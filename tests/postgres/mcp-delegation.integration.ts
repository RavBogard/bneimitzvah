import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { postgresAccessFixture } from "./access-fixture";
import { query } from "./disposable.mjs";

type Fixture=Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened:Fixture[]=[];
afterEach(async()=>{for(const f of opened.splice(0))await f.close();});
async function fixture(){const f=await postgresAccessFixture();opened.push(f);return f;}
async function pending(f:Fixture,extra:Partial<typeof s.mcpDelegation.$inferInsert>={}){
  const [member]=await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId,f.admin.id));
  const [grant]=await f.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.membershipId,member.id));
  const now=Date.now();
  return {id:randomUUID(),tenantId:"crc",userId:f.admin.id,sessionId:f.admin.sessionId,membershipId:member.id,roleGrantId:grant.id,role:"admin" as const,
    membershipRevision:1,grantRevision:1,pendingCookieHash:randomBytes(32).toString("hex"),requestFingerprint:randomBytes(32).toString("hex"),scope:"portal:read",
    resource:"https://beitmitzvah.centralreform.org/api/mcp",clientId:"synthetic-client",createdAt:new Date(now-1000),selectionDeadline:new Date(now+60_000),hardDeadline:new Date(now+120_000),...extra};
}
async function tenant<T>(f:Fixture,action:(tx:Parameters<Parameters<Fixture["aDb"]["transaction"]>[0]>[0])=>Promise<T>,id="crc"){
  return f.aDb.transaction(async tx=>{await tx.execute(sql`select set_config('app.tenant_id',${id},true)`);return action(tx);});
}
async function refused(action:()=>PromiseLike<unknown>,codes=["23514","23503","23505","42501"]){
  try{await action();return false;}catch(error){const e=error as {code?:string;cause?:{code?:string}};return codes.includes(e.cause?.code??e.code??"");}
}

// No cluster selection/start here: the existing public disposable CI fixture
// owns fresh databases and real restricted LOGIN pools. No production execution.
test("native runtime is tenant isolated with narrow column grants and exact actor FKs",async()=>{
  const f=await fixture(),row=await pending(f);
  await tenant(f,tx=>tx.insert(s.mcpDelegation).values(row));
  expect((await tenant(f,tx=>tx.select().from(s.mcpDelegation))).length).toBe(1);
  expect((await tenant(f,tx=>tx.select().from(s.mcpDelegation),"other")).length).toBe(0);
  expect((await f.aDb.select().from(s.mcpDelegation)).length).toBe(0);
  await tenant(f,tx=>tx.update(s.mcpDelegation).set({id:row.id}).where(eq(s.mcpDelegation.id,row.id)));
  await tenant(f,tx=>tx.execute(sql`select id from mcp_delegation where id=${row.id} for update`));
  expect(await refused(()=>tenant(f,tx=>tx.delete(s.mcpDelegation)),["42501"])).toBe(true);
  expect(await refused(()=>tenant(f,tx=>tx.update(s.mcpDelegation).set({clientId:"replacement"})),["42501"])).toBe(true);
  expect(await refused(async()=>tenant(f,tx=>tx.insert(s.mcpDelegation).values({...row,id:randomUUID(),pendingCookieHash:randomBytes(32).toString("hex")}),"other"),["42501"])).toBe(true);
  for(const change of [{userId:f.tutor.id},{sessionId:f.tutor.sessionId},{roleGrantId:f.tutorGrant.id},{role:"tutor" as const},{membershipRevision:0}]){
    expect(await refused(async()=>{const bad=await pending(f,change);return tenant(f,tx=>tx.insert(s.mcpDelegation).values(bad));})).toBe(true);
  }
  const flags=await query(f.owner,"SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='mcp_delegation'::regclass");
  expect(flags.rows[0].relrowsecurity===true&&flags.rows[0].relforcerowsecurity===true).toBe(true);
  const privileges=await query(f.owner,"SELECT has_table_privilege('portal_runtime','mcp_delegation','DELETE') AS deletion,has_column_privilege('portal_runtime','mcp_delegation','client_id','UPDATE') AS rewrite");
  expect(privileges.rows[0].deletion===false&&privileges.rows[0].rewrite===false).toBe(true);
});

