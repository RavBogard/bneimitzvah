import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { PRIVATE_MEDIA_PROBE as P, PRIVATE_MEDIA_DIAGNOSTIC_CHECKS, runPrivateMediaOidcProbe as probe } from "../scripts/private-media-oidc-probe.mjs";

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
async function diagnosed(env,deps=dependencies(allowed)){
  const records=[];
  const value=await probe(env,{...deps,onDiagnostic:record=>records.push(record)});
  return {value,records};
}
function failure(actual,phase,check){
  assert.equal(actual.value.outcome,"failed");closed(actual.value);
  assert.deepEqual(actual.records,[{schema:"private-media-oidc-diagnostic/v1",phase,check}]);
  assert.ok(PRIVATE_MEDIA_DIAGNOSTIC_CHECKS[phase].includes(check));
  assert.ok(Object.isFrozen(actual.records[0]));
  assert.ok(!JSON.stringify(actual.records).includes("synthetic-sensitive"));
}

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
    assert.equal(pkg.scripts.prebuild,"node scripts/private-media-oidc-probe.mjs && node scripts/private-media-object-probe.mjs");
    assert.equal(pkg.scripts.build,"next build");
  }finally{await isolated.cleanup();}
});

test("CLI enabled failure preserves the exact main result and emits one closed literal diagnostic afterward",async()=>{
  const isolated=await isolatedEnv({...environment(),VERCEL_OIDC_TOKEN:"synthetic-sensitive-malformed"});
  try{
    const child=spawnSync(process.execPath,["scripts/private-media-oidc-probe.mjs"],{env:isolated.env,encoding:"utf8"});
    assert.equal(child.status,1);assert.equal(child.stderr,"");
    const records=child.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    assert.equal(records.length,2);
    assert.deepEqual(records[0],{ok:false,mode:"production-allow",environmentMatch:false,expectation:"allow",outcome:"failed"});
    assert.deepEqual(records[1],{schema:"private-media-oidc-diagnostic/v1",phase:"identity",check:"token-encoding"});
    assert.ok(!child.stdout.includes("synthetic-sensitive"));
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
    const value=await probe({...environment(name==="NODE_OPTIONS"?"development-deny":"production-allow"),[name]:name==="NODE_TLS_REJECT_UNAUTHORIZED"?"0":"synthetic-sensitive"},
      {loadSdk:async()=>{loads++;throw 0;}});
    assert.equal(value.ok,false);assert.equal(loads,0);closed(value);
  }
});

test("both fully validated native profiles may reach one SDK request without inspecting inherited startup options",async()=>{
  for(const mode of ["production-allow","preview-deny"])for(const opaque of [false,true]){
    const env={...environment(mode),NODE_OPTIONS:"synthetic-sensitive-inherited-startup"};
    let reads=0,imports=0,calls=0;
    if(opaque)Object.defineProperty(env,"NODE_OPTIONS",{get(){reads++;throw Error("synthetic-sensitive-options-must-not-be-inspected");}});
    const deps=dependencies(async options=>{
      calls++;assert.equal(options.oidcToken,env.VERCEL_OIDC_TOKEN);assert.equal(options.storeId,P.storeId);
      return mode==="production-allow"?allowed():denied();
    });
    const load=deps.loadSdk;deps.loadSdk=async()=>{imports++;return load();};
    const actual=await diagnosed(env,deps);
    assert.equal(actual.value.ok,true);assert.equal(actual.value.environmentMatch,true);assert.deepEqual(actual.records,[]);
    assert.equal(imports,1);assert.equal(calls,1);assert.equal(reads,0);assert.ok(Object.hasOwn(env,"NODE_OPTIONS"));closed(actual.value);
  }
});

test("startup exception never authorizes labels alone, invalid identity or Development SDK work",async()=>{
  for(const env of [
    {...environment(),VERCEL_OIDC_TOKEN:undefined},
    {...environment(),VERCEL_OIDC_TOKEN:"synthetic-sensitive-not-a-token"},
    environment("production-allow",{owner_id:"other"}),
    environment("preview-deny",{project_id:"other"}),
    environment("production-allow",{exp:now/1000}),
    {...environment(),VERCEL:undefined},
    {...environment("preview-deny"),VERCEL_ENV:"production"},
  ]){
    let imports=0,calls=0;
    const actual=await diagnosed({...env,NODE_OPTIONS:"synthetic-sensitive"},{now:()=>now,loadSdk:async()=>{imports++;return {BlobError,list:async()=>{calls++;return allowed();}};}});
    assert.equal(actual.value.ok,false);assert.equal(actual.value.environmentMatch,false);assert.equal(imports,0);assert.equal(calls,0);
    assert.equal(actual.records.length,1);assert.equal(actual.records[0].phase,"identity");closed(actual.value);
  }
  let calls=0;
  failure(await diagnosed({...environment("development-deny"),NODE_OPTIONS:"synthetic-sensitive"},dependencies(async()=>{calls++;return denied();})),"environment-guard","node-options");
  assert.equal(calls,0);
  for(const NODE_OPTIONS of [undefined,""]){
    const actual=await diagnosed({...environment("development-deny"),NODE_OPTIONS},dependencies(async()=>{calls++;return denied();}));
    assert.equal(actual.value.ok,true);assert.deepEqual(actual.records,[]);
  }
  assert.equal(calls,2);
});

