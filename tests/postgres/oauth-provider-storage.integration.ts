import { randomUUID,randomBytes } from "node:crypto";
import { afterEach,beforeEach,test,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq } from "drizzle-orm";
import { postgresAccessFixture } from "./access-fixture";
import { query } from "./disposable.mjs";
import * as s from "../../src/server/db/index";
import { closed,ensure,providerFixture,verifyOAuthCatalog,RESOURCE,REFERENCE } from "../app/oauth-provider-storage-helper";
type Fixture=Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened:Fixture[]=[];
beforeEach(()=>{vi.spyOn(console,"error").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});vi.stubGlobal("fetch",async()=>{throw Error("Synthetic OAuth storage forbids network");});});
afterEach(async()=>{try{for(const f of opened.splice(0))await f.close();}finally{vi.unstubAllGlobals();vi.restoreAllMocks();}});
async function fixture(){const f=await postgresAccessFixture();opened.push(f);return f;}

// Uses only the existing opt-in public disposable fixture. No native launcher,
// target selection or real Google/portal-delegation authority is introduced.
test("native selected opaque catalog and restricted grants match generated storage",()=>closed(async()=>{
  const f=await fixture();await verifyOAuthCatalog(async text=>(await query<Record<string,unknown>>(f.owner,text)).rows);
  const permissions=await query(f.owner,"SELECT has_table_privilege('portal_runtime','oauth_client_assertion','UPDATE') AS assertion_update,has_table_privilege('portal_runtime','oauth_client_assertion','DELETE') AS assertion_delete,has_table_privilege('portal_runtime','oauth_client_resource','UPDATE') AS link_update,(SELECT tableowner='portal_runtime' FROM pg_tables WHERE schemaname='public' AND tablename='oauth_client') AS owner");
  ensure(!permissions.rows[0].assertion_update&&!permissions.rows[0].assertion_delete&&!permissions.rows[0].link_update&&!permissions.rows[0].owner);
  const clientId=randomUUID();await f.aDb.insert(s.oauthClient).values({id:randomUUID(),clientId,redirectUris:["https://example.test/callback"],metadata:{synthetic:true}});
  const [stored]=await f.aDb.select().from(s.oauthClient).where(eq(s.oauthClient.clientId,clientId));
  ensure(stored.disabled===false&&stored.dpopBoundAccessTokens===false&&stored.clientCredentialsScopes?.length===0&&(stored.metadata as {synthetic?:boolean}).synthetic===true);
  let denied=false;try{await f.aDb.update(s.oauthClientAssertion).set({expiresAt:new Date()});}catch(error){const e=error as {code?:string;cause?:{code?:string}};denied=(e.cause?.code??e.code)==="42501";}ensure(denied);
}));

test("native real SDK public-client PKCE exchange persists and revokes opaque credentials",()=>closed(async()=>{
  const f=await fixture(),sdk=providerFixture(f.aDb),selection=await sdk.start();
  await sdk.exchange(selection,true);ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId))).length===0);
  const token=await sdk.exchange(selection);ensure(token);
  const [stored]=await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId));
  ensure(stored.token!==token&&stored.sessionId===selection.sessionId&&stored.userId===selection.userId&&stored.referenceId===REFERENCE&&stored.resources?.[0]===RESOURCE&&stored.scopes[0]==="portal:read");
  const active=await sdk.auth.api.validateStoredAccess({body:{token}});ensure(active.active&&active.persistedHash&&active.subject===selection.userId&&active.session===selection.sessionId&&active.reference===REFERENCE&&active.resource&&active.scope);
  ensure((await sdk.request("/synthetic-storage-validator",{token})).status===404);
  ensure((await sdk.request("/oauth2/revoke",{client_id:selection.clientId,token,token_type_hint:"access_token"})).status===200);
  ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,stored.id))).length===0&&await sdk.denied(token));
}));

test("native session SET NULL and provider cascades preserve existing material and delegation storage",()=>closed(async()=>{
  const f=await fixture();
  const before=await query(f.owner,"SELECT (SELECT count(*)::int FROM honoree_material_release) AS material,(SELECT count(*)::int FROM mcp_delegation) AS delegation");
  const sdk=providerFixture(f.aDb),selection=await sdk.start();ensure(await sdk.exchange(selection));
  const refreshId=randomUUID(),accessId=randomUUID(),now=new Date();
  // Structural refresh row, not refresh issuance/rotation acceptance.
  await f.aDb.insert(s.oauthRefreshToken).values({id:refreshId,token:randomBytes(32).toString("hex"),clientId:selection.clientId,sessionId:selection.sessionId,userId:selection.userId,scopes:["portal:read"],createdAt:now,expiresAt:new Date(Date.now()+60_000)});
  await f.aDb.insert(s.oauthAccessToken).values({id:accessId,token:randomBytes(32).toString("hex"),clientId:selection.clientId,refreshId,sessionId:selection.sessionId,userId:selection.userId,scopes:["portal:read"],createdAt:now,expiresAt:new Date(Date.now()+60_000)});
  await f.aDb.delete(s.session).where(eq(s.session.id,selection.sessionId));
  ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId))).every(row=>row.sessionId===null));
  ensure((await f.aDb.select().from(s.oauthRefreshToken).where(eq(s.oauthRefreshToken.id,refreshId)))[0].sessionId===null);
  await f.aDb.delete(s.oauthRefreshToken).where(eq(s.oauthRefreshToken.id,refreshId));ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,accessId))).length===0);
  await f.aDb.delete(s.oauthClient).where(eq(s.oauthClient.clientId,selection.clientId));
  ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId))).length===0&&(await f.aDb.select().from(s.oauthConsent).where(eq(s.oauthConsent.clientId,selection.clientId))).length===0&&(await f.aDb.select().from(s.oauthClientResource).where(eq(s.oauthClientResource.clientId,selection.clientId))).length===0);
  const other=await sdk.start();ensure(await sdk.exchange(other));await f.aDb.delete(s.user).where(eq(s.user.id,other.userId));
  ensure((await f.aDb.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.userId,other.userId))).length===0&&(await f.aDb.select().from(s.oauthConsent).where(eq(s.oauthConsent.userId,other.userId))).length===0);
  const after=await query(f.owner,"SELECT (SELECT count(*)::int FROM honoree_material_release) AS material,(SELECT count(*)::int FROM mcp_delegation) AS delegation");
  ensure(before.rows[0].material===after.rows[0].material&&before.rows[0].delegation===after.rows[0].delegation);
}));
