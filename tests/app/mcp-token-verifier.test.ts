import { randomBytes,randomUUID } from "node:crypto";
import { beforeAll,afterAll,beforeEach,afterEach,test,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq,sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";
import { verifierProfile,ensure,closed,RESOURCE } from "./mcp-token-verifier-helper";
import type { McpTokenPolicy } from "../../src/server/mcp/token-verifier";
import { createMcpTokenVerifier } from "../../src/server/mcp/token-verifier";
import { mcp } from "@better-auth/mcp";
let f:Awaited<ReturnType<typeof accessFixture>>;
beforeAll(async()=>{f=await accessFixture();},60_000);afterAll(async()=>{await f?.client.close();});
beforeEach(()=>{vi.spyOn(console,"error").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});vi.stubGlobal("fetch",async()=>{throw Error("Synthetic MCP verifier forbids network");});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
async function profile(expected:Partial<McpTokenPolicy>={}){
  const p=verifierProfile(f.db,expected),identity=await p.session();
  await f.db.insert(s.oauthClient).values(p.client);await f.db.insert(s.oauthClientResource).values(p.link);
  const token=await p.issue(identity.cookie),[row]=await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,p.clientId));ensure(row);
  return {...p,identity,token,row};
}

test("actual SDK hop seals only closed provider evidence and the HTTP path is unavailable",()=>closed(async()=>{
  const p=await profile(),direct=await p.auth.api.verifyPortalMcpToken({body:{token:p.token}});
  ensure(Object.isFrozen(direct)&&p.boundary.readEvidence(direct)===null);
  const proof=await p.verify(p.token);ensure(proof&&Object.isFrozen(proof)&&Object.isSealed(proof)&&p.boundary.readEvidence(proof)===proof);
  ensure(proof.userId===p.identity.userId&&proof.authSessionId===p.identity.sessionId&&proof.delegationId===p.reference&&proof.clientId===p.clientId&&proof.resource===RESOURCE&&proof.scope==="portal:read"&&proof.accessTokenHash===p.row.token);
  ensure(Object.keys(proof).sort().join(",")===["issuer","resource","clientId","scope","userId","authSessionId","delegationId","expiresAt","accessTokenHash"].sort().join(","));
  ensure(!JSON.stringify(proof).includes(p.token));
  ensure((await p.request("/portal/mcp/verify-token",{token:p.token},p.identity.cookie)).status===404);
}));

test("clones, forged API results and malformed inputs never acquire an evidence brand",()=>closed(async()=>{
  const p=await profile(),proof=await p.verify(p.token);ensure(proof);
  ensure(p.boundary.readEvidence({...proof})===null&&p.boundary.readEvidence(structuredClone(proof))===null&&p.boundary.readEvidence(Object.freeze({...proof}))===null);
  let calls=0;const negative=p.boundary.bind({verifyPortalMcpToken:async()=>{calls++;return {...proof};}});
  for(const input of [undefined,null,{},"",p.identity.cookie,"Bearer "+p.token,"synthetic.jwt.parts","x".repeat(4097),"bad\nvalue"])ensure(await negative(input)===null);
  ensure(calls===0);ensure(await negative(p.token)===null);ensure(Number(calls)===1);
  const cloned=p.boundary.bind({verifyPortalMcpToken:async input=>structuredClone(await p.auth.api.verifyPortalMcpToken(input))});ensure(await cloned(p.token)===null);
  const swapped=p.boundary.bind({verifyPortalMcpToken:async()=>p.auth.api.verifyPortalMcpToken({body:{token:p.token}})});ensure(await swapped("A".repeat(32))===null);
}));

test("actual provider credentials refuse fixed issuer, resource and client policy mismatches",()=>closed(async()=>{
  for(const expected of [{issuer:"https://foreign.example.test/api/auth"},{resource:"https://foreign.example.test/api/mcp"},{clientId:randomUUID()}]){
    const p=await profile(expected);ensure(await p.verify(p.token)===null);
  }
}));

