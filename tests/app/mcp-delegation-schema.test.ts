import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";

let f: Awaited<ReturnType<typeof accessFixture>>;
beforeAll(async () => { f = await accessFixture(); }, 60_000);
afterAll(async () => { await f?.client.close(); });
const hash = () => randomBytes(32).toString("hex");
function pending(extra: Partial<typeof s.mcpDelegation.$inferInsert> = {}) {
  const now = Date.now();
  return { id: randomUUID(), tenantId: "crc", userId: f.identities.admin.id, sessionId: f.identities.admin.sessionId,
    membershipId: f.adminMember.id, roleGrantId: f.adminGrant.id, role: "admin" as const, membershipRevision: 1, grantRevision: 1,
    pendingCookieHash: hash(), requestFingerprint: hash(), scope: "portal:read", resource: "https://beitmitzvah.centralreform.org/api/mcp",
    clientId: "synthetic-client", createdAt: new Date(now - 1000), selectionDeadline: new Date(now + 60_000), hardDeadline: new Date(now + 120_000), ...extra };
}
async function tenant<T>(action: (tx: Parameters<Parameters<typeof f.db.transaction>[0]>[0]) => Promise<T>, tenantId = "crc") {
  return f.db.transaction(async tx => { await tx.execute(sql`select set_config('app.tenant_id',${tenantId},true)`); return action(tx); });
}
async function refused(action: () => PromiseLike<unknown>, codes = ["23514", "23503", "23505", "42501"]) {
  try { await action(); return false; } catch (error) { const e = error as { code?: string; cause?: { code?: string } }; return codes.includes(e.cause?.code ?? e.code ?? ""); }
}
async function insert(extra: Partial<typeof s.mcpDelegation.$inferInsert> = {}) { const row = pending(extra); await tenant(tx => tx.insert(s.mcpDelegation).values(row)); return row; }
async function update(id: string, values: Partial<typeof s.mcpDelegation.$inferInsert>) { return tenant(tx => tx.update(s.mcpDelegation).set(values).where(eq(s.mcpDelegation.id, id))); }

