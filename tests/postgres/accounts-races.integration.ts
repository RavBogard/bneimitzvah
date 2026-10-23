import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createAccountsService } from "../../src/server/accounts/service";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { withTenantTransaction } from "../../src/server/db/runtime";

// Release 1.4 accounts on two real PostgreSQL backends: racing approvals, racing requests, and a designation
// revoked while its tutor is approving. The mail sender records only; nothing reaches a provider.
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const safe = (operation: PromiseLike<unknown>) => Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));

async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const sent: string[] = [];
  const service = (access: typeof f.a) => createAccountsService({ db: access === f.a ? f.aDb : f.bDb, access, throttleSecret: "t".repeat(48), send: async kind => { sent.push(kind); return "sent"; } });
  const a = service(f.a), b = service(f.b);
  const requester = await f.signIn("pg-requester");
  const as = (cookie: string, post = false) => ({ url: "http://localhost:3000/accounts", method: post ? "POST" : "GET", headers: new Headers({ cookie, ...(post ? { origin: "http://localhost:3000" } : {}) }) });
  const mutation = (who: "admin" | "tutor") => { const value = f.request(who); value.headers.set("origin", "http://localhost:3000"); return { ...value, method: "POST" }; };
  return { ...f, a, b, sent, requester, as, mutation };
}

test("two backends approving the same request at once: exactly one Member row and one email", async () => {
  const f = await fixture();
  expect(await f.a.request(f.as(f.requester.cookie, true), { name: "Racing requester" })).toMatchObject({ ok: true, state: "pending" });
  const [pending] = await f.ownerDb.select().from(s.accountRequest);
  f.sent.length = 0;
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "tenant_member"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const first = safe(f.a.approve(f.mutation("admin"), { mode: "admin", requestId: pending.id }));
  let second: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, first);
    second = safe(f.b.approve(f.mutation("admin"), { mode: "admin", requestId: pending.id }));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); }
  const results = await Promise.all([first, second!]);
  expect(results.filter(row => (row as { ok?: boolean }).ok).length).toBe(1);
  expect(results.filter(row => (row as { denied?: number }).denied === 404).length).toBe(1);
  expect((await f.ownerDb.select().from(s.tenantMember)).length).toBe(1);
  expect(f.sent).toEqual(["account-approved"]);
});

test("the same person asking on two backends at once leaves exactly one request", async () => {
  const f = await fixture();
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "account_request"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const first = safe(f.a.request(f.as(f.requester.cookie, true), { name: "Twice" }));
  let second: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, first);
    second = safe(f.b.request(f.as(f.requester.cookie, true), { name: "Twice" }));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); }
  expect(await Promise.all([first, second!])).toEqual([{ ok: true, state: "pending" }, { ok: true, state: "pending" }]);
  expect((await f.ownerDb.select().from(s.accountRequest)).length).toBe(1);
});

test("revoking a designation while its tutor approves waits for that approval, and the next one is refused", async () => {
  const f = await fixture();
  const [tutorMember] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.tutor.id));
  const [adminMember] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [designation] = await f.ownerDb.insert(s.accountApprover).values({ tenantId: "crc", membershipId: tutorMember.id, tutorGrantId: f.tutorGrant.id, designatedByMembershipId: adminMember.id }).returning();
  await f.a.request(f.as(f.requester.cookie, true), { name: "Waiting" });
  const second = await f.signIn("pg-requester-two");
  await f.a.request(f.as(second.cookie, true), { name: "Second" });
  const [one, two] = await f.ownerDb.select().from(s.accountRequest).orderBy(s.accountRequest.createdAt);
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('delete from "account_request"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const approving = safe(f.a.approve(f.mutation("tutor"), { mode: "tutor", requestId: one.id }));
  let revoke: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, approving);
    revoke = withTenantTransaction(f.bDb, { tenantId: "crc" }, tx => tx.update(s.accountApprover).set({ revokedAt: new Date(), revokedByMembershipId: adminMember.id }).where(eq(s.accountApprover.id, designation.id)));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); }
  expect(await approving).toMatchObject({ ok: true });
  await revoke;
  expect(await safe(f.b.approve(f.mutation("tutor"), { mode: "tutor", requestId: two.id }))).toEqual({ denied: 403 });
  expect((await f.ownerDb.select().from(s.accountRequest)).map(row => row.id)).toEqual([two.id]);
});
