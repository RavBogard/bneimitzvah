import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { prepareOwnerAdmin, applyOwnerAdmin, OwnerAdminError, type OwnerAdminSelection } from "../../scripts/manage-admin.mjs";
import { createStudyService } from "../../src/server/study/service";
import { createPracticeService } from "../../src/server/practice/service";
import { AccessDenied } from "../../src/server/access/errors";
import { postgresAccessFixture, deferred, waitForEntry } from "./access-fixture";
import { disposableConfig, query } from "./disposable.mjs";

const { Client } = createRequire(import.meta.url)("pg");
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: { close: () => Promise<void> }[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function fixture() {
  const base = await postgresAccessFixture();
  let other: InstanceType<typeof Client>;
  const wrapped = { close: async () => { await other?.end().catch(() => {}); await base.close(); } }; fixtures.push(wrapped);
  try {
    // This isolated fixture already has the synthetic owner admin identity.
    // Seed only its exact initial append-only binding, not a bootstrap adoption
    // path. Genuine bootstrap/no-adoption behavior has separate focused tests.
    const [ownerMember] = await base.ownerDb.select().from(s.membership).where(eq(s.membership.userId, base.admin.id));
    const [ownerGrant] = await base.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, ownerMember.id));
    const [binding] = await base.ownerDb.insert(s.auditEvent).values({ tenantId: "crc", actorUserId: base.admin.id,
      actorMembershipId: ownerMember.id, roleGrantId: ownerGrant.id, mode: "admin", action: "grant.issue",
      targetType: "owner-bootstrap", targetId: ownerGrant.id, requestId: randomUUID() }).returning();
    const database = (await query<{ name: string }>(base.owner, "SELECT current_database() AS name")).rows[0].name;
    other = new Client({ ...disposableConfig(), database }); await other.connect();
    const otherPid = (await query<{ pid: number }>(other, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const input: OwnerAdminSelection = { operation: "grant", tenantId: "crc", bootstrapId: binding.id,
      ownerUserId: base.admin.id, targetUserId: base.tutor.id, targetGrantId: null };
    return { ...base, other, otherPid, input, binding, ownerMember, ownerGrant };
  } catch { throw new Error("Disposable owner operator fixture failed; details withheld"); }
}
async function denied(operation: () => Promise<unknown>, code?: string) {
  try { await operation(); return false; } catch (error) { return error instanceof OwnerAdminError && !("cause" in error) && (!code || error.code === code); }
}
async function targetAdmin(f: Base) {
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.tutor.id));
  const grants = await f.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, member.id));
  return { member, grant: grants.find(row => row.role === "admin" && !row.revokedAt)! };
}
async function privileges(f: Base) {
  return (await query(f.owner, "SELECT table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee='portal_runtime' ORDER BY table_name,privilege_type")).rows;
}

test("real owner grants/revokes/regrants exactly; runtime/masked callers deny and privileges/scope stay unchanged", async () => {
  const f = await fixture(), before = await privileges(f), prepared = await prepareOwnerAdmin(f.owner, f.input);
  expect(await denied(() => prepareOwnerAdmin(f.aDb.$client, f.input))).toBe(true);
  await query(f.other, "SET ROLE portal_runtime");
  expect(await denied(() => prepareOwnerAdmin(f.other, f.input))).toBe(true);
  await query(f.other, "RESET ROLE");
  await applyOwnerAdmin(f.owner, prepared.review, prepared.digest);
  const target = await targetAdmin(f), revoke = await prepareOwnerAdmin(f.owner, { ...f.input, operation: "revoke", targetGrantId: target.grant.id });
  await applyOwnerAdmin(f.owner, revoke.review, revoke.digest);
  const regrant = await prepareOwnerAdmin(f.owner, f.input); await applyOwnerAdmin(f.owner, regrant.review, regrant.digest);
  const current = await targetAdmin(f);
  expect(current.grant.id !== target.grant.id).toBe(true);
  expect((await f.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.id, target.grant.id)))[0].revokedAt !== null).toBe(true);
  expect(await privileges(f)).toEqual(before);
  expect((await query(f.owner, "SELECT current_user=session_user AS direct,nullif(current_setting('app.tenant_id',true),'') IS NULL AS cleared")).rows[0]).toEqual({ direct: true, cleared: true });
});

