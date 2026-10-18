import { randomUUID } from "node:crypto";
import { afterEach,beforeEach,test,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq,sql } from "drizzle-orm";
import { postgresAccessFixture,deferred,waitForEntry,settleRace } from "./access-fixture";
import { liveProfile,ensure,closed } from "../app/mcp-live-authority-helper";
import { createMcpLiveAuthority } from "../../src/server/mcp/live-authority";
import { AccessDenied,AccessUnavailable } from "../../src/server/access/errors";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";
type Fixture=Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened:Fixture[]=[];
beforeEach(()=>{vi.spyOn(console,"error").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});vi.stubGlobal("fetch",async()=>{throw Error("Synthetic native authority forbids network");});});
afterEach(async()=>{try{vi.restoreAllMocks();for(const f of opened.splice(0))await f.close();}finally{vi.unstubAllGlobals();}});
async function fixture(role:"admin"|"tutor"="admin") {const f=await postgresAccessFixture();opened.push(f);const p=await liveProfile(f.aDb,fn=>fn(f.ownerDb),{role});return {f,p};}
async function denied(operation:()=>Promise<unknown>,status:number){try{await operation();return false;}catch(error){return (error instanceof AccessDenied||error instanceof AccessUnavailable)&&error.status===status;}}

// Source-only until the existing public disposable native harness is authorized.
// No cluster selection or launch; Google verification/profile alone is stubbed.
test("native restricted LOGIN link-lock privilege is id-only, immutable and compatible with actual SDK link CRUD",()=>closed(async()=>{
  const {p}=await fixture();await p.verifyLinkPermissions();
}));

test("native actual factory Google + real PKCE opaque proof permits restricted admin and tutor with tenant RLS",()=>closed(async()=>{
  const {f,p}=await fixture();
  ensure(await p.service.withActor(p.actorRequest,p.evidence,async(tx,actor)=>{
    const rows=await tx.select({tenant:s.student.tenantId}).from(s.student);
    return actor.mode==="admin"&&actor.authorizationExpiresAt<actor.authSessionExpiresAt&&actor.authorizationExpiresAt<=p.evidence.expiresAt&&rows.length===1&&rows.every(v=>v.tenant==="crc");
  }));
  const tutor=await liveProfile(f.aDb,fn=>fn(f.ownerDb),{role:"tutor"});
  ensure(await tutor.service.withActor(tutor.actorRequest,tutor.evidence,async(_tx,actor)=>actor.mode==="tutor"));
}));

test("native committed revoker before exact grant lock denies without action",()=>closed(async()=>{
  const {f,p}=await fixture(),entered=deferred(),release=deferred();let action=false;
  const revoker=withTenantTransaction(f.bDb,{tenantId:"crc"},async tx=>{
    await tx.update(s.roleGrant).set({revision:2}).where(eq(s.roleGrant.id,p.selected.grant.id));entered.resolve();await release.promise;
  });
  let read:Promise<boolean>|undefined;
  try{await waitForEntry(entered.promise,revoker);read=denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>{action=true;}),403);
    await f.waitForLock(f.pidA,f.pidB);release.resolve();await revoker;ensure(await read&&!action);
  }finally{release.resolve();await settleRace([revoker,...(read?[read]:[])]);}
}));

test("native authorized reader holds exact grant revoker until materialized read commits",()=>closed(async()=>{
  const {f,p}=await fixture(),entered=deferred(),release=deferred();
  const read=p.service.withActor(p.actorRequest,p.evidence,async()=>{entered.resolve();await release.promise;return true;});let revoker:Promise<unknown>|undefined;
  try{await waitForEntry(entered.promise,read);revoker=withTenantTransaction(f.bDb,{tenantId:"crc"},tx=>tx.update(s.roleGrant).set({revision:2}).where(eq(s.roleGrant.id,p.selected.grant.id)).then(()=>undefined));
    await f.waitForLock(f.pidB,f.pidA);release.resolve();ensure(await read);await revoker;
    ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true),403));
  }finally{release.resolve();await settleRace([read,...(revoker?[revoker]:[])]);}
}));

test("native consent delete committed first denies even while its access token survives",()=>closed(async()=>{
  const {f,p}=await fixture(),entered=deferred(),release=deferred();
  const revoker=f.bDb.transaction(async tx=>{await tx.delete(s.oauthConsent).where(eq(s.oauthConsent.id,p.consent.id));entered.resolve();await release.promise;});let read:Promise<boolean>|undefined;
  try{await waitForEntry(entered.promise,revoker);read=denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true),403);
    await f.waitForLock(f.pidA,f.pidB);release.resolve();await revoker;ensure(await read);
    ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,p.token.id))).length===1);
  }finally{release.resolve();await settleRace([revoker,...(read?[read]:[])]);}
}));