test("every other environment guard remains strict for native profiles with inherited startup options",async()=>{
  const names=["VERCEL_BLOB_API_URL","VERCEL_BLOB_API_VERSION_OVERRIDE","VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API"];
  for(const mode of ["production-allow","preview-deny"])for(const name of [...names,...names.map(key=>`NEXT_PUBLIC_${key}`),"DEBUG","NEXT_PUBLIC_DEBUG","NODE_EXTRA_CA_CERTS","NODE_TLS_REJECT_UNAUTHORIZED"]){
    let imports=0;
    const actual=await diagnosed({...environment(mode),NODE_OPTIONS:"synthetic-sensitive-inherited",[name]:name==="NODE_TLS_REJECT_UNAUTHORIZED"?"0":"synthetic-sensitive-other"},
      {now:()=>now,loadSdk:async()=>{imports++;throw 0;}});
    assert.equal(actual.value.ok,false);assert.equal(imports,0);assert.equal(actual.records[0].phase,"environment-guard");
    assert.notEqual(actual.records[0].check,"node-options");closed(actual.value);
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
      const {value,records}=await diagnosed({...environment("preview-deny"),NODE_OPTIONS:"synthetic-sensitive-inherited"},{now:()=>now});
      assert.equal(value.outcome,expected);assert.equal(value.ok,expected==="denied");assert.equal(calls,1);closed(value);
      assert.deepEqual(records,expected==="failed"?[{schema:"private-media-oidc-diagnostic/v1",phase:"sdk-request",check:"provider-result"}]:[]);
      agent.assertNoPendingInterceptors();
    }
  }finally{setGlobalDispatcher(previous);await agent.close();}
});

test("selection and environment diagnostic labels identify fixed checks without reflecting flags or values",async()=>{
  for(const [changed,check] of [
    [{PRIVATE_MEDIA_OIDC_PROBE_EXTRA:"synthetic-sensitive"},"flag-set"],
    [{PRIVATE_MEDIA_OIDC_PROBE_MODE:"synthetic-sensitive"},"mode"],
    [{PRIVATE_MEDIA_OIDC_PROBE_STORE_ID:"synthetic-sensitive"},"store"],
    [{PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:"synthetic-sensitive"},"run"],
  ])failure(await diagnosed({...environment(),...changed}),"selection",check);
  for(const [name,check] of [
    ["VERCEL_BLOB_API_URL","endpoint-override"],["NEXT_PUBLIC_VERCEL_BLOB_API_URL","endpoint-override"],
    ["VERCEL_BLOB_API_VERSION_OVERRIDE","version-override"],["NEXT_PUBLIC_VERCEL_BLOB_API_VERSION_OVERRIDE","version-override"],
    ["VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API","proxy-override"],["NEXT_PUBLIC_VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API","proxy-override"],
    ["DEBUG","debug"],["NEXT_PUBLIC_DEBUG","debug"],["NODE_OPTIONS","node-options"],["NODE_EXTRA_CA_CERTS","custom-ca"],["NODE_TLS_REJECT_UNAUTHORIZED","insecure-tls"],
  ])failure(await diagnosed({...environment(name==="NODE_OPTIONS"?"development-deny":"production-allow"),[name]:name==="NODE_TLS_REJECT_UNAUTHORIZED"?"0":"synthetic-sensitive"}),"environment-guard",check);
});