test("pending staff evidence is tenant isolated and grants only narrow transition/lock permissions", async () => {
  const row = await insert();
  expect((await tenant(tx => tx.select().from(s.mcpDelegation).where(eq(s.mcpDelegation.id,row.id)))).length).toBe(1);
  expect((await tenant(tx => tx.select().from(s.mcpDelegation), "other")).length).toBe(0);
  expect((await f.db.select().from(s.mcpDelegation)).length).toBe(0);
  expect(await refused(() => tenant(tx => tx.insert(s.mcpDelegation).values(pending()), "other"), ["42501"])).toBe(true);
  await update(row.id,{ id: row.id });
  await tenant(tx => tx.execute(sql`select id from mcp_delegation where id=${row.id} for update`));
  expect(await refused(() => tenant(tx => tx.delete(s.mcpDelegation).where(eq(s.mcpDelegation.id,row.id))), ["42501"])).toBe(true);
  expect(await refused(() => update(row.id,{ clientId: "replacement" }), ["42501"])).toBe(true);
  const flags = await f.owner(() => f.client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relrowsecurity,relforcerowsecurity from pg_class where oid='mcp_delegation'::regclass"));
  expect(flags.rows[0].relrowsecurity && flags.rows[0].relforcerowsecurity).toBe(true);
});

test("composite keys reject mismatched user/session/member/grant/role and nonstaff selections", async () => {
  for (const extra of [
    { userId: f.identities.multi.id }, { sessionId: f.identities.multi.sessionId }, { membershipId: f.multiMember.id },
    { roleGrantId: f.tutorGrant.id }, { role: "tutor" as const },
    { userId: f.identities.multi.id, sessionId: f.identities.multi.sessionId, membershipId: f.multiMember.id, roleGrantId: f.parentGrant.id, role: "parent" as const },
    { tenantId: "other" }, { membershipRevision: 0 }, { grantRevision: -1 },
  ]) expect(await refused(() => insert(extra))).toBe(true);
  const tutor = await insert({ userId: f.identities.multi.id, sessionId: f.identities.multi.sessionId, membershipId: f.multiMember.id, roleGrantId: f.tutorGrant.id, role: "tutor", membershipRevision: 7, grantRevision: 9 });
  expect(tutor.role).toBe("tutor"); // Snapshots are positive evidence, not live authority checks.
});

test("hashes and fixed policy cannot admit raw secrets, alternate resource, control IDs or duplicate capability hashes", async () => {
  for (const extra of [{ pendingCookieHash: "synthetic-not-a-hash" }, { requestFingerprint: "A".repeat(64) }, { scope: "portal:write" },
    { resource: "https://example.test/api/mcp" }, { clientId: " " }, { clientId: " synthetic-client" }, { clientId: "synthetic-client " }, { clientId: "synthetic\nclient" }, { clientId: "x".repeat(256) }, { clientId: "é".repeat(128) }]) {
    expect(await refused(() => insert(extra), ["23514"])).toBe(true);
  }
  const row = await insert(); expect(await refused(() => insert({ pendingCookieHash: row.pendingCookieHash }), ["23505"])).toBe(true);
  // Restarting the same request requires a fresh secret/reference, not a new fingerprint.
  await insert({ requestFingerprint: row.requestFingerprint });
});

test("creation, ten minute selection and originating session expiry bound all inserted deadlines", async () => {
  const now = Date.now();
  for (const extra of [{ createdAt: new Date(now+60_000) }, { selectionDeadline: new Date(now-2000) },
    { selectionDeadline: new Date(now+600_000), hardDeadline: new Date(now+700_000) }, { hardDeadline: new Date(now+1000) },
    { hardDeadline: new Date(now+100*86400_000) }, { authorizedAt: new Date(), consentId: "synthetic-consent" }, { revokedAt: new Date() }]) {
    expect(await refused(() => insert(extra), ["23514"])).toBe(true);
  }
  const id = randomUUID();
  await f.owner(() => f.db.insert(s.session).values({ id, token: randomUUID(), userId: f.identities.admin.id, expiresAt: new Date(now-1000), updatedAt: new Date() }));
  expect(await refused(() => insert({ sessionId: id }), ["23514"])).toBe(true);
  for (const column of ["created_at","selection_deadline","hard_deadline"]) {
    const key = {created_at:"createdAt",selection_deadline:"selectionDeadline",hard_deadline:"hardDeadline"}[column]!;
    expect(await refused(() => tenant(tx => tx.insert(s.mcpDelegation).values({...pending(),[key]:sql`'infinity'::timestamptz`})), ["23514"])).toBe(true);
  }
});

test("restricted TEMP session shadow cannot extend the real public session expiry", async () => {
  const row=pending(),realExpiry=new Date(Date.now()+30_000),fakeExpiry=new Date(Date.now()+86400_000);
  let shadowProved=false;
  expect(await refused(()=>tenant(async tx=>{
    await tx.execute(sql`update public.session set expires_at=${realExpiry}::timestamptz at time zone 'UTC' where id=${row.sessionId}`);
    await tx.execute(sql`create temporary table session (id text,user_id text,expires_at timestamp) on commit drop`);
    await tx.execute(sql`insert into pg_temp.session values (${row.sessionId},${row.userId},${fakeExpiry}::timestamptz at time zone 'UTC')`);
    const proof=await tx.execute<{valid:boolean}>(sql`select current_user='portal_runtime'
      and (select expires_at at time zone 'UTC' from session where id=${row.sessionId})>${row.hardDeadline}::timestamptz
      and (select expires_at at time zone 'UTC' from public.session where id=${row.sessionId})<${row.hardDeadline}::timestamptz as valid`);
    shadowProved=proof.rows[0].valid; expect(shadowProved).toBe(true);
    // Direct SQL under the unchanged restricted role, with valid public FKs.
    await tx.execute(sql`insert into public.mcp_delegation
      (id,tenant_id,user_id,session_id,membership_id,role_grant_id,role,membership_revision,grant_revision,pending_cookie_hash,request_fingerprint,scope,resource,client_id,created_at,selection_deadline,hard_deadline)
      values (${row.id},${row.tenantId},${row.userId},${row.sessionId},${row.membershipId},${row.roleGrantId},${row.role},${row.membershipRevision},${row.grantRevision},${row.pendingCookieHash},${row.requestFingerprint},${row.scope},${row.resource},${row.clientId},${row.createdAt},${row.selectionDeadline},${row.hardDeadline})`);
  }),["23514"])).toBe(true);
  expect(shadowProved).toBe(true);
  expect((await tenant(tx=>tx.select().from(s.mcpDelegation).where(eq(s.mcpDelegation.id,row.id)))).length).toBe(0);
  // The failed transaction drops its temporary table and restores public expiry.
  await insert();
});

test("authorization is a one-time exact pair, with clock bounds and no simultaneous revocation", async () => {
  const row = await insert(), authorizedAt = new Date(), consentId = "Synthetic-Exact-Consent";
  for (const values of [{ authorizedAt }, { consentId }, { authorizedAt: new Date(Date.now()+60_000), consentId },
    { authorizedAt: new Date(row.createdAt.getTime()-1), consentId }, { authorizedAt, consentId: "\t" },
    { authorizedAt, consentId: " synthetic-consent" }, { authorizedAt, consentId: "synthetic-consent " },
    { authorizedAt, consentId: "x".repeat(256) }, { authorizedAt, consentId, revokedAt: new Date() }]) {
    expect(await refused(() => update(row.id,values), ["23514"])).toBe(true);
  }
  await update(row.id,{ authorizedAt,consentId }); await update(row.id,{ authorizedAt,consentId });
  for (const values of [{ consentId: "replacement" }, { authorizedAt: null, consentId: null }, { authorizedAt: new Date(authorizedAt.getTime()+1) }]) {
    expect(await refused(() => update(row.id,values), ["23514"])).toBe(true);
  }
  const expired = await insert({ createdAt: new Date(Date.now()-120_000), selectionDeadline: new Date(Date.now()-60_000) });
  expect(await refused(() => update(expired.id,{ authorizedAt: new Date(), consentId }), ["23514"])).toBe(true);
});

test("an identical authorization pair remains a no-op after the selection deadline without renewal", async () => {
  const deadline = new Date(Date.now()+1000), row=await insert({selectionDeadline:deadline});
  const authorizedAt=new Date(),consentId="synthetic-fixed-consent";
  await update(row.id,{authorizedAt,consentId});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline.getTime()-Date.now())+50));
  const clock=await tenant(tx=>tx.execute<{expired:boolean}>(sql`select clock_timestamp()>=${deadline}::timestamptz as expired`));
  expect(clock.rows[0].expired).toBe(true);
  await update(row.id,{authorizedAt,consentId});
  const [saved]=await tenant(tx=>tx.select().from(s.mcpDelegation).where(eq(s.mcpDelegation.id,row.id)));
  expect(saved.selectionDeadline.getTime()===deadline.getTime()&&saved.authorizedAt?.getTime()===authorizedAt.getTime()).toBe(true);
});

