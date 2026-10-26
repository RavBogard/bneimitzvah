import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { invitesFixture } from "./invites-fixture";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { AccessDenied } from "../../src/server/access/errors";
import { INVITATION_LIFETIME_MS, PARENT_INVITATION_LIFETIME_MS } from "../../src/server/invitations/tokens";
import { invitationMailText } from "../../src/server/mail/transport";
import * as s from "../../src/server/db/index";

// Release 1.9 N22 (decision 12; G13): parent links last 7 days, the email never names the child, "Copy link" rotates the
// link and shows it once to the admin who asked, "Expires tomorrow" and "Needs a parent invitation" come from the server.
type Invites = Awaited<ReturnType<typeof invitesFixture>>;
const open: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(open.splice(0).map(f => f.client.close())); });
async function invites() { const f = await invitesFixture(); open.push(f); return f; }
async function routes() { const f = await portalRoutesFixture(); open.push(f); return f; }
async function denied(action: () => Promise<unknown>, status = 404) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}
const DAY = 24 * 60 * 60_000;
const parent = (studentId: string) => ({ mode: "admin" as const, role: "parent" as const, studentId, email: "recipient@example.test" });
/**
 * Moves the clock forward (invitation rows are immutable, so time moves instead) and signs the recipient and the admin
 * in again, so a refusal is the invitation's expiry and never a session's.
 */
async function travel(f: Invites, start: number, days: number) {
  vi.setSystemTime(new Date(start + days * DAY));
  for (const [who, email] of [["recipient", "recipient@example.test"], ["admin", "admin@example.test"]] as const) {
    await f.owner(async () => {
      const { cookie } = await f.signIn(email);
      const current = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } });
      if (!current) throw new Error("Synthetic sign-in after travel failed");
      f.identities[who] = { id: current.user.id, cookie, sessionId: current.session.id };
    });
  }
}
async function everything(f: Invites) {
  return f.owner(async () => JSON.stringify({ invites: await f.db.select().from(s.invite), audits: await f.db.select().from(s.auditEvent) }));
}
/** Every console and stdout/stderr write while `action` runs. */
async function captureLogs<T>(action: () => Promise<T>) {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stdout.write);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);
  try { return { value: await action(), lines }; } finally { stdout.mockRestore(); stderr.mockRestore(); }
}

describe("invitation lifetimes", () => {
  it("a parent link lasts 7 days on the server: it works on day 6 and fails on day 8; other roles keep 72 hours", async () => {
    const f = await invites();
    const early = await f.invitations.issue(f.request("admin"), parent(f.students[0].id)), earlyToken = f.token();
    const late = await f.invitations.issue(f.request("admin"), parent(f.students[1].id)), lateToken = f.token();
    const tutor = await f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: "tutor-new@example.test" });
    await f.owner(async () => {
      const rows = await f.db.select().from(s.invite);
      const span = (id: string) => { const row = rows.find(value => value.id === id)!; return row.expiresAt.getTime() - row.createdAt.getTime(); };
      expect(span(early.inviteId)).toBe(PARENT_INVITATION_LIFETIME_MS);
      expect(span(tutor.inviteId)).toBe(INVITATION_LIFETIME_MS);
    });
    expect(PARENT_INVITATION_LIFETIME_MS).toBe(7 * DAY);
    const start = Date.now();
    await travel(f, start, 6);
    await expect(f.invitations.accept(f.request("recipient"), { token: earlyToken })).resolves.toMatchObject({ inviteId: early.inviteId, role: "parent" });
    await travel(f, start, 8);
    expect(await denied(() => f.invitations.preview(f.request("recipient", undefined, {}, "GET"), { token: lateToken }))).toBe(true);
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token: lateToken }))).toBe(true);
    await f.owner(async () => { const [row] = await f.db.select().from(s.invite).where(eq(s.invite.id, late.inviteId)); expect(row.acceptedAt).toBeNull(); });
  });
});

