import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, isNull } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { CHIP_TEXT, weekCards, studentFacts, type StudentStatus } from "../../src/components/portal/workspace/staff/model";

// Release 1.9 N14/N15 staff screens, server side. Synthetic people only. The fixture's "multi" is the tutor of Sibling A and the
// parent of Siblings A and B; "learner" is Sibling A's own account; "recipient" becomes a second tutor here; students[3] and a
// tutor grant made here belong to another congregation.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient";

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const [own, sibling, unrelated, other] = f.students;
  const call = async (path: string, who: Who, body?: unknown, headers: Record<string, string> = {}) => {
    const h = new Headers(headers); h.set("cookie", f.identities[who].cookie);
    if (body !== undefined) { if (!h.has("origin")) h.set("origin", ORIGIN); h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await response.text();
    return { status: response.status, text, json: (text ? JSON.parse(text) : null) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  // A second tutor here (the routes recipient), and a tutor of the other congregation.
  const { secondTutor, foreignTutor } = await f.owner(async () => {
    const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id }).returning();
    const [secondTutor] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "tutor" }).returning();
    const [otherMember] = await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other"));
    const [foreignTutor] = await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: otherMember.id, role: "tutor" }).returning();
    await f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, f.identities.recipient.id));
    return { secondTutor, foreignTutor };
  });
  const liveTutors = (studentId: string) => f.owner(async () => (await f.db.select({ grant: s.tutorStudent.tutorGrantId }).from(s.tutorStudent)
    .where(and(eq(s.tutorStudent.studentId, studentId), isNull(s.tutorStudent.revokedAt)))).map(row => row.grant));
  const grantOf = (id: string) => f.owner(async () => (await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.id, id)))[0]);
  const revisionOf = async (studentId: string) => (await f.owner(() => f.db.select({ revision: s.student.revision }).from(s.student).where(eq(s.student.id, studentId))))[0].revision;
  return { f, call, own, sibling, unrelated, other, secondTutor, foreignTutor, liveTutors, grantOf, revisionOf };
}
const isoIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

describe("Needs you (N14)", () => {
  it("lists a ceremony six weeks out with no tutor as one row with one verb, from facts only an admin reads", async () => {
    const t = await setup();
    await t.f.owner(() => t.f.db.update(s.student).set({ ceremonyDate: isoIn(42) }).where(eq(s.student.id, t.unrelated.id)));
    const response = await t.call("/api/admin/student-status", "admin");
    expect(response.status).toBe(200);
    expect(response.text).not.toMatch(/@/);
    const statuses = new Map<string, StudentStatus>(response.json.students.map((row: StudentStatus) => [row.id, row]));
    // Only this congregation's students; the other congregation's is never named.
    expect([...statuses.keys()].sort()).toEqual([t.own.id, t.sibling.id, t.unrelated.id].sort());
    expect(statuses.get(t.unrelated.id)).toEqual({ id: t.unrelated.id, tutors: 0, family: "none", reading: "none", honors: false, tutorName: null, got: 0, total: 0 });
    expect(statuses.get(t.own.id)).toMatchObject({ tutors: 1, family: "joined" });
    // The tutor is named as the People page names them (never an address); verse counts are counts only.
    expect(typeof statuses.get(t.own.id)!.tutorName).toBe("string");
    // A parent whose address is unverified has not joined, by the same rule as the tutor's family line.
    await t.f.owner(() => t.f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, t.f.identities.multi.id)));
    expect((await t.call("/api/admin/student-status", "admin")).json.students.find((row: StudentStatus) => row.id === t.own.id).family).toBe("none");
    await t.f.owner(() => t.f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, t.f.identities.multi.id)));
    const roster = (await t.call("/api/admin/students", "admin")).json.students;
    const cards = weekCards(roster, statuses).filter(card => card.student.id === t.unrelated.id);
    expect(cards).toHaveLength(1); expect(cards[0].chips).toContain("no-tutor");
    expect(CHIP_TEXT["no-tutor"]).toBe("Needs a tutor");
    // The students a year out are not listed at all.
    expect(weekCards(roster, statuses).some(card => card.student.id === t.own.id)).toBe(false);
    expect(studentFacts(statuses.get(t.unrelated.id)!)).toContain("No tutor yet");
  });

  it("refuses everyone but an admin", async () => {
    const t = await setup();
    for (const who of ["multi", "learner", "recipient"] as const) {
      expect((await t.call("/api/admin/student-status", who)).status, who).toBe(403);
      expect((await t.call("/api/admin/tutor-students", who)).status, who).toBe(403);
    }
    expect((await t.call("/api/admin/student-status?mode=tutor", "admin")).status).toBe(400);
  });
});

