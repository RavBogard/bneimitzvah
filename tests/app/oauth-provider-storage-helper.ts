// Test-only actual SDK composition. No application factory or HTTP route imports.
import { randomBytes, createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins";
import { createAuthEndpoint } from "better-auth/api";
import { mcp } from "@better-auth/mcp";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import { z } from "zod";
import * as authSchema from "../../src/server/db/auth-schema";
import * as oauthSchema from "../../src/server/db/oauth-schema";
import { getTableConfig } from "drizzle-orm/pg-core";

export const ORIGIN="https://portal.example.test",RESOURCE=ORIGIN+"/api/mcp",CALLBACK="https://claude.ai/api/mcp/auth_callback",REFERENCE="synthetic-provider-reference";
export function ensure(value:unknown):asserts value {if(!value)throw Error("Synthetic OAuth storage assertion failed; details withheld");}
export async function closed<T>(operation:()=>Promise<T>):Promise<T>{try{return await operation();}catch{throw Error("Synthetic OAuth storage operation failed; details withheld");}}

export async function verifyOAuthCatalog(query:(text:string)=>Promise<Record<string,unknown>[]>) {
  const columns=await query("SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'oauth_%' AND a.attnum>0 AND NOT a.attisdropped");
  const indexes=await query("SELECT ci.relname AS indexname,i.indisunique AS is_unique,ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ci ON ci.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'oauth_%'");
  const foreignKeys=await query("SELECT c.relname AS table_name,con.confdeltype AS action,a.attname AS column_name,p.relname AS target,b.attname AS target_column FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_class p ON p.oid=con.confrelid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=con.conkey[1] JOIN pg_attribute b ON b.attrelid=p.oid AND b.attnum=con.confkey[1] WHERE con.contype='f' AND con.connamespace='public'::regnamespace AND c.relname LIKE 'oauth_%'");
  let count=0,expectedKeys=0;
  for(const table of Object.values(oauthSchema)) {
    const config=getTableConfig(table);count+=config.columns.length;
    for(const column of config.columns){const rows=columns.filter(row=>row.table_name===config.name&&row.column_name===column.name);
      const type=column.getSQLType()==="timestamp"?"timestamp without time zone":column.getSQLType();
      const expectedDefault=column.default===undefined?null:Array.isArray(column.default)?"'{}'::text[]":String(column.default);
      ensure(rows.length===1&&rows[0].type===type&&rows[0].required===column.notNull&&rows[0].default_value===expectedDefault);}
    for(const index of config.indexes){const names=index.config.columns.map(column=>"name"in column?column.name:null);
      ensure(indexes.some(row=>row.indexname===index.config.name&&row.is_unique===index.config.unique&&JSON.stringify(row.columns)===JSON.stringify(names)));}
    for(const fk of config.foreignKeys){expectedKeys++;const reference=fk.reference();ensure(foreignKeys.some(row=>row.table_name===config.name&&row.column_name===reference.columns[0].name
      &&row.target===getTableConfig(reference.foreignTable).name&&row.target_column===reference.foreignColumns[0].name&&row.action===(fk.onDelete==="set null"?"n":"c")));}
  }
  ensure(columns.length===count&&count===100&&foreignKeys.length===expectedKeys);
  ensure(!(await query("SELECT 1 FROM pg_class WHERE oid=to_regclass('public.jwks')")).length);
}

export function providerFixture(db:Parameters<typeof drizzleAdapter>[0]) {
  const deliveries:{url:string}[]=[];
  const provider=mcp({resource:RESOURCE,disableJwtPlugin:true,loginPage:"/login",consentPage:"/consent",scopes:["portal:read"],
    grantTypes:["authorization_code"],accessTokenExpiresIn:900,allowDynamicClientRegistration:false,allowUnauthenticatedClientRegistration:false,
    clientPrivileges:async({session})=>!!session,resourcePrivileges:async({session})=>!!session,
    postLogin:{page:"/selection",shouldRedirect:async()=>false,consentReferenceId:async()=>REFERENCE},
    customAccessTokenClaims:async({referenceId})=>({portal_reference:referenceId})});
  const validator={id:"synthetic-storage-validator",endpoints:{validateStoredAccess:createAuthEndpoint("/synthetic-storage-validator",{
    method:"POST",body:z.object({token:z.string()}),metadata:{SERVER_ONLY:true},
  },async ctx=>{const api=getOAuthProviderApi(ctx,provider.options),payload=await api.requireActiveAccessToken(ctx.body.token);
    const hash=await api.hashToken(ctx.body.token,"access_token");
    const stored=await ctx.context.adapter.findOne({model:"oauthAccessToken",where:[{field:"token",value:hash}]});
    return {active:true,subject:payload.sub,session:payload.sid,client:payload.client_id,reference:payload.portal_reference,
      persistedHash:!!stored,resource:Array.isArray(payload.aud)?payload.aud.length===1&&payload.aud[0]===RESOURCE:payload.aud===RESOURCE,scope:payload.scope==="portal:read"};})}};
  const auth=betterAuth({baseURL:ORIGIN,secret:randomBytes(48).toString("base64url"),logger:{disabled:true},telemetry:{enabled:false},rateLimit:{enabled:false},
    database:drizzleAdapter(db,{provider:"pg",schema:{...authSchema,...oauthSchema},transaction:true}),
    plugins:[magicLink({storeToken:"hashed",sendMagicLink:async message=>{deliveries.push({url:message.url});}}),provider,validator]});
  async function request(path:string,body?:Record<string,unknown>,cookie?:string,query?:string){
    const form=path==="/oauth2/token"||path==="/oauth2/revoke",headers=new Headers({origin:ORIGIN,accept:"application/json"});
    if(cookie)headers.set("cookie",cookie);if(body)headers.set("content-type",form?"application/x-www-form-urlencoded":"application/json");
    return auth.handler(new Request(ORIGIN+"/api/auth"+path+(query?"?"+query:""),{method:body?"POST":"GET",headers,
      body:body?(form?new URLSearchParams(body as Record<string,string>).toString():JSON.stringify(body)):undefined}));
  }
  async function location(response:Response){const direct=response.headers.get("location");if(direct)return direct;const body:unknown=await response.json().catch(()=>null);return body&&typeof body==="object"&&"url"in body&&typeof body.url==="string"?body.url:null;}
  async function start(){
    const deliveryCount=deliveries.length;
    ensure((await request("/sign-in/magic-link",{email:"oauth-storage@example.test",callbackURL:"/"})).status===200);
    ensure(deliveries.length===deliveryCount+1);const redeemed=await auth.handler(new Request(deliveries.at(-1)!.url));
    const cookie=redeemed.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    const proof=await auth.api.getSession({headers:new Headers({cookie}),query:{disableRefresh:true,disableCookieCache:true}});ensure(proof);
    const client=await auth.api.adminCreateOAuthClient({headers:new Headers({cookie}),body:{client_name:"Synthetic storage client",redirect_uris:[CALLBACK],
      token_endpoint_auth_method:"none",require_pkce:true,application_type:"web",subject_type:"public",response_types:["code"],grant_types:["authorization_code"],scope:"portal:read",resources:[RESOURCE],skip_consent:false}});
    ensure(typeof client.client_id==="string"&&!client.client_secret);
    return {cookie,userId:proof.user.id,sessionId:proof.session.id,clientId:client.client_id};
  }
  type Selection=Awaited<ReturnType<typeof start>>;
  async function exchange(selection:Selection,wrongVerifier=false){
    const verifier=randomBytes(48).toString("base64url"),query=new URLSearchParams({client_id:selection.clientId,redirect_uri:CALLBACK,response_type:"code",scope:"portal:read",resource:RESOURCE,
      code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",state:"synthetic-storage-state"});
    let response=await request("/oauth2/authorize",undefined,selection.cookie,query.toString()),redirect=await location(response);ensure(redirect);
    if(new URL(redirect,ORIGIN).pathname==="/consent") {response=await request("/oauth2/consent",{accept:true,oauth_query:new URL(redirect,ORIGIN).search.slice(1)},selection.cookie);redirect=await location(response);ensure(redirect);}
    ensure(new URL(redirect).origin===new URL(CALLBACK).origin&&new URL(redirect).pathname===new URL(CALLBACK).pathname);
    const code=new URL(redirect).searchParams.get("code");ensure(code);
    response=await request("/oauth2/token",{grant_type:"authorization_code",client_id:selection.clientId,code,redirect_uri:CALLBACK,code_verifier:wrongVerifier?randomBytes(48).toString("base64url"):verifier,resource:RESOURCE});
    const body=await response.json() as Record<string,unknown>;
    if(wrongVerifier){ensure(response.status>=400&&typeof body.access_token!=="string");return null;}
    ensure(response.status===200&&typeof body.access_token==="string"&&body.access_token.split(".").length!==3&&body.expires_in===900&&!body.refresh_token);
    return body.access_token;
  }
  async function denied(token:string){try{await auth.api.validateStoredAccess({body:{token}});return false;}catch(error){return (error as {statusCode?:number}).statusCode===401;}}
  return {auth,provider,request,start,exchange,denied};
}
