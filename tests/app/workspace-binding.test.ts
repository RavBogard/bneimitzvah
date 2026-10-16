import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import * as s from "../../src/server/db/index";

const open: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });
async function fixture() { const f = await portalRoutesFixture(); open.push(f); return f; }
test("opaque UI binding is stable for a live session but changes for new session, identity, membership revision and grant revision", async () => {
  const f = await fixture(), request = f.request("/api/session", { who: "admin" });
  const first = await f.runtime.portal.sessionSummary(request), again = await f.runtime.portal.sessionSummary(request);
  expect(first.sessionBinding === again.sessionBinding && /^[A-Za-z0-9_-]{43}$/.test(first.sessionBinding)).toBe(true);
  const serialized = JSON.stringify(first);
  expect(!serialized.includes(f.identities.admin.id) && !serialized.includes(f.identities.admin.sessionId) && !serialized.includes(f.adminMember.id) && !serialized.includes(f.adminGrant.id)).toBe(true);
  const other = await f.runtime.portal.sessionSummary(f.request("/api/session", { who: "multi" })); expect(other.sessionBinding === first.sessionBinding).toBe(false);
  let cookie = "";
  await f.owner(async () => { const [user] = await f.db.select({ email: s.user.email }).from(s.user).where(eq(s.user.id, f.identities.admin.id)); cookie = (await f.signIn(user.email)).cookie; });
  const next = await f.runtime.portal.sessionSummary(new Request("http://localhost:3000/api/session", { headers: { cookie } }));
  expect(next.roles.join() === first.roles.join() && next.sessionBinding !== first.sessionBinding).toBe(true);
  await f.owner(async () => { await f.db.update(s.membership).set({ authorityRevision: 2 }).where(eq(s.membership.id, f.adminMember.id)); });
  const revised = await f.runtime.portal.sessionSummary(request); expect(revised.sessionBinding === first.sessionBinding).toBe(false);
  await f.owner(async () => { await f.db.update(s.roleGrant).set({ revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
  const grantChanged = await f.runtime.portal.sessionSummary(request); expect(grantChanged.sessionBinding === revised.sessionBinding).toBe(false);
});

test("replacement grant identity changes the binding even when available role names remain identical", async () => {
  const f = await fixture(), request = f.request("/api/session", { who: "multi" });
  const before = await f.runtime.portal.sessionSummary(request);
  await f.owner(async () => {
    await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.tutorGrant.id));
    await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "tutor" });
  });
  const after = await f.runtime.portal.sessionSummary(request);
  expect(before.roles.join() === after.roles.join() && before.sessionBinding !== after.sessionBinding).toBe(true);
});