test("live provider state, missing session/user/reference and exact read scope deny",()=>closed(async()=>{
  const p=await profile();ensure(await p.verify(p.token));
  for(const change of [{sessionId:null},{userId:null},{referenceId:null},{referenceId:"not-a-uuid"},{scopes:["portal:write"]},{scopes:["portal:read","offline_access"]},
    {resources:["https://foreign.example.test/api/mcp"]},{resources:[RESOURCE,"https://foreign.example.test/api/mcp"]},{revoked:new Date()},{expiresAt:new Date(Date.now()-1000)}]){
    await f.db.update(s.oauthAccessToken).set(change).where(eq(s.oauthAccessToken.id,p.row.id));ensure(await p.verify(p.token)===null);
    await f.db.update(s.oauthAccessToken).set(p.row).where(eq(s.oauthAccessToken.id,p.row.id));
  }
  await f.db.update(s.oauthClient).set({disabled:true}).where(eq(s.oauthClient.clientId,p.clientId));ensure(await p.verify(p.token)===null);
  await f.db.update(s.oauthClient).set({disabled:false}).where(eq(s.oauthClient.clientId,p.clientId));
  await f.db.execute(sql`update oauth_access_token set expires_at='infinity'::timestamp where id=${p.row.id}`);ensure(await p.verify(p.token)===null);
  await f.db.update(s.oauthAccessToken).set({expiresAt:p.row.expiresAt}).where(eq(s.oauthAccessToken.id,p.row.id));
  ensure(await p.verify(p.token));
  await f.db.delete(s.session).where(eq(s.session.id,p.identity.sessionId));
  ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,p.row.id)))[0].sessionId===null&&await p.verify(p.token)===null);
}));

test("real opaque revocation and a refresh-only stored credential cannot verify as access",()=>closed(async()=>{
  const p=await profile(),raw=randomBytes(32).toString("base64url");
  await f.db.insert(s.oauthRefreshToken).values({id:randomUUID(),token:raw,clientId:p.clientId,userId:p.identity.userId,sessionId:p.identity.sessionId,scopes:["portal:read"],createdAt:new Date(),expiresAt:new Date(Date.now()+60_000)});
  ensure(await p.verify(raw)===null); // Structural refresh-only row, not refresh issuance acceptance.
  ensure((await p.request("/oauth2/revoke",{client_id:p.clientId,token:p.token,token_type_hint:"access_token"})).status===200&&await p.verify(p.token)===null);
}));

test("observable sender binding denies while falsy stored JSON remains an explicit DAO gate",()=>closed(async()=>{
  const p=await profile();
  for(const confirmation of [{jkt:"synthetic-thumbprint"},{"x5t#S256":"synthetic-thumbprint"},{}]){
    await f.db.update(s.oauthAccessToken).set({confirmation}).where(eq(s.oauthAccessToken.id,p.row.id));ensure(await p.verify(p.token)===null);
  }
  await f.db.update(s.oauthAccessToken).set({confirmation:false}).where(eq(s.oauthAccessToken.id,p.row.id));
  const stored=await f.db.execute<{present:boolean}>(sql`select confirmation is not null as present from oauth_access_token where id=${p.row.id}`);
  ensure(stored.rows[0].present===true&&await p.verify(p.token)!==null);
  // SDK truthiness drops falsy JSON; provider evidence cannot prove SQL NULL.
  await f.db.update(s.oauthAccessToken).set({confirmation:null}).where(eq(s.oauthAccessToken.id,p.row.id));
}));

test("expiry is fenced again after the actual API await and on evidence reuse",()=>closed(async()=>{
  const p=await profile(),proof=await p.verify(p.token);ensure(proof);
  const delayed=p.boundary.bind({verifyPortalMcpToken:async input=>{const candidate=await p.auth.api.verifyPortalMcpToken(input);vi.spyOn(Date,"now").mockReturnValue(candidate.expiresAt);return candidate;}});
  ensure(await delayed(p.token)===null&&p.boundary.readEvidence(proof)===null);
}));

test("unsupported JWT/prefix profiles and malformed server policy fail construction",()=>closed(async()=>{
  const options={resource:RESOURCE,loginPage:"/login",consentPage:"/consent",disableJwtPlugin:true},policy={issuer:"https://portal.example.test/api/auth",resource:RESOURCE,clientId:"synthetic-fixed-client"};
  const rejects=(fn:()=>unknown)=>{try{fn();return false;}catch(error){return error instanceof Error&&error.message==="Invalid MCP verifier composition";}};
  ensure(rejects(()=>createMcpTokenVerifier(mcp({...options,disableJwtPlugin:false}),policy)));
  ensure(rejects(()=>createMcpTokenVerifier(mcp({...options,prefix:{opaqueAccessToken:"synthetic_"}}),policy)));
  const provider=mcp(options);
  for(const change of [{issuer:"not-a-url"},{issuer:"https://portal.example.test/api/auth?query=1"},{resource:"https://portal.example.test/api/mcp#fragment"},{clientId:""},{clientId:" padded "},{clientId:"bad\nclient"},{clientId:"x".repeat(256)}])ensure(rejects(()=>createMcpTokenVerifier(provider,{...policy,...change})));
  const p=await profile();p.policy.clientId="different";const proof=await p.verify(p.token);ensure(proof?.clientId===p.clientId);
}));