describe("Confirm reading is still right (N14, AD-05)", () => {
  it("records the reading as reviewed for the current date and service, for a tutor of the student; refuses a parent and a stale copy", async () => {
    const t = await setup();
    const [assignment] = await t.f.owner(() => t.f.db.insert(s.assignment).values({ tenantId: "crc", studentId: t.own.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed",
      setByMembershipId: t.f.adminMember.id, proposalSnapshot: { slotProvenance: 1, serviceSlot: "morning", confirmationDate: "2020-01-04", needsReview: true }, aliyahStarts: ["Genesis 1:2"] }).returning());
    expect((await t.call("/api/admin/student-status", "admin")).json.students.find((row: StudentStatus) => row.id === t.own.id).reading).toBe("review");
    const path = `/api/students/${t.own.id}/reading/reconfirm`;
    expect((await t.call(path, "multi", { mode: "parent", kind: "torah", expectedRevision: 1 })).status).toBe(400);
    expect((await t.call(path, "learner", { mode: "tutor", kind: "torah", expectedRevision: 1 })).status).toBe(403);
    expect((await t.call(path, "multi", { mode: "tutor", kind: "torah", expectedRevision: 1 }, { origin: "https://elsewhere.example.test" })).status).toBe(403);
    expect((await t.call(path, "multi", { mode: "tutor", kind: "torah", expectedRevision: 7 })).status).toBe(409);
    expect((await t.call(`/api/students/${t.sibling.id}/reading/reconfirm`, "multi", { mode: "tutor", kind: "torah", expectedRevision: 1 })).status).toBe(404);
    const done = await t.call(path, "multi", { mode: "tutor", kind: "torah", expectedRevision: 1 });
    expect(done.status).toBe(200);
    expect(done.json).toEqual({ ok: true, assignmentId: assignment.id, revision: 2 });
    const [row] = await t.f.owner(() => t.f.db.select().from(s.assignment).where(eq(s.assignment.id, assignment.id)));
    expect(row).toMatchObject({ ref: "Genesis 1:1-3", basis: "custom", aliyahStarts: ["Genesis 1:2"], revision: 2 });
    expect(row.proposalSnapshot).toMatchObject({ needsReview: false, confirmationDate: t.own.ceremonyDate, serviceSlot: "morning", slotProvenance: 1 });
    expect((await t.call("/api/admin/student-status", "admin")).json.students.find((row: StudentStatus) => row.id === t.own.id).reading).toBe("confirmed");
  });
});

describe("Family line (N15, G7 TP-12)", () => {
  it("tells the student's tutor who joined and whether an invitation is open, with no address, and nobody else", async () => {
    const t = await setup();
    const family = (who: Who, id: string, mode = "tutor") => t.call(`/api/students/${id}/family?mode=${mode}`, who);
    const joined = await family("multi", t.own.id);
    expect(joined.status).toBe(200);
    expect(Object.keys(joined.json).sort()).toEqual(["invited", "joined", "kind", "neverInvited"]);
    expect(joined.json.joined).toHaveLength(1);
    expect(joined.json.invited).toBe(false);
    expect(joined.text).not.toMatch(/@/);
    // Not this tutor's student, another congregation's, a parent or a student asking: refused.
    expect((await family("multi", t.unrelated.id)).status).toBe(404);
    expect((await family("multi", t.other.id)).status).toBe(404);
    expect((await family("multi", t.own.id, "parent")).status).toBe(400);
    expect((await family("learner", t.own.id)).status).toBe(403);
    // Nobody invited yet; then an open parent invitation, nobody joined: the line says so, still without the address it went to.
    await t.f.owner(() => t.f.db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: t.unrelated.id, tutorGrantId: t.f.tutorGrant.id }));
    expect((await family("multi", t.unrelated.id)).json).toEqual({ kind: "child", joined: [], invited: false, neverInvited: true });
    await t.f.owner(async () => {
      await t.f.db.insert(s.invite).values({ tenantId: "crc", tokenHash: "f".repeat(64), email: "invited-parent@example.test", role: "parent", studentId: t.unrelated.id,
        inviterMembershipId: t.f.adminMember.id, expiresAt: new Date(Date.now() + 3 * 86_400_000) });
    });
    const invited = await family("multi", t.unrelated.id);
    expect(invited.json).toEqual({ kind: "child", joined: [], invited: true, neverInvited: false });
    expect(invited.text).not.toMatch(/invited-parent/);
  });
});

