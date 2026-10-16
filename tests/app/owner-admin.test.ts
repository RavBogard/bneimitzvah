import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { authFixture } from "./auth-stack-helper";
import { bootstrapOwner } from "../../scripts/bootstrap-owner.mjs";
import { applyOwnerAdmin, prepareOwnerAdmin, ownerAdminDigest, OwnerAdminError, type OwnerAdminSelection } from "../../scripts/manage-admin.mjs";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof authFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await authFixture(); fixtures.push(f);
  await f.signIn("owner-operator@example.test");
  await bootstrapOwner(f.client, { email: "owner-operator@example.test", confirm: true });
  await f.signIn("target-operator@example.test");
  const db = drizzle(f.client, { schema: s });
  const users = await db.select().from(s.user);
  const owner = users.find(row => row.email === "owner-operator@example.test")!, target = users.find(row => row.email === "target-operator@example.test")!;
  const [binding] = await db.select().from(s.auditEvent);
  const input: OwnerAdminSelection = { operation: "grant", tenantId: "crc", bootstrapId: binding.id, ownerUserId: owner.id, targetUserId: target.id, targetGrantId: null };
  return { ...f, db, owner, target, binding, input };
}
async function denied(action: () => unknown | Promise<unknown>, code?: string) {
  try { await action(); return false; } catch (error) { return error instanceof OwnerAdminError && error.message === "Owner admin operation failed" && !("cause" in error) && (!code || error.code === code); }
}

test("explicit absent membership grant, exact revoke and reviewed fresh-row regrant preserve immutable history", async () => {
  const f = await fixture(), prepared = await prepareOwnerAdmin(f.client, f.input);
  expect(prepared.review.snapshot.target.membership).toBeNull();
  expect(await applyOwnerAdmin(f.client, prepared.review, prepared.digest)).toEqual({ status: "granted" });
  expect(await denied(() => applyOwnerAdmin(f.client, prepared.review, prepared.digest), "stale")).toBe(true);
  const targetMember = (await f.db.select().from(s.membership).where(eq(s.membership.userId, f.target.id)))[0];
  const targetGrant = (await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, targetMember.id)))[0];
  const revoke = await prepareOwnerAdmin(f.client, { ...f.input, operation: "revoke", targetGrantId: targetGrant.id });
  expect(await applyOwnerAdmin(f.client, revoke.review, revoke.digest)).toEqual({ status: "revoked" });
  expect(await denied(() => applyOwnerAdmin(f.client, revoke.review, revoke.digest), "stale")).toBe(true);
  const regrant = await prepareOwnerAdmin(f.client, f.input);
  expect(regrant.review.snapshot.target.grants.length).toBe(1);
  expect(regrant.review.snapshot.target.grants[0].revokedAt !== null).toBe(true);
  await applyOwnerAdmin(f.client, regrant.review, regrant.digest);
  const rows = await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, targetMember.id));
  expect(rows.length === 2 && rows.some(row => row.id === targetGrant.id && row.revokedAt !== null && row.revision === 2)
    && rows.some(row => row.id !== targetGrant.id && row.revokedAt === null && row.revision === 1)).toBe(true);
  expect((await f.db.select().from(s.auditEvent)).length).toBe(4);
  const state = (await f.client.query<{ role: string; tenant: string | null }>("SELECT current_user AS role,nullif(current_setting('app.tenant_id',true),'') AS tenant")).rows[0];
  expect(state.role === "postgres" && state.tenant === null).toBe(true);
});

test("exact target membership absence, verification and authority revision are CAS-bound", async () => {
  const f = await fixture(), absent = await prepareOwnerAdmin(f.client, f.input);
  const [membership] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.target.id }).returning();
  expect(await denied(() => applyOwnerAdmin(f.client, absent.review, absent.digest), "stale")).toBe(true);
  const enabled = await prepareOwnerAdmin(f.client, f.input);
  await f.db.update(s.membership).set({ authorityRevision: 2 }).where(eq(s.membership.id, membership.id));
  expect(await denied(() => applyOwnerAdmin(f.client, enabled.review, enabled.digest), "stale")).toBe(true);
  const verified = await prepareOwnerAdmin(f.client, f.input);
  await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.target.id));
  expect(await denied(() => applyOwnerAdmin(f.client, verified.review, verified.digest), "stale")).toBe(true);
  expect(await denied(() => prepareOwnerAdmin(f.client, f.input))).toBe(true);
  await f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, f.target.id));
  await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, membership.id));
  expect(await denied(() => prepareOwnerAdmin(f.client, f.input))).toBe(true);
  expect((await f.db.select().from(s.roleGrant)).length).toBe(1);
});

