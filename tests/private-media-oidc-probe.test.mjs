import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { PRIVATE_MEDIA_PROBE as P, runPrivateMediaOidcProbe as probe } from "../scripts/private-media-oidc-probe.mjs";

const now=Date.UTC(2026,9,17,12), run="12345678-1234-4123-8123-123456789abc";
const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
function environment(mode="production-allow",changed={}){
  const environment={"production-allow":"production","preview-deny":"preview","development-deny":"development"}[mode];
  const claims={iss:`https://oidc.vercel.com/${P.teamSlug}`,aud:`https://vercel.com/${P.teamSlug}`,
    sub:`owner:${P.teamSlug}:project:${P.projectName}:environment:${environment}`,
    owner:P.teamSlug,owner_id:P.teamId,project:P.projectName,project_id:P.projectId,environment,
    iat:now/1000-10,nbf:now/1000-10,exp:now/1000+300,...changed};
  return {PRIVATE_MEDIA_OIDC_PROBE_MODE:mode,PRIVATE_MEDIA_OIDC_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:run,
    VERCEL:"1",VERCEL_ENV:environment,VERCEL_OIDC_TOKEN:`${encode({typ:"JWT",alg:"RS256",kid:"synthetic-probe-key"})}.${encode(claims)}.${encode("synthetic-signature")}`};
}
class BlobError extends Error {}
class BlobOidcEnvironmentNotAllowedError extends BlobError {}
const denied=()=>{throw new BlobOidcEnvironmentNotAllowedError("synthetic-sensitive-provider-message");};
const allowed=async()=>({blobs:[],hasMore:false});
const dependencies=list=>({now:()=>now,loadSdk:async()=>({BlobError,list})});
const closed=value=>{
  assert.deepEqual(Object.keys(value).sort(),["environmentMatch","expectation","mode","ok","outcome"]);
  assert.ok(!JSON.stringify(value).includes("synthetic-sensitive"));
};

test("default prebuild is silent and has no SDK loading, even with ambient provider configuration",async()=>{
  let loads=0;
  assert.equal(await probe({BLOB_READ_WRITE_TOKEN:"unused",VERCEL_BLOB_API_URL:"https://invalid.example"},
    {loadSdk:async()=>{loads++;throw 0;}}),null);
  assert.equal(loads,0);
  const isolated=await isolatedEnv();
  try{
    assert.equal(execFileSync(process.execPath,["scripts/private-media-oidc-probe.mjs"],{env:isolated.env,encoding:"utf8"}),"");
    const guarded=`import { registerHooks } from 'node:module';
      registerHooks({resolve(name,context,next){if(name.startsWith('@vercel/') || name==='undici')throw Error('SDK import forbidden');return next(name,context);}});
      globalThis.fetch=()=>{throw Error('network forbidden');};
      const {runPrivateMediaOidcProbe}=await import('./scripts/private-media-oidc-probe.mjs');
      if(await runPrivateMediaOidcProbe()!==null)throw Error('not disabled');`;
    assert.equal(execFileSync(process.execPath,["--input-type=module","-e",guarded],{env:isolated.env,encoding:"utf8"}),"");
    const invalid=spawnSync(process.execPath,["scripts/private-media-oidc-probe.mjs","synthetic-sensitive-argument"],{env:isolated.env,encoding:"utf8"});
    assert.equal(invalid.status,1);assert.equal(invalid.stderr,"");
    assert.deepEqual(JSON.parse(invalid.stdout),{ok:false,mode:"invalid",environmentMatch:false,expectation:"none",outcome:"failed"});
    const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
    assert.equal(pkg.dependencies["@vercel/blob"],"2.8.2");
    assert.equal(pkg.scripts.prebuild,"node scripts/private-media-oidc-probe.mjs");
    assert.equal(pkg.scripts.build,"next build");
  }finally{await isolated.cleanup();}
});

