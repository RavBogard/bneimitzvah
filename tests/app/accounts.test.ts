import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createAccountsService, type AccountMailSender } from "../../src/server/accounts/service";
import { ACCOUNT_LIMITS } from "../../src/server/accounts/data";

// Release 1.4 accounts end to end through the dispatcher: request, approve, decline, members and approvers.
// Synthetic @example.test people only; the mail sender is a recorder, and nothing reaches a provider.
const ORIGIN = "http://localhost:3000", SECRET = "s".repeat(48);
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Mail = { kind: string; to: string; tenant: { name: string; productName: string }; key: string };

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const mail: Mail[] = [], clock = { now: Date.now() };
  const send: AccountMailSender = async (kind, to, tenant, key) => { mail.push({ kind, to, tenant, key }); return "sent"; };
  const accounts = createAccountsService({ db: f.db, access: f.service, throttleSecret: SECRET, send, now: () => clock.now });
  const runtime = { ...f.runtime, accounts };
  const dispatch = createHttpDispatcher(async action => action(runtime));
  const people: Record<string, { id: string; cookie: string; membershipId: string | null }> = {};
  async function person(key: string, membership: "none" | "disabled" = "none") {
    return f.owner(async () => {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(`acct-${key}@example.test`);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic account failed");
      let membershipId: string | null = null;
      if (membership === "disabled") membershipId = (await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id, disabledAt: new Date() }).returning())[0].id;
      people[key] = { id: proof.user.id, cookie, membershipId };
      return people[key];
    });
  }
  const cookie = (who: string) => who === "anonymous" ? "" : people[who]?.cookie ?? f.identities[who as "admin"].cookie;
  async function call(path: string, who: string, body?: unknown, headers: Record<string, string> = {}) {
    const h = new Headers(headers), c = cookie(who);
    if (c) h.set("cookie", c);
    if (body !== undefined) { if (!h.has("origin")) h.set("origin", ORIGIN); h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    return { status: response.status, json: await response.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const grants = () => f.owner(async () => (await f.db.select().from(s.roleGrant)).map(row => [row.id, row.role, row.revokedAt?.toISOString() ?? null]).sort());
  const audits = (action: string) => f.owner(async () => (await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, action))));
  const designate = async () => (await call("/api/accounts/approvers/add", "admin", { tutorGrantId: f.tutorGrant.id })).json.approverId as string;
  return { f, mail, clock, dispatch, call, person, people, grants, audits, designate, accounts };
}
const requests = (t: Awaited<ReturnType<typeof setup>>, who = "admin", mode = "admin") => t.call(`/api/accounts/requests?mode=${mode}`, who);

