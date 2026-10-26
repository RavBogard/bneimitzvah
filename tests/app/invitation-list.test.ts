import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import * as s from "../../src/server/db/index";

const open: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
async function fixture() { const f = await portalRoutesFixture(); open.push(f); return f; }
type Fixture = Awaited<ReturnType<typeof fixture>>;
afterEach(async () => { vi.useRealTimers(); await Promise.all(open.splice(0).map(f => f.client.close())); });
const json = (response: Response) => response.json();
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
async function seed(f: Fixture, n: number, values: Partial<typeof s.invite.$inferInsert> = {}) {
  const now = Date.now();
  await f.owner(async () => { await f.db.insert(s.invite).values({ id: id(n), tenantId: "crc", role: "tutor", email: "synthetic-list@example.test",
    inviterMembershipId: f.adminMember.id, tokenHash: randomBytes(32).toString("hex"), createdAt: new Date(now - 1000), expiresAt: new Date(now + 72 * 60 * 60_000), ...values }); });
}
async function state(f: Fixture) {
  return f.owner(async () => JSON.stringify({ invites: await f.db.select().from(s.invite).orderBy(s.invite.id), audits: await f.db.select().from(s.auditEvent).orderBy(s.auditEvent.id),
    grants: await f.db.select().from(s.roleGrant).orderBy(s.roleGrant.id), guardians: await f.db.select().from(s.guardian).orderBy(s.guardian.id) }));
}