test("revoked history mutations invalidate deliberate regrant rather than restoring any row", async () => {
  const f = await fixture(), [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.target.id }).returning();
  const [old] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "admin", revision: 2, revokedAt: new Date() }).returning();
  const prepared = await prepareOwnerAdmin(f.client, f.input);
  await f.db.update(s.roleGrant).set({ revision: 3 }).where(eq(s.roleGrant.id, old.id));
  expect(await denied(() => applyOwnerAdmin(f.client, prepared.review, prepared.digest), "stale")).toBe(true);
  expect((await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, member.id)))[0].revokedAt !== null).toBe(true);
});

test("owner grant is permanently protected, alternate/missing/duplicate binding denies, and owner loss is no recovery path", async () => {
  const f = await fixture();
  expect(await denied(() => prepareOwnerAdmin(f.client, { ...f.input, operation: "revoke", targetUserId: f.owner.id, targetGrantId: f.binding.roleGrantId }))).toBe(true);
  expect(await denied(() => prepareOwnerAdmin(f.client, { ...f.input, bootstrapId: randomUUID() }))).toBe(true);
  expect(await denied(() => prepareOwnerAdmin(f.client, { ...f.input, ownerUserId: f.target.id, targetUserId: f.owner.id }))).toBe(true);
  await f.db.insert(s.auditEvent).values({ tenantId: "crc", actorUserId: f.binding.actorUserId, actorMembershipId: f.binding.actorMembershipId,
    roleGrantId: f.binding.roleGrantId, mode: "admin", action: "grant.issue", targetType: "owner-bootstrap", targetId: f.binding.targetId, requestId: randomUUID() });
  expect(await denied(() => prepareOwnerAdmin(f.client, f.input))).toBe(true);
  expect((await f.db.select().from(s.roleGrant)).length).toBe(1);
});

test("admin audit failure rolls back grant and membership and restores the direct role", async () => {
  const f = await fixture(), prepared = await prepareOwnerAdmin(f.client, f.input);
  const client = { query: async (text: string, values?: unknown[]) => {
    if (text.includes("INSERT INTO audit_event")) throw Object.assign(new Error("synthetic private diagnostics"), { cause: "synthetic cause" });
    return f.client.query<Record<string, unknown>>(text, values);
  } };
  expect(await denied(() => applyOwnerAdmin(client, prepared.review, prepared.digest))).toBe(true);
  expect((await f.db.select().from(s.membership)).length).toBe(1);
  expect((await f.db.select().from(s.roleGrant)).length).toBe(1);
  expect((await f.db.select().from(s.auditEvent)).length).toBe(1);
  expect((await f.client.query<{ role: string }>("SELECT current_user AS role")).rows[0].role).toBe("postgres");
});

test("bounded exact descriptors, digest and ten-minute time window reject unknown values before authority queries", async () => {
  const f = await fixture(), prepared = await prepareOwnerAdmin(f.client, f.input, { now: () => 1_700_000_000_000 });
  for (const mutate of [
    (review: any) => { review.extra = true; }, (review: any) => { review.snapshot.target.user.email = "forbidden"; },
    (review: any) => { review.snapshot.owner.grant.createdAt = "2026-02-31T00:00:00.000000Z"; },
    (review: any) => { review.expiresAt += 1; }, (review: any) => { review.snapshot.target.grants = Array(65).fill(review.snapshot.owner.grant); },
  ]) { const review = structuredClone(prepared.review); mutate(review); expect(await denied(() => ownerAdminDigest(review), "invalid")).toBe(true); }
  expect(await denied(() => applyOwnerAdmin(f.client, prepared.review, "0".repeat(64)), "invalid")).toBe(true);
  expect(await denied(() => applyOwnerAdmin(f.client, prepared.review, prepared.digest, { now: () => prepared.review.expiresAt }), "stale")).toBe(true);
  expect(await denied(() => applyOwnerAdmin(f.client, prepared.review, prepared.digest, { now: () => prepared.review.preparedAt - 1 }), "stale")).toBe(true);
  const hostile = Object.defineProperty(new OwnerAdminError(), "code", { get() { throw new Error("synthetic private accessor"); } });
  expect(await denied(() => prepareOwnerAdmin({ query: async () => { throw hostile; } }, f.input))).toBe(true);
});

test("ordinary and masked runtime callers cannot acquire the private operator capability", async () => {
  const f = await fixture();
  await f.client.exec("SET ROLE portal_runtime");
  expect(await denied(() => prepareOwnerAdmin(f.client, f.input))).toBe(true);
  await f.client.exec("RESET ROLE; CREATE ROLE owner_operator_runtime LOGIN; GRANT portal_runtime TO owner_operator_runtime; SET SESSION AUTHORIZATION owner_operator_runtime");
  expect(await denied(() => prepareOwnerAdmin(f.client, f.input))).toBe(true);
});
