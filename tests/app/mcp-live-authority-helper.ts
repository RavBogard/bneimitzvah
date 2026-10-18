// Actual SDK control flow, factory provenance hook and Drizzle persistence.
// ONLY Google remote verification/profile is stubbed; no portal authority mock.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { mcp } from "@better-auth/mcp";
import { and, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase } from "../../src/server/access/types";
import { createAuthStack } from "../../src/server/auth/factory";
import { createMcpTokenVerifier } from "../../src/server/mcp/token-verifier";
import { createMcpLiveAuthority } from "../../src/server/mcp/live-authority";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { mcpAuthorityData } from "../../src/server/data/mcp-authority";
import * as s from "../../src/server/db/index";
type Phase="assertion"|"google"|"cookie"|"code-hook"|"consent-row"|"delegation-pin"|"authorize"|"callback"|"exchange"|"proof"|"stored"|"profile-client"|"profile-resource"|"profile-link"|"profile-consent"|"profile-token";
class LiveFailure extends Error { constructor(readonly phase:Phase){super("Synthetic authority assertion failed");} }
export function ensure(value:unknown,phase:Phase="assertion"):asserts value {if(!value)throw new LiveFailure(phase);}
export async function closed<T>(operation:()=>Promise<T>):Promise<T>{try{return await operation();}catch(error){
  const e=error as {code?:unknown;cause?:{code?:unknown};status?:unknown},raw=e?.cause?.code??e?.code;
  const code=typeof raw==="string"&&["23503","23505","23514","42501","42703","42P01"].includes(raw)?raw:"withheld";
  const status=typeof e?.status==="number"&&[401,403,404,503].includes(e.status)?e.status:"withheld";
  throw Error(`Synthetic authority failed: phase=${error instanceof LiveFailure?error.phase:"operation"}; code=${code}; status=${status}`);
}}
export const ORIGIN="https://beitmitzvah.centralreform.org", RESOURCE=ORIGIN+"/api/mcp", CALLBACK="https://claude.ai/api/mcp/auth_callback";
export async function liveProfile<Q extends PgQueryResultHKT>(db:AccessDatabase<Q>,
  maintenance:<T>(operation:(db:AccessDatabase<Q>)=>Promise<T>)=>Promise<T>,
  options:{role?:"admin"|"tutor";magic?:boolean;hardMs?:number}={}) {
  const clientId=randomUUID(), reference=randomUUID(), subject=randomUUID(), deliveries:{url:string}[]=[];
  const deployment={environment:"test" as const,deployment:"mcp-live"};
  const provider=mcp({resource:RESOURCE,disableJwtPlugin:true,loginPage:"/login",consentPage:"/consent",scopes:["portal:read"],grantTypes:["authorization_code"],
    accessTokenExpiresIn:900,allowDynamicClientRegistration:false,allowUnauthenticatedClientRegistration:false,
    postLogin:{page:"/selection",shouldRedirect:async()=>false,consentReferenceId:async()=>reference},customAccessTokenClaims:async({referenceId})=>({portal_reference:referenceId})});
  const policy={issuer:ORIGIN+"/api/auth",resource:RESOURCE,clientId},boundary=createMcpTokenVerifier(provider,policy);
  const base=createAuthStack(db,s,{origin:ORIGIN,secret:randomBytes(48).toString("base64url"),google:{clientId:"synthetic-client",clientSecret:randomBytes(32).toString("base64url")},
    sendMagicLink:async value=>{deliveries.push({url:value.url});}});
  let codeHook=false;
  const auth=betterAuth({...base.options,telemetry:{enabled:false},rateLimit:{enabled:false},socialProviders:{google:{clientId:"synthetic-client",clientSecret:randomBytes(32).toString("base64url"),
    verifyIdToken:async token=>token==="synthetic-accepted-google",getUserInfo:async()=>({user:{name:"Synthetic Staff",email:subject+"@example.test",emailVerified:true},
      data:{sub:subject,name:"Synthetic Staff",email:subject+"@example.test",email_verified:true,iss:"https://accounts.google.com",aud:"synthetic-client",azp:"synthetic-client",
        exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000),family_name:"Staff",given_name:"Synthetic",picture:""}})}},
    databaseHooks:{...base.options.databaseHooks,verification:{create:{before:async(value,ctx)=>{
      let code;try{code=JSON.parse(value.value);}catch{return;}if(code?.type!=="authorization_code")return;
      ensure(ctx&&code.referenceId===reference&&code.query.client_id===clientId&&code.resource?.length===1&&code.resource[0]===RESOURCE,"code-hook");
      // Test-only selection persistence in the genuine code hook. Not an app
      // consent handler or a claim that the SDK operation is globally atomic.
      await withTenantTransaction(db,{tenantId:"crc"},async tx=>{
        const rows=await tx.select().from(s.oauthConsent).where(and(eq(s.oauthConsent.clientId,clientId),eq(s.oauthConsent.userId,code.userId),eq(s.oauthConsent.referenceId,reference)));
        ensure(rows.length===1,"consent-row");
        const updated=await tx.update(s.mcpDelegation).set({authorizedAt:new Date(),consentId:rows[0].id}).where(and(eq(s.mcpDelegation.id,reference),eq(s.mcpDelegation.sessionId,code.sessionId))).returning({id:s.mcpDelegation.id});
        ensure(updated.length===1,"delegation-pin");codeHook=true;
      });
    }}}},plugins:[...base.options.plugins!,provider,boundary.plugin]});
  async function request(path:string,body?:Record<string,unknown>,cookie?:string,query?:string){
    const form=path==="/oauth2/token"||path==="/oauth2/revoke",headers=new Headers({origin:ORIGIN,accept:"application/json"});
    if(cookie)headers.set("cookie",cookie);if(body)headers.set("content-type",form?"application/x-www-form-urlencoded":"application/json");
    return auth.handler(new Request(ORIGIN+"/api/auth"+path+(query?"?"+query:""),{method:body?"POST":"GET",headers,
      body:body?(form?new URLSearchParams(body as Record<string,string>).toString():JSON.stringify(body)):undefined}));
  }
  let response:Response;
  if(options.magic){ensure((await request("/sign-in/magic-link",{email:subject+"@example.test",callbackURL:"/"})).status===200);ensure(deliveries.length===1);response=await auth.handler(new Request(deliveries[0].url));}
  else response=await request("/sign-in/social",{provider:"google",idToken:{token:"synthetic-accepted-google"}});
  ensure(response.status<400,"google");
  const cookie=response.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
  const identity=await auth.api.getSession({headers:new Headers({cookie}),query:{disableRefresh:true,disableCookieCache:true}});ensure(identity,"cookie");
  const role=options.role??"admin";
  const selected=await maintenance(async owner=>{
    await owner.insert(s.tenantHost).values({host:new URL(ORIGIN).host,tenantId:"crc",origin:ORIGIN,...deployment})
      .onConflictDoUpdate({target:s.tenantHost.host,set:{tenantId:"crc",origin:ORIGIN,...deployment}});
    const [member]=await owner.insert(s.membership).values({tenantId:"crc",userId:identity.user.id}).returning();
    const [grant]=await owner.insert(s.roleGrant).values({tenantId:"crc",membershipId:member.id,role}).returning();
    return {member,grant};
  });
  await withTenantTransaction(db,{tenantId:"crc"},async tx=>{
    const now=Date.now(), hard=now+(options.hardMs??300_000);
    await tx.insert(s.mcpDelegation).values({id:reference,tenantId:"crc",userId:identity.user.id,sessionId:identity.session.id,membershipId:selected.member.id,roleGrantId:selected.grant.id,role,
      membershipRevision:1,grantRevision:1,pendingCookieHash:randomBytes(32).toString("hex"),requestFingerprint:randomBytes(32).toString("hex"),scope:"portal:read",resource:RESOURCE,clientId,
      createdAt:new Date(now),selectionDeadline:new Date(Math.min(hard,now+60_000)),hardDeadline:new Date(hard)});
  });
  // Explicit synthetic provisioning only. Default provider seed is insufficient.
  await db.insert(s.oauthClient).values({id:randomUUID(),clientId,name:"Claude — CRC Beit Mitzvah",redirectUris:[CALLBACK],tokenEndpointAuthMethod:"none",requirePKCE:true,
    applicationType:"web",subjectType:"public",responseTypes:["code"],grantTypes:["authorization_code"],scopes:["portal:read"],skipConsent:false,disabled:false});
  await db.update(s.oauthResource).set({name:"CRC Beit Mitzvah",accessTokenTtl:900,allowedScopes:["portal:read"],policyVersion:1}).where(eq(s.oauthResource.identifier,RESOURCE));
  await db.insert(s.oauthClientResource).values({id:randomUUID(),clientId,resourceId:RESOURCE});
  const verifier=randomBytes(48).toString("base64url"),query=new URLSearchParams({client_id:clientId,redirect_uri:CALLBACK,response_type:"code",scope:"portal:read",resource:RESOURCE,
    code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",state:"synthetic-live-state"});
  async function redirect(r:Response){const direct=r.headers.get("location");if(direct)return direct;const body=await r.json() as {url?:string};return body.url;}
  let location=await redirect(await request("/oauth2/authorize",undefined,cookie,query.toString()));ensure(location,"authorize");
  if(new URL(location,ORIGIN).pathname==="/consent")location=await redirect(await request("/oauth2/consent",{accept:true,oauth_query:new URL(location,ORIGIN).search.slice(1)},cookie));
  ensure(location&&new URL(location).origin===new URL(CALLBACK).origin&&new URL(location).pathname===new URL(CALLBACK).pathname&&codeHook,"callback");
  const code=new URL(location).searchParams.get("code");ensure(code);
  const exchanged=await request("/oauth2/token",{grant_type:"authorization_code",client_id:clientId,code,redirect_uri:CALLBACK,code_verifier:verifier,resource:RESOURCE});
  const body=await exchanged.json() as {access_token?:string;refresh_token?:string};ensure(exchanged.status===200&&typeof body.access_token==="string"&&!body.refresh_token,"exchange");
  const evidence=await boundary.bind(auth.api)(body.access_token);ensure(evidence,"proof");
  const [token]=await db.select().from(s.oauthAccessToken).where(eq(s.oauthAccessToken.token,evidence.accessTokenHash));
  const [consent]=await db.select().from(s.oauthConsent).where(eq(s.oauthConsent.clientId,clientId));ensure(token&&consent,"stored");
  await withTenantTransaction(db,{tenantId:"crc"},async tx=>{
    const data=mcpAuthorityData(tx);
    ensure((await data.client(clientId))?.valid===true,"profile-client");
    ensure((await data.resource(RESOURCE))?.valid===true,"profile-resource");
    ensure((await data.link(clientId,RESOURCE))?.valid===true,"profile-link");
    ensure((await data.consent(consent.id,identity.user.id,clientId,reference,RESOURCE))?.valid===true,"profile-consent");
    ensure((await data.token(evidence.accessTokenHash,identity.user.id,identity.session.id,clientId,reference,RESOURCE))?.valid===true,"profile-token");
  });
  const service=createMcpLiveAuthority({db,boundary,policy,deployment});
  const actorRequest={url:RESOURCE,headers:new Headers()};
  async function verifyLinkPermissions(){
    const [privileges]=await db.select({tableUpdate:sql<boolean>`has_table_privilege('portal_runtime','public.oauth_client_resource','UPDATE')`,
      idUpdate:sql<boolean>`has_column_privilege('portal_runtime','public.oauth_client_resource','id','UPDATE')`,
      otherUpdate:sql<boolean>`exists (select 1 from pg_catalog.pg_attribute a where a.attrelid='public.oauth_client_resource'::regclass
        and a.attnum>0 and not a.attisdropped and a.attname<>'id' and has_column_privilege('portal_runtime','public.oauth_client_resource',a.attname,'UPDATE'))`,
      restricted:sql<boolean>`not exists (select 1 from pg_catalog.pg_roles where rolname in (current_user,session_user) and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication))
        and pg_has_role(session_user,'portal_runtime','MEMBER') and session_user<>'portal_runtime'`
    }).from(s.oauthClientResource).limit(1);
    ensure(privileges&&!privileges.tableUpdate&&privileges.idUpdate&&!privileges.otherUpdate&&privileges.restricted);
    const [link]=await db.select().from(s.oauthClientResource).where(eq(s.oauthClientResource.clientId,clientId));ensure(link);
    await db.transaction(async tx=>{const row=await tx.select({id:s.oauthClientResource.id}).from(s.oauthClientResource).where(eq(s.oauthClientResource.id,link.id)).for("share");ensure(row.length===1);});
    async function code(operation:()=>Promise<unknown>,expected:string){try{await operation();return false;}catch(error){const e=error as {code?:string;cause?:{code?:string}};return (e.cause?.code??e.code)===expected;}}
    ensure(await code(()=>db.update(s.oauthClientResource).set({id:randomUUID()}).where(eq(s.oauthClientResource.id,link.id)),"23514"));
    await db.update(s.oauthClientResource).set({id:link.id}).where(eq(s.oauthClientResource.id,link.id));
    for(const change of [{clientId},{resourceId:RESOURCE},{metadata:null},{createdAt:new Date()}])ensure(await code(()=>db.update(s.oauthClientResource).set(change).where(eq(s.oauthClientResource.id,link.id)),"42501"));
    const unchanged=await db.select().from(s.oauthClientResource).where(eq(s.oauthClientResource.id,link.id));ensure(unchanged.length===1);
    // Genuine supported server-only SDK APIs: no fabricated endpoint context.
    const args={headers:new Headers({cookie}),params:{identifier:encodeURIComponent(RESOURCE),client_id:clientId}};
    ensure((await auth.api.adminUnlinkClientResource(args)).unlinked);
    ensure((await db.select().from(s.oauthClientResource).where(eq(s.oauthClientResource.clientId,clientId))).length===0);
    ensure((await auth.api.adminLinkClientResource(args)).linked);
    ensure((await db.select().from(s.oauthClientResource).where(eq(s.oauthClientResource.clientId,clientId))).length===1);
  }
  return {db,auth,boundary,policy,deployment,identity,selected,reference,clientId,token,consent,evidence,service,actorRequest,request,verifyLinkPermissions};
}
