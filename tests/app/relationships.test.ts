import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { relationshipsFixture } from "./relationships-fixture";
import { createInvitationService } from "../../src/server/invitations/service";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";

const open: Awaited<ReturnType<typeof relationshipsFixture>>[] = [];
async function fixture() { const f = await relationshipsFixture(); open.push(f); return f; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(open.splice(0).map(f => f.client.close())); });
const admin = { mode: "admin" as const };
const active = { expectedState: "active" as const };
async function denied(action: () => Promise<unknown>, status = 404) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}

describe("admin tenant authority management", () => {
  it("lists only eligible tenant tutors with authorized labels and safe exact relationship DTOs", async () => {
    const f = await fixture();
    await f.owner(async () => {
      await f.db.update(s.user).set({ name: "Synthetic tutor" }).where(eq(s.user.id, f.identities.multi.id));
      await f.db.update(s.user).set({ name: "profile@example.test" }).where(eq(s.user.id, f.identities.learner.id));
      const [otherMember] = await f.db.select().from(s.membership).where(and(eq(s.membership.tenantId, "other"), eq(s.membership.userId, f.identities.multi.id)));
      await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: otherMember.id, role: "tutor" });
    });
    await f.owner(async () => {
      for (const update of [() => f.db.update(s.guardian).set({ revision: 0 }).where(eq(s.guardian.id, f.guardians[0].id)),
        () => f.db.update(s.roleGrant).set({ revision: 0 }).where(eq(s.roleGrant.id, f.tutorGrant.id))]) {
        let rejected = false;
        try { await update(); } catch (error) { const row = error as { code?: string; cause?: { code?: string } }; rejected = (row.cause?.code ?? row.code) === "23514"; }
        expect(rejected).toBe(true);
      }
    });
    const tutors = await f.relationships.listEligibleTutors(f.request("admin", undefined, { method: "GET" }), admin);
    expect(tutors.length === 1 && tutors[0].id === f.tutorGrant.id && tutors[0].revision === 1 && tutors[0].displayName === "Synthetic tutor" && !tutors[0].isCantor).toBe(true);
    expect((await f.relationships.listEligibleTutors(f.request("admin"), { ...admin, afterId: tutors[0].id, limit: 1 })).length === 0).toBe(true);
    const current = await f.relationships.inspectStudent(f.request("admin"), { ...admin, studentId: f.students[0].id });
    expect(!current.student.disabled && current.guardians.length === 1 && current.identities.length === 1 && current.tutors.length === 1
      && current.guardians[0].displayName === "Synthetic tutor" && current.tutors[0].displayName === "Synthetic tutor" && current.identities[0].displayName === "Student"
      && current.guardians[0].id === f.guardians[0].id && current.guardians[0].revision === 1 && current.guardians[0].effectivePractice).toBe(true);
    const encoded = JSON.stringify({ tutors, current });
    expect(!encoded.includes("@") && !encoded.includes(f.identities.multi.id) && !encoded.includes(f.identities.multi.sessionId)
      && !encoded.includes(f.multiMember.id) && !encoded.includes("linkProvenance") && !encoded.includes("userId")).toBe(true);
    await f.owner(async () => { await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.multiMember.id)); });
    expect((await f.relationships.listEligibleTutors(f.request("admin"), admin)).length === 0).toBe(true);
  });

  it("requires actual admin mode and denies forged child context, wrong tenant, unverified and stale sessions", async () => {
    const f = await fixture();
    for (const who of ["multi", "learner"] as const) {
      expect(await denied(() => f.relationships.inspectStudent(f.request(who), { ...admin, studentId: f.students[0].id }), 403)).toBe(true);
      expect(await denied(() => f.relationships.assignTutor(f.request(who), { ...admin, studentId: f.students[1].id, tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" }), 403)).toBe(true);
    }
    expect(await denied(() => f.relationships.listEligibleTutors(f.request("admin"), { mode: "parent" }), 403)).toBe(true);
    expect(await denied(() => f.relationships.setCantor(f.request("admin", ""), { ...admin, roleGrantId: f.tutorGrant.id, expectedRevision: 1, isCantor: true }), 403)).toBe(true);
    expect(await denied(() => f.relationships.inspectStudent(f.request("admin", ""), { ...admin, studentId: f.students[0].id }), 403)).toBe(true);
    expect(await denied(() => f.relationships.inspectStudent(f.request("admin"), { ...admin, studentId: f.students[3].id }))).toBe(true);
    expect(await denied(() => f.relationships.inspectStudent(f.request("admin", undefined, { cookie: "" }), { ...admin, studentId: f.students[0].id }), 401)).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.admin.id)); });
    expect(await denied(() => f.relationships.listEligibleTutors(f.request("admin"), admin), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, f.identities.admin.id)); });
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    // Reads retain ordinary session availability; only authority writes need freshness.
    expect((await f.relationships.listEligibleTutors(f.request("admin"), admin)).length === 1).toBe(true);
    expect(await denied(() => f.relationships.assignTutor(f.request("admin"), { ...admin, studentId: f.students[1].id, tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" }), 403)).toBe(true);
  });

  it("assigns/unassigns explicit tutor grants, retains old rows and rejects stale exact-link operations", async () => {
    const f = await fixture();
    const selection = { ...admin, studentId: f.students[1].id, tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" as const };
    const assigned = await f.relationships.assignTutor(f.request("admin"), selection);
    expect(assigned.ok).toBe(true); if (!assigned.ok) throw new Error("Expected assignment missing");
    expect((await f.service.readStudent(f.request("multi"), { mode: "tutor", studentId: f.students[1].id })).id === f.students[1].id).toBe(true);
    expect(!(await f.relationships.assignTutor(f.request("admin"), selection)).ok).toBe(true);
    const revoke = { ...admin, ...active, studentId: f.students[1].id, linkId: assigned.id };
    expect((await f.relationships.revokeTutor(f.request("admin"), revoke)).ok).toBe(true);
    expect(await denied(() => f.service.readStudent(f.request("multi"), { mode: "tutor", studentId: f.students[1].id }))).toBe(true);
    const reissued = await f.relationships.assignTutor(f.request("admin"), selection);
    expect(reissued.ok && reissued.id !== assigned.id).toBe(true);
    expect(!(await f.relationships.revokeTutor(f.request("admin"), revoke)).ok).toBe(true);
    expect((await f.service.readStudent(f.request("multi"), { mode: "tutor", studentId: f.students[1].id })).id === f.students[1].id).toBe(true);
    await f.owner(async () => {
      const rows = await f.db.select().from(s.tutorStudent).where(and(eq(s.tutorStudent.studentId, f.students[1].id), eq(s.tutorStudent.tutorGrantId, f.tutorGrant.id)));
      expect(rows.length === 2 && rows.filter(row => row.revokedAt === null).length === 1).toBe(true);
    });
  });

  it("rejects foreign/wrong-role/inactive tutor targets and disabled students but permits inspection/revocation cleanup", async () => {
    const f = await fixture();
    let foreign = "";
    await f.owner(async () => {
      const [other] = await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other"));
      [foreign] = (await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: other.id, role: "tutor" }).returning({ id: s.roleGrant.id })).map(row => row.id);
      await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.students[0].id));
    });
    for (const tutorGrantId of [foreign, f.parentGrant.id, crypto.randomUUID()]) expect(await denied(() => f.relationships.assignTutor(f.request("admin"), { ...admin, studentId: f.students[1].id, tutorGrantId, expectedState: "unassigned" }))).toBe(true);
    expect(await denied(() => f.relationships.assignTutor(f.request("admin"), { ...admin, studentId: f.students[0].id, tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" }))).toBe(true);
    const current = await f.relationships.inspectStudent(f.request("admin"), { ...admin, studentId: f.students[0].id });
    expect(current.student.disabled && !current.guardians[0].effectivePractice).toBe(true);
    expect((await f.relationships.revokeTutor(f.request("admin"), { ...admin, ...active, studentId: f.students[0].id, linkId: f.tutorLink.id })).ok).toBe(true);
    await f.owner(async () => { await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.multiMember.id)); });
    expect(await denied(() => f.relationships.assignTutor(f.request("admin"), { ...admin, studentId: f.students[1].id, tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" }))).toBe(true);
    expect((await f.relationships.revokeGuardian(f.request("admin"), { ...admin, ...active, studentId: f.students[0].id, linkId: f.guardians[0].id })).ok).toBe(true);
  });

  it("uses revision CAS against guardian flag ABA and never revives disabled-context handles or sibling authority", async () => {
    const f = await fixture();
    const a = await f.practice.enter(f.request(), { studentId: f.students[0].id }), a2 = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const b = await f.practice.enter(f.request(), { studentId: f.students[1].id });
    const flag = { ...admin, studentId: f.students[0].id, guardianId: f.guardians[0].id };
    const disabled = await f.relationships.setGuardianPractice(f.request("admin"), { ...flag, expectedRevision: 1, practiceEnabled: false });
    expect(disabled.ok && disabled.revision === 2).toBe(true);
    expect((await f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[0].id })).id === f.students[0].id).toBe(true);
    for (const handle of [a.handle, a2.handle]) expect(await denied(() => f.practice.read(f.request("multi", handle), { mode: "child-practice", studentId: f.students[0].id }))).toBe(true);
    expect((await f.practice.read(f.request("multi", b.handle), { mode: "child-practice", studentId: f.students[1].id })).context?.id === b.context.id).toBe(true);
    const enabled = await f.relationships.setGuardianPractice(f.request("admin"), { ...flag, expectedRevision: 2, practiceEnabled: true });
    expect(enabled.ok && enabled.revision === 3).toBe(true);
    expect(!(await f.relationships.setGuardianPractice(f.request("admin"), { ...flag, expectedRevision: 1, practiceEnabled: false })).ok).toBe(true);
    expect(await denied(() => f.practice.read(f.request("multi", a.handle), { mode: "child-practice", studentId: f.students[0].id }))).toBe(true);
    const fresh = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    expect((await f.practice.read(f.request("multi", fresh.handle), { mode: "child-practice", studentId: f.students[0].id })).context?.id === fresh.context.id).toBe(true);
    await f.owner(async () => {
      const [member] = await f.db.select().from(s.membership).where(eq(s.membership.id, f.multiMember.id));
      expect(member.authorityRevision === 1).toBe(true);
      const audit = await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "guardian.practice-set"));
      expect(audit.length === 2 && audit.every(row => row.guardianId === f.guardians[0].id && row.actorUserId === f.identities.admin.id && row.mode === "admin")).toBe(true);
    });
  });

  it("revokes exactly one guardian and its contexts while preserving its sibling and own-student identity", async () => {
    const f = await fixture();
    const a = await f.practice.enter(f.request(), { studentId: f.students[0].id }), b = await f.practice.enter(f.request(), { studentId: f.students[1].id });
    const revoke = { ...admin, ...active, studentId: f.students[0].id, linkId: f.guardians[0].id };
    expect((await f.relationships.revokeGuardian(f.request("admin"), revoke)).ok).toBe(true);
    expect(!(await f.relationships.revokeGuardian(f.request("admin"), revoke)).ok).toBe(true);
    expect(await denied(() => f.practice.read(f.request("multi", a.handle), { mode: "child-practice", studentId: f.students[0].id }))).toBe(true);
    expect(await denied(() => f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[0].id }))).toBe(true);
    expect((await f.practice.read(f.request("multi", b.handle), { mode: "child-practice", studentId: f.students[1].id })).context?.id === b.context.id).toBe(true);
    expect((await f.service.readStudent(f.request("learner"), { mode: "student", studentId: f.students[0].id })).id === f.students[0].id).toBe(true);
    await f.owner(async () => {
      const [old] = await f.db.select().from(s.practiceContext).where(eq(s.practiceContext.id, a.context.id));
      expect(old.revokedAt !== null).toBe(true);
    });
  });

  it("revokes own identity without revoking the student's parent practice, and does not expose a relink method", async () => {
    const f = await fixture(); const parent = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    expect((await f.relationships.revokeStudentIdentity(f.request("admin"), { ...admin, ...active, studentId: f.students[0].id, linkId: f.learnerLink.id })).ok).toBe(true);
    expect(await denied(() => f.service.readStudent(f.request("learner"), { mode: "student", studentId: f.students[0].id }))).toBe(true);
    expect((await f.practice.read(f.request("multi", parent.handle), { mode: "child-practice", studentId: f.students[0].id })).context?.id === parent.context.id).toBe(true);
    expect(!Object.hasOwn(f.relationships, "linkGuardian") && !Object.hasOwn(f.relationships, "linkStudent") && !Object.hasOwn(f.relationships, "grantRole")).toBe(true);
  });

  it("changes only the tutor cantor flag with revision CAS and cannot grant/revoke administrator authority", async () => {
    const f = await fixture(); const subject = { ...admin, roleGrantId: f.tutorGrant.id };
    const enabled = await f.relationships.setCantor(f.request("admin"), { ...subject, expectedRevision: 1, isCantor: true });
    expect(enabled.ok && enabled.revision === 2 && enabled.isCantor).toBe(true);
    expect((await f.relationships.setCantor(f.request("admin"), { ...subject, expectedRevision: 2, isCantor: false })).ok).toBe(true);
    expect(!(await f.relationships.setCantor(f.request("admin"), { ...subject, expectedRevision: 1, isCantor: true })).ok).toBe(true);
    expect(await denied(() => f.relationships.listEligibleTutors(f.request("multi"), admin), 403)).toBe(true);
    expect(await denied(() => f.relationships.setCantor(f.request("admin"), { ...admin, roleGrantId: f.parentGrant.id, expectedRevision: 1, isCantor: true }))).toBe(true);
    expect(await denied(() => f.relationships.revokeRoleGrant(f.request("admin"), { ...admin, ...active, roleGrantId: f.adminGrant.id, expectedRevision: 1 }), 403)).toBe(true);
    expect(!(await f.relationships.revokeRoleGrant(f.request("admin"), { ...subject, ...active, expectedRevision: 1 })).ok).toBe(true);
    const revoked = await f.relationships.revokeRoleGrant(f.request("admin"), { ...subject, ...active, expectedRevision: 3 });
    expect(revoked.ok && revoked.revision === 4).toBe(true);
    expect(await denied(() => f.service.readStudent(f.request("multi"), { mode: "tutor", studentId: f.students[0].id }), 403)).toBe(true);
    expect((await f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[0].id })).id === f.students[0].id).toBe(true);
  });

  it("revokes a parent grant and its contexts conservatively without changing sibling grants or admin ownership", async () => {
    const f = await fixture(); const a = await f.practice.enter(f.request(), { studentId: f.students[0].id }), b = await f.practice.enter(f.request(), { studentId: f.students[1].id });
    expect((await f.relationships.revokeRoleGrant(f.request("admin"), { ...admin, ...active, roleGrantId: f.parentGrant.id, expectedRevision: 1 })).ok).toBe(true);
    for (const [handle, studentId] of [[a.handle, f.students[0].id], [b.handle, f.students[1].id]]) expect(await denied(() => f.practice.read(f.request("multi", handle), { mode: "child-practice", studentId }), 403)).toBe(true);
    expect((await f.service.readStudent(f.request("multi"), { mode: "tutor", studentId: f.students[0].id })).id === f.students[0].id).toBe(true);
    expect(!(await f.relationships.revokeRoleGrant(f.request("admin"), { ...admin, ...active, roleGrantId: f.parentGrant.id, expectedRevision: 2 })).ok).toBe(true);
    await f.owner(async () => { const rows = await f.db.select().from(s.practiceContext); expect(rows.length === 2 && rows.every(row => row.revokedAt !== null)).toBe(true); });
  });

  it("requires exact-Origin POST for authority writes and rolls back flag/context changes if audit fails", async () => {
    const f = await fixture(); const context = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const selection = { ...admin, studentId: f.students[0].id, guardianId: f.guardians[0].id, expectedRevision: 1, practiceEnabled: false };
    for (const options of [{ method: "GET" }, { headers: { origin: "https://foreign.example.test" } }, { headers: { origin: "null" } }, { headers: { "sec-fetch-site": "cross-site" } }] as NonNullable<Parameters<typeof f.request>[2]>[]) {
      expect(await denied(() => f.relationships.setGuardianPractice(f.request("admin", undefined, options), selection), 403)).toBe(true);
    }
    await f.owner(async () => {
      await f.client.exec(`CREATE FUNCTION synthetic_relationship_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='guardian.practice-set' THEN RAISE EXCEPTION 'Synthetic relationship audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_relationship_audit_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_relationship_audit_failure()`);
    });
    let safeFailure = false;
    try { await f.relationships.setGuardianPractice(f.request("admin"), selection); } catch (error) { safeFailure = error instanceof AccessUnavailable; }
    expect(safeFailure).toBe(true);
    expect((await f.practice.read(f.request("multi", context.handle), { mode: "child-practice", studentId: f.students[0].id })).context?.id === context.context.id).toBe(true);
    await f.owner(async () => { const [row] = await f.db.select().from(s.guardian).where(eq(s.guardian.id, f.guardians[0].id)); expect(row.practiceEnabled && row.revision === 1).toBe(true); });
  });

  it("keeps pending invitation history invalid after an admin guardian revoke and permits only a fresh explicit reinvite", async () => {
    const f = await fixture(); let url = "";
    const invitations = createInvitationService({ db: f.db, access: f.service, throttleSecret: randomBytes(48).toString("base64url"), transport: async message => { url = message.url; } });
    const input = { ...admin, role: "parent" as const, studentId: f.students[0].id, email: "multi@example.test" };
    await invitations.issue(f.request("admin"), input); const old = new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
    await f.relationships.revokeGuardian(f.request("admin"), { ...admin, ...active, studentId: f.students[0].id, linkId: f.guardians[0].id });
    expect(await denied(() => invitations.preview(f.request("multi"), { token: old }))).toBe(true);
    expect(await denied(() => invitations.accept(f.request("multi"), { token: old }))).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 1000));
    await invitations.issue(f.request("admin"), input); const fresh = new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
    const preview = await invitations.preview(f.request("multi"), { token: fresh });
    expect((await invitations.acceptReviewed(f.request("multi"), { token: fresh, reviewBinding: preview.reviewBinding })).studentId === f.students[0].id).toBe(true);
    expect(!(await f.relationships.revokeGuardian(f.request("admin"), { ...admin, ...active, studentId: f.students[0].id, linkId: f.guardians[0].id })).ok).toBe(true);
    expect((await f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[0].id })).id === f.students[0].id).toBe(true);
  });
});