describe("asking for an account", () => {
  it("is open to any signed-in person without saved readings, waits idempotently, and tells each approver once", async () => {
    const t = await setup();
    await t.person("asker");
    expect((await t.call("/api/account/request", "anonymous")).status).toBe(401);
    expect((await t.call("/api/account/request", "anonymous", { name: "X" })).status).toBe(401);
    const state = await t.call("/api/account/request", "asker");
    expect(state.json).toEqual({ ok: true, state: "requestable", suggestedName: expect.any(String) });
    expect(JSON.stringify(state.json)).not.toContain("@");
    await t.designate();
    const sent = await t.call("/api/account/request", "asker", { name: "  Ruth bat Naomi ", purpose: "Learning\nto lein" });
    expect(sent).toEqual({ status: 200, json: { ok: true, state: "pending" } });
    expect((await t.call("/api/account/request", "asker")).json.state).toBe("pending");
    // The request email went to the admin and the designated tutor, carrying none of the requester's words.
    expect(t.mail.map(row => [row.kind, row.to]).sort()).toEqual([["account-request", "admin@example.test"], ["account-request", "multi@example.test"]]);
    expect(new Set(t.mail.map(row => row.key)).size).toBe(2);
    for (const row of t.mail) { expect(JSON.stringify(row)).not.toContain("Ruth"); expect(JSON.stringify(row)).not.toContain("lein"); expect(row.key).toMatch(/^[0-9a-f-]{36}$/); }
    // Asking again while waiting changes nothing and sends nothing.
    expect((await t.call("/api/account/request", "asker", { name: "Someone else" })).json).toEqual({ ok: true, state: "pending" });
    expect(t.mail).toHaveLength(2);
    const [row] = await t.f.owner(() => t.f.db.select().from(s.accountRequest));
    expect(row).toMatchObject({ displayName: "Ruth bat Naomi", purpose: "Learning to lein", notifyStatus: "sent" });
    expect((await requests(t)).json.requests).toEqual([{ id: row.id, name: "Ruth bat Naomi", purpose: "Learning to lein", email: "acct-asker@example.test", requestedAt: expect.any(String) }]);
    // A student-only account may ask too; a parent, tutor or admin already keeps saved readings.
    expect((await t.call("/api/account/request", "learner")).json.state).toBe("requestable");
    for (const who of ["multi", "admin"]) {
      expect((await t.call("/api/account/request", who)).json.state).toBe("member");
      expect((await t.call("/api/account/request", who, { name: "Staff" })).json).toEqual({ ok: true, state: "member" });
    }
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.accountRequest)).length)).toBe(1);
    // Requesting is not audited: the request row is the record.
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.auditEvent)).map(row => row.action))).toEqual(["approver.designate"]);
  });

  it("refuses spoofing characters, long text, extra fields and a POST without the exact Origin", async () => {
    const t = await setup();
    await t.person("spoof");
    for (const body of [{ name: "A\u202eB" }, { name: "A\u2066B" }, { name: "A\u2028B" }, { name: "Line\nbreak" }, { name: "" }, { name: "x".repeat(81) }, { name: "Ok", purpose: "p".repeat(501) },
      { name: "Ok", purpose: "A\u202dB" }, { name: "Ok", extra: 1 }, { name: 4 }]) expect((await t.call("/api/account/request", "spoof", body)).status, JSON.stringify(body)).toBe(400);
    for (const headers of [{ origin: "https://evil.example" }, { origin: ORIGIN, "sec-fetch-site": "cross-site" }] as Record<string, string>[])
      expect((await t.call("/api/account/request", "spoof", { name: "Ok" }, headers)).status).toBe(403);
    expect((await t.call("/api/account/request", "spoof", { name: "Ok" }, { "X-Practice-Context": "x".repeat(43) })).status).toBe(403);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.accountRequest)).length)).toBe(0);
  });

  it("holds three requests a day per person, fifty waiting per congregation, and twelve request emails an hour", async () => {
    const t = await setup();
    await t.person("again");
    for (let round = 0; round < ACCOUNT_LIMITS.requestsPerDay; round++) {
      expect((await t.call("/api/account/request", "again", { name: "Again" })).json.state).toBe("pending");
      const [row] = (await requests(t)).json.requests;
      expect((await t.call("/api/accounts/requests/decline", "admin", { mode: "admin", requestId: row.id })).status).toBe(200);
    }
    expect(await t.call("/api/account/request", "again", { name: "Again" })).toEqual({ status: 429, json: { ok: false, code: "rate-limited" } });
    t.clock.now += 24 * 60 * 60_000;
    expect((await t.call("/api/account/request", "again", { name: "Again" })).json.state).toBe("pending");
    // The congregation's hourly mail budget: past it, a request still waits and is listed, its email skipped.
    await t.person("late");
    const hour = Math.floor(t.clock.now / 3_600_000) * 3_600_000, key = createHmac("sha256", SECRET).update(JSON.stringify(["account-mail", "crc", "requests"])).digest("hex");
    await t.f.owner(async () => { await t.f.db.update(s.invitationThrottle).set({ count: ACCOUNT_LIMITS.requestMailsPerHour }).where(and(eq(s.invitationThrottle.scope, "account-mail"), eq(s.invitationThrottle.key, key), eq(s.invitationThrottle.bucketStart, hour))); });
    const before = t.mail.length;
    expect((await t.call("/api/account/request", "late", { name: "Late" })).json.state).toBe("pending");
    expect(t.mail.length).toBe(before);
    expect((await t.f.owner(() => t.f.db.select().from(s.accountRequest).where(eq(s.accountRequest.userId, t.people.late.id))))[0].notifyStatus).toBe("skipped");
    expect((await requests(t)).json.requests.map((row: { name: string }) => row.name)).toContain("Late");
    // Fifty waiting is the most; the fifty-first is refused until some are decided.
    await t.f.owner(async () => {
      for (let i = 0; i < 48; i++) {
        const [account] = await t.f.db.insert(s.user).values({ id: `filler-${i}`, name: "Filler", email: `filler-${i}@example.test`, emailVerified: true }).returning();
        await t.f.db.insert(s.accountRequest).values({ tenantId: "crc", userId: account.id, displayName: `Filler ${i}`, notifyStatus: "skipped" });
      }
    });
    await t.person("crowd");
    expect(await t.call("/api/account/request", "crowd", { name: "Crowd" })).toEqual({ status: 429, json: { ok: false, code: "busy" } });
  });
});