test("native finite deadlines, UTC origin expiry and pending-only insertion are enforced",async()=>{
  const f=await fixture(),now=Date.now();
  for(const change of [{createdAt:new Date(now+60_000)},{selectionDeadline:new Date(now+600_000),hardDeadline:new Date(now+700_000)},
    {hardDeadline:new Date(now+100*86400_000)},{authorizedAt:new Date(),consentId:"synthetic-consent"},{revokedAt:new Date()},
    {clientId:"synthetic\nclient"},{clientId:" synthetic-client"},{clientId:"synthetic-client "},{scope:"portal:write"},{pendingCookieHash:"raw-synthetic-value"}]){
    expect(await refused(async()=>{const row=await pending(f,change);return tenant(f,tx=>tx.insert(s.mcpDelegation).values(row));},["23514"])).toBe(true);
  }
  // Non-UTC database session must not reinterpret Better Auth's UTC timestamp.
  const row=await pending(f);
  await tenant(f,async tx=>{await tx.execute(sql`set local timezone='Pacific/Honolulu'`);await tx.insert(s.mcpDelegation).values(row);});
  const [origin]=await f.ownerDb.select().from(s.session).where(eq(s.session.id,f.admin.sessionId));
  await f.ownerDb.update(s.session).set({expiresAt:new Date(now-1000)}).where(eq(s.session.id,f.admin.sessionId));
  expect(await refused(async()=>{const bad=await pending(f);return tenant(f,tx=>tx.insert(s.mcpDelegation).values(bad));},["23514"])).toBe(true);
  await f.ownerDb.update(s.session).set({expiresAt:origin.expiresAt}).where(eq(s.session.id,f.admin.sessionId));
  for(const column of ["created_at","selection_deadline","hard_deadline","authorized_at","revoked_at"]){
    expect(await refused(()=>query(f.owner,`UPDATE mcp_delegation SET ${column}='infinity' WHERE id=$1`,[row.id]),["23514"])).toBe(true);
  }
  // Actual restricted LOGIN pool can create a shadow, but the trigger must
  // read public.session even under pg_temp's implicit search-path precedence.
  const shadow=await pending(f),realExpiry=new Date(Date.now()+30_000),fakeExpiry=new Date(Date.now()+86400_000);
  let shadowProved=false;
  expect(await refused(()=>tenant(f,async tx=>{
    await tx.execute(sql`update public.session set expires_at=${realExpiry}::timestamptz at time zone 'UTC' where id=${shadow.sessionId}`);
    await tx.execute(sql`create temporary table session (id text,user_id text,expires_at timestamp) on commit drop`);
    await tx.execute(sql`insert into pg_temp.session values (${shadow.sessionId},${shadow.userId},${fakeExpiry}::timestamptz at time zone 'UTC')`);
    const proof=await tx.execute<{valid:boolean}>(sql`select current_user='portal_runtime'
      and (select expires_at at time zone 'UTC' from session where id=${shadow.sessionId})>${shadow.hardDeadline}::timestamptz
      and (select expires_at at time zone 'UTC' from public.session where id=${shadow.sessionId})<${shadow.hardDeadline}::timestamptz as valid`);
    shadowProved=proof.rows[0].valid;expect(shadowProved).toBe(true);
    await tx.execute(sql`insert into public.mcp_delegation
      (id,tenant_id,user_id,session_id,membership_id,role_grant_id,role,membership_revision,grant_revision,pending_cookie_hash,request_fingerprint,scope,resource,client_id,created_at,selection_deadline,hard_deadline)
      values (${shadow.id},${shadow.tenantId},${shadow.userId},${shadow.sessionId},${shadow.membershipId},${shadow.roleGrantId},${shadow.role},${shadow.membershipRevision},${shadow.grantRevision},${shadow.pendingCookieHash},${shadow.requestFingerprint},${shadow.scope},${shadow.resource},${shadow.clientId},${shadow.createdAt},${shadow.selectionDeadline},${shadow.hardDeadline})`);
  }),["23514"])).toBe(true);
  expect(shadowProved).toBe(true);
  expect((await tenant(f,tx=>tx.select().from(s.mcpDelegation).where(eq(s.mcpDelegation.id,shadow.id)))).length).toBe(0);
  const valid=await pending(f);await tenant(f,tx=>tx.insert(s.mcpDelegation).values(valid));
});