describe("private admin invitation status listing", () => {
  it("derives lifecycle and durable delivery states, projects contacts only for admins, and never mutates on GET", async () => {
    const f = await fixture();
    const parent = { role: "parent", email: "routes-recipient@example.test", studentId: f.students[0].id };
    const sent = await json(await f.call("/api/admin/invitations", { who: "admin", body: parent }));
    await f.runtime.invitations.accept(f.request("/api/invitations/accept", { who: "recipient", method: "POST" }), { token: f.pending().token });
    const revoked = await json(await f.call("/api/admin/invitations", { who: "admin", body: { ...parent, studentId: f.students[1].id } }));
    expect((await f.call(`/api/admin/invitations/${revoked.inviteId}/revoke`, { who: "admin", body: {} })).status).toBe(200);
    f.failSend(true);
    const failed = await json(await f.call("/api/admin/invitations", { who: "admin", body: { role: "tutor", email: "synthetic-failed@example.test" } }));
    await seed(f, 1);
    await seed(f, 2, { expiresAt: new Date(Date.now() - 100), createdAt: new Date(Date.now() - 5000), role: "student", studentId: f.students[0].id });
    const before = await state(f), response = await f.call("/api/admin/invitations", { who: "admin" }), result = await json(response);
    expect(response.status).toBe(200); expect(result.invitations).toHaveLength(5); expect(response.headers.get("cache-control")).toContain("private, no-store");
    const rows = result.invitations as Record<string, any>[];
    const accepted = rows.find(row => row.id === sent.inviteId)!, cancelled = rows.find(row => row.id === revoked.inviteId)!, rejected = rows.find(row => row.id === failed.inviteId)!;
    expect(accepted.status === "accepted" && accepted.acceptedAt !== null && accepted.student.id === f.students[0].id && accepted.delivery.status === "sent" && accepted.delivery.attemptedAt !== null).toBe(true);
    expect(cancelled.status === "revoked" && cancelled.revokedAt !== null).toBe(true);
    expect(rejected.status === "pending" && rejected.delivery.status === "failed" && rejected.delivery.attemptedAt !== null && rejected.student === null).toBe(true);
    const pending = rows.find(row => row.id === id(1))!, expired = rows.find(row => row.id === id(2))!;
    expect(pending.status === "pending" && pending.delivery.status === "pending" && pending.delivery.attemptedAt === null).toBe(true);
    expect(expired.status === "expired" && expired.role === "student").toBe(true);
    expect(rows.every(row => typeof row.recipientEmail === "string" && row.recipientEmail.includes("@"))).toBe(true);
    expect(Object.keys(accepted).sort()).toEqual(["id", "role", "recipientEmail", "student", "status", "createdAt", "expiresAt", "expiresTomorrow", "acceptedAt", "revokedAt", "delivery"].sort());
    expect(Object.keys(accepted.student).sort()).toEqual(["firstName", "id", "lastName"]);
    expect(Object.keys(accepted.delivery).sort()).toEqual(["attemptedAt", "status"]);
    const encoded = JSON.stringify(result);
    for (const forbidden of ["tokenHash", "inviterMembershipId", "acceptedMembershipId", f.adminMember.id, f.identities.admin.id, f.identities.admin.sessionId, f.pending(0).token]) expect(encoded.includes(forbidden)).toBe(false);
    expect((await state(f)) === before).toBe(true);
  });

  it("requires real active admin mode with no child context, no role union and no anonymous recipient lookup", async () => {
    const f = await fixture(); await seed(f, 1);
    for (const who of ["multi", "learner", "recipient"] as const) expect((await f.call("/api/admin/invitations", { who })).status).toBe(403);
    expect((await f.call("/api/admin/invitations", { who: "anonymous" })).status).toBe(401);
    expect((await f.call("/api/admin/invitations", { who: "admin", handle: "" })).status).toBe(403);
    for (const mode of ["parent", "tutor"] as const) {
      let denied = false;
      try { await f.runtime.invitations.list(f.request("/api/admin/invitations", { who: "admin" }), { mode }); } catch { denied = true; }
      expect(denied).toBe(true);
    }
    await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
    expect((await f.call("/api/admin/invitations", { who: "admin" })).status).toBe(403);
  });

  it("retains nonfresh listing while existing issue/reissue/revoke still require fresh admin sessions", async () => {
    const f = await fixture(); await seed(f, 1);
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    expect((await f.call("/api/admin/invitations", { who: "admin" })).status).toBe(200);
    for (const action of ["reissue", "revoke"]) expect((await f.call(`/api/admin/invitations/${id(1)}/${action}`, { who: "admin", body: {} })).status).toBe(403);
    expect((await f.call("/api/admin/invitations", { who: "admin", body: { role: "tutor", email: "synthetic-new@example.test" } })).status).toBe(403);
  });

  it("uses bounded stable UUID pagination and never joins targets or invitations from another tenant", async () => {
    const f = await fixture();
    await f.owner(async () => {
      const now = Date.now();
      await f.db.insert(s.invite).values(Array.from({ length: 101 }, (_, index) => ({ id: id(index + 1), tenantId: "crc", role: "parent" as const, studentId: f.students[0].id,
        email: "synthetic-page@example.test", inviterMembershipId: f.adminMember.id, tokenHash: randomBytes(32).toString("hex"), createdAt: new Date(now - 1000), expiresAt: new Date(now + 100_000) })));
      const [member] = await f.db.select({ id: s.membership.id }).from(s.membership).where(and(eq(s.membership.tenantId, "other"), eq(s.membership.userId, f.identities.multi.id)));
      await f.db.insert(s.invite).values({ id: id(102), tenantId: "other", role: "parent", studentId: f.students[3].id, email: "foreign-recipient@example.test",
        inviterMembershipId: member.id, tokenHash: randomBytes(32).toString("hex"), createdAt: new Date(now - 1000), expiresAt: new Date(now + 100_000) });
    });
    const first = (await json(await f.call("/api/admin/invitations", { who: "admin" }))).invitations;
    expect(first).toHaveLength(100); expect(first[0].id === id(1) && first[99].id === id(100)).toBe(true);
    const second = (await json(await f.call(`/api/admin/invitations?afterId=${first[99].id}&limit=100`, { who: "admin" }))).invitations;
    expect(second).toHaveLength(1); expect(second[0].id === id(101) && second[0].student.id === f.students[0].id).toBe(true);
    expect((await json(await f.call(`/api/admin/invitations?afterId=${id(101)}`, { who: "admin" }))).invitations).toHaveLength(0);
    expect((await f.call("/api/admin/invitations", { who: "admin", origin: "http://localhost:3101" })).status).toBe(403);
    expect(!JSON.stringify({ first, second }).includes("foreign-recipient") && !JSON.stringify({ first, second }).includes(f.students[3].id)).toBe(true);
    const tiny = await f.runtime.invitations.list(f.request("/api/admin/invitations", { who: "admin" }), { mode: "admin", limit: 1 }); expect(tiny).toHaveLength(1);
  });

  it("rejects closed query violations, invalid bounds and methods without selecting a caller-supplied mode", async () => {
    const f = await fixture();
    for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=01", "limit=1&limit=2", "mode=admin", "email=claimed", "tenantId=other", "actor=claimed", "afterId="])
      expect([400, 404].includes((await f.call(`/api/admin/invitations?${query}`, { who: "admin" })).status)).toBe(true);
    const wrong = await f.call("/api/admin/invitations", { who: "admin", method: "DELETE" }); expect(wrong.status).toBe(405); expect(wrong.headers.get("allow")).toBe("GET, POST");
    for (const limit of [0, 101, 1.5]) {
      let denied = false; try { await f.runtime.invitations.list(f.request("/api/admin/invitations", { who: "admin" }), { mode: "admin", limit }); } catch { denied = true; } expect(denied).toBe(true);
    }
  });

  it("fails malformed legacy contact/name/timestamp rows closed with fixed503 and no diagnostic leaks", async () => {
    const f = await fixture(); await seed(f, 1, { email: "invalid-mailbox" });
    const invalid = await f.call("/api/admin/invitations", { who: "admin" });
    expect(invalid.status).toBe(503); expect(await json(invalid)).toEqual({ error: "unavailable" });
    await seed(f, 2, { role: "parent", studentId: f.students[0].id });
    await f.owner(async () => { await f.db.update(s.student).set({ firstName: "<private-invalid-label>" }).where(eq(s.student.id, f.students[0].id)); });
    expect((await f.call(`/api/admin/invitations?afterId=${id(1)}`, { who: "admin" })).status).toBe(503);
    await f.owner(async () => { await f.db.update(s.student).set({ firstName: "Synthetic" }).where(eq(s.student.id, f.students[0].id));
      await f.db.update(s.invite).set({ revokedAt: sql`${s.invite.createdAt} - interval '1 second'` }).where(eq(s.invite.id, id(2))); });
    expect((await f.call(`/api/admin/invitations?afterId=${id(1)}`, { who: "admin" })).status).toBe(503);
  });

  it("derives expiry at the exact boundary and preserves accepted/revoked history after expiry", async () => {
    const f = await fixture(), now = Date.now(); vi.setSystemTime(new Date(now));
    await seed(f, 1, { createdAt: new Date(now - 1000), expiresAt: new Date(now) });
    await seed(f, 2, { createdAt: new Date(now - 1000), expiresAt: new Date(now + 1) });
    await seed(f, 3, { createdAt: new Date(now - 3000), expiresAt: new Date(now - 1000), revokedAt: new Date(now - 500) });
    await seed(f, 4, { createdAt: new Date(now - 3000), expiresAt: new Date(now - 1000), acceptedAt: new Date(now - 2000), acceptedMembershipId: f.multiMember.id });
    const rows = (await json(await f.call("/api/admin/invitations", { who: "admin" }))).invitations;
    expect(rows.map((row: { status: string }) => row.status)).toEqual(["expired", "pending", "revoked", "accepted"]);
    vi.setSystemTime(new Date(now + 1));
    const next = (await json(await f.call(`/api/admin/invitations?afterId=${id(1)}&limit=1`, { who: "admin" }))).invitations;
    expect(next).toHaveLength(1); expect(next[0].status).toBe("expired");
  });
});
