import { randomUUID, randomBytes } from "node:crypto";
import { beforeAll,afterAll,beforeEach,afterEach,test,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";
import { closed,ensure,providerFixture,verifyOAuthCatalog,RESOURCE,REFERENCE } from "./oauth-provider-storage-helper";
let f:Awaited<ReturnType<typeof accessFixture>>;
beforeAll(async()=>{f=await accessFixture();},60_000);afterAll(async()=>{await f?.client.close();});
beforeEach(()=>{vi.spyOn(console,"error").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});vi.stubGlobal("fetch",async()=>{throw Error("Synthetic OAuth storage forbids network");});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

test("selected opaque CLI schema matches all100 SQL columns, named indexes and foreign-key actions",()=>closed(async()=>{
  await verifyOAuthCatalog(async text=>(await f.client.query<Record<string,unknown>>(text)).rows);
  const id=randomUUID();await f.db.insert(s.oauthClient).values({id,clientId:randomUUID(),redirectUris:["https://example.test/callback"],metadata:{synthetic:true}});
  const [row]=await f.db.select().from(s.oauthClient).where(eq(s.oauthClient.id,id));
  ensure(row.disabled===false&&row.dpopBoundAccessTokens===false&&Array.isArray(row.clientCredentialsScopes)&&row.clientCredentialsScopes.length===0&&row.contacts===null&&(row.metadata as {synthetic?:boolean}).synthetic===true);
  const resource=randomUUID();await f.db.insert(s.oauthResource).values({id:resource,identifier:"https://example.test/"+resource,name:"Synthetic"});
  const [stored]=await f.db.select().from(s.oauthResource).where(eq(s.oauthResource.id,resource));ensure(stored.policyVersion===1&&stored.disabled===false&&stored.dpopBoundAccessTokensRequired===false&&stored.customClaims===null);
}));

test("real managed public client, consent, S256 code exchange, hashed opaque storage and revoke interoperate",()=>closed(async()=>{
  const sdk=providerFixture(f.db),selection=await sdk.start();
  await sdk.exchange(selection,true);ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId))).length===0);
  const token=await sdk.exchange(selection);ensure(token);
  const [stored]=await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId));
  ensure(stored.token!==token&&stored.sessionId===selection.sessionId&&stored.userId===selection.userId&&stored.referenceId===REFERENCE&&stored.resources?.[0]===RESOURCE&&stored.scopes[0]==="portal:read");
  const active=await sdk.auth.api.validateStoredAccess({body:{token}});ensure(active.active&&active.persistedHash&&active.subject===selection.userId&&active.session===selection.sessionId&&active.client===selection.clientId&&active.reference===REFERENCE&&active.resource&&active.scope);
  ensure((await sdk.request("/synthetic-storage-validator",{token})).status===404);
  ensure((await sdk.request("/oauth2/revoke",{client_id:selection.clientId,token,token_type_hint:"access_token"})).status===200);
  ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,stored.id))).length===0&&await sdk.denied(token));
}));

test("session SET NULL and client/user/refresh cascades retain exact provider storage semantics",()=>closed(async()=>{
  const sdk=providerFixture(f.db),selection=await sdk.start(),token=await sdk.exchange(selection);ensure(token);
  // Structural refresh storage only; refresh issuance remains outside this slice.
  const refreshId=randomUUID(),accessId=randomUUID(),now=new Date();
  await f.db.insert(s.oauthRefreshToken).values({id:refreshId,token:randomBytes(32).toString("hex"),clientId:selection.clientId,sessionId:selection.sessionId,userId:selection.userId,scopes:["portal:read"],createdAt:now,expiresAt:new Date(Date.now()+60_000)});
  await f.db.insert(s.oauthAccessToken).values({id:accessId,token:randomBytes(32).toString("hex"),clientId:selection.clientId,refreshId,sessionId:selection.sessionId,userId:selection.userId,scopes:["portal:read"],createdAt:now,expiresAt:new Date(Date.now()+60_000)});
  await f.db.delete(s.session).where(eq(s.session.id,selection.sessionId));
  ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId))).every(row=>row.sessionId===null));
  ensure((await f.db.select().from(s.oauthRefreshToken).where(eq(s.oauthRefreshToken.id,refreshId)))[0].sessionId===null);
  await f.db.delete(s.oauthRefreshToken).where(eq(s.oauthRefreshToken.id,refreshId));ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.id,accessId))).length===0);
  await f.db.delete(s.oauthClient).where(eq(s.oauthClient.clientId,selection.clientId));
  ensure((await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.clientId,selection.clientId))).length===0&&(await f.db.select().from(s.oauthConsent).where(eq(s.oauthConsent.clientId,selection.clientId))).length===0&&(await f.db.select().from(s.oauthClientResource).where(eq(s.oauthClientResource.clientId,selection.clientId))).length===0);
  const other=await sdk.start();await sdk.exchange(other);await f.db.delete(s.user).where(eq(s.user.id,other.userId));
  ensure((await f.db.select().from(s.oauthConsent).where(eq(s.oauthConsent.userId,other.userId))).length===0&&(await f.db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.userId,other.userId))).length===0);
}));

test("global provider storage has only reviewed runtime grants and uniqueness",()=>closed(async()=>{
  const rows=await f.client.query<{assertion_update:boolean;assertion_delete:boolean;link_update:boolean;owner:boolean}>("SELECT has_table_privilege('portal_runtime','oauth_client_assertion','UPDATE') AS assertion_update,has_table_privilege('portal_runtime','oauth_client_assertion','DELETE') AS assertion_delete,has_table_privilege('portal_runtime','oauth_client_resource','UPDATE') AS link_update,(SELECT tableowner='portal_runtime' FROM pg_tables WHERE schemaname='public' AND tablename='oauth_client') AS owner");
  ensure(!rows.rows[0].assertion_update&&!rows.rows[0].assertion_delete&&!rows.rows[0].link_update&&!rows.rows[0].owner);
  const id=randomUUID(),clientId=randomUUID();await f.db.insert(s.oauthClient).values({id,clientId,redirectUris:[]});
  let duplicate=false;try{await f.db.insert(s.oauthClient).values({id:randomUUID(),clientId,redirectUris:[]});}catch(error){const e=error as {code?:string;cause?:{code?:string}};duplicate=(e.cause?.code??e.code)==="23505";}ensure(duplicate);
}));
