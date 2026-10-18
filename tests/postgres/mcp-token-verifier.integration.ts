import { afterEach,beforeEach,test,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq,sql } from "drizzle-orm";
import { postgresAccessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";
import { verifierProfile,ensure,closed } from "../app/mcp-token-verifier-helper";
type Fixture=Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened:Fixture[]=[];
beforeEach(()=>{vi.spyOn(console,"error").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});vi.stubGlobal("fetch",async()=>{throw Error("Synthetic native MCP verifier forbids network");});});
afterEach(async()=>{try{for(const f of opened.splice(0))await f.close();}finally{vi.unstubAllGlobals();vi.restoreAllMocks();}});
async function fixture(){const f=await postgresAccessFixture();opened.push(f);return f;}
async function profile(f:Fixture){const p=verifierProfile(f.aDb),identity=await p.session();await f.aDb.insert(s.oauthClient).values(p.client);await f.aDb.insert(s.oauthClientResource).values(p.link);
  const token=await p.issue(identity.cookie),[row]=await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,p.clientId));ensure(row);return {...p,identity,token,row};}

// Only the existing public disposable native fixture is used. No cluster is
// selected/launched here, and provider evidence does not authorize portal data.
test("native real SDK API identity produces sealed evidence and private HTTP returns404",()=>closed(async()=>{
  const f=await fixture(),p=await profile(f),proof=await p.verify(p.token);ensure(proof);
  ensure(p.boundary.readEvidence(proof)===proof&&Object.isFrozen(proof)&&Object.isSealed(proof)&&proof.accessTokenHash===p.row.token&&proof.userId===p.identity.userId&&proof.authSessionId===p.identity.sessionId&&proof.delegationId===p.reference);
  ensure(p.boundary.readEvidence({...proof})===null&&p.boundary.readEvidence(structuredClone(proof))===null);
  ensure((await p.request("/portal/mcp/verify-token",{token:p.token},p.identity.cookie)).status===404);
  ensure((await p.request("/oauth2/revoke",{client_id:p.clientId,token:p.token,token_type_hint:"access_token"})).status===200&&await p.verify(p.token)===null);
}));

test("native observable confirmation denies while falsy JSON proves remaining SQL-null gate",()=>closed(async()=>{
  const f=await fixture(),p=await profile(f);
  for(const confirmation of [{jkt:"synthetic-thumbprint"},{"x5t#S256":"synthetic-thumbprint"},{}]){await f.aDb.update(s.oauthAccessToken).set({confirmation}).where(eq(s.oauthAccessToken.id,p.row.id));ensure(await p.verify(p.token)===null);}
  await f.aDb.update(s.oauthAccessToken).set({confirmation:false}).where(eq(s.oauthAccessToken.id,p.row.id));
  const rows=await f.aDb.execute<{present:boolean}>(sql`select confirmation is not null as present from oauth_access_token where id=${p.row.id}`);ensure(rows.rows[0].present&&await p.verify(p.token)!==null);
  await f.aDb.update(s.oauthAccessToken).set({confirmation:null}).where(eq(s.oauthAccessToken.id,p.row.id));
  await f.aDb.delete(s.session).where(eq(s.session.id,p.identity.sessionId));
  ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,p.row.id)))[0].sessionId===null&&await p.verify(p.token)===null);
}));

test("native missing bindings, wrong scope and expired/infinite provider timestamps deny",()=>closed(async()=>{
  const f=await fixture(),p=await profile(f);
  for(const change of [{userId:null},{referenceId:"not-a-uuid"},{scopes:["portal:write"]},{expiresAt:new Date(Date.now()-1000)}]){
    await f.aDb.update(s.oauthAccessToken).set(change).where(eq(s.oauthAccessToken.id,p.row.id));ensure(await p.verify(p.token)===null);await f.aDb.update(s.oauthAccessToken).set(p.row).where(eq(s.oauthAccessToken.id,p.row.id));
  }
  await f.aDb.execute(sql`update oauth_access_token set expires_at='infinity'::timestamp where id=${p.row.id}`);ensure(await p.verify(p.token)===null);
}));