describe("approving and declining", () => {
  it("approve creates the membership and the Member role, removes the request, writes one audit and sends one email; never a role grant", async () => {
    const t = await setup();
    await t.person("new");
    await t.call("/api/account/request", "new", { name: "New Member", purpose: "Shabbat readings" });
    const grantsBefore = await t.grants(), [pending] = (await requests(t)).json.requests;
    t.mail.length = 0;
    expect((await t.call("/api/saved/readings", "new")).status).toBe(403);
    const approved = await t.call("/api/accounts/requests/approve", "admin", { mode: "admin", requestId: pending.id });
    expect(approved.status).toBe(200); expect(approved.json).toEqual({ ok: true, memberId: expect.any(String) });
    expect(t.mail).toEqual([{ kind: "account-approved", to: "acct-new@example.test", tenant: { name: expect.any(String), productName: expect.any(String) }, key: approved.json.memberId }]);
    expect(await t.grants()).toEqual(grantsBefore);
    const [member] = await t.f.owner(() => t.f.db.select().from(s.tenantMember));
    expect(member).toMatchObject({ displayName: "New Member", userId: t.people.new.id, welcomeStatus: "sent", revokedAt: null });
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.accountRequest)).length)).toBe(0);
    expect((await t.audits("account-request.approve")).map(row => [row.targetType, row.targetId, row.mode])).toEqual([["tenant_member", member.id, "admin"]]);
    // The new member keeps saved readings at once, and has no workspace role.
    expect((await t.call("/api/saved/readings", "new")).status).toBe(200);
    const session = await t.call("/api/session", "new");
    expect(session.json).toMatchObject({ membershipAvailable: true, roles: [], saved: true, approver: false });
    expect((await t.call("/api/account/request", "new")).json.state).toBe("member");
    expect((await t.call("/api/students?mode=parent", "new")).status).toBe(403);
    // A membership without a role is new in this release: nothing that reads only the membership treats it as a role.
    for (const mode of ["student", "parent", "tutor", "admin"]) expect((await t.call(`/api/students?mode=${mode}`, "new")).status, mode).toBe(403);
    for (const path of ["/api/admin/students", "/api/admin/invitations", "/api/admin/congregation-settings", "/api/staff/claude-connections"]) expect((await t.call(path, "new")).status, path).toBe(403);
    expect((await t.call("/api/notifications/preferences", "new")).json).toEqual({ ok: true, view: { options: [] } });
    expect((await t.call("/api/notifications/preferences", "new", { kind: "weekly-digest", enabled: false })).status).toBe(403);
    expect((await t.call("/api/accounts/summary?mode=admin", "new")).status).toBe(403);
    // Deciding again finds nothing: the losing side of a race sees the same 404.
    expect((await t.call("/api/accounts/requests/approve", "admin", { mode: "admin", requestId: pending.id })).status).toBe(404);
    expect((await t.call("/api/accounts/requests/decline", "admin", { mode: "admin", requestId: pending.id })).status).toBe(404);
    // Two approvals at once: exactly one wins.
    await t.person("race");
    await t.call("/api/account/request", "race", { name: "Racer" });
    const [raced] = (await requests(t)).json.requests;
    const results = await Promise.all([1, 2].map(() => t.call("/api/accounts/requests/approve", "admin", { mode: "admin", requestId: raced.id })));
    expect(results.map(r => r.status).sort()).toEqual([200, 404]);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.tenantMember)).length)).toBe(2);
  });

  it("approving a disabled membership is refused and keeps the request; decline removes it and sends nothing", async () => {
    const t = await setup();
    await t.person("off", "disabled");
    // A disabled membership cannot even ask (403), so its request is planted as if made before it was turned off.
    expect((await t.call("/api/account/request", "off")).status).toBe(403);
    await t.f.owner(async () => { await t.f.db.insert(s.accountRequest).values({ tenantId: "crc", userId: t.people.off.id, displayName: "Turned off" }); });
    const [row] = (await requests(t)).json.requests;
    expect(await t.call("/api/accounts/requests/approve", "admin", { mode: "admin", requestId: row.id })).toEqual({ status: 409, json: { ok: false, code: "disabled" } });
    expect((await requests(t)).json.requests).toHaveLength(1);
    t.mail.length = 0;
    expect((await t.call("/api/accounts/requests/decline", "admin", { mode: "admin", requestId: row.id })).json).toEqual({ ok: true });
    expect(t.mail).toEqual([]);
    expect((await requests(t)).json.requests).toEqual([]);
    expect((await t.audits("account-request.decline")).map(audit => audit.targetId)).toEqual([row.id]);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.tenantMember)).length)).toBe(0);
  });

  it("is for admins and designated tutors only, in their own mode, with the exact Origin", async () => {
    const t = await setup();
    await t.person("asker");
    await t.call("/api/account/request", "asker", { name: "Asker" });
    const [row] = (await requests(t)).json.requests;
    for (const [who, mode, status] of [["anonymous", "admin", 401], ["asker", "admin", 403], ["learner", "admin", 403], ["learner", "tutor", 403], ["multi", "admin", 403], ["multi", "tutor", 403], ["admin", "tutor", 403]] as const) {
      expect((await t.call(`/api/accounts/summary?mode=${mode}`, who)).status, `${who} ${mode}`).toBe(status);
      expect((await requests(t, who, mode)).status, `${who} ${mode}`).toBe(status);
      expect((await t.call("/api/accounts/requests/approve", who, { mode, requestId: row.id })).status, `${who} ${mode}`).toBe(status);
    }
    expect((await t.call("/api/accounts/summary?mode=admin", "admin")).json).toEqual({ ok: true, requests: 1 });
    expect((await t.call("/api/accounts/summary?mode=owner", "admin")).status).toBe(400);
    expect((await t.call("/api/accounts/requests/approve", "admin", { mode: "admin", requestId: row.id }, { origin: "https://evil.example" })).status).toBe(403);
    // Designated, the tutor approves in tutor mode; the audit carries that mode and grant.
    const approverId = await t.designate();
    expect((await t.call("/api/session", "multi")).json.approver).toBe(true);
    expect((await t.call("/api/accounts/summary?mode=tutor", "multi")).json).toEqual({ ok: true, requests: 1 });
    expect((await t.call("/api/accounts/requests/approve", "multi", { mode: "tutor", requestId: row.id })).status).toBe(200);
    expect((await t.audits("account-request.approve")).map(audit => [audit.mode, audit.roleGrantId])).toEqual([["tutor", t.f.tutorGrant.id]]);
    // Removing the designation, or the tutor grant behind it, ends it at once.
    expect((await t.call("/api/accounts/approvers/remove", "admin", { approverId })).json).toEqual({ ok: true });
    expect((await t.call("/api/accounts/summary?mode=tutor", "multi")).status).toBe(403);
    expect((await t.call("/api/session", "multi")).json.approver).toBe(false);
    await t.designate();
    await t.f.owner(async () => { await t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.tutorGrant.id)); });
    expect((await t.call("/api/accounts/summary?mode=tutor", "multi")).status).toBe(403);
    expect((await t.call("/api/session", "multi")).json.approver).toBe(false);
  });
});

