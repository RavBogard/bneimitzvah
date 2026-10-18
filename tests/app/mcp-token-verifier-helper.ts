import { randomBytes,randomUUID,createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { createMcpTokenVerifier,type McpTokenPolicy } from "../../src/server/mcp/token-verifier";
import * as authSchema from "../../src/server/db/auth-schema";
import * as oauthSchema from "../../src/server/db/oauth-schema";
export const ORIGIN="https://portal.example.test",RESOURCE=ORIGIN+"/api/mcp",CALLBACK="https://claude.ai/api/mcp/auth_callback";
type Phase="assertion"|"magic-start"|"delivery"|"cookie-session"|"authorization"|"consent"|"callback"|"code"|"exchange";
class SyntheticFailure extends Error{constructor(readonly phase:Phase){super("Synthetic MCP verifier assertion failed");}}
export function ensure(value:unknown,phase:Phase="assertion"):asserts value{if(!value)throw new SyntheticFailure(phase);}
export async function closed<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(error){
  const e=error as {code?:unknown;cause?:{code?:unknown};statusCode?:unknown},rawCode=e?.cause?.code??e?.code;
  const code=typeof rawCode==="string"&&["23503","23505","23514","42501","22P02","ECONNREFUSED"].includes(rawCode)?rawCode:"withheld";
  const status=typeof e?.statusCode==="number"&&Number.isInteger(e.statusCode)&&e.statusCode>=400&&e.statusCode<=599?e.statusCode:"withheld";
  throw Error(`Synthetic MCP verifier failed: phase=${error instanceof SyntheticFailure?error.phase:"operation"}; code=${code}; status=${status}`);
}}

export function verifierProfile(db:Parameters<typeof drizzleAdapter>[0],expected:Partial<McpTokenPolicy>={}){
  const clientId=randomUUID(),reference=randomUUID(),deliveries:{url:string}[]=[];
  const provider=mcp({resource:RESOURCE,disableJwtPlugin:true,loginPage:"/login",consentPage:"/consent",scopes:["portal:read"],grantTypes:["authorization_code"],
    accessTokenExpiresIn:900,allowDynamicClientRegistration:false,allowUnauthenticatedClientRegistration:false,
    postLogin:{page:"/selection",shouldRedirect:async()=>false,consentReferenceId:async()=>reference},customAccessTokenClaims:async({referenceId})=>({portal_reference:referenceId})});
  const policy={issuer:ORIGIN+"/api/auth",resource:RESOURCE,clientId,...expected},boundary=createMcpTokenVerifier(provider,policy);
  const auth=betterAuth({baseURL:ORIGIN,secret:randomBytes(48).toString("base64url"),logger:{disabled:true},telemetry:{enabled:false},rateLimit:{enabled:false},
    database:drizzleAdapter(db,{provider:"pg",schema:{...authSchema,...oauthSchema},transaction:true}),
    plugins:[magicLink({storeToken:"hashed",sendMagicLink:async value=>{deliveries.push({url:value.url});}}),provider,boundary.plugin]});
  const verify=boundary.bind(auth.api);
  async function request(path:string,body?:Record<string,string|boolean>,cookie?:string,query?:string){
    const form=path==="/oauth2/token"||path==="/oauth2/revoke",headers=new Headers({origin:ORIGIN,accept:"application/json"});
    if(cookie)headers.set("cookie",cookie);if(body)headers.set("content-type",form?"application/x-www-form-urlencoded":"application/json");
    return auth.handler(new Request(ORIGIN+"/api/auth"+path+(query?"?"+query:""),{method:body?"POST":"GET",headers,
      body:body?(form?new URLSearchParams(body as Record<string,string>).toString():JSON.stringify(body)):undefined}));
  }
  async function location(response:Response){const direct=response.headers.get("location");if(direct)return direct;const body:unknown=await response.json().catch(()=>null);return body&&typeof body==="object"&&"url"in body&&typeof body.url==="string"?body.url:null;}
  async function session(){
    const count=deliveries.length;ensure((await request("/sign-in/magic-link",{email:"token-verifier@example.test",callbackURL:"/"})).status===200,"magic-start");ensure(deliveries.length===count+1,"delivery");
    const response=await auth.handler(new Request(deliveries.at(-1)!.url)),cookie=response.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    const proof=await auth.api.getSession({headers:new Headers({cookie}),query:{disableRefresh:true,disableCookieCache:true}});ensure(proof,"cookie-session");
    return {cookie,userId:proof.user.id,sessionId:proof.session.id};
  }
  async function issue(cookie:string){
    const verifier=randomBytes(48).toString("base64url"),query=new URLSearchParams({client_id:clientId,redirect_uri:CALLBACK,response_type:"code",scope:"portal:read",resource:RESOURCE,
      code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",state:"synthetic-verifier-state"});
    let response=await request("/oauth2/authorize",undefined,cookie,query.toString()),redirect=await location(response);ensure(redirect,"authorization");
    if(new URL(redirect,ORIGIN).pathname==="/consent"){response=await request("/oauth2/consent",{accept:true,oauth_query:new URL(redirect,ORIGIN).search.slice(1)},cookie);redirect=await location(response);ensure(redirect,"consent");}
    ensure(new URL(redirect).origin===new URL(CALLBACK).origin&&new URL(redirect).pathname===new URL(CALLBACK).pathname,"callback");
    const code=new URL(redirect).searchParams.get("code");ensure(code,"code");
    response=await request("/oauth2/token",{grant_type:"authorization_code",client_id:clientId,code,redirect_uri:CALLBACK,code_verifier:verifier,resource:RESOURCE});
    const body=await response.json() as Record<string,unknown>;ensure(response.status===200&&typeof body.access_token==="string"&&!body.refresh_token,"exchange");return body.access_token;
  }
  // The fixed verifier policy needs its client ID before auth construction.
  // Tests seed an explicit synthetic preregistered row; registration API behavior
  // is covered separately by the actual-library storage suite, not claimed here.
  const client={id:randomUUID(),clientId,redirectUris:[CALLBACK],tokenEndpointAuthMethod:"none",requirePKCE:true,applicationType:"web",subjectType:"public",
    responseTypes:["code"],grantTypes:["authorization_code"],scopes:["portal:read"],skipConsent:false,disabled:false};
  const link={id:randomUUID(),clientId,resourceId:RESOURCE};
  return {auth,provider,policy,boundary,verify,request,session,issue,client,link,clientId,reference};
}
