import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { portalRoutesFixture } from "./portal-routes-fixture";

// A2 (Daniel, 2026-11-16, "Relax for both"): assigning an existing tutor to a student and sending an invitation need only a live
// admin session. Every other operation that needed a sign-in from the last 15 minutes still does. Synthetic people only.
const open: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
async function fixture() { const f = await portalRoutesFixture(); open.push(f); return f; }
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Who = "admin" | "multi" | "learner" | "recipient";
afterEach(async () => { vi.useRealTimers(); await Promise.all(open.splice(0).map(f => f.client.close())); });

const OLD = 2 * 60 * 60_000;
const age = (f: Fixture, who: Who) => f.owner(() => f.db.update(s.session).set({ createdAt: new Date(Date.now() - OLD) }).where(eq(s.session.id, f.identities[who].sessionId)));
const assign = (f: Fixture, studentId: string, options: Parameters<Fixture["call"]>[1] = { who: "admin" }) =>
  f.call(`/api/admin/students/${studentId}/relationships/tutors`, { ...options, body: { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" } });
const invite = (f: Fixture, body: Record<string, unknown>, options: Parameters<Fixture["call"]>[1] = { who: "admin" }) => f.call("/api/admin/invitations", { ...options, body });
/** Everything a refused operation must leave as it was. */
const state = (f: Fixture) => f.owner(async () => JSON.stringify({ links: await f.db.select().from(s.tutorStudent).orderBy(s.tutorStudent.id), guardians: await f.db.select().from(s.guardian).orderBy(s.guardian.id),
  identities: await f.db.select().from(s.studentIdentity).orderBy(s.studentIdentity.id), grants: await f.db.select().from(s.roleGrant).orderBy(s.roleGrant.id),
  invites: await f.db.select().from(s.invite).orderBy(s.invite.id), audits: await f.db.select().from(s.auditEvent).orderBy(s.auditEvent.id) }));
async function outcome(action: () => Promise<unknown>) { try { await action(); return "allowed"; } catch (error) { return error instanceof AccessDenied ? error.status : "other"; } }

describe("fresh sign-in after A2", () => {
  it("lets an admin whose sign-in is two hours old assign an existing tutor and send parent, student and tutor invitations", async () => {
    const f = await fixture(); await age(f, "admin");
    expect((await assign(f, f.students[1].id)).status).toBe(201);
    const links = await f.owner(() => f.db.select().from(s.tutorStudent).where(and(eq(s.tutorStudent.studentId, f.students[1].id), eq(s.tutorStudent.tutorGrantId, f.tutorGrant.id))));
    expect(links.filter(link => !link.revokedAt)).toHaveLength(1);
    expect((await invite(f, { role: "parent", studentId: f.students[1].id, email: "synthetic-a2-parent@example.test" })).status).toBe(201);
    expect((await invite(f, { role: "student", studentId: f.students[2].id, email: "synthetic-a2-student@example.test" })).status).toBe(201);
    expect((await invite(f, { role: "tutor", email: "synthetic-a2-tutor@example.test" })).status).toBe(201);
    expect(f.deliveries).toHaveLength(3);
    const audits = await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.actorMembershipId, f.adminMember.id)));
    expect(audits.filter(row => row.action === "invite.issue")).toHaveLength(3);
    expect(audits.filter(row => row.action === "tutor.assign")).toHaveLength(1);
    // The other checks stay: a cross-site request, a second assignment and a non-tutor grant are still refused.
    const before = await state(f);
    expect((await assign(f, f.students[2].id, { who: "admin", headers: { origin: "https://elsewhere.example.test" } })).status).toBeGreaterThanOrEqual(400);
    expect((await invite(f, { role: "tutor", email: "synthetic-a2-csrf@example.test" }, { who: "admin", headers: { origin: "https://elsewhere.example.test" } })).status).toBeGreaterThanOrEqual(400);
    expect((await assign(f, f.students[1].id)).status).toBe(409);
    expect((await f.call(`/api/admin/students/${f.students[2].id}/relationships/tutors`, { who: "admin", body: { tutorGrantId: f.adminGrant.id, expectedState: "unassigned" } })).status).toBe(404);
    expect((await invite(f, { role: "admin", email: "synthetic-a2-admin@example.test" })).status).toBeGreaterThanOrEqual(400);
    expect(await state(f)).toBe(before);
  });

  it("still refuses the same old session every other fresh-only operation, and nothing changes", async () => {
    const f = await fixture(); await age(f, "admin");
    const inviteId = randomUUID();
    await f.owner(() => f.db.insert(s.invite).values({ id: inviteId, tenantId: "crc", role: "tutor", email: "synthetic-a2-seeded@example.test", inviterMembershipId: f.adminMember.id,
      tokenHash: randomBytes(32).toString("hex"), createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 72 * 60 * 60_000) }));
    const before = await state(f), student = `/api/admin/students/${f.students[0].id}/relationships`;
    const routes: [string, string, Record<string, unknown>][] = [
      ["remove a tutor from a student", `${student}/tutors/${f.tutorLink.id}/revoke`, { expectedState: "active" }],
      ["remove a parent link", `${student}/guardians/${f.guardians[0].id}/revoke`, { expectedState: "active" }],
      ["remove a student's own sign-in", `${student}/identities/${f.learnerLink.id}/revoke`, { expectedState: "active" }],
      ["change a parent's practice permission", `${student}/guardians/${f.guardians[0].id}/practice`, { expectedRevision: 1, practiceEnabled: false }],
      ["Remove as a tutor", `/api/admin/grants/${f.tutorGrant.id}/revoke`, { expectedRevision: 1, expectedState: "active" }],
      ["mark a tutor as cantor", `/api/admin/tutors/${f.tutorGrant.id}/cantor`, { expectedRevision: 1, isCantor: true }],
      ["revoke an invitation", `/api/admin/invitations/${inviteId}/revoke`, {}],
      ["Copy link", `/api/admin/invitations/${inviteId}/copy`, {}],
    ];
    for (const [label, path, body] of routes) expect((await f.call(path, { who: "admin", body })).status, label).toBe(403);
    const request = (path: string) => f.request(path, { who: "admin", body: {} });
    const services: [string, () => Promise<unknown>][] = [
      ["hand over a tutor's students", () => f.runtime.staff.handOver(request(`/api/admin/tutors/${f.tutorGrant.id}/hand-over`), { mode: "admin", tutorGrantId: f.tutorGrant.id, expectedRevision: 1, toTutorGrantId: randomUUID(), studentIds: [f.students[0].id] })],
      ["Make tutor", () => f.runtime.accounts.makeTutor(request("/api/accounts/people/make-tutor"), { membershipId: f.learnerMember.id })],
      ["Remove tutor", () => f.runtime.accounts.removeTutor(request("/api/accounts/people/remove-tutor"), { membershipId: f.multiMember.id })],
      ["designate an approver", () => f.runtime.accounts.addApprover(request("/api/accounts/approvers/add"), { tutorGrantId: f.tutorGrant.id })],
      ["end a Claude connection", () => f.runtime.claudeConnections.revoke(request("/api/staff/claude-connections/revoke"), randomUUID())],
    ];
    for (const [label, action] of services) expect(await outcome(action), label).toBe(403);
    expect(f.deliveries).toHaveLength(0);
    expect(await state(f)).toBe(before);
  });

  it("lets the same old session Send again within the send budget and recipient checks, while Copy link and Revoke stay fresh-only", async () => {
    const HOUR = 60 * 60_000;
    // Mid-hour, so the hourly send budget's bucket cannot roll over during the test.
    vi.setSystemTime(new Date(Math.floor(Date.now() / HOUR) * HOUR + 20 * 60_000));
    const f = await fixture(); await age(f, "admin");
    const email = "synthetic-a2-again@example.test";
    const live = async () => (await f.owner(() => f.db.select().from(s.invite).where(eq(s.invite.email, email)))).filter(row => !row.revokedAt);
    await f.owner(() => f.db.insert(s.invite).values({ id: randomUUID(), tenantId: "crc", role: "tutor", email, inviterMembershipId: f.adminMember.id,
      tokenHash: randomBytes(32).toString("hex"), createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 72 * 60 * 60_000) }));
    // The recipient's budget is five sends an hour: five Send agains go out, each revoking the previous link.
    for (let n = 1; n <= 5; n++) {
      const [current] = await live();
      expect((await f.call(`/api/admin/invitations/${current.id}/reissue`, { who: "admin", body: {} })).status, `send ${n}`).toBe(200);
      const [next] = await live(); expect(next.id).not.toBe(current.id);
    }
    expect(f.deliveries).toHaveLength(5);
    const [current] = await live(), before = await state(f);
    expect((await f.call(`/api/admin/invitations/${current.id}/reissue`, { who: "admin", body: {} })).status).toBe(403);
    for (const action of ["copy", "revoke"]) expect((await f.call(`/api/admin/invitations/${current.id}/${action}`, { who: "admin", body: {} })).status, action).toBe(403);
    expect(await state(f)).toBe(before);
    // A student invitation addressed to the student's parent contact is still refused on Send again.
    const parentContact = randomUUID();
    await f.owner(() => f.db.insert(s.invite).values({ id: parentContact, tenantId: "crc", role: "student", studentId: f.students[2].id, email: "unrelated@example.test", inviterMembershipId: f.adminMember.id,
      tokenHash: randomBytes(32).toString("hex"), createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 72 * 60 * 60_000) }));
    const seeded = await state(f);
    expect((await f.call(`/api/admin/invitations/${parentContact}/reissue`, { who: "admin", body: {} })).status).toBe(403);
    expect(await state(f)).toBe(seeded);
    expect(f.deliveries).toHaveLength(5);
  });

  it("refuses a tutor, a parent, a student, a signed-out caller and another congregation's admin, with an old or a fresh session", async () => {
    const f = await fixture();
    await f.owner(async () => {
      const [member] = await f.db.select().from(s.membership).where(and(eq(s.membership.tenantId, "other"), eq(s.membership.userId, f.identities.multi.id)));
      await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: member.id, role: "admin" });
    });
    const inviteId = randomUUID();
    await f.owner(() => f.db.insert(s.invite).values({ id: inviteId, tenantId: "crc", role: "parent", studentId: f.students[1].id, email: "synthetic-a2-denied@example.test", inviterMembershipId: f.adminMember.id,
      tokenHash: randomBytes(32).toString("hex"), createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 72 * 60 * 60_000) }));
    const again = (options: Parameters<Fixture["call"]>[1]) => f.call(`/api/admin/invitations/${inviteId}/reissue`, { ...options, body: {} });
    const before = await state(f), other = { origin: "http://localhost:3101", headers: { origin: "http://localhost:3101" } };
    for (const old of [false, true]) {
      if (old) for (const who of ["multi", "learner", "recipient"] as const) await age(f, who);
      // multi is a parent and a tutor here (and an admin of the other congregation); learner is a student; recipient holds no role.
      for (const who of ["multi", "learner", "recipient"] as const) {
        expect((await assign(f, f.students[1].id, { who })).status, `${who} assign`).toBe(403);
        expect((await invite(f, { role: "tutor", email: "synthetic-a2-denied@example.test" }, { who })).status, `${who} invite`).toBe(403);
        expect((await invite(f, { role: "parent", studentId: f.students[1].id, email: "synthetic-a2-denied@example.test" }, { who })).status, `${who} family invite`).toBe(403);
        expect((await again({ who })).status, `${who} send again`).toBe(403);
      }
      expect((await assign(f, f.students[1].id, { who: "anonymous" })).status).toBe(401);
      expect((await invite(f, { role: "tutor", email: "synthetic-a2-denied@example.test" }, { who: "anonymous" })).status).toBe(401);
      expect((await again({ who: "anonymous" })).status).toBe(401);
      expect((await again({ who: "multi", ...other })).status).toBeGreaterThanOrEqual(400);
      // The other congregation's admin reaches neither this congregation's students nor its tutors.
      expect((await assign(f, f.students[1].id, { who: "multi", ...other })).status).toBeGreaterThanOrEqual(400);
      expect((await invite(f, { role: "parent", studentId: f.students[1].id, email: "synthetic-a2-denied@example.test" }, { who: "multi", ...other })).status).toBeGreaterThanOrEqual(400);
      // And this congregation's admin cannot attach this congregation's tutor to the other's student.
      expect((await assign(f, f.students[3].id)).status).toBeGreaterThanOrEqual(400);
    }
    expect(f.deliveries).toHaveLength(0);
    expect(await state(f)).toBe(before);
  });

  it("refuses an expired or signed-out admin session", async () => {
    const f = await fixture(); await age(f, "admin");
    const before = await state(f);
    await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.id, f.identities.admin.sessionId)));
    expect((await assign(f, f.students[1].id)).status).toBe(401);
    expect((await invite(f, { role: "tutor", email: "synthetic-a2-expired@example.test" })).status).toBe(401);
    await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(Date.now() + 60 * 60_000) }).where(eq(s.session.id, f.identities.admin.sessionId)));
    await f.auth.api.signOut({ headers: new Headers({ cookie: f.identities.admin.cookie }) });
    expect((await assign(f, f.students[1].id)).status).toBe(401);
    expect((await invite(f, { role: "tutor", email: "synthetic-a2-expired@example.test" })).status).toBe(401);
    expect(f.deliveries).toHaveLength(0);
    expect(await state(f)).toBe(before);
  });
});
