import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { invitesFixture } from "./invites-fixture";
import { createAccessService } from "../../src/server/access/service";
import { createInvitationService } from "../../src/server/invitations/service";
import { AccessDenied } from "../../src/server/access/errors";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { PARENT_INVITATION_LIFETIME_MS } from "../../src/server/invitations/tokens";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof invitesFixture>>[] = [];
async function fixture() { const f = await invitesFixture(); fixtures.push(f); return f; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(fixtures.splice(0).map((f) => f.client.close())); });
async function denied(action: () => Promise<unknown>, status = 404) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}
const parent = (studentId: string, email = "recipient@example.test") => ({ mode: "admin" as const, role: "parent" as const, studentId, email });

describe("explicit invitation service", () => {
  it("stores only a 256-bit token hash for 7 days (a parent's), commits before delivery and grants nothing from contact alone", async () => {
    const f = await fixture();
    await f.owner(async () => { await f.db.update(s.student).set({ parentEmail: "recipient@example.test" }).where(eq(s.student.id, f.students[0].id)); });
    expect(await denied(() => f.service.listStudents(f.request("recipient"), { mode: "parent" }), 403)).toBe(true);
    const result = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    expect(result.delivery === "sent" && f.outsideTransport()).toBe(true);
    const token = f.token();
    expect(await denied(() => f.invitations.issue(f.request("admin", undefined, {}, "GET"), parent(f.students[1].id)), 403)).toBe(true);
    expect(await denied(() => f.invitations.revoke(f.request("admin", undefined, { origin: "https://evil.example.test" }), { mode: "admin", inviteId: crypto.randomUUID() }), 403)).toBe(true);
    expect(await denied(() => f.invitations.reissue(f.request("admin", undefined, {}, "GET"), { mode: "admin", inviteId: crypto.randomUUID() }), 403)).toBe(true);
    expect(/^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, "base64url").length === 32).toBe(true);
    await f.owner(async () => {
      const [row] = await f.db.select().from(s.invite).where(eq(s.invite.id, result.inviteId));
      expect(/^[a-f0-9]{64}$/.test(row.tokenHash) && !JSON.stringify(row).includes(token)).toBe(true);
      expect(row.deliveryStatus === "sent" && row.deliveryAttemptedAt instanceof Date).toBe(true);
      expect(row.expiresAt.getTime() - row.createdAt.getTime() === PARENT_INVITATION_LIFETIME_MS).toBe(true);
      expect((await f.db.select().from(s.membership).where(eq(s.membership.userId, f.identities.recipient.id))).length === 0).toBe(true);
    });
    expect(!JSON.stringify(result).includes(token) && !JSON.stringify(result).includes("@")).toBe(true);
  });

  it("requires explicit matching verified identity and creates separate sibling guardian links with one parent grant", async () => {
    const f = await fixture();
    await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const first = f.token();
    await f.invitations.issue(f.request("admin"), parent(f.students[1].id));
    const second = f.token();
    expect(await denied(() => f.invitations.accept(f.request("multi"), { token: first }))).toBe(true);
    expect(await denied(() => f.invitations.accept(f.request("recipient", "http://localhost:3101"), { token: first }))).toBe(true);
    await f.invitations.accept(f.request("recipient"), { token: first });
    await f.invitations.accept(f.request("recipient"), { token: second });
    const rows = await f.service.listStudents(f.request("recipient"), { mode: "parent" });
    expect(rows.length === 2 && rows.every((row) => [f.students[0].id, f.students[1].id].includes(row.id))).toBe(true);
    await f.owner(async () => {
      const [member] = await f.db.select().from(s.membership).where(eq(s.membership.userId, f.identities.recipient.id));
      const grants = await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, member.id));
      expect(grants.length === 1 && grants[0].role === "parent").toBe(true);
      const links = await f.db.select().from(s.guardian).where(eq(s.guardian.parentGrantId, grants[0].id));
      expect(links.length === 2 && links.every((link) => link.practiceEnabled)).toBe(true);
    });
  });

  it("rejects GET, missing/spoofed/null Origin and cross-site mutations without consuming tokens", async () => {
    const f = await fixture();
    await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const token = f.token();
    for (const request of [f.request("recipient", undefined, {}, "GET"), f.request("recipient", undefined, { origin: "" }), f.request("recipient", undefined, { origin: "null" }), f.request("recipient", undefined, { origin: "https://evil.example.test" }), f.request("recipient", undefined, { "sec-fetch-site": "cross-site" })]) {
      expect(await denied(() => f.invitations.accept(request, { token }), 403)).toBe(true);
    }
    const absent = f.request("recipient"); absent.headers.delete("origin");
    expect(await denied(() => f.invitations.accept(absent, { token }), 403)).toBe(true);
    const noMethod = { ...f.request("recipient"), method: undefined };
    expect(await denied(() => f.invitations.accept(noMethod as unknown as ReturnType<typeof f.request>, { token }), 403)).toBe(true);
    await f.invitations.accept(f.request("recipient"), { token });
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token }))).toBe(true);
  });

  it("consumes atomically across concurrent attempts with one membership/grant/link and one accepted audit", async () => {
    const f = await fixture();
    const issued = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const token = f.token();
    const outcomes = await Promise.allSettled([0, 1].map(() => f.invitations.accept(f.request("recipient"), { token })));
    expect(outcomes.filter((value) => value.status === "fulfilled").length === 1).toBe(true);
    expect(outcomes.filter((value) => value.status === "rejected").length === 1).toBe(true);
    await f.owner(async () => {
      const [member] = await f.db.select().from(s.membership).where(eq(s.membership.userId, f.identities.recipient.id));
      expect(Boolean(member)).toBe(true);
      const accepted = await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, issued.inviteId));
      expect(accepted.filter((row) => row.action === "invite.accept").length === 1).toBe(true);
      expect((await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, member.id))).length === 1).toBe(true);
    });
  });

  it("denies revoked/expired/reissued links and rotates only after revoking old token", async () => {
    const f = await fixture();
    const original = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const old = f.token();
    const replacement = await f.invitations.reissue(f.request("admin"), { mode: "admin", inviteId: original.inviteId });
    const fresh = f.token();
    expect(old !== fresh && replacement.inviteId !== original.inviteId).toBe(true);
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token: old }))).toBe(true);
    expect(await denied(() => f.invitations.reissue(f.request("admin"), { mode: "admin", inviteId: original.inviteId }))).toBe(true);
    await f.invitations.revoke(f.request("admin"), { mode: "admin", inviteId: replacement.inviteId });
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token: fresh }))).toBe(true);
    // A tutor link keeps 72 hours (a parent's lasts 7 days: invitations-lifetime-copy.test.ts).
    await f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: "recipient@example.test" });
    const expired = f.token();
    vi.setSystemTime(new Date(Date.now() + 73 * 3600_000));
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token: expired }))).toBe(true);
  });

  it("fails closed for unverified/disabled recipients and stale or nonadmin issuers", async () => {
    const f = await fixture();
    await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const token = f.token();
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.recipient.id)); });
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token }), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, f.identities.recipient.id)); await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id, disabledAt: new Date() }); });
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token }), 403)).toBe(true);
    expect(await denied(() => f.invitations.issue(f.request("multi"), { ...parent(f.students[1].id), mode: "tutor" }), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.session).set({ createdAt: new Date(Date.now() - 16 * 60_000) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
    expect(await denied(() => f.invitations.issue(f.request("admin"), parent(f.students[1].id)), 403)).toBe(true);
    const before = f.delivered.length;
    expect(await denied(() => f.invitations.revoke(f.request("admin"), { mode: "admin", inviteId: crypto.randomUUID() }), 403)).toBe(true);
    expect(f.delivered.length === before).toBe(true);
  });

  it("matches the live locked email even when the real auth proof had the invited mailbox", async () => {
    const f = await fixture();
    const issued = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const token = f.token();
    let sawProof = false;
    const api = new Proxy(f.auth.api, { get(target, property, receiver) {
      if (property !== "getSession") return Reflect.get(target, property, receiver);
      return async (options: Parameters<typeof f.auth.api.getSession>[0]) => {
        const proof = await target.getSession(options); sawProof = Boolean(proof);
        await f.owner(async () => { await f.db.update(s.user).set({ email: "changed@example.test" }).where(eq(s.user.id, f.identities.recipient.id)); });
        return proof;
      };
    } });
    const invitations = createInvitationService({ db: f.db, access: createAccessService({ db: f.db, auth: { api }, deployment: { environment: "test", deployment: "suite" } }),
      throttleSecret: randomBytes(48).toString("base64url"), transport: async () => { throw new Error("No delivery expected"); } });
    expect(await denied(() => invitations.accept(f.request("recipient"), { token }))).toBe(true);
    expect(sawProof).toBe(true);
    await f.owner(async () => { const [row] = await f.db.select().from(s.invite).where(eq(s.invite.id, issued.inviteId)); expect(row.acceptedAt === null).toBe(true); });
  });

  it("never turns a parent mailbox/identity into a student and permits distinct explicit parent+tutor grants", async () => {
    const f = await fixture();
    expect(await denied(() => f.invitations.issue(f.request("admin"), { mode: "admin", role: "student", studentId: f.students[2].id, email: "unrelated@example.test" }), 403)).toBe(true);
    expect(await denied(() => f.invitations.issue(f.request("admin"), { mode: "admin", role: "student", studentId: f.students[2].id, email: "multi@example.test" }), 403)).toBe(true);
    // Student invitation issued first; becoming a parent before redemption still
    // prevents silent child identity linking on that same mailbox.
    await f.invitations.issue(f.request("admin"), { mode: "admin", role: "student", studentId: f.students[2].id, email: "student-new@example.test" });
    const studentToken = f.token();
    await f.invitations.issue(f.request("admin"), parent(f.students[1].id, "student-new@example.test"));
    await f.invitations.accept(f.request("newStudent"), { token: f.token() });
    expect(await denied(() => f.invitations.accept(f.request("newStudent"), { token: studentToken }))).toBe(true);
    await f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: "student-new@example.test" });
    await f.invitations.accept(f.request("newStudent"), { token: f.token() });
    expect((await f.service.listStudents(f.request("newStudent"), { mode: "parent" })).length === 1).toBe(true);
    expect((await f.service.listStudents(f.request("newStudent"), { mode: "tutor" })).length === 0).toBe(true);
  });

  it("accepts a distinct verified student identity but rejects stolen foreign targets", async () => {
    const f = await fixture();
    expect(await denied(() => f.invitations.issue(f.request("admin"), parent(f.students[3].id)))).toBe(true);
    await f.invitations.issue(f.request("admin"), { mode: "admin", role: "student", studentId: f.students[2].id, email: " STUDENT-NEW@example.test " });
    const result = await f.invitations.accept(f.request("newStudent"), { token: f.token() });
    expect(result.role === "student" && result.studentId === f.students[2].id).toBe(true);
    expect((await f.service.readStudent(f.request("newStudent"), { mode: "student", studentId: f.students[2].id })).id === f.students[2].id).toBe(true);
    expect(await denied(() => f.service.readStudent(f.request("newStudent"), { mode: "student", studentId: f.students[0].id }))).toBe(true);
  });

  it("reports postcommit delivery failure safely and reissues a new recoverable token", async () => {
    const f = await fixture(); f.failDelivery(true);
    const failed = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const first = f.token();
    expect(failed.delivery === "failed" && f.outsideTransport() && !JSON.stringify(failed).includes("@")).toBe(true);
    await f.owner(async () => {
      const [row] = await f.db.select().from(s.invite).where(eq(s.invite.id, failed.inviteId));
      const audits = await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, failed.inviteId));
      expect(row.deliveryStatus === "failed" && row.deliveryAttemptedAt instanceof Date && audits.filter((a) => a.action === "invite.delivery-failed").length === 1).toBe(true);
      // Both terminal state and receipt timestamp are immutable, including to a
      // privileged fixture. Runtime cannot silently overwrite the outcome.
      await expect(f.db.update(s.invite).set({ deliveryStatus: "sent" }).where(eq(s.invite.id, failed.inviteId))).rejects.toThrow();
      await expect(f.db.update(s.invite).set({ deliveryAttemptedAt: new Date(0) }).where(eq(s.invite.id, failed.inviteId))).rejects.toThrow();
    });
    f.failDelivery(false);
    const replacement = await f.invitations.reissue(f.request("admin"), { mode: "admin", inviteId: failed.inviteId });
    expect(replacement.delivery === "sent").toBe(true);
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token: first }))).toBe(true);
    await f.invitations.accept(f.request("recipient"), { token: f.token() });
  });

  it("keeps pending/unknown if the post-send audit cannot persist, even if transport threw", async () => {
    const f = await fixture();
    await f.owner(async () => {
      await f.client.exec(`CREATE FUNCTION synthetic_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action in ('invite.delivery-sent','invite.delivery-failed') THEN RAISE EXCEPTION 'Synthetic receipt persistence failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_receipt_failure()`);
    });
    for (const failed of [false, true]) {
      f.failDelivery(failed);
      const result = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
      expect(result.delivery === "unknown" && f.outsideTransport()).toBe(true);
      await f.owner(async () => {
        const [row] = await f.db.select().from(s.invite).where(eq(s.invite.id, result.inviteId));
        const events = await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.targetId, result.inviteId));
        expect(row.deliveryStatus === "pending" && row.deliveryAttemptedAt === null && events.length === 1 && events[0].action === "invite.issue").toBe(true);
      });
    }
    expect(f.delivered.length === 2).toBe(true);
    // The transport is told the issuing admin's congregation, whose product name the email then uses.
    expect(f.delivered.every(message => message.tenantId === "crc")).toBe(true);
  });

  it("records a transport outcome after actor logout/revocation without restoring any authority", async () => {
    const f = await fixture();
    let committedPending = false;
    f.duringTransport(async () => {
      // The committed row is visible from a new transaction before delivery
      // completes. Revocation/logout happen while private transport is running.
      await withTenantTransaction(f.db, { tenantId: "crc" }, async (tx) => {
        const rows = await tx.select().from(s.invite);
        committedPending = rows.length === 1 && rows[0].deliveryStatus === "pending" && rows[0].deliveryAttemptedAt === null;
      });
      await f.owner(async () => {
        await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.adminGrant.id));
        await f.db.delete(s.session).where(eq(s.session.id, f.identities.admin.sessionId));
        await f.db.update(s.invite).set({ revokedAt: new Date() });
      });
    });
    const result = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    expect(committedPending && result.delivery === "sent").toBe(true);
    await f.owner(async () => {
      const [row] = await f.db.select().from(s.invite).where(eq(s.invite.id, result.inviteId));
      const receipts = await f.db.select().from(s.auditEvent).where(and(eq(s.auditEvent.targetId, result.inviteId), eq(s.auditEvent.action, "invite.delivery-sent")));
      const [grant] = await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.id, f.adminGrant.id));
      expect(row.deliveryStatus === "sent" && Boolean(row.revokedAt) && Boolean(grant.revokedAt) && receipts.length === 1 && receipts[0].actorUserId === f.identities.admin.id).toBe(true);
    });
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token: f.token() }))).toBe(true);
    expect(await denied(() => f.invitations.issue(f.request("admin"), parent(f.students[1].id)), 401)).toBe(true);
  });

  it("does not let an older pending student invite undo identity unlink, but accepts a fresh explicit invite", async () => {
    const f = await fixture();
    const input = { mode: "admin" as const, role: "student" as const, studentId: f.students[2].id, email: "student-new@example.test" };
    await f.invitations.issue(f.request("admin"), input);
    await f.invitations.accept(f.request("newStudent"), { token: f.token() });
    await f.invitations.issue(f.request("admin"), input);
    const pending = f.token();
    const revokedAt = new Date(Date.now() + 1000);
    await f.owner(async () => { await f.db.update(s.studentIdentity).set({ revokedAt }).where(eq(s.studentIdentity.studentId, f.students[2].id)); });
    expect(await denied(() => f.invitations.accept(f.request("newStudent"), { token: pending }))).toBe(true);
    vi.setSystemTime(new Date(revokedAt.getTime() + 1000));
    await f.invitations.issue(f.request("admin"), input);
    await f.invitations.accept(f.request("newStudent"), { token: f.token() });
    expect((await f.service.readStudent(f.request("newStudent"), { mode: "student", studentId: f.students[2].id })).id === f.students[2].id).toBe(true);
  });

  it("keeps committed recipient/actor budgets with HMAC-only keys and never sends a throttled token", async () => {
    const f = await fixture();
    for (let index = 0; index < 5; index++) await f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: "recipient@example.test" });
    for (let index = 0; index < 2; index++) expect(await denied(() => f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: "recipient@example.test" }), 403)).toBe(true);
    expect(f.delivered.length === 5).toBe(true);
    await f.owner(async () => { const counters = await f.db.select().from(s.invitationThrottle); expect(counters.length === 2 && counters.every((row) => /^[a-f0-9]{64}$/.test(row.key)) && !JSON.stringify(counters).includes("@")).toBe(true); expect((await f.db.select().from(s.invite)).length === 5).toBe(true); });
    for (let index = 0; index < 15; index++) await f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: `bulk-${index}@example.test` });
    expect(await denied(() => f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: "over-budget@example.test" }), 403)).toBe(true);
    expect(f.delivered.length === 20).toBe(true);
  });
});