test("competing exact absent-membership grants and exact revokes commit one effect and one audit each", async () => {
  const f = await fixture(), newUser = await f.signIn("new-operator-target");
  const input = { ...f.input, targetUserId: newUser.id };
  const first = await prepareOwnerAdmin(f.owner, input), second = await prepareOwnerAdmin(f.other, input);
  expect(first.review.snapshot.target.membership).toBeNull();
  const results = await Promise.allSettled([applyOwnerAdmin(f.owner, first.review, first.digest), applyOwnerAdmin(f.other, second.review, second.digest)]);
  expect(results.filter(result => result.status === "fulfilled").length).toBe(1);
  expect(results.every(result => result.status === "fulfilled" || result.reason instanceof OwnerAdminError && result.reason.code === "stale")).toBe(true);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, newUser.id));
  const [grant] = await f.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, member.id));
  const revokeInput = { ...input, operation: "revoke" as const, targetGrantId: grant.id };
  const a = await prepareOwnerAdmin(f.owner, revokeInput), b = await prepareOwnerAdmin(f.other, revokeInput);
  const revoked = await Promise.allSettled([applyOwnerAdmin(f.owner, a.review, a.digest), applyOwnerAdmin(f.other, b.review, b.digest)]);
  expect(revoked.filter(result => result.status === "fulfilled").length).toBe(1);
  expect((await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetType, "owner-admin"))).length).toBe(2);
  expect((await f.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId, member.id))).length).toBe(1);
});

test("CAS rejects changed verified identity and immutable/ambiguous owner state without any grant or audit", async () => {
  const f = await fixture(), prepared = await prepareOwnerAdmin(f.owner, f.input);
  await f.ownerDb.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.tutor.id));
  expect(await denied(() => applyOwnerAdmin(f.owner, prepared.review, prepared.digest), "stale")).toBe(true);
  expect(await denied(() => prepareOwnerAdmin(f.owner, { ...f.input, operation: "revoke", targetUserId: f.admin.id, targetGrantId: f.ownerGrant.id }))).toBe(true);
  await f.ownerDb.insert(s.auditEvent).values({ tenantId: "crc", actorUserId: f.admin.id, actorMembershipId: f.ownerMember.id,
    roleGrantId: f.ownerGrant.id, mode: "admin", action: "grant.issue", targetType: "owner-bootstrap", targetId: f.ownerGrant.id, requestId: randomUUID() });
  expect(await denied(() => prepareOwnerAdmin(f.owner, f.input))).toBe(true);
  expect((await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.targetType, "owner-admin"))).length).toBe(0);
  expect((await query(f.owner, "SELECT current_user=session_user AS direct,nullif(current_setting('app.tenant_id',true),'') IS NULL AS cleared")).rows[0]).toEqual({ direct: true, cleared: true });
});

test("actual in-flight admin capability commits before private revoke; subsequent admin/study deny with no role union", async () => {
  const f = await fixture(), prepared = await prepareOwnerAdmin(f.owner, f.input); await applyOwnerAdmin(f.owner, prepared.review, prepared.digest);
  const target = await targetAdmin(f), revoke = await prepareOwnerAdmin(f.other, { ...f.input, operation: "revoke", targetGrantId: target.grant.id });
  const entered = deferred(), release = deferred(); let finished = false;
  const read = f.a.withAdminCapability(f.request("tutor"), { mode: "admin", capability: "read-relationships" }, async () => {
    entered.resolve(); await release.promise; finished = true; return "completed";
  });
  let revocation: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, read);
    revocation = applyOwnerAdmin(f.other, revoke.review, revoke.digest);
    await f.waitForLock(f.otherPid, f.pidA);
    expect(finished).toBe(false); release.resolve(); expect(await read).toBe("completed");
    await revocation;
    let status = 0;
    try { await f.a.withAdminCapability(f.request("tutor"), { mode: "admin", capability: "read-relationships" }, async () => true); }
    catch (error) { status = error instanceof AccessDenied ? error.status : 503; }
    expect(status).toBe(403);
    const load = vi.fn(async () => { throw new Error("Synthetic public reader should not start"); });
    const study = createStudyService({ access: f.a, practice: createPracticeService({ access: f.a }), load });
    try { await study.read(f.request("tutor"), { mode: "admin", studentId: f.student.id, assignmentId: randomUUID(), assignmentRevision: 1, kind: "torah", translation: "jps2023", offset: 0 }); }
    catch (error) { status = error instanceof AccessDenied ? error.status : 503; }
    expect(status).toBe(403); expect(load).not.toHaveBeenCalled();
    expect((await f.a.readStudent(f.request("tutor"), { mode: "tutor", studentId: f.student.id })).id === f.student.id).toBe(true);
  } finally { release.resolve(); await Promise.allSettled([read, ...(revocation ? [revocation] : [])]); }
});