describe("Tutor hand-over (N15, G11)", () => {
  const handOver = (t: Awaited<ReturnType<typeof setup>>, body: Record<string, unknown>, who: Who = "admin", headers: Record<string, string> = {}) =>
    t.call(`/api/admin/tutors/${t.f.tutorGrant.id}/hand-over`, who, body, headers);

  it("lists each tutor's students and moves them to another tutor while the old access ends, in one transaction", async () => {
    const t = await setup();
    const teaching = await t.call("/api/admin/tutor-students", "admin");
    expect(teaching.status).toBe(200);
    expect(teaching.json.tutors).toEqual([{ tutorGrantId: t.f.tutorGrant.id, students: [{ id: t.own.id, firstName: t.own.firstName, lastName: t.own.lastName }] }]);
    // Readings for everyone: a claim the departing tutor holds ends with the grant, so it never blocks the learner's next tutor.
    const [claim] = await t.f.owner(() => t.f.db.insert(s.learnerClaim).values({ tenantId: "crc", learnerMembershipId: t.f.adminMember.id, tutorGrantId: t.f.tutorGrant.id }).returning());
    const moved = await handOver(t, { expectedRevision: 1, toTutorGrantId: t.secondTutor.id, studentIds: [t.own.id] });
    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ ok: true, id: t.f.tutorGrant.id, revision: 2, moved: 1 });
    const [ended] = await t.f.owner(() => t.f.db.select().from(s.learnerClaim).where(eq(s.learnerClaim.id, claim.id)));
    expect(ended).toMatchObject({ revokedBy: "admin", revokedByMembershipId: t.f.adminMember.id });
    expect(ended.revokedAt).not.toBeNull();
    expect(await t.f.owner(() => t.f.db.select().from(s.auditEvent).where(and(eq(s.auditEvent.action, "learner.unclaim"), eq(s.auditEvent.targetId, claim.id))))).toHaveLength(1);
    expect(await t.liveTutors(t.own.id)).toEqual([t.secondTutor.id]);
    expect((await t.grantOf(t.f.tutorGrant.id)).revokedAt).not.toBeNull();
    // The old tutor reads nothing now; the new one reads the student.
    expect((await t.call(`/api/students/${t.own.id}?mode=tutor`, "multi")).status).toBe(403);
    expect((await t.call(`/api/students/${t.own.id}?mode=tutor`, "recipient")).status).toBe(200);
  });

  it("refuses a tutor of another congregation, a parent grant, students the tutor does not teach, a stale review, a non-admin and a cross-site request; nothing changes", async () => {
    const t = await setup();
    const base = { expectedRevision: 1, toTutorGrantId: t.secondTutor.id, studentIds: [t.own.id] };
    expect((await handOver(t, { ...base, toTutorGrantId: t.foreignTutor.id })).status).toBe(404);
    expect((await handOver(t, { ...base, toTutorGrantId: t.f.parentGrant.id })).status).toBe(404);
    expect((await handOver(t, { ...base, toTutorGrantId: t.f.tutorGrant.id })).status).toBe(403);
    expect((await handOver(t, { ...base, studentIds: [t.own.id, t.unrelated.id] })).status).toBe(409);
    expect((await handOver(t, { ...base, studentIds: [t.other.id] })).status).toBe(409);
    expect((await handOver(t, { ...base, studentIds: [] })).status).toBe(403);
    expect((await handOver(t, { ...base, expectedRevision: 5 })).status).toBe(409);
    expect((await handOver(t, { ...base, extra: true })).status).toBe(400);
    for (const who of ["multi", "learner", "recipient"] as const) expect((await handOver(t, base, who)).status, who).toBe(403);
    expect((await handOver(t, base, "admin", { origin: "https://elsewhere.example.test" })).status).toBe(403);
    expect((await t.call(`/api/admin/tutors/${t.foreignTutor.id}/hand-over`, "admin", { ...base, studentIds: [t.other.id] })).status).toBe(404);
    expect(await t.liveTutors(t.own.id)).toEqual([t.f.tutorGrant.id]);
    expect((await t.grantOf(t.f.tutorGrant.id)).revokedAt).toBeNull();
    expect(await t.liveTutors(t.other.id)).toEqual([]);
  });

  it("refuses a destination tutor whose grant is revoked, whose membership is disabled or whose address is unverified, and the departing tutor keeps the student", async () => {
    const t = await setup();
    const base = { expectedRevision: 1, toTutorGrantId: t.secondTutor.id, studentIds: [t.own.id] };
    // A revoked grant can never be restored (0002's trigger), so it goes last.
    const cases: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
      ["disabled membership", () => t.f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, t.secondTutor.membershipId)), () => t.f.db.update(s.membership).set({ disabledAt: null }).where(eq(s.membership.id, t.secondTutor.membershipId))],
      ["unverified address", () => t.f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, t.f.identities.recipient.id)), () => t.f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, t.f.identities.recipient.id))],
      ["revoked grant", () => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.secondTutor.id)), async () => undefined],
    ];
    for (const [label, spoil, restore] of cases) {
      await t.f.owner(spoil);
      expect((await handOver(t, base)).status, label).toBe(404);
      expect(await t.liveTutors(t.own.id), label).toEqual([t.f.tutorGrant.id]);
      expect((await t.grantOf(t.f.tutorGrant.id)).revokedAt, label).toBeNull();
      await t.f.owner(restore);
    }
  });

  it("refuses an admin whose sign-in is older than 15 minutes, and nothing changes", async () => {
    const t = await setup();
    await t.f.owner(() => t.f.db.update(s.session).set({ createdAt: new Date(Date.now() - 16 * 60_000) }).where(eq(s.session.id, t.f.identities.admin.sessionId)));
    expect((await handOver(t, { expectedRevision: 1, toTutorGrantId: t.secondTutor.id, studentIds: [t.own.id] })).status).toBe(403);
    expect(await t.liveTutors(t.own.id)).toEqual([t.f.tutorGrant.id]);
    expect((await t.grantOf(t.f.tutorGrant.id)).revokedAt).toBeNull();
  });

  it("refuses a student whose ceremony is done (N21) and grants nothing", async () => {
    const t = await setup();
    expect((await t.call(`/api/admin/students/${t.own.id}/ceremony-done`, "admin", { expectedRevision: await t.revisionOf(t.own.id) })).status).toBe(200);
    expect((await handOver(t, { expectedRevision: 1, toTutorGrantId: t.secondTutor.id, studentIds: [t.own.id] })).status).toBe(409);
    expect(await t.liveTutors(t.own.id)).toEqual([]);
    expect((await t.grantOf(t.f.tutorGrant.id)).revokedAt).toBeNull();
  });
});