test("closed selection rejects partial/unknown flags, wrong stores and noncanonical runs before SDK loading",async()=>{
  const good=environment();
  for(const change of [
    {PRIVATE_MEDIA_OIDC_PROBE_MODE:"preview"},{PRIVATE_MEDIA_OIDC_PROBE_STORE_ID:"store_other"},
    {PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:"../synthetic-sensitive"},{PRIVATE_MEDIA_OIDC_PROBE_EXTRA:"1"},
  ]){
    let loads=0;
    const value=await probe({...good,...change},{loadSdk:async()=>{loads++;throw 0;}});
    assert.equal(value.ok,false);closed(value);assert.equal(loads,0);
  }
  const partial={...good};delete partial.PRIVATE_MEDIA_OIDC_PROBE_RUN_ID;
  assert.equal((await probe(partial)).ok,false);
});

test("native identity diagnostics reject wrong claims, stale/future tokens and environment labels before I/O",async()=>{
  for(const claims of [
    {owner:"other"},{owner_id:"team_other"},{project_id:"prj_other"},{project:"other"},
    {environment:"preview"},{sub:"other"},{aud:"other"},{iss:"https://invalid.example"},
    {custom_environment_id:"custom"},{exp:now/1000+5},{nbf:now/1000+1},{iat:now/1000+1},
    {exp:now/1000+8000},{exp:"synthetic-sensitive"},
  ]){
    let calls=0;
    const value=await probe(environment("production-allow",claims),dependencies(async()=>{calls++;return allowed();}));
    assert.equal(value.ok,false);assert.equal(value.environmentMatch,false);assert.equal(calls,0);closed(value);
  }
  for(const change of [{VERCEL:undefined},{VERCEL_ENV:"preview"},{VERCEL_TARGET_ENV:"preview"},
    {VERCEL_PROJECT_ID:"other"},{VERCEL_ORG_ID:"other"},{VERCEL_OIDC_TOKEN:"synthetic-sensitive-not-a-token"}]){
    assert.equal((await probe({...environment(),...change},dependencies(allowed))).ok,false);
  }
});

test("SDK endpoint/debug/TLS overrides fail closed before import, never route around provider identity",async()=>{
  const names=["VERCEL_BLOB_API_URL","VERCEL_BLOB_API_VERSION_OVERRIDE","VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API"];
  for(const name of [...names,...names.map(name=>`NEXT_PUBLIC_${name}`),"DEBUG","NEXT_PUBLIC_DEBUG","NODE_OPTIONS","NODE_EXTRA_CA_CERTS","NODE_TLS_REJECT_UNAUTHORIZED"]){
    let loads=0;
    const value=await probe({...environment(),[name]:name==="NODE_TLS_REJECT_UNAUTHORIZED"?"0":"synthetic-sensitive"},
      {loadSdk:async()=>{loads++;throw 0;}});
    assert.equal(value.ok,false);assert.equal(loads,0);closed(value);
  }
});

test("explicit OIDC/store only, one narrow metadata list, no static fallback or returned metadata",async()=>{
  const env={...environment(),BLOB_READ_WRITE_TOKEN:"unused",VERCEL_BLOB_RETRIES:"10"};
  let calls=0;
  const value=await probe(env,dependencies(async options=>{
    calls++;
    assert.deepEqual(Object.keys(options).sort(),["abortSignal","limit","oidcToken","prefix","storeId"]);
    assert.equal(options.oidcToken,env.VERCEL_OIDC_TOKEN);assert.equal(options.storeId,P.storeId);
    assert.equal(options.limit,1);assert.equal(options.prefix,`acceptance/${run}/`);
    assert.equal(env.BLOB_READ_WRITE_TOKEN,undefined);assert.equal(env.VERCEL_BLOB_RETRIES,"0");
    return {blobs:[{pathname:"synthetic-sensitive-path",url:"synthetic-sensitive-url"}],cursor:"synthetic-sensitive-cursor",hasMore:true};
  }));
  assert.equal(calls,1);assert.deepEqual(value,{ok:true,mode:"production-allow",environmentMatch:true,expectation:"allow",outcome:"allowed"});closed(value);
});