describe("members and approvers", () => {
  it("lists members by name only, and ending one removes saved readings at once while keeping the rows", async () => {
    const t = await setup();
    await t.person("kept");
    await t.call("/api/account/request", "kept", { name: "Kept" });
    const [row] = (await requests(t)).json.requests;
    await t.call("/api/accounts/requests/approve", "admin", { mode: "admin", requestId: row.id });
    await t.call("/api/saved/readings/create", "kept", { name: "Mine", date: null, kind: "torah", ranges: "Genesis 1:1-3" });
    const list = await t.call("/api/accounts/members", "admin");
    expect(list.json).toEqual({ ok: true, members: [{ id: expect.any(String), name: "Kept", since: expect.any(String) }] });
    expect(JSON.stringify(list.json)).not.toContain("@");
    for (const who of ["multi", "learner", "kept"]) expect((await t.call("/api/accounts/members", who)).status).toBe(403);
    const memberId = list.json.members[0].id;
    expect((await t.call("/api/accounts/members/end", "multi", { memberId })).status).toBe(403);
    expect((await t.call("/api/accounts/members/end", "admin", { memberId })).json).toEqual({ ok: true });
    expect((await t.call("/api/saved/readings", "kept")).status).toBe(403);
    expect((await t.call("/api/session", "kept")).json.saved).toBe(false);
    expect((await t.call("/api/accounts/members/end", "admin", { memberId })).status).toBe(404);
    expect((await t.audits("member.revoke")).map(audit => audit.targetId)).toEqual([memberId]);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.savedReading)).length)).toBe(1);
    // Asked again and approved again, the same readings are there.
    await t.call("/api/account/request", "kept", { name: "Kept again" });
    const [again] = (await requests(t)).json.requests;
    await t.call("/api/accounts/requests/approve", "admin", { mode: "admin", requestId: again.id });
    expect((await t.call("/api/saved/readings", "kept")).json.readings).toHaveLength(1);
  });

  it("designates tutors only (never admins, never twice) with a fresh sign-in, and removes them without one", async () => {
    const t = await setup();
    const view = await t.call("/api/accounts/approvers", "admin");
    expect(view.json).toEqual({ ok: true, admins: [expect.any(String)], designated: [], candidates: [{ tutorGrantId: t.f.tutorGrant.id, name: expect.any(String) }] });
    expect(JSON.stringify(view.json)).not.toContain("@");
    for (const who of ["multi", "learner"]) expect((await t.call("/api/accounts/approvers", who)).status).toBe(403);
    expect((await t.call("/api/accounts/approvers/add", "multi", { tutorGrantId: t.f.tutorGrant.id })).status).toBe(403);
    expect((await t.call("/api/accounts/approvers/add", "admin", { tutorGrantId: t.f.adminGrant.id })).status).toBe(404);
    expect((await t.call("/api/accounts/approvers/add", "admin", { tutorGrantId: t.f.parentGrant.id })).status).toBe(404);
    // An admin who is also a tutor already approves.
    const adminTutor = await t.f.owner(async () => (await t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.f.adminMember.id, role: "tutor" }).returning())[0]);
    expect(await t.call("/api/accounts/approvers/add", "admin", { tutorGrantId: adminTutor.id })).toEqual({ status: 409, json: { ok: false, code: "admin" } });
    const id = await t.designate();
    expect(await t.call("/api/accounts/approvers/add", "admin", { tutorGrantId: t.f.tutorGrant.id })).toEqual({ status: 409, json: { ok: false, code: "designated" } });
    expect((await t.call("/api/accounts/approvers", "admin")).json.designated).toEqual([{ id, name: expect.any(String) }]);
    expect((await t.audits("approver.designate")).map(audit => audit.targetId)).toEqual([id]);
    // A stale sign-in (over 15 minutes) cannot add an approver, but can remove one.
    await t.f.owner(async () => { await t.f.db.update(s.session).set({ createdAt: new Date(Date.now() - 60 * 60_000) }).where(eq(s.session.id, t.f.identities.admin.sessionId)); });
    expect((await t.call("/api/accounts/approvers/remove", "admin", { approverId: id })).json).toEqual({ ok: true });
    expect((await t.call("/api/accounts/approvers/add", "admin", { tutorGrantId: t.f.tutorGrant.id })).status).toBe(403);
    expect((await t.audits("approver.revoke")).map(audit => audit.targetId)).toEqual([id]);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.accountApprover).where(eq(s.accountApprover.id, id)))[0].revokedAt)).not.toBeNull();
    // A designation dies with its tutor grant; the same person teaching again under a new grant can be designated again.
    await t.f.owner(async () => { await t.f.db.update(s.session).set({ createdAt: new Date() }).where(eq(s.session.id, t.f.identities.admin.sessionId)); });
    const old = await t.designate();
    const regrant = await t.f.owner(async () => {
      await t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.tutorGrant.id));
      return (await t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.f.multiMember.id, role: "tutor" }).returning())[0];
    });
    expect((await t.call("/api/accounts/approvers", "admin")).json.designated).toEqual([]);
    const renewed = await t.call("/api/accounts/approvers/add", "admin", { tutorGrantId: regrant.id });
    expect(renewed.json).toEqual({ ok: true, approverId: expect.any(String) });
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.accountApprover).where(eq(s.accountApprover.id, old)))[0].revokedAt)).not.toBeNull();
    expect((await t.call("/api/accounts/summary?mode=tutor", "multi")).status).toBe(200);
  });

  it("keeps each congregation's requests, members and approvers to that congregation", async () => {
    const t = await setup();
    await t.person("here");
    await t.call("/api/account/request", "here", { name: "Here only" });
    const [row] = (await requests(t)).json.requests;
    // multi is an admin in the other congregation as well; there it sees and decides nothing of this one.
    const [other] = await t.f.owner(() => t.f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")));
    await t.f.owner(async () => { await t.f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: other.id, role: "admin" }); });
    const there = (path: string, body?: unknown) => t.dispatch(new Request(`http://localhost:3101${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { cookie: t.f.identities.multi.cookie, ...(body === undefined ? {} : { origin: "http://localhost:3101", "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
    expect(await (await there("/api/accounts/summary?mode=admin")).json()).toEqual({ ok: true, requests: 0 });
    expect(await (await there("/api/accounts/requests?mode=admin")).json()).toEqual({ ok: true, requests: [] });
    // Refused either way: the runtime answers one origin (403), and the request is not in that congregation (404).
    expect([403, 404]).toContain((await there("/api/accounts/requests/approve", { mode: "admin", requestId: row.id })).status);
    // Refused either way: the runtime answers one origin (403), and the request is not in that congregation (404).
    expect([403, 404]).toContain((await there("/api/accounts/requests/decline", { mode: "admin", requestId: row.id })).status);
    expect([403, 404]).toContain((await there("/api/accounts/approvers/add", { tutorGrantId: t.f.tutorGrant.id })).status);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.accountApprover)).length)).toBe(0);
    expect((await requests(t)).json.requests).toHaveLength(1);
  });

  it("serves every accounts route private and no-store, errors included, and refuses unknown methods and query keys", async () => {
    const t = await setup();
    const gets = ["/api/account/request", "/api/accounts/summary?mode=admin", "/api/accounts/requests?mode=admin", "/api/accounts/members", "/api/accounts/approvers"];
    const posts = ["/api/account/request", "/api/accounts/requests/approve", "/api/accounts/requests/decline", "/api/accounts/members/end", "/api/accounts/approvers/add", "/api/accounts/approvers/remove"];
    for (const who of ["anonymous", "learner", "admin"]) { for (const path of gets) await t.call(path, who); for (const path of posts) await t.call(path, who, { bad: true }); }
    expect((await t.call("/api/accounts/members?mode=admin", "admin")).status).toBe(400);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/accounts/members/end`, { headers: { cookie: t.f.identities.admin.cookie } }))).status).toBe(405);
  });
});
