import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { practiceFixture } from "./practice-fixture";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import { PRACTICE_LIFETIME_MS } from "../../src/server/practice/handles";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof practiceFixture>>[] = [];
async function fixture() { const f = await practiceFixture(); fixtures.push(f); return f; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(fixtures.splice(0).map((f) => f.client.close())); });
async function denied(operation: () => Promise<unknown>, status = 404) {
  try { await operation(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}
const selection = (studentId: string) => ({ mode: "child-practice" as const, studentId });

describe("per-tab parent child practice contexts", () => {
  it("creates a hashed 256-bit private handle with session binding, bounded expiry and atomic audit", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    expect(/^[A-Za-z0-9_-]{43}$/.test(entered.handle) && Buffer.from(entered.handle, "base64url").length === 32).toBe(true);
    await f.owner(async () => {
      const [row] = await f.db.select().from(s.practiceContext);
      const audit = await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, row.id));
      expect(row.tokenHash === createHash("sha256").update(entered.handle).digest("hex") && !JSON.stringify(row).includes(entered.handle)).toBe(true);
      expect(row.mode === "child-practice" && row.role === "parent" && row.actorUserId === f.identities.multi.id && row.authSessionId === f.identities.multi.sessionId
        && row.actorMembershipId === f.multiMember.id && row.roleGrantId === f.parentGrant.id && row.guardianId === f.guardians[0].id && row.actingStudentId === f.students[0].id).toBe(true);
      expect(row.expiresAt.getTime() - row.createdAt.getTime() === PRACTICE_LIFETIME_MS && entered.context.id === row.id && entered.context.authorityRevision === f.multiMember.authorityRevision).toBe(true);
      expect(audit.length === 1 && audit[0].action === "context.enter" && audit[0].mode === "child-practice" && audit[0].actingStudentId === row.actingStudentId && audit[0].guardianId === row.guardianId).toBe(true);
    });
    const result = await f.practice.read(f.request("multi", entered.handle, { method: "GET" }), selection(f.students[0].id));
    expect(result.student.id === f.students[0].id && result.context?.id === entered.context.id && result.context.studentRevision === f.students[0].revision
      && !JSON.stringify(result).includes(entered.handle) && !JSON.stringify(result).includes("@")).toBe(true);
  });

  it("keeps sibling handles independent across tabs and denies late old-handle requests after switch", async () => {
    const f = await fixture();
    const tabA = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const tabB = await f.practice.enter(f.request(), { studentId: f.students[1].id });
    const switched = await f.practice.switch(f.request("multi", tabA.handle), { studentId: f.students[1].id });
    expect(tabA.handle !== tabB.handle && switched.handle !== tabA.handle && switched.context.id !== tabA.context.id).toBe(true);
    expect(await denied(() => f.practice.read(f.request("multi", tabA.handle), selection(f.students[0].id)))).toBe(true);
    let writes = 0;
    expect(await denied(() => f.practice.withPracticeCapability(f.request("multi", tabA.handle), { ...selection(f.students[0].id), capability: "practice-write" }, async () => { writes++; }))).toBe(true);
    expect(writes === 0).toBe(true);
    expect((await f.practice.read(f.request("multi", tabB.handle), selection(f.students[1].id))).context?.id === tabB.context.id).toBe(true);
    expect((await f.practice.read(f.request("multi", switched.handle), selection(f.students[1].id))).context?.id === switched.context.id).toBe(true);
    await f.practice.exit(f.request("multi", switched.handle));
    expect(await denied(() => f.practice.read(f.request("multi", switched.handle), selection(f.students[1].id)))).toBe(true);
    expect((await f.practice.read(f.request("multi", tabB.handle), selection(f.students[1].id))).context?.id === tabB.context.id).toBe(true);
    expect(await denied(() => f.practice.switch(f.request("multi", tabA.handle), { studentId: f.students[0].id }))).toBe(true);
  });

  it("requires exact target, tenant and real cookie/session, rejecting absent/malformed or URL handles", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    for (const handle of [undefined, "", "x", `${entered.handle},${entered.handle}`, randomBytes(32).toString("base64url")]) {
      expect(await denied(() => f.practice.read(f.request("multi", handle), selection(f.students[0].id)))).toBe(true);
    }
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle), selection(f.students[1].id)))).toBe(true);
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle), selection(crypto.randomUUID())))).toBe(true);
    const urlOnly = { ...f.request(), url: `http://localhost:3000/practice?context=${entered.handle}` };
    expect(await denied(() => f.practice.read(urlOnly, selection(f.students[0].id)))).toBe(true);
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle, { cookie: "" }), selection(f.students[0].id)), 401)).toBe(true);
    expect(await denied(() => f.practice.read(f.request("admin", entered.handle), selection(f.students[0].id)), 403)).toBe(true);
    await f.owner(async () => {
      // Same global identity also has an independent parent role/child at B.
      const [member] = await f.db.select().from(s.membership).where(and(eq(s.membership.tenantId, "other"), eq(s.membership.userId, f.identities.multi.id)));
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: member.id, role: "parent" }).returning();
      await f.db.insert(s.guardian).values({ tenantId: "other", studentId: f.students[3].id, parentGrantId: grant.id, linkProvenance: "synthetic" });
    });
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle, { origin: "http://localhost:3101" }), selection(f.students[3].id)))).toBe(true);
    let otherCookie = "";
    await f.owner(async () => { otherCookie = (await f.signIn("multi@example.test")).cookie; });
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle, { cookie: otherCookie }), selection(f.students[0].id)))).toBe(true);
    expect(await denied(() => f.practice.exit(f.request("multi", entered.handle, { cookie: otherCookie })))).toBe(true);
  });

  it("requires POST and exact resolved Origin for enter/switch/exit and writes", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const invalidOptions: NonNullable<Parameters<typeof f.request>[2]>[] = [{ method: "GET" }, { headers: { origin: "null" } }, { headers: { origin: "https://evil.example.test" } }, { headers: { "sec-fetch-site": "cross-site" } }];
    for (const options of invalidOptions) {
      expect(await denied(() => f.practice.enter(f.request("multi", undefined, options), { studentId: f.students[0].id }), 403)).toBe(true);
      expect(await denied(() => f.practice.switch(f.request("multi", entered.handle, options), { studentId: f.students[1].id }), 403)).toBe(true);
      expect(await denied(() => f.practice.exit(f.request("multi", entered.handle, options)), 403)).toBe(true);
      expect(await denied(() => f.practice.withPracticeCapability(f.request("multi", entered.handle, options), { ...selection(f.students[0].id), capability: "practice-write" }, async () => true), 403)).toBe(true);
    }
    const absent = f.request("multi", entered.handle); absent.headers.delete("origin");
    expect(await denied(() => f.practice.exit(absent), 403)).toBe(true);
    expect((await f.practice.read(f.request("multi", entered.handle, { method: "GET" }), selection(f.students[0].id))).context?.id === entered.context.id).toBe(true);
  });

  it("never unions a parent+tutor's child practice into staff or parent-base writes", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    let calls = 0;
    const request = f.request("multi", entered.handle);
    expect(await denied(() => f.service.withStudentCapability(request, { mode: "tutor", studentId: f.students[0].id, capability: "set-reading" }, async () => { calls++; }), 403)).toBe(true);
    expect(await denied(() => f.service.withAdminCapability(request, { mode: "admin", capability: "manage-invites" }, async () => { calls++; }), 403)).toBe(true);
    for (const mode of ["parent", "tutor", "admin"] as const) {
      expect(await denied(() => f.service.withStudentCapability(f.request(), { mode, studentId: f.students[0].id, capability: "practice-write" }, async () => { calls++; }), 403)).toBe(true);
    }
    expect(await denied(() => f.practice.withPracticeCapability(request, { ...selection(f.students[0].id), capability: "set-reading" as "practice-write" }, async () => { calls++; }), 403)).toBe(true);
    for (const handle of [entered.handle, ""]) {
      expect(await denied(() => f.service.withVerifiedIdentity(f.request("multi", handle), { intent: "authority-write", mutation: true }, async () => { calls++; }), 403)).toBe(true);
    }
    expect(calls === 0).toBe(true);
    expect(await f.practice.withPracticeCapability(request, { ...selection(f.students[0].id), capability: "practice-write" }, async (_tx, actor) => actor.mode === "child-practice" && actor.role === "parent" && actor.userId === f.identities.multi.id)).toBe(true);
    expect((await f.service.readStudent(f.request(), { mode: "parent", studentId: f.students[0].id })).id === f.students[0].id).toBe(true);
  });

  it("supports own-student practice without a parent handle through its live identity link", async () => {
    const f = await fixture();
    const own = { mode: "student" as const, studentId: f.students[0].id };
    const result = await f.practice.read(f.request("learner", undefined, { method: "GET" }), own);
    expect(result.mode === "student" && result.context === null && result.student.id === f.students[0].id).toBe(true);
    expect(await f.practice.withPracticeCapability(f.request("learner"), { ...own, capability: "practice-write" }, async (_tx, actor) => actor.mode === "student" && actor.role === "student" && actor.context === null)).toBe(true);
    expect(await denied(() => f.practice.withPracticeCapability(f.request("learner", undefined, { method: "GET" }), { ...own, capability: "practice-write" }, async () => true), 403)).toBe(true);
    expect(await denied(() => f.practice.read(f.request("learner"), { ...own, studentId: f.students[1].id }))).toBe(true);
    await f.owner(async () => { await f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)); });
    expect(await denied(() => f.practice.read(f.request("learner"), own))).toBe(true);
  });

  it("bounds lifetime by live session expiry and denies the exact expiry instant", async () => {
    const f = await fixture();
    const expiresAt = new Date(Date.now() + 12 * 60_000);
    await f.owner(async () => { await f.db.update(s.session).set({ expiresAt }).where(eq(s.session.id, f.identities.multi.sessionId)); });
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    expect(new Date(entered.context.expiresAt).getTime() === expiresAt.getTime()).toBe(true);
    vi.setSystemTime(expiresAt);
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle), selection(f.students[0].id)), 401)).toBe(true);
  });

  it("denies exact60minute context expiry while the auth session remains live", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const expiry = new Date(entered.context.expiresAt);
    vi.setSystemTime(new Date(expiry.getTime() - 1));
    expect((await f.practice.read(f.request("multi", entered.handle), selection(f.students[0].id))).context?.id === entered.context.id).toBe(true);
    vi.setSystemTime(expiry);
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle), selection(f.students[0].id)))).toBe(true);
    // Expired bound contexts can still be cleared or replaced deliberately.
    const switched = await f.practice.switch(f.request("multi", entered.handle), { studentId: f.students[1].id });
    expect(switched.context.id !== entered.context.id).toBe(true);
    expect((await f.practice.exit(f.request("multi", entered.handle))).status === "closed").toBe(true);
  });

  it("denies next read/write after live revocation, disable, revision change or logout", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const request = f.request("multi", entered.handle);
    async function bothDeny(status: 401 | 403 | 404) {
      expect(await denied(() => f.practice.read(request, selection(f.students[0].id)), status)).toBe(true);
      expect(await denied(() => f.practice.withPracticeCapability(request, { ...selection(f.students[0].id), capability: "practice-write" }, async () => true), status)).toBe(true);
    }
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.multi.id)); });
    await bothDeny(403);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, f.identities.multi.id)); });
    await f.owner(async () => { await f.db.update(s.guardian).set({ practiceEnabled: false }).where(eq(s.guardian.id, f.guardians[0].id)); });
    await bothDeny(404);
    await f.owner(async () => {
      await f.db.update(s.guardian).set({ practiceEnabled: true }).where(eq(s.guardian.id, f.guardians[0].id));
      await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.students[0].id));
    });
    await bothDeny(404);
    await f.owner(async () => {
      await f.db.update(s.student).set({ disabledAt: null }).where(eq(s.student.id, f.students[0].id));
      await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.multiMember.id));
    });
    await bothDeny(403);
    await f.owner(async () => {
      await f.db.update(s.membership).set({ disabledAt: null, authorityRevision: 2 }).where(eq(s.membership.id, f.multiMember.id));
    });
    await bothDeny(404);
    await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.parentGrant.id)); });
    await bothDeny(403);
    await f.owner(async () => { await f.db.delete(s.session).where(eq(s.session.id, f.identities.multi.sessionId)); });
    await bothDeny(401);
  });

  it("allows clearing revoked old authority and switching only to a newly authorized sibling", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const tabB = await f.practice.enter(f.request(), { studentId: f.students[1].id });
    await f.owner(async () => {
      await f.db.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.id, f.guardians[0].id));
    });
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle), selection(f.students[0].id)))).toBe(true);
    expect(await denied(() => f.practice.withPracticeCapability(f.request("multi", entered.handle), { ...selection(f.students[0].id), capability: "practice-write" }, async () => true))).toBe(true);
    const switched = await f.practice.switch(f.request("multi", entered.handle), { studentId: f.students[1].id });
    expect((await f.practice.read(f.request("multi", switched.handle), selection(f.students[1].id))).context?.id === switched.context.id).toBe(true);
    expect((await f.practice.exit(f.request("multi", entered.handle))).status === "closed").toBe(true);
    await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.parentGrant.id)); });
    // Exiting old contexts needs a live real identity, not the revoked role.
    expect((await f.practice.exit(f.request("multi", tabB.handle))).status === "closed").toBe(true);
    expect((await f.practice.exit(f.request("multi", tabB.handle))).status === "closed").toBe(true);
    await f.owner(async () => {
      const exits = await f.db.select().from(s.auditEvent).where(and(eq(s.auditEvent.action, "context.exit"), eq(s.auditEvent.targetId, tabB.context.id)));
      expect(exits.length === 1 && exits[0].guardianId === f.guardians[1].id).toBe(true);
    });
  });

  it("can replace an expired/revoked-grant context using a fresh explicit parent grant and sibling link", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    await f.owner(async () => {
      await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.parentGrant.id));
      const [newGrant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "parent" }).returning();
      await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.students[1].id, parentGrantId: newGrant.id, linkProvenance: "synthetic-new-link" });
      await f.db.update(s.membership).set({ authorityRevision: 2 }).where(eq(s.membership.id, f.multiMember.id));
    });
    vi.setSystemTime(new Date(entered.context.expiresAt));
    const switched = await f.practice.switch(f.request("multi", entered.handle), { studentId: f.students[1].id });
    expect(switched.context.authorityRevision === 2 && switched.context.id !== entered.context.id).toBe(true);
    expect((await f.practice.read(f.request("multi", switched.handle), selection(f.students[1].id))).context?.id === switched.context.id).toBe(true);
    expect(await denied(() => f.practice.read(f.request("multi", entered.handle), selection(f.students[0].id)))).toBe(true);
    await f.owner(async () => {
      const old = await f.db.select().from(s.practiceContext).where(eq(s.practiceContext.id, entered.context.id));
      const exits = await f.db.select().from(s.auditEvent).where(and(eq(s.auditEvent.action, "context.exit"), eq(s.auditEvent.targetId, entered.context.id)));
      expect(old.length === 1 && Boolean(old[0].revokedAt) && exits.length === 1 && exits[0].roleGrantId === f.parentGrant.id).toBe(true);
    });
  });

  it("leaves prior handle active after unauthorized switch, foreign exit or failed atomic audit", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    for (const studentId of [f.students[2].id, f.students[3].id, crypto.randomUUID()]) {
      expect(await denied(() => f.practice.switch(f.request("multi", entered.handle), { studentId }))).toBe(true);
    }
    expect(await denied(() => f.practice.exit(f.request("admin", entered.handle)))).toBe(true);
    await f.owner(async () => {
      await f.client.exec(`CREATE FUNCTION synthetic_context_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='context.enter' THEN RAISE EXCEPTION 'Synthetic context audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_context_audit_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_context_audit_failure()`);
    });
    let safeFailure = false;
    try { await f.practice.switch(f.request("multi", entered.handle), { studentId: f.students[1].id }); } catch (error) { safeFailure = error instanceof AccessUnavailable && !error.message.includes(entered.handle); }
    expect(safeFailure).toBe(true);
    expect((await f.practice.read(f.request("multi", entered.handle), selection(f.students[0].id))).context?.id === entered.context.id).toBe(true);
    await f.owner(async () => {
      const rows = await f.db.select().from(s.practiceContext);
      const audit = await f.db.select().from(s.auditEvent);
      expect(rows.length === 1 && rows[0].revokedAt === null && audit.length === 1 && audit[0].action === "context.enter").toBe(true);
    });
  });

  it("rolls back a future internal practice-write callback and its audit as one transaction", async () => {
    const f = await fixture();
    const entered = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    let completedInsert = false;
    let safeFailure = false;
    try {
      await f.practice.withPracticeCapability(f.request("multi", entered.handle), { ...selection(f.students[0].id), capability: "practice-write" }, async (tx, actor) => {
        // Synthetic audit side effect stands in for a future separately-reviewed
        // practice feature; no translation/recording schema is introduced here.
        await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId,
          roleGrantId: actor.roleGrantId, mode: actor.mode, actingStudentId: actor.studentId, action: "context.enter", targetType: "synthetic-practice-write",
          targetId: actor.context!.id, requestId: crypto.randomUUID() });
        completedInsert = true;
        throw new Error("Synthetic callback failure");
      });
    } catch (error) { safeFailure = error instanceof AccessUnavailable; }
    expect(completedInsert && safeFailure).toBe(true);
    await f.owner(async () => {
      expect((await f.db.select().from(s.auditEvent)).length === 1 && (await f.db.select().from(s.practiceContext))[0].revokedAt === null).toBe(true);
    });
  });
});