test("identity diagnostics distinguish each claim family without returning claim data",async()=>{
  failure(await diagnosed({...environment(),VERCEL_OIDC_TOKEN:undefined}),"identity","token-presence");
  failure(await diagnosed({...environment(),VERCEL_OIDC_TOKEN:"synthetic-sensitive"}),"identity","token-encoding");
  const env=environment(),parts=env.VERCEL_OIDC_TOKEN.split(".");parts[0]=encode({typ:"JWT",alg:"HS256",kid:"synthetic-sensitive"});
  failure(await diagnosed({...env,VERCEL_OIDC_TOKEN:parts.join(".")}),"identity","header-algorithm");
  for(const [claims,check] of [
    [{owner:"synthetic-sensitive"},"owner-name"],[{owner_id:"synthetic-sensitive"},"owner-id"],
    [{project:"synthetic-sensitive"},"project-name"],[{project_id:"synthetic-sensitive"},"project-id"],
    [{environment:"synthetic-sensitive"},"environment"],[{custom_environment_id:"synthetic-sensitive"},"custom-environment"],
    [{sub:"synthetic-sensitive"},"subject"],[{iss:"synthetic-sensitive"},"issuer"],[{aud:"synthetic-sensitive"},"audience"],
    [{exp:"synthetic-sensitive"},"timestamp-types"],[{iat:undefined},"timestamp-types"],
    [{iat:now/1000+1},"issued-at"],[{nbf:now/1000+1},"not-before"],
    [{exp:now/1000},"expiry-freshness"],[{exp:now/1000+8000},"lifetime"],
  ])failure(await diagnosed(environment("production-allow",claims)),"identity",check);
  for(const [header,check] of [[{typ:"synthetic-sensitive",alg:"RS256",kid:"fixture"},"header-type"],[{typ:"JWT",alg:"RS256",kid:""},"header-key"]]){
    const pieces=environment().VERCEL_OIDC_TOKEN.split(".");pieces[0]=encode(header);
    failure(await diagnosed({...environment(),VERCEL_OIDC_TOKEN:pieces.join(".")}),"identity",check);
  }
  for(const [changed,check] of [[{VERCEL_ENV:"synthetic-sensitive"},"native-environment"],[{VERCEL_TARGET_ENV:"synthetic-sensitive"},"native-target"],
    [{VERCEL:undefined},"native-hosted"],[{VERCEL_PROJECT_ID:"synthetic-sensitive"},"native-project"],[{VERCEL_ORG_ID:"synthetic-sensitive"},"native-org"]]){
    failure(await diagnosed({...environment(),...changed}),"identity",check);
  }
});

test("disabled, positive and recognized-denial outcomes have no diagnostic, including unexpected access",async()=>{
  assert.deepEqual(await diagnosed({}),{value:null,records:[]});
  for(const mode of ["production-allow","preview-deny","development-deny"]){
    for(const list of [allowed,denied]){
      const actual=await diagnosed(environment(mode),dependencies(list));
      assert.equal(actual.records.length,0);closed(actual.value);
    }
  }
});

test("SDK and post-await diagnostics retain existing failures and never inspect hostile error text",async()=>{
  const bad=()=>{throw new Proxy({}, {get(){throw Error("synthetic-sensitive");},getPrototypeOf(){throw Error("synthetic-sensitive");}});};
  failure(await diagnosed(environment(),{now:()=>now,loadSdk:bad}),"sdk-import","import");
  failure(await diagnosed(environment(),{now:()=>now,loadSdk:at=>{at("synthetic-sensitive","synthetic-sensitive");throw 0;}}),"sdk-import","import");
  failure(await diagnosed(environment(),{...dependencies(allowed),timeoutMs:10001}),"sdk-import","deadline-options");
  failure(await diagnosed(environment(),dependencies(bad)),"sdk-request","provider-result");
  failure(await diagnosed(environment(),dependencies(async()=>({blobs:[],hasMore:"synthetic-sensitive"}))),"sdk-request","response-shape");
  for(const list of [allowed,denied]){
    let clock=now;
    failure(await diagnosed(environment(),{...dependencies(async()=>{clock=now+301000;return list();}),now:()=>clock}),"post-identity","expiry-freshness");
  }
  const env=environment();
  failure(await diagnosed(env,dependencies(async()=>{env.VERCEL_OIDC_TOKEN=environment("production-allow",{iat:now/1000-20}).VERCEL_OIDC_TOKEN;return allowed();})),"post-identity","token-stable");
});

test("deadline diagnostics snapshot the awaited stage once and ignore late import/request settlement",async()=>{
  let load,calls=0;const imported=[];
  const waiting=probe(environment(),{now:()=>now,timeoutMs:5,onDiagnostic:record=>imported.push(record),loadSdk:()=>new Promise(resolve=>{load=resolve;})});
  const first=await waiting;failure({value:first,records:imported},"deadline","sdk-import");
  load({BlobError,list:()=>{calls++;return allowed();}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,0);failure({value:first,records:imported},"deadline","sdk-import");
  let reject;const requested=[];
  const request=probe(environment(),{...dependencies(()=>new Promise((_,fail)=>{reject=fail;})),timeoutMs:5,onDiagnostic:record=>requested.push(record)});
  const second=await request;failure({value:second,records:requested},"deadline","sdk-request");
  reject(new BlobOidcEnvironmentNotAllowedError("synthetic-sensitive"));await new Promise(resolve=>setImmediate(resolve));
  failure({value:second,records:requested},"deadline","sdk-request");
});