test("native authorization/revocation are one-way exact transitions and immutable fields cannot change",async()=>{
  const f=await fixture(),row=await pending(f);await tenant(f,tx=>tx.insert(s.mcpDelegation).values(row));
  const update=(values:Partial<typeof s.mcpDelegation.$inferInsert>)=>tenant(f,tx=>tx.update(s.mcpDelegation).set(values).where(eq(s.mcpDelegation.id,row.id)));
  const authorizedAt=new Date(),consentId="Synthetic-Consent";
  for(const values of [{authorizedAt},{consentId},{authorizedAt:new Date(Date.now()+60_000),consentId},{authorizedAt,consentId,revokedAt:new Date()},
    {authorizedAt,consentId:"synthetic\nconsent"},{authorizedAt,consentId:" synthetic-consent"},{authorizedAt,consentId:"synthetic-consent "}])expect(await refused(()=>update(values),["23514"])).toBe(true);
  await update({authorizedAt,consentId});await update({authorizedAt,consentId});
  for(const values of [{consentId:"replacement"},{authorizedAt:null,consentId:null}])expect(await refused(()=>update(values),["23514"])).toBe(true);
  const revokedAt=new Date();await update({revokedAt});await update({revokedAt});
  expect(await refused(()=>update({revokedAt:null}),["23514"])).toBe(true);
  expect(await refused(()=>update({revokedAt:new Date(revokedAt.getTime()+1)}),["23514"])).toBe(true);
  expect(await refused(()=>f.ownerDb.update(s.mcpDelegation).set({hardDeadline:new Date(Date.now()+180_000)}).where(eq(s.mcpDelegation.id,row.id)),["23514"])).toBe(true);
  const expired=await pending(f,{createdAt:new Date(Date.now()-120_000),selectionDeadline:new Date(Date.now()-60_000)});
  await tenant(f,tx=>tx.insert(s.mcpDelegation).values(expired));
  expect(await refused(()=>tenant(f,tx=>tx.update(s.mcpDelegation).set({authorizedAt:new Date(),consentId}).where(eq(s.mcpDelegation.id,expired.id))),["23514"])).toBe(true);
  await tenant(f,tx=>tx.update(s.mcpDelegation).set({revokedAt:new Date()}).where(eq(s.mcpDelegation.id,expired.id)));
  expect(await refused(()=>tenant(f,tx=>tx.update(s.mcpDelegation).set({authorizedAt:new Date(),consentId}).where(eq(s.mcpDelegation.id,expired.id))),["23514"])).toBe(true);
});

test("native rollback/session cascade preserve material rows and earlier migration ledger",async()=>{
  const f=await fixture();
  const before=await query(f.owner,"SELECT (SELECT count(*)::int FROM honoree_material_release) AS materials,(SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations");
  const row=await pending(f);let rollback=false;
  try{await tenant(f,async tx=>{await tx.insert(s.mcpDelegation).values(row);throw Error("synthetic-rollback");});}catch(e){rollback=e instanceof Error&&e.message==="synthetic-rollback";}
  expect(rollback&&(await tenant(f,tx=>tx.select().from(s.mcpDelegation))).length===0).toBe(true);
  await tenant(f,tx=>tx.insert(s.mcpDelegation).values(row));
  await f.aDb.delete(s.session).where(eq(s.session.id,f.admin.sessionId));
  expect((await tenant(f,tx=>tx.select().from(s.mcpDelegation))).length).toBe(0);
  const after=await query(f.owner,"SELECT (SELECT count(*)::int FROM honoree_material_release) AS materials,(SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations");
  expect(before.rows[0].materials===after.rows[0].materials&&before.rows[0].migrations===after.rows[0].migrations).toBe(true);
});