test("expectation is mode-bound; only the SDK-specific environment denial passes a negative",async()=>{
  for(const mode of ["production-allow","preview-deny","development-deny"]){
    for(const [list,outcome] of [[allowed,"allowed"],[denied,"denied"]]){
      const env=environment(mode,{iss:"https://oidc.vercel.com"});
      if(mode==="development-deny")delete env.VERCEL; // Local dev labels are not hosting proof.
      const value=await probe(env,dependencies(list));
      assert.equal(value.outcome,outcome);assert.equal(value.ok,mode==="production-allow"?outcome==="allowed":outcome==="denied");closed(value);
    }
  }
  for(const failure of [new BlobError("synthetic-sensitive-forbidden"),new Error("synthetic-sensitive-network"),
    {constructor:{name:"BlobOidcEnvironmentNotAllowedError"}},null]){
    const value=await probe(environment("preview-deny"),dependencies(async()=>{throw failure;}));
    assert.equal(value.ok,false);assert.equal(value.outcome,"failed");closed(value);
  }
});

test("freshness and token identity are rechecked after both success and recognized denial",async()=>{
  for(const outcome of [allowed,denied]){
    let clock=now;
    const deps=dependencies(async()=>{clock=now+301000;return outcome();});deps.now=()=>clock;
    const value=await probe(environment("preview-deny"),deps);
    assert.equal(value.ok,false);assert.equal(value.outcome,"failed");closed(value);
  }
  const env=environment();
  const value=await probe(env,dependencies(async()=>{env.VERCEL_OIDC_TOKEN=environment("production-allow",{iat:now/1000-20}).VERCEL_OIDC_TOKEN;return allowed();}));
  assert.equal(value.ok,false);
});

test("hostile exceptions and malformed metadata produce only the fixed redacted failure",async()=>{
  const hostile=new Proxy({}, {getPrototypeOf(){throw Error("synthetic-sensitive-prototype");},get(){throw Error("synthetic-sensitive-property");}});
  const message=new BlobError();Object.defineProperty(message,"message",{get(){throw Error("synthetic-sensitive-message");}});
  for(const list of [async()=>{throw hostile;},async()=>{throw message;},async()=>({blobs:[{},{}],hasMore:false}),
    async()=>({blobs:[],hasMore:"synthetic-sensitive"}),async()=>null]){
    const value=await probe(environment("preview-deny"),dependencies(list));
    assert.equal(value.ok,false);assert.equal(value.outcome,"failed");closed(value);
  }
});

test("bounded deadline aborts pending I/O and prevents a late SDK load from starting a request",async()=>{
  let signal;
  const value=await probe(environment(),{...dependencies(options=>{signal=options.abortSignal;return new Promise(()=>{});}),timeoutMs:5});
  assert.equal(value.outcome,"failed");assert.equal(signal.aborted,true);closed(value);
  let resolveLoad,calls=0;
  const pending=probe(environment(),{now:()=>now,timeoutMs:5,loadSdk:()=>new Promise(resolve=>{resolveLoad=resolve;})});
  assert.equal((await pending).ok,false);
  resolveLoad({BlobError,list:()=>{calls++;return allowed();}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
  for(const timeoutMs of [0,10001,Infinity,1.5])assert.equal((await probe(environment(),{...dependencies(allowed),timeoutMs})).ok,false);
});

test("actual pinned SDK maps specific provider denial, but generic 403/config/5xx never pass and never retry",async()=>{
  const previous=getGlobalDispatcher(),agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent);
  try{
    const pool=agent.get("https://vercel.com");
    for(const [status,body,expected] of [
      [403,{error:{code:"oidc_environment_not_allowed",message:"synthetic-sensitive-environment"}},"denied"],
      [403,{error:{code:"forbidden",message:"synthetic-sensitive-generic"}},"failed"],
      [404,{error:{code:"store_not_found"}},"failed"],
      [503,{error:{code:"unknown_error"}},"failed"],
      [200,{blobs:[],hasMore:false},"allowed"],
    ]){
      let calls=0;
      pool.intercept({method:"GET",path:path=>{
        const url=new URL(path,"https://vercel.com");
        return url.pathname==="/api/blob" && url.searchParams.get("limit")==="1" && url.searchParams.get("prefix")===`acceptance/${run}/`;
      }}).reply(()=>{calls++;return {statusCode:status,data:body,responseOptions:{headers:{"content-type":"application/json"}}};});
      const value=await probe(environment("preview-deny"),{now:()=>now});
      assert.equal(value.outcome,expected);assert.equal(value.ok,expected==="denied");assert.equal(calls,1);closed(value);
      agent.assertNoPendingInterceptors();
    }
  }finally{setGlobalDispatcher(previous);await agent.close();}
});
