import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq, sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { liveProfile, ensure, closed, RESOURCE } from "./mcp-live-authority-helper";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";
type Fixture=Awaited<ReturnType<typeof accessFixture>>;
const opened:Fixture[]=[];
beforeEach(()=>{vi.spyOn(console,"error").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});vi.stubGlobal("fetch",async()=>{throw Error("Synthetic authority forbids network");});});
afterEach(async()=>{try{vi.restoreAllMocks();for(const f of opened.splice(0))await f.client.close();}finally{vi.unstubAllGlobals();}});
async function fixture(options:Parameters<typeof liveProfile>[2]={}){const f=await accessFixture();opened.push(f);const p=await liveProfile(f.db,fn=>f.owner(()=>fn(f.db)),options);return {f,p};}
export async function refusal(operation:()=>Promise<unknown>,status:number){try{await operation();return false;}catch(error){return (error instanceof AccessDenied||error instanceof AccessUnavailable)&&error.status===status;}}

test("restricted link lock carrier permits FOR SHARE and real SDK CRUD without mutable identity or other UPDATE grants",()=>closed(async()=>{
  const {p}=await fixture();await p.verifyLinkPermissions();
}));

for(const role of ["admin","tutor"] as const)test(`real factory Google hook + consent/PKCE/opaque proof authorizes live ${role} in same restricted tenant transaction`,()=>closed(async()=>{
  const {f,p}=await fixture({role});
  const result=await p.service.withActor(p.actorRequest,p.evidence,async(tx,actor)=>{
    ensure(Object.isFrozen(actor)&&actor.mode===role&&actor.userId===p.identity.user.id&&actor.roleGrantId===p.selected.grant.id&&actor.authSessionId===p.identity.session.id);
    ensure(actor.authorizationExpiresAt<actor.authSessionExpiresAt&&actor.authorizationExpiresAt<=p.evidence.expiresAt&&actor.authorizationExpiresAt<=p.token.expiresAt.getTime());
    const limits=await tx.execute<{lock:string;statement:string}>(sql`select current_setting('lock_timeout') as lock,current_setting('statement_timeout') as statement`);
    ensure(limits.rows[0].lock==="2s"&&limits.rows[0].statement==="5s");
    const students=await tx.select({tenant:s.student.tenantId}).from(s.student);ensure(students.length===3&&students.every(v=>v.tenant==="crc"));
    return Object.freeze({count:students.length});
  });ensure(result.count===3);
  const [stored]=await f.db.select().from(s.session).where(eq(s.session.id,p.identity.session.id));ensure(stored.googleAuthenticatedAt!==null);
  ensure((await p.request("/portal/mcp/verify-token",{token:"synthetic-invalid"})).status===404);
}));

test("unmarked magic session, forged/cloned evidence, host and practice context cannot reach action",()=>closed(async()=>{
  const {p}=await fixture({magic:true});let entered=false;
  const action=async()=>{entered=true;};
  ensure(await refusal(()=>p.service.withActor(p.actorRequest,p.evidence,action),401));
  ensure(await refusal(()=>p.service.withActor(p.actorRequest,{...p.evidence},action),401));
  ensure(await refusal(()=>p.service.withActor(p.actorRequest,structuredClone(p.evidence),action),401));
  ensure(await refusal(()=>p.service.withActor({...p.actorRequest,url:"https://unknown.example.test/api/mcp"},p.evidence,action),404));
  ensure(await refusal(()=>p.service.withActor({...p.actorRequest,headers:new Headers({"x-practice-context":"synthetic"})},p.evidence,action),403));
  ensure(await refusal(()=>p.service.withActor({...p.actorRequest,headers:new Headers({dpop:"synthetic"})},p.evidence,action),403));
  ensure(!entered);
}));