describe("the invitation email", () => {
  it("is handed the role and expiry but never a student, so no child's name can reach the subject or body", async () => {
    const f = await invites();
    await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const message = f.delivered.at(-1)! as unknown as Record<string, unknown>;
    expect(Object.keys(message).sort()).toEqual(["email", "expiresAt", "role", "tenantId", "url"]);
    expect(message.role).toBe("parent");
    const mail = invitationMailText({ congregation: "Central Reform Congregation", productName: "CRC Torah", role: "parent", expiresAt: message.expiresAt as Date, link: String(message.url) });
    expect(mail.subject).toBe("Central Reform Congregation invited you to CRC Torah");
    for (const name of [f.students[0].firstName, f.students[0].lastName]) expect(`${mail.subject}\n${mail.text}`).not.toContain(name);
    expect(mail.text).toContain("invited you as a parent on CRC Torah");
  });
});

describe("Copy link", () => {
  it("rotates the link: the copy works once, the previous link fails, and nothing is emailed", async () => {
    const f = await invites();
    const original = await f.invitations.issue(f.request("admin"), parent(f.students[0].id)), previous = f.token(), sent = f.delivered.length;
    const copied = await f.invitations.copyLink(f.request("admin"), { mode: "admin", inviteId: original.inviteId });
    const token = new URLSearchParams(new URL(copied.url).hash.slice(1)).get("token")!;
    expect(new URL(copied.url).pathname).toBe("/invitations/open");
    expect(copied.inviteId !== original.inviteId && token !== previous && /^[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
    expect(Date.parse(copied.expiresAt) - Date.now()).toBeGreaterThan(7 * DAY - 60_000);
    expect(f.delivered.length).toBe(sent);
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token: previous }))).toBe(true);
    await f.invitations.accept(f.request("recipient"), { token });
    expect(await denied(() => f.invitations.accept(f.request("recipient"), { token }))).toBe(true);
    // Copying the old (revoked) invitation again is refused.
    expect(await denied(() => f.invitations.copyLink(f.request("admin"), { mode: "admin", inviteId: original.inviteId }))).toBe(true);
  });

  it("keeps the token out of every audit row, invitation row and log line, and audits the rotation by id", async () => {
    const f = await invites();
    const original = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const { value: copied, lines } = await captureLogs(() => f.invitations.copyLink(f.request("admin"), { mode: "admin", inviteId: original.inviteId }));
    const token = new URLSearchParams(new URL(copied.url).hash.slice(1)).get("token")!;
    const accepted = await captureLogs(() => f.invitations.accept(f.request("recipient"), { token }));
    expect([...lines, ...accepted.lines].some(line => line.includes(token))).toBe(false);
    const stored = await everything(f);
    expect(stored.includes(token)).toBe(false);
    await f.owner(async () => {
      const audits = await f.db.select().from(s.auditEvent);
      expect(audits.some(row => row.action === "invite.revoke" && row.targetId === original.inviteId)).toBe(true);
      expect(audits.some(row => row.action === "invite.issue" && row.targetId === copied.inviteId)).toBe(true);
    });
  });

  it("refuses a tutor, a learner, a stale sign-in and another congregation's admin, and changes nothing", async () => {
    const f = await invites();
    const original = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    // Give the multi user an admin grant in the other congregation only.
    await f.owner(async () => {
      const [member] = await f.db.select().from(s.membership).where(sql`${s.membership.tenantId} = 'other' and ${s.membership.userId} = ${f.identities.multi.id}`);
      await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: member.id, role: "admin" });
    });
    const before = await everything(f);
    expect(await denied(() => f.invitations.copyLink(f.request("multi"), { mode: "tutor", inviteId: original.inviteId }), 403)).toBe(true);
    expect(await denied(() => f.invitations.copyLink(f.request("multi"), { mode: "admin", inviteId: original.inviteId }), 403)).toBe(true);
    expect(await denied(() => f.invitations.copyLink(f.request("learner"), { mode: "admin", inviteId: original.inviteId }), 403)).toBe(true);
    expect(await denied(() => f.invitations.copyLink(f.request("multi", "http://localhost:3101"), { mode: "admin", inviteId: original.inviteId }), 404)).toBe(true);
    expect(await denied(() => f.invitations.copyLink(f.request("admin", undefined, {}, "GET"), { mode: "admin", inviteId: original.inviteId }), 403)).toBe(true);
    expect(await denied(() => f.invitations.copyLink(f.request("admin", undefined, { origin: "https://evil.example.test" }), { mode: "admin", inviteId: original.inviteId }), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.session).set({ createdAt: new Date(Date.now() - 16 * 60_000) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
    expect(await denied(() => f.invitations.copyLink(f.request("admin"), { mode: "admin", inviteId: original.inviteId }), 403)).toBe(true);
    expect(await everything(f)).toBe(before);
  });

  it("over HTTP returns the link only to the admin, in a private no-store response, and refuses a tutor", async () => {
    const f = await routes();
    const sent = await (await f.call("/api/admin/invitations", { who: "admin", body: { role: "parent", email: "routes-recipient@example.test", studentId: f.students[0].id } })).json();
    expect((await f.call(`/api/admin/invitations/${sent.inviteId}/copy`, { who: "multi", body: {} })).status).toBe(403);
    expect((await f.call(`/api/admin/invitations/${sent.inviteId}/copy`, { who: "admin" })).status).toBe(405);
    const response = await f.call(`/api/admin/invitations/${sent.inviteId}/copy`, { who: "admin", body: {} }), body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "inviteId", "url"]);
    expect(body.url).toMatch(/^http:\/\/localhost:3000\/invitations\/open#token=[A-Za-z0-9_-]{43}$/);
    const list = await (await f.call("/api/admin/invitations", { who: "admin" })).json();
    expect(JSON.stringify(list).includes(body.url.split("=")[1])).toBe(false);
  });
});

