import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { bookletTutorName } from "../../src/server/booklet/access";
import * as s from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { listLearners } from "../../src/server/learners/data";
import { portalRoutesFixture } from "./portal-routes-fixture";

vi.mock("server-only", () => ({}));
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
const path = "/api/profile/name";
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });

async function setup() {
  const f = await portalRoutesFixture();
  fixtures.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const binding = async (who: "admin" | "multi" | "learner" | "recipient", origin?: string) =>
    (await f.runtime.portal.sessionSummary(f.request("/api/session", { who, origin }))).sessionBinding;
  const call = async (options: Parameters<typeof f.request>[1] = {}, query = "") => dispatch(f.request(path + query, options));
  return { ...f, dispatch, binding, call };
}
const bound = (binding: string) => ({ "X-Session-Binding": binding });

it("lets a verified roleless member rename their own congregation account and binds the editor to the current session", async () => {
  const f = await setup();
  const [roleless] = await f.owner(() => f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id }).returning());
  const summary = await f.runtime.portal.sessionSummary(f.request("/api/session", { who: "recipient" }));
  expect(summary.roles).toEqual([]);
  const options = { who: "recipient" as const, headers: bound(summary.sessionBinding) };
  expect(await (await f.call(options)).json()).toEqual({ ok: true, name: "", revision: 0 });
  const saved = await f.call({ ...options, body: { name: "  Aviva שָׁלוֹם  ", expectedRevision: 0 } });
  expect(saved.headers.get("cache-control")).toContain("no-store");
  expect(await saved.json()).toEqual({ ok: true, name: "Aviva שָׁלוֹם", revision: 1 });
  expect(await (await f.call(options)).json()).toEqual({ ok: true, name: "Aviva שָׁלוֹם", revision: 1 });
  expect((await f.call({ ...options, who: "learner" })).status).toBe(403);
  expect((await f.call({ ...options, who: "learner", body: { name: "Stale tab", expectedRevision: 0 } })).status).toBe(403);
  const otherSession = await f.owner(() => f.signIn("routes-recipient@example.test"));
  expect((await f.call({ ...options, headers: { ...options.headers, cookie: otherSession.cookie }, body: { name: "Stale tab", expectedRevision: 1 } })).status).toBe(403);
  await f.owner(async () => {
    const [stored] = await f.db.select().from(s.membership).where(eq(s.membership.id, roleless.id));
    const [user] = await f.db.select().from(s.user).where(eq(s.user.id, f.identities.recipient.id));
    expect(stored).toEqual(roleless);
    expect(user.name).not.toBe("Aviva שָׁלוֹם");
  });
});

it("shares one revision between self, People, and Tutors and updates existing name projections without changing the roster or links", async () => {
  const f = await setup();
  await f.owner(async () => {
    await f.db.update(s.user).set({ name: "Synthetic account" }).where(eq(s.user.id, f.identities.multi.id));
    await f.db.insert(s.tenantMember).values({ tenantId: "crc", membershipId: f.multiMember.id, userId: f.identities.multi.id,
      displayName: "Synthetic member", approvedByMembershipId: f.adminMember.id });
  });
  const admin = { who: "admin" as const, headers: bound(await f.binding("admin")) };
  const self = { who: "multi" as const, headers: bound(await f.binding("multi")) };
  const person = "?membershipId=" + f.multiMember.id, tutor = "?tutorGrantId=" + f.tutorGrant.id;
  const people = async () => (await (await f.dispatch(f.request("/api/accounts/people", admin))).json()).people;
  const tutors = async () => (await (await f.dispatch(f.request("/api/admin/tutors", admin))).json()).tutors;
  const callPortal = (pathname: string) => f.dispatch(f.request(pathname, admin));
  const booklet = () => withTenantTransaction(f.db, { tenantId: "crc" }, tx => bookletTutorName(tx, "crc", f.students[0].id));
  expect(await (await f.call(admin, person)).json()).toEqual({ ok: true, name: "Synthetic member", revision: 0 });
  expect(await (await f.call(admin, tutor)).json()).toEqual({ ok: true, name: "Synthetic account", revision: 0 });
  expect(await people()).toContainEqual(expect.objectContaining({ id: f.multiMember.id, name: "Synthetic member" }));
  expect(await tutors()).toContainEqual(expect.objectContaining({ id: f.tutorGrant.id, displayName: "Synthetic account" }));
  expect(await booklet()).toBe("Synthetic account");

  expect(await (await f.call({ ...admin, body: { name: "Revised tutor", tutorGrantId: f.tutorGrant.id, expectedRevision: 0 } })).json())
    .toEqual({ ok: true, name: "Revised tutor", revision: 1 });
  expect((await f.call({ ...admin, body: { name: "Unseen older value", membershipId: f.multiMember.id, expectedRevision: 0 } })).status).toBe(409);
  expect(await (await f.call(self)).json()).toEqual({ ok: true, name: "Revised tutor", revision: 1 });
  expect(await (await f.call({ ...self, body: { name: "Revised again", expectedRevision: 1 } })).json()).toEqual({ ok: true, name: "Revised again", revision: 2 });
  expect(await people()).toContainEqual(expect.objectContaining({ id: f.multiMember.id, name: "Revised again" }));
  expect(await tutors()).toContainEqual(expect.objectContaining({ id: f.tutorGrant.id, displayName: "Revised again" }));
  expect(await booklet()).toBe("Revised again");
  const relationships = await (await callPortal(`/api/admin/students/${f.students[0].id}/relationships`)).json();
  expect(relationships.tutors).toContainEqual(expect.objectContaining({ id: f.tutorLink.id, displayName: "Revised again", tutorGrantRevision: f.tutorGrant.revision }));
  expect(relationships.guardians).toContainEqual(expect.objectContaining({ id: f.guardians[0].id, displayName: "Revised again" }));
  const anotherTenant = { who: "multi" as const, origin: "http://localhost:3101", headers: bound(await f.binding("multi", "http://localhost:3101")) };
  expect(await (await f.call(anotherTenant)).json()).toEqual({ ok: true, name: "Synthetic account", revision: 0 });
  expect(await f.owner(() => f.db.select().from(s.student).where(eq(s.student.id, f.students[0].id)))).toEqual([{ ...f.students[0], serviceSlot: "morning" }]);
  expect((await f.owner(() => f.db.select().from(s.tenantMember)))[0].displayName).toBe("Synthetic member");

  expect((await f.call({ ...admin, body: { name: "Searchable learner", membershipId: f.learnerMember.id, expectedRevision: 0 } })).status).toBe(200);
  const found = await withTenantTransaction(f.db, { tenantId: "crc" }, tx => listLearners(tx, "crc", { q: "searchable", after: null, exceptMembershipId: f.adminMember.id, limit: 20 }));
  expect(found).toEqual([{ membershipId: f.learnerMember.id, name: "Searchable learner" }]);
});