test("live tenant/user/membership/grant revisions and selected actor bindings all deny on drift",()=>closed(async()=>{
  const {f,p}=await fixture();const run=()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true);
  async function changeAndRestore(change:()=>Promise<unknown>,restore:()=>Promise<unknown>){ensure(await run());await f.owner(change);try{ensure(await refusal(run,403));}finally{await f.owner(restore);}ensure(await run());}
  await changeAndRestore(()=>f.db.update(s.tenant).set({enabled:false}).where(eq(s.tenant.id,"crc")),()=>f.db.update(s.tenant).set({enabled:true}).where(eq(s.tenant.id,"crc")));
  await changeAndRestore(()=>f.db.update(s.user).set({emailVerified:false}).where(eq(s.user.id,p.identity.user.id)),()=>f.db.update(s.user).set({emailVerified:true}).where(eq(s.user.id,p.identity.user.id)));
  await changeAndRestore(()=>f.db.update(s.membership).set({authorityRevision:2}).where(eq(s.membership.id,p.selected.member.id)),()=>f.db.update(s.membership).set({authorityRevision:1}).where(eq(s.membership.id,p.selected.member.id)));
  await changeAndRestore(()=>f.db.update(s.membership).set({disabledAt:new Date()}).where(eq(s.membership.id,p.selected.member.id)),()=>f.db.update(s.membership).set({disabledAt:null}).where(eq(s.membership.id,p.selected.member.id)));
  await changeAndRestore(()=>f.db.update(s.roleGrant).set({revision:2}).where(eq(s.roleGrant.id,p.selected.grant.id)),()=>f.db.update(s.roleGrant).set({revision:1}).where(eq(s.roleGrant.id,p.selected.grant.id)));
  // Exact host directory chooses other tenant, never caller-selected crc.
  await f.owner(()=>f.db.update(s.tenantHost).set({tenantId:"other"}).where(eq(s.tenantHost.host,new URL(RESOURCE).host)));
  ensure(await refusal(run,403));
  await f.owner(()=>f.db.update(s.tenantHost).set({tenantId:"crc"}).where(eq(s.tenantHost.host,new URL(RESOURCE).host)));
  ensure(await run());await f.owner(async()=>{
    await f.db.insert(s.roleGrant).values(["parent","student"].map(role=>({tenantId:"crc",membershipId:p.selected.member.id,role:role as "parent"|"student"})));
    await f.db.update(s.roleGrant).set({revokedAt:new Date()}).where(eq(s.roleGrant.id,p.selected.grant.id));
  });ensure(await refusal(run,403)); // Active parent/student grants cannot replace the exact staff selection.
}));

test("closed client/resource/link policy refuses semantic drift without normalizing rows",()=>closed(async()=>{
  const {f,p}=await fixture();const run=()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true);
  const [client]=await f.db.select().from(s.oauthClient).where(eq(s.oauthClient.clientId,p.clientId));
  for(const change of [{name:"Synthetic changed"},{skipConsent:true},{disabled:true},{requirePKCE:false},{dpopBoundAccessTokens:true},{clientSecret:"synthetic"},{userId:p.identity.user.id},
    {redirectUris:["https://callback.example.test/"]},{grantTypes:["authorization_code","refresh_token"]},{metadata:false},{contacts:[]},{enableEndSession:false},{softwareVersion:"synthetic"}]){
    await f.db.update(s.oauthClient).set(change).where(eq(s.oauthClient.id,client.id));ensure(await refusal(run,403));await f.db.update(s.oauthClient).set(client).where(eq(s.oauthClient.id,client.id));
  }
  const [resource]=await f.db.select().from(s.oauthResource).where(eq(s.oauthResource.identifier,RESOURCE));
  for(const change of [{policyVersion:2},{accessTokenTtl:null},{allowedScopes:null},{disabled:true},{dpopBoundAccessTokensRequired:true},{metadata:{}},{refreshTokenTtl:900}]){
    await f.db.update(s.oauthResource).set(change).where(eq(s.oauthResource.id,resource.id));ensure(await refusal(run,403));await f.db.update(s.oauthResource).set(resource).where(eq(s.oauthResource.id,resource.id));
  }
  await f.owner(()=>f.db.execute(sql`update public.oauth_client_resource set metadata='null'::jsonb where client_id=${p.clientId}`));ensure(await refusal(run,403));
}));

test("consent deletion leaves provider token active but replacement cannot rebind pinned consent",()=>closed(async()=>{
  const {f,p}=await fixture();const run=()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true);
  await f.db.update(s.oauthConsent).set({scopes:[]}).where(eq(s.oauthConsent.id,p.consent.id));ensure(await refusal(run,403));
  await f.db.update(s.oauthConsent).set(p.consent).where(eq(s.oauthConsent.id,p.consent.id));
  await f.db.delete(s.oauthConsent).where(eq(s.oauthConsent.id,p.consent.id));
  ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,p.token.id))).length===1);
  ensure(await refusal(run,403));await f.db.insert(s.oauthConsent).values({...p.consent,id:randomUUID()});ensure(await refusal(run,403));
}));

test("all nonnull confirmation forms and structural refresh-linked access deny despite sealed provider evidence",()=>closed(async()=>{
  const {f,p}=await fixture();const run=()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true);
  for(const literal of ["null","false","0",'""',"{}"]){await f.db.execute(sql`update public.oauth_access_token set confirmation=${literal}::jsonb where id=${p.token.id}`);ensure(await refusal(run,403));}
  await f.db.update(s.oauthAccessToken).set({confirmation:null}).where(eq(s.oauthAccessToken.id,p.token.id));
  const refreshId=randomUUID();
  // Structural negative only: actual code-only issuance above has no refresh.
  await f.db.insert(s.oauthRefreshToken).values({id:refreshId,token:randomUUID(),clientId:p.clientId,userId:p.identity.user.id,sessionId:p.identity.session.id,expiresAt:new Date(Date.now()+300000),createdAt:new Date(),scopes:["portal:read"]});
  await f.db.update(s.oauthAccessToken).set({refreshId}).where(eq(s.oauthAccessToken.id,p.token.id));ensure(await refusal(run,403));
}));