test("revocation is finite, one-way, available on pending rows and prevents later authorization", async () => {
  for (const authorized of [false,true]) {
    const row = await insert();
    if (authorized) await update(row.id,{ authorizedAt: new Date(), consentId: "synthetic-consent" });
    for (const revokedAt of [new Date(row.createdAt.getTime()-1),new Date(Date.now()+60_000)]) expect(await refused(() => update(row.id,{revokedAt}),["23514"])).toBe(true);
    const revokedAt = new Date(); await update(row.id,{revokedAt}); await update(row.id,{revokedAt});
    expect(await refused(() => update(row.id,{revokedAt:null}),["23514"])).toBe(true);
    expect(await refused(() => update(row.id,{revokedAt:new Date(revokedAt.getTime()+1)}),["23514"])).toBe(true);
    if(!authorized) expect(await refused(() => update(row.id,{authorizedAt:new Date(),consentId:"synthetic-consent"}),["23514"])).toBe(true);
  }
});

test("even owner updates cannot rewrite any immutable authority/policy/deadline field", async () => {
  const row = await insert();
  const changes: Record<string,unknown> = { id:randomUUID(),tenantId:"other",userId:f.identities.multi.id,sessionId:f.identities.multi.sessionId,
    membershipId:f.multiMember.id,roleGrantId:f.tutorGrant.id,role:"tutor",membershipRevision:2,grantRevision:2,pendingCookieHash:hash(),requestFingerprint:hash(),
    scope:"portal:write",resource:"https://example.test",clientId:"other",createdAt:new Date(row.createdAt.getTime()-1),selectionDeadline:new Date(Date.now()+50_000),hardDeadline:new Date(Date.now()+70_000) };
  for(const [key,value] of Object.entries(changes)) expect(await refused(() => f.owner(() => f.db.update(s.mcpDelegation).set({[key]:value}).where(eq(s.mcpDelegation.id,row.id))),["23514"])).toBe(true);
});

test("session deletion cascades and a failed transaction leaves no pending evidence", async () => {
  const id=randomUUID();
  await f.owner(() => f.db.insert(s.session).values({id,token:randomUUID(),userId:f.identities.admin.id,expiresAt:new Date(Date.now()+180_000),updatedAt:new Date()}));
  const row=await insert({sessionId:id}); await f.owner(() => f.db.delete(s.session).where(eq(s.session.id,id)));
  expect((await tenant(tx=>tx.select().from(s.mcpDelegation).where(eq(s.mcpDelegation.id,row.id)))).length).toBe(0);
  const rolledBack=pending(); let expected=false;
  try { await tenant(async tx=>{await tx.insert(s.mcpDelegation).values(rolledBack);throw Error("synthetic-rollback");}); } catch(e) {expected=e instanceof Error && e.message==="synthetic-rollback";}
  expect(expected && (await tenant(tx=>tx.select().from(s.mcpDelegation).where(eq(s.mcpDelegation.id,rolledBack.id)))).length===0).toBe(true);
});
