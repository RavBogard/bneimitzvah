import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fixed nonsecret deployment/store identity. Never accept a provider endpoint.
export const PRIVATE_MEDIA_PROBE = Object.freeze({
  projectId:"prj_LaqPZuHk6W5XLlDpw29lUyyij3Sq", projectName:"bneimitzvah",
  teamId:"team_AyFDvnGV3IHjAY32PlW1tltN", teamSlug:"ravbogards-projects",
  storeId:"store_UOU7eX3fTuUHAs7G", sdkVersion:"2.8.2", timeoutMs:10000,
});
const flagPrefix="PRIVATE_MEDIA_OIDC_PROBE_";
const flags=["MODE","STORE_ID","RUN_ID"].map(name=>flagPrefix+name);
const modes={"production-allow":"production","preview-deny":"preview","development-deny":"development"};
const overrides=["VERCEL_BLOB_API_URL","VERCEL_BLOB_API_VERSION_OVERRIDE","VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API"];
const need=value=>{if(!value)throw 0;};
function selection(env){
  const supplied=Object.keys(env).filter(key=>key.startsWith(flagPrefix));
  if(!supplied.length)return null;
  need(supplied.length===flags.length && supplied.every(key=>flags.includes(key)));
  const mode=env[flags[0]],store=env[flags[1]],run=env[flags[2]];
  need(Object.hasOwn(modes,mode) && store===PRIVATE_MEDIA_PROBE.storeId && typeof run==="string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(run));
  return {mode,environment:modes[mode],run};
}
function part(value){
  need(typeof value==="string" && /^[A-Za-z0-9_-]+$/.test(value));
  const bytes=Buffer.from(value,"base64url");need(bytes.toString("base64url")===value);
  const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  need(result && typeof result==="object" && !Array.isArray(result));return result;
}
/** Claim-shape diagnostics only; provider authentication, not this decoding,
 * supplies access evidence. No JWKS call or application authorization. */
function identity(env,selected,now){
  const token=env.VERCEL_OIDC_TOKEN;need(typeof token==="string" && token.length<=16384);
  const pieces=token.split(".");need(pieces.length===3 && /^[A-Za-z0-9_-]+$/.test(pieces[2]));
  const header=part(pieces[0]),claims=part(pieces[1]),p=PRIVATE_MEDIA_PROBE,time=Math.floor(now/1000);
  need(header.typ==="JWT" && header.alg==="RS256" && typeof header.kid==="string" && header.kid.length>0 && header.kid.length<=256);
  need(claims.owner===p.teamSlug && claims.owner_id===p.teamId && claims.project===p.projectName && claims.project_id===p.projectId
    && claims.environment===selected.environment && claims.sub===`owner:${p.teamSlug}:project:${p.projectName}:environment:${selected.environment}`
    && ["https://oidc.vercel.com",`https://oidc.vercel.com/${p.teamSlug}`].includes(claims.iss) && claims.aud===`https://vercel.com/${p.teamSlug}`
    && claims.custom_environment_id===undefined);
  need([claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger) && claims.iat>=0 && claims.nbf>=0 && claims.iat<=time && claims.nbf<=time
    && claims.exp>time+5 && claims.exp>claims.iat && claims.exp-claims.iat<=(selected.environment==="development"?43200:7200));
  need(env.VERCEL_ENV===selected.environment && (env.VERCEL_TARGET_ENV===undefined || env.VERCEL_TARGET_ENV===selected.environment));
  if(selected.environment!=="development")need(env.VERCEL==="1");
  if(env.VERCEL_PROJECT_ID!==undefined)need(env.VERCEL_PROJECT_ID===p.projectId);
  if(env.VERCEL_ORG_ID!==undefined)need(env.VERCEL_ORG_ID===p.teamId);
  return token;
}
async function loadSdk(){
  const metadata=JSON.parse(await readFile(new URL("../package.json",import.meta.resolve("@vercel/blob")),"utf8"));
  need(metadata.version===PRIVATE_MEDIA_PROBE.sdkVersion);return import("@vercel/blob");
}
function guardedEnvironment(env){
  for(const key of [...overrides,...overrides.map(name=>"NEXT_PUBLIC_"+name),"DEBUG","NEXT_PUBLIC_DEBUG","NODE_OPTIONS","NODE_EXTRA_CA_CERTS"])
    need(env[key]===undefined || env[key]==="");
  need(env.NODE_TLS_REJECT_UNAUTHORIZED!=="0");
  // This script is a separate prebuild process. Never restore static fallback.
  delete env.BLOB_READ_WRITE_TOKEN;delete process.env.BLOB_READ_WRITE_TOKEN;
  env.VERCEL_BLOB_RETRIES="0";process.env.VERCEL_BLOB_RETRIES="0";
}
const result=(mode,environmentMatch,outcome)=>Object.freeze({ok:outcome===(mode==="production-allow"?"allowed":"denied"),mode,environmentMatch,expectation:mode==="production-allow"?"allow":mode==="invalid"?"none":"deny",outcome});

/** No arguments or HTTP transport. Only root-controlled ephemeral environment
 * flags enable the one SDK list operation. Dependencies are for offline tests. */
export async function runPrivateMediaOidcProbe(env=process.env,dependencies={}){
  let selected,environmentMatch=false,timer,controller;
  try{
    selected=selection(env);if(!selected)return null;
    guardedEnvironment(env);
    const now=dependencies.now??Date.now,token=identity(env,selected,now());environmentMatch=true;
    const timeout=dependencies.timeoutMs??PRIVATE_MEDIA_PROBE.timeoutMs;
    need(Number.isSafeInteger(timeout) && timeout>0 && timeout<=PRIVATE_MEDIA_PROBE.timeoutMs);
    controller=new AbortController();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(0);},timeout);});
    const operation=(async()=>{
      const sdk=await(dependencies.loadSdk??loadSdk)();need(!controller.signal.aborted);
      let outcome;
      try{
        const response=await sdk.list({oidcToken:token,storeId:PRIVATE_MEDIA_PROBE.storeId,limit:1,prefix:`acceptance/${selected.run}/`,abortSignal:controller.signal});
        need(response && Array.isArray(response.blobs) && response.blobs.length<=1 && typeof response.hasMore==="boolean"
          && (response.cursor===undefined || typeof response.cursor==="string"));outcome="allowed";
      }catch(error){
        // 2.8.2 maps the actual provider oidc_environment_not_allowed code to
        // this private class. It is not a public export: pin both base and
        // prototype name, never match provider-controlled message text.
        need(error instanceof sdk.BlobError && Object.getPrototypeOf(error)?.constructor?.name==="BlobOidcEnvironmentNotAllowedError");
        outcome="denied";
      }
      need(!controller.signal.aborted && identity(env,selected,now())===token);
      return result(selected.mode,true,outcome);
    })();
    return await Promise.race([operation,deadline]);
  }catch{return result(selected?.mode??"invalid",environmentMatch,"failed");}
  finally{clearTimeout(timer);controller?.abort();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const value=process.argv.length===2?await runPrivateMediaOidcProbe():result("invalid",false,"failed");
  if(value){process.stdout.write(`${JSON.stringify(value)}\n`);process.exitCode=value.ok?0:1;}
}