describe("Expires tomorrow and Needs a parent invitation", () => {
  it("flags only a pending link with a day or less left", async () => {
    const f = await invites();
    const soon = await f.invitations.issue(f.request("admin"), parent(f.students[0].id));
    const gone = await f.invitations.issue(f.request("admin"), { mode: "admin", role: "tutor", email: "tutor-new@example.test" });
    await travel(f, Date.now(), 6.5);
    const later = await f.invitations.issue(f.request("admin"), parent(f.students[1].id));
    const rows = await f.invitations.list(f.request("admin", undefined, {}, "GET"), { mode: "admin" });
    const flag = (id: string) => rows.find(row => row.id === id)!;
    expect(flag(soon.inviteId)).toMatchObject({ status: "pending", expiresTomorrow: true });
    expect(flag(later.inviteId)).toMatchObject({ status: "pending", expiresTomorrow: false });
    expect(flag(gone.inviteId)).toMatchObject({ status: "expired", expiresTomorrow: false });
  });

  it("lists approved members who are a roster parent contact with no parent access or live parent invitation, for admins only", async () => {
    const f = await invites();
    await f.owner(async () => {
      await f.db.update(s.student).set({ secondParentEmail: "recipient@example.test" }).where(eq(s.student.id, f.students[2].id));
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id }).returning();
      await f.db.insert(s.tenantMember).values({ tenantId: "crc", membershipId: member.id, userId: f.identities.recipient.id, displayName: "Synthetic Parent", approvedByMembershipId: f.adminMember.id });
    });
    const read = () => f.invitations.parentInvitationsNeeded(f.request("admin", undefined, {}, "GET"), { mode: "admin" });
    const needed = await read();
    expect(needed).toHaveLength(1);
    expect(needed[0]).toMatchObject({ name: "Synthetic Parent", email: "recipient@example.test", student: { id: f.students[2].id } });
    expect(JSON.stringify(needed)).not.toMatch(/token|hash/i);
    expect(await denied(() => f.invitations.parentInvitationsNeeded(f.request("multi", undefined, {}, "GET"), { mode: "tutor" }), 403)).toBe(true);
    expect(await denied(() => f.invitations.parentInvitationsNeeded(f.request("multi", "http://localhost:3101", {}, "GET"), { mode: "admin" }), 403)).toBe(true);
    // A live parent invitation clears it; accepting keeps it cleared.
    await f.invitations.issue(f.request("admin"), parent(f.students[2].id));
    expect(await read()).toHaveLength(0);
    await f.invitations.accept(f.request("recipient"), { token: f.token() });
    expect(await read()).toHaveLength(0);
  });
});