for(const target of ["consent","access","session"] as const)test(`native reader shared locks block ${target} deletion then preserve subsequent denial/cascades`,()=>closed(async()=>{
  const {f,p}=await fixture(),entered=deferred(),release=deferred();
  const read=p.service.withActor(p.actorRequest,p.evidence,async()=>{entered.resolve();await release.promise;return true;});let revoker:Promise<unknown>|undefined;
  try{await waitForEntry(entered.promise,read);revoker=f.bDb.transaction(async tx=>{
    if(target==="consent")await tx.delete(s.oauthConsent).where(eq(s.oauthConsent.id,p.consent.id));
    else if(target==="access")await tx.delete(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,p.token.id));
    else await tx.delete(s.session).where(eq(s.session.id,p.identity.session.id));
  });await f.waitForLock(f.pidB,f.pidA);release.resolve();ensure(await read);await revoker;
    ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true),target==="session"?401:403));
    if(target==="session"){
      const [row]=await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,p.token.id));ensure(row.sessionId===null);
      const count=await f.ownerDb.select().from(s.mcpDelegation).where(eq(s.mcpDelegation.id,p.reference));ensure(count.length===0);
    }
  }finally{release.resolve();await settleRace([read,...(revoker?[revoker]:[])]);}
}));

test("native rollback and failed COMMIT never return a private result and leave connection usable",()=>closed(async()=>{
  const {f,p}=await fixture();
  ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>{throw Error("synthetic-read-failure");}),503));
  let commitSeen=false;const restore=await f.intercept("a",text=>/^commit$/i.test(text.trim()),async()=>{commitSeen=true;throw Error("synthetic-commit-failure");});
  try{ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>"synthetic-private"),503)&&commitSeen);}finally{restore();}
  ensure(await p.service.withActor(p.actorRequest,p.evidence,async()=>true));
}));

test("native post-COMMIT deadline fence discards result after actual acknowledgement",()=>closed(async()=>{
  const {f,p}=await fixture();const now=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValue(now);let committed=false;
  const restore=await f.intercept("a",text=>/^commit$/i.test(text.trim()),async proceed=>{const value=await proceed();committed=true;clock.mockReturnValue(now+901000);return value;});
  try{ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>"synthetic-private"),401)&&committed);}finally{restore();clock.mockRestore();}
}));

test("native SQL null/refresh/session UTC checks remain independent of provider evidence",()=>closed(async()=>{
  const {f,p}=await fixture();
  await f.aDb.execute(sql`set time zone 'Pacific/Honolulu'`);ensure(await p.service.withActor(p.actorRequest,p.evidence,async()=>true));
  await f.aDb.execute(sql`update public.oauth_access_token set confirmation='false'::jsonb where id=${p.token.id}`);
  ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true),403));
  await f.aDb.update(s.oauthAccessToken).set({confirmation:null}).where(eq(s.oauthAccessToken.id,p.token.id));
  const refreshId=randomUUID();
  await f.aDb.insert(s.oauthRefreshToken).values({id:refreshId,token:randomUUID(),clientId:p.clientId,userId:p.identity.user.id,sessionId:p.identity.session.id,
    createdAt:new Date(),expiresAt:new Date(Date.now()+300000),scopes:["portal:read"]});
  await f.aDb.update(s.oauthAccessToken).set({refreshId}).where(eq(s.oauthAccessToken.id,p.token.id));
  ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true),403));
  await f.aDb.update(s.oauthAccessToken).set({refreshId:null}).where(eq(s.oauthAccessToken.id,p.token.id));
  await f.aDb.update(s.session).set({expiresAt:new Date(Date.now()-1000)}).where(eq(s.session.id,p.identity.session.id));
  ensure(await denied(()=>p.service.withActor(p.actorRequest,p.evidence,async()=>true),401));
  // A second live authority service on another real runtime DB uses exactly the
  // same verifier instance/policy; there is no independent cookie identity path.
  const b=createMcpLiveAuthority({db:f.bDb,boundary:p.boundary,policy:p.policy,deployment:p.deployment});
  ensure(await denied(()=>b.withActor(p.actorRequest,p.evidence,async()=>true),401));
}));
