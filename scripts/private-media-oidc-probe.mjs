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
const identityChecks=Object.freeze(["token-presence","token-encoding","header-type","header-algorithm","header-key","owner-name","owner-id","project-name","project-id",
  "environment","custom-environment","subject","issuer","audience","timestamp-types","issued-at","not-before","expiry-freshness","expiry-order","lifetime",
  "native-environment","native-target","native-hosted","native-project","native-org"]);
export const PRIVATE_MEDIA_DIAGNOSTIC_CHECKS=Object.freeze({
  selection:Object.freeze(["flag-set","mode","store","run"]),
  "environment-guard":Object.freeze(["endpoint-override","version-override","proxy-override","debug","node-options","custom-ca","insecure-tls"]),
  identity:identityChecks,
  "sdk-import":Object.freeze(["deadline-options","pinned-package","import","not-aborted"]),
  "sdk-request":Object.freeze(["request","response-shape","provider-result"]),
  "post-identity":Object.freeze(["not-aborted",...identityChecks,"token-stable"]),
  deadline:Object.freeze(["sdk-import","sdk-request"]),
});
const diagnostic=(phase,check)=>Object.freeze({schema:"private-media-oidc-diagnostic/v1",phase,check});
function selection(env,at){
  at("selection","flag-set");
  const supplied=Object.keys(env).filter(key=>key.startsWith(flagPrefix));
  if(!supplied.length)return null;
  need(supplied.length===flags.length && supplied.every(key=>flags.includes(key)));
  const mode=env[flags[0]],store=env[flags[1]],run=env[flags[2]];
  at("selection","mode");need(Object.hasOwn(modes,mode));
  at("selection","store");need(store===PRIVATE_MEDIA_PROBE.storeId);
  at("selection","run");need(typeof run==="string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(run));
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
function identity(env,selected,now,at,phase="identity"){
  at(phase,"token-presence");
  const token=env.VERCEL_OIDC_TOKEN;need(typeof token==="string" && token.length<=16384);
  at(phase,"token-encoding");
  const pieces=token.split(".");need(pieces.length===3 && /^[A-Za-z0-9_-]+$/.test(pieces[2]));
  const header=part(pieces[0]),claims=part(pieces[1]),p=PRIVATE_MEDIA_PROBE,time=Math.floor(now/1000);
  at(phase,"header-type");need(header.typ==="JWT");
  at(phase,"header-algorithm");need(header.alg==="RS256");
  at(phase,"header-key");need(typeof header.kid==="string" && header.kid.length>0 && header.kid.length<=256);
  at(phase,"owner-name");need(claims.owner===p.teamSlug);
  at(phase,"owner-id");need(claims.owner_id===p.teamId);
  at(phase,"project-name");need(claims.project===p.projectName);
  at(phase,"project-id");need(claims.project_id===p.projectId);
  at(phase,"environment");need(claims.environment===selected.environment);
  at(phase,"subject");need(claims.sub===`owner:${p.teamSlug}:project:${p.projectName}:environment:${selected.environment}`);
  at(phase,"issuer");need(["https://oidc.vercel.com",`https://oidc.vercel.com/${p.teamSlug}`].includes(claims.iss));
  at(phase,"audience");need(claims.aud===`https://vercel.com/${p.teamSlug}`);
  at(phase,"custom-environment");need(claims.custom_environment_id===undefined);
  at(phase,"timestamp-types");need([claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger));
  at(phase,"issued-at");need(claims.iat>=0);
  at(phase,"not-before");need(claims.nbf>=0);
  at(phase,"issued-at");need(claims.iat<=time);
  at(phase,"not-before");need(claims.nbf<=time);
  at(phase,"expiry-freshness");need(claims.exp>time+5);
  at(phase,"expiry-order");need(claims.exp>claims.iat);
  at(phase,"lifetime");need(claims.exp-claims.iat<=(selected.environment==="development"?43200:7200));
  at(phase,"native-environment");need(env.VERCEL_ENV===selected.environment);
  at(phase,"native-target");need(env.VERCEL_TARGET_ENV===undefined || env.VERCEL_TARGET_ENV===selected.environment);
  at(phase,"native-hosted");if(selected.environment!=="development")need(env.VERCEL==="1");
  at(phase,"native-project");if(env.VERCEL_PROJECT_ID!==undefined)need(env.VERCEL_PROJECT_ID===p.projectId);
  at(phase,"native-org");if(env.VERCEL_ORG_ID!==undefined)need(env.VERCEL_ORG_ID===p.teamId);
  return token;
}
async function loadSdk(at){
  at("sdk-import","pinned-package");
  const metadata=JSON.parse(await readFile(new URL("../package.json",import.meta.resolve("@vercel/blob")),"utf8"));
  need(metadata.version===PRIVATE_MEDIA_PROBE.sdkVersion);at("sdk-import","import");return import("@vercel/blob");
}
function guardedEnvironment(env,at){
  const checks=["endpoint-override","version-override","proxy-override"];
  for(const [index,key] of [...overrides,...overrides.map(name=>"NEXT_PUBLIC_"+name),"DEBUG","NEXT_PUBLIC_DEBUG","NODE_EXTRA_CA_CERTS"].entries()){
    at("environment-guard",index<6?checks[index%3]:["debug","debug","custom-ca"][index-6]);
    need(env[key]===undefined || env[key]==="");
  }
  at("environment-guard","insecure-tls");need(env.NODE_TLS_REJECT_UNAUTHORIZED!=="0");
  // This script is a separate prebuild process. Never restore static fallback.
  delete env.BLOB_READ_WRITE_TOKEN;delete process.env.BLOB_READ_WRITE_TOKEN;
  env.VERCEL_BLOB_RETRIES="0";process.env.VERCEL_BLOB_RETRIES="0";
}
const result=(mode,environmentMatch,outcome)=>Object.freeze({ok:outcome===(mode==="production-allow"?"allowed":"denied"),mode,environmentMatch,expectation:mode==="production-allow"?"allow":mode==="invalid"?"none":"deny",outcome});

/** No arguments or HTTP transport. Only root-controlled ephemeral environment
 * flags enable the one SDK list operation. Dependencies are for offline tests. */
export async function runPrivateMediaOidcProbe(env=process.env,dependencies={}){
  let selected,environmentMatch=false,timer,controller,finished=false,timeoutDiagnostic;
  let current=diagnostic("selection","flag-set");
  const at=(phase,check)=>{
    if(!finished && typeof phase==="string" && typeof check==="string" && Object.hasOwn(PRIVATE_MEDIA_DIAGNOSTIC_CHECKS,phase)
      && PRIVATE_MEDIA_DIAGNOSTIC_CHECKS[phase].includes(check))current=diagnostic(phase,check);
  };
  try{
    selected=selection(env,at);if(!selected)return null;
    guardedEnvironment(env,at);
    const now=dependencies.now??Date.now,token=identity(env,selected,now(),at);
    // Native Production/Preview reached here only after the full matching,
    // fresh profile (including VERCEL=1). Startup hooks already ran: this is
    // explicit hosted-runtime trust, not proof that options are harmless.
    // The root operator separately binds exact native deployment/source.
    if(selected.environment==="development"){
      at("environment-guard","node-options");need(env.NODE_OPTIONS===undefined || env.NODE_OPTIONS==="");
    }
    environmentMatch=true;
    at("sdk-import","deadline-options");
    const timeout=dependencies.timeoutMs??PRIVATE_MEDIA_PROBE.timeoutMs;
    need(Number.isSafeInteger(timeout) && timeout>0 && timeout<=PRIVATE_MEDIA_PROBE.timeoutMs);
    controller=new AbortController();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
      // Snapshot before abort synchronously invokes any SDK listeners. Late
      // import/request completion cannot replace this failure classification.
      timeoutDiagnostic=diagnostic("deadline",current.phase==="sdk-import"?"sdk-import":"sdk-request");
      controller.abort();reject(0);
    },timeout);});
    const operation=(async()=>{
      at("sdk-import","import");
      const sdk=await(dependencies.loadSdk??loadSdk)(at);at("sdk-import","not-aborted");need(!controller.signal.aborted);
      let outcome,received=false;
      try{
        at("sdk-request","request");
        const response=await sdk.list({oidcToken:token,storeId:PRIVATE_MEDIA_PROBE.storeId,limit:1,prefix:`acceptance/${selected.run}/`,abortSignal:controller.signal});
        received=true;at("sdk-request","response-shape");
        need(response && Array.isArray(response.blobs) && response.blobs.length<=1 && typeof response.hasMore==="boolean"
          && (response.cursor===undefined || typeof response.cursor==="string"));outcome="allowed";
      }catch(error){
        if(!received)at("sdk-request","provider-result");
        // 2.8.2 maps the actual provider oidc_environment_not_allowed code to
        // this private class. It is not a public export: pin both base and
        // prototype name, never match provider-controlled message text.
        need(error instanceof sdk.BlobError && Object.getPrototypeOf(error)?.constructor?.name==="BlobOidcEnvironmentNotAllowedError");
        outcome="denied";
      }
      at("post-identity","not-aborted");need(!controller.signal.aborted);
      const after=identity(env,selected,now(),at,"post-identity");
      at("post-identity","token-stable");need(after===token);
      return result(selected.mode,true,outcome);
    })();
    return await Promise.race([operation,deadline]);
  }catch{
    finished=true;
    // Only literal labels cross this seam. No caught object, claim, environment
    // value or stack trace is inspected for diagnostic output.
    try{dependencies.onDiagnostic?.(timeoutDiagnostic??current);}catch{}
    return result(selected?.mode??"invalid",environmentMatch,"failed");
  }
  finally{finished=true;clearTimeout(timer);controller?.abort();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let failure;
  const value=process.argv.length===2?await runPrivateMediaOidcProbe(process.env,{onDiagnostic:record=>{failure=record;}}):result("invalid",false,"failed");
  if(value){process.stdout.write(`${JSON.stringify(value)}\n`);if(failure)process.stdout.write(`${JSON.stringify(failure)}\n`);process.exitCode=value.ok?0:1;}
}