describe("The staff routes are closed and never cached", () => {
  const someId = "00000000-0000-4000-8000-000000000001";
  it.each([
    ["/api/admin/student-status", "GET"], ["/api/admin/tutor-students", "GET"], [`/api/admin/tutors/${someId}/hand-over`, "POST"],
    [`/api/students/${someId}/family?mode=tutor`, "GET"], [`/api/students/${someId}/reading/reconfirm`, "POST"],
  ])("%s answers only %s, names it in allow on a 405, and every answer is no-store", async (path, method) => {
    const t = await setup();
    const dispatch = createHttpDispatcher(async action => action(t.f.runtime));
    const send = (verb: string) => dispatch(new Request(`${ORIGIN}${path}`, { method: verb, headers: { cookie: t.f.identities.admin.cookie, origin: ORIGIN, "content-type": "application/json" },
      body: verb === "GET" ? undefined : "{}" }));
    for (const wrong of ["GET", "POST", "PUT", "DELETE"].filter(verb => verb !== method)) {
      const response = await send(wrong);
      expect(response.status, wrong).toBe(405);
      expect(response.headers.get("allow"), wrong).toBe(method);
      expect(response.headers.get("cache-control"), wrong).toContain("no-store");
    }
    const answer = await send(method);
    expect(answer.status).not.toBe(405);
    expect(answer.headers.get("cache-control")).toContain("no-store");
  });
});