test("access row checks exact bindings, code marker, scope/resource and finite maximum lifetime",()=>closed(async()=>{
  const {f,p}=await fixture();const run=()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true);
  for(const change of [{sessionId:null},{userId:null},{referenceId:randomUUID()},{authorizationCodeId:null},{authorizationCodeId:" "},{scopes:[]},{resources:[]},{requestedUserInfoClaims:[]},{revoked:new Date()},
    {createdAt:new Date(Date.now()+10000)},{expiresAt:new Date(p.token.createdAt.getTime()+901000)}]){
    await f.db.update(s.oauthAccessToken).set(change).where(eq(s.oauthAccessToken.id,p.token.id));ensure(await refusal(run,403));await f.db.update(s.oauthAccessToken).set(p.token).where(eq(s.oauthAccessToken.id,p.token.id));
  }
  await f.db.execute(sql`update public.oauth_access_token set expires_at='infinity'::timestamp where id=${p.token.id}`);ensure(await refusal(run,403));
}));

test("explicit UTC timestamps survive connection TimeZone and selection expiry does not renew or end authorized access",()=>closed(async()=>{
  const {f,p}=await fixture();await f.client.exec("SET TIME ZONE 'Pacific/Honolulu'");
  const now=Date.now();vi.spyOn(Date,"now").mockReturnValue(now+61_000);
  ensure(await p.service.withActor(p.actorRequest,p.evidence,async()=>true));
  vi.mocked(Date.now).mockReturnValue(now+301000);
  ensure(await refusal(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true),401));
  vi.mocked(Date.now).mockReturnValue(now);
  ensure(await p.service.withActor(p.actorRequest,p.evidence,async()=>true));
}));

test("action-await expiry, abort, unexpected failure and post-COMMIT expiry discard private results",()=>closed(async()=>{
  const {f,p}=await fixture();const now=Date.now();let entered=false;
  const clock=vi.spyOn(Date,"now").mockReturnValue(now);
  ensure(await refusal(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>{entered=true;await Promise.resolve();clock.mockReturnValue(now+901000);return "synthetic-private";}),401));ensure(entered);
  clock.mockReturnValue(now);const abort=new AbortController();
  ensure(await refusal(()=>p.service.withActor({...p.actorRequest,signal:abort.signal},p.evidence,async()=>{abort.abort();return true;}),503));
  ensure(await refusal(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>{throw Error("synthetic-action");}),503));
  const original=f.db.transaction.bind(f.db);
  vi.spyOn(f.db,"transaction").mockImplementation(async(action,config)=>{const value=await original(action,config);clock.mockReturnValue(now+901000);return value;});
  ensure(await refusal(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>"synthetic-private"),401));
}));

test("live originating session removal cascades delegation and cannot fall back to browser cookies",()=>closed(async()=>{
  const {f,p}=await fixture();await f.db.delete(s.session).where(eq(s.session.id,p.identity.session.id));
  ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,p.token.id)))[0].sessionId===null);
  ensure(await refusal(()=>p.service.withActor({...p.actorRequest,headers:new Headers({cookie:f.identities.admin.cookie})},p.evidence,async()=>true),401));
}));

test("future/expired/infinite live session instants deny401 and revoked delegation denies403",()=>closed(async()=>{
  const {f,p}=await fixture();const [original]=await f.db.select().from(s.session).where(eq(s.session.id,p.identity.session.id));
  const run=()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true);
  for(const change of [{createdAt:new Date(Date.now()+10000)},{expiresAt:new Date(Date.now()-1000)}]){
    await f.db.update(s.session).set(change).where(eq(s.session.id,original.id));ensure(await refusal(run,401));
    await f.db.update(s.session).set({createdAt:original.createdAt,expiresAt:original.expiresAt}).where(eq(s.session.id,original.id));ensure(await run());
  }
  await f.db.execute(sql`update public.session set expires_at='infinity'::timestamp where id=${original.id}`);ensure(await refusal(run,401));
  await f.db.update(s.session).set({expiresAt:original.expiresAt}).where(eq(s.session.id,original.id));ensure(await run());
  await f.owner(()=>f.db.update(s.mcpDelegation).set({revokedAt:new Date()}).where(eq(s.mcpDelegation.id,p.reference)));ensure(await refusal(run,403));
}));