it("refuses missing or stale authority, cross-tenant or inactive targets, and unsafe display names", async () => {
  const f = await setup();
  const admin = { who: "admin" as const, headers: bound(await f.binding("admin")) };
  const nonAdmin = { who: "multi" as const, headers: bound(await f.binding("multi")) };
  const name = { name: "Synthetic name", expectedRevision: 0 };
  expect((await f.call({ who: "anonymous" })).status).toBe(401);
  expect((await f.call({ who: "recipient" })).status).toBe(403);
  expect((await f.call({ who: "admin", body: name })).status).toBe(403);
  expect((await f.call({ ...admin, handle: "synthetic" })).status).toBe(403);
  expect((await f.call({ ...admin, headers: { ...admin.headers, origin: "https://elsewhere.example.test" }, body: name })).status).toBe(403);
  expect((await f.call({ ...admin, headers: { ...admin.headers, "sec-fetch-site": "same-site" }, body: name })).status).toBe(403);
  expect((await f.call(nonAdmin, "?membershipId=" + f.learnerMember.id)).status).toBe(403);
  expect((await f.call({ ...nonAdmin, body: { ...name, membershipId: f.learnerMember.id } })).status).toBe(403);
  const other = await f.owner(async () => {
    const [m] = await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other"));
    const [g] = await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.tenantId, "other"));
    return { membershipId: m.id, tutorGrantId: g.id };
  });
  for (const target of [{ membershipId: other.membershipId }, { tutorGrantId: other.tutorGrantId }, { tutorGrantId: f.learnerGrant.id }, { membershipId: randomUUID() }]) {
    expect((await f.call({ ...admin, body: { ...name, ...target } })).status).toBe(404);
  }
  for (const invalid of ["", "  ", "🙈", "A".repeat(81), "a@example.test", "<Fake>", "A\u202eB", "A\u200bB", "\tName", "\ud800"]) {
    expect((await f.call({ ...admin, body: { ...name, name: invalid } })).status).toBe(400);
  }
  for (const invalid of [{ expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: 9999999999 }, { unknown: true },
    { membershipId: "invalid" }, { membershipId: f.multiMember.id, tutorGrantId: f.tutorGrant.id }]) {
    expect((await f.call({ ...admin, body: { ...name, ...invalid } })).status).toBe(400);
  }
  expect((await f.call(admin, `?membershipId=${f.multiMember.id}&membershipId=${f.multiMember.id}`)).status).toBe(400);
  expect((await f.call({ ...admin, body: name }, "?membershipId=" + f.multiMember.id)).status).toBe(400);

  await f.owner(async () => {
    await f.db.update(s.user).set({ name: "synthetic-fallback@example.test" }).where(eq(s.user.id, f.identities.multi.id));
    await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.tutorGrant.id));
    await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.learnerMember.id));
  });
  expect(await (await f.call(admin, "?membershipId=" + f.multiMember.id)).json()).toEqual({ ok: true, name: "", revision: 0 });
  expect((await f.call(admin, "?tutorGrantId=" + f.tutorGrant.id)).status).toBe(404);
  expect((await f.call(admin, "?membershipId=" + f.learnerMember.id)).status).toBe(404);
  await f.owner(() => f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.multi.id)));
  expect((await f.call({ ...admin, body: { ...name, membershipId: f.multiMember.id } })).status).toBe(200);
  expect((await f.call(nonAdmin)).status).toBe(403);
  await f.owner(() => f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.adminGrant.id)));
  expect((await f.call({ ...admin, body: { ...name, membershipId: f.multiMember.id } })).status).toBe(403);
  expect((await f.call({ ...admin, headers: bound(await f.binding("admin")), body: { ...name, membershipId: f.multiMember.id } })).status).toBe(403);
});
