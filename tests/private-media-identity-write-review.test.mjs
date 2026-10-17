import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {isolatedEnv} from './helpers/isolatedEnv.mjs';
import {PRIVATE_MEDIA_IDENTITY_WRITE_PROBE as P,runPrivateMediaIdentityWriteProbe as probe,runPrivateMediaSingleWriteProbe as writer,singleWriteBody} from '../scripts/private-media-single-write-probe.mjs';
import {PRIVATE_MEDIA_PROBE as I} from '../scripts/private-media-oidc-probe.mjs';
const run='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),origin=new URL(`https://${I.storeId.slice(6)}.private.blob.vercel-storage.com`).origin;
const blocked=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function environment(){const seconds=Math.floor(Date.now()/1000);return {PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run,
  VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:I.projectId,VERCEL_ORG_ID:I.teamId,VERCEL_OIDC_TOKEN:`${encode({typ:'JWT',alg:'RS256',kid:'independent-identity'})}.${encode({owner:I.teamSlug,owner_id:I.teamId,project:I.projectName,project_id:I.projectId,environment:'production',sub:`owner:${I.teamSlug}:project:${I.projectName}:environment:production`,iss:`https://oidc.vercel.com/${I.teamSlug}`,aud:`https://vercel.com/${I.teamSlug}`,iat:seconds-1,nbf:seconds-1,exp:seconds+600})}.${encode('synthetic')}`};}
function fixture(){
  const env=environment(),trace=[],hooks={},objects=new Map(),gets=[];let serial=0;
  class BlobPreconditionFailedError extends Error{}
  const info=(key,item)=>({pathname:key,url:`${origin}/${key}`,contentType:'application/octet-stream',etag:item.etag,size:item.bytes.length});
  const sdk={BlobPreconditionFailedError,
    list:async()=>{trace.push('list');return {blobs:[],hasMore:false};},
    put:async(key,bytes,o)=>{trace.push(`put:${bytes.length}`);const old=objects.get(key);if(o.ifMatch===undefined?old:old?.etag!==o.ifMatch)throw new BlobPreconditionFailedError();if(bytes.length===33)throw Error('fixture-stops-before-retirement');const item={bytes:Uint8Array.from(bytes),etag:`"review-${++serial}"`};objects.set(key,item);return info(key,item);},
    head:async key=>{trace.push('head');return info(key,objects.get(key));},
    issueSignedToken:async o=>{trace.push('grant');return {delegationToken:`${encode({storeId:P.storeId,pathname:o.pathname,operations:['get'],validUntil:o.validUntil})}.${encode('mac')}`,clientSigningToken:'a'.repeat(43),validUntil:o.validUntil};},
    presignUrl:async(g,o)=>({presignedUrl:`${origin}/${o.pathname}?cache=0&vercel-blob-delegation=${g.delegationToken}&vercel-blob-signature=${'b'.repeat(43)}`}),
  };
  const response=(url,{headers={},bytes,status=200}={})=>{const item=objects.get(url.pathname.slice(1)),value=new Response(bytes??item.bytes,{status,headers:{'content-length':String(item.bytes.length),'content-type':'application/octet-stream',etag:item.etag,...headers}});Object.defineProperty(value,'url',{value:url.href});return value;};
  const fetch=async(url,options)=>{trace.push('get');gets.push({url,options});return hooks.fetch?hooks.fetch(url,options,gets.length):response(url);};
  const dependencies={loadSdk:async()=>sdk,fetch,request:()=>{trace.push('raw-request');throw Error('unexpected-held-transport');}};
  return {env,sdk,hooks,trace,objects,gets,response,dependencies};
}
function closed(v){assert.deepEqual(Object.keys(v).sort(),['checks','evidence','ok','outcome','phase','race','requiresReconciliation','schema','writeAttempted']);assert.equal(v.schema,P.schema);assert.ok(P.phases.includes(v.phase));assert.equal(JSON.stringify(v).includes(run),false);}
function inert(url,{encoding,hasEncoding=false,cancel=()=>{}}={}){let reads=0;const headers=new Headers({'content-length':String(P.uploadBytes),'content-type':'application/octet-stream',etag:'"review-2"'});if(hasEncoding)headers.set('content-encoding',encoding);return {value:{url:String(url),status:200,redirected:false,headers,body:{getReader(){reads++;throw Error('must-not-read');},cancel}},reads:()=>reads};}

test('independent identity extension preserves the entire frozen source prefix and dispatches its own CLI refusal',async()=>{
  const isolated=await isolatedEnv();try{
    const current=(await readFile(new URL('../scripts/private-media-single-write-probe.mjs',import.meta.url),'utf8')).replace(/\r\n/g,'\n'),old=execFileSync('git',['show','92585f2ade456e240429966a5592918c5080089b:scripts/private-media-single-write-probe.mjs'],{env:isolated.env,encoding:'utf8'}).replace(/\r\n/g,'\n');
    const end=current.indexOf('export const PRIVATE_MEDIA_IDENTITY_WRITE_PROBE='),priorEnd=old.indexOf('if(process.argv[1]');assert.ok(end>0&&priorEnd>0);assert.equal(current.slice(0,end),old.slice(0,priorEnd));
    let output;try{execFileSync(process.execPath,['scripts/private-media-single-write-probe.mjs'],{env:{...isolated.env,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run},stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:5000});assert.fail();}catch(error){assert.equal(error.status,1);output=error.stdout;}const v=JSON.parse(output);closed(v);assert.equal(v.ok,false);assert.equal(v.writeAttempted,false);
  }finally{await isolated.cleanup();}
});

test('independent identity selection cannot borrow old/read modes or token access and cannot relax inherited timeout caps',async()=>{
  let tokenReads=0,loads=0;const dependencies={loadSdk:()=>{loads++;throw 0;}};assert.equal(await probe({},dependencies),null);
  for(const mode of ['single-write-v1','read-only-v1','single-write-identity-v2-extra']){const env={...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:mode};Object.defineProperty(env,'VERCEL_OIDC_TOKEN',{enumerable:true,get(){tokenReads++;throw 0;}});const v=await probe(env,dependencies);closed(v);assert.equal(v.phase,'selection');assert.equal(v.writeAttempted,false);}
  const direct=await writer(environment(),dependencies);assert.equal(direct.ok,false);assert.equal(direct.writeAttempted,false);assert.equal(direct.schema,'private-media-single-write/v1');
  for(const option of ['callTimeoutMs','bodyIdleMs','totalTimeoutMs']){const f=fixture(),v=await probe(f.env,{...f.dependencies,[option]:P[option]+1});closed(v);assert.equal(v.writeAttempted,false);assert.equal(f.trace.length,0);}
  assert.equal(tokenReads,0);assert.equal(loads,0);
});

test('independent late encoded or unencoded fetch responses are cancelled even when cancellation throws or never settles',async()=>{
  for(const hasEncoding of [false,true])for(const cancellation of ['throw','never']){
    const f=fixture();let release,cancels=0;f.hooks.fetch=()=>new Promise(resolve=>{release=resolve;});const v=await probe(f.env,{...f.dependencies,callTimeoutMs:40});closed(v);assert.equal(v.phase,'deadline');assert.equal(v.requiresReconciliation,true);const before=f.trace.slice(),snapshot=JSON.stringify(v),item=inert(`${origin}/ignored`,{hasEncoding,encoding:'gzip',cancel(){cancels++;if(cancellation==='throw')throw Error('private-error');return new Promise(()=>{});}});
    release(item.value);await new Promise(resolve=>setImmediate(resolve));assert.equal(cancels,1);assert.equal(item.reads(),0);assert.deepEqual(f.trace,before);assert.equal(JSON.stringify(v),snapshot);assert.equal(f.trace.includes('put:33'),false);assert.equal(f.trace.includes('raw-request'),false);
  }
});

test('independent all encoding headers are refused with exact original If-Match, no body access and no cleanup replay',async()=>{
  for(const encoding of ['', 'identity','GZIP','br, gzip']){const f=fixture();let cancels=0,item;f.hooks.fetch=(url,options)=>{assert.deepEqual(Object.keys(options.headers).sort(),['Accept-Encoding','If-Match']);assert.equal(options.headers['Accept-Encoding'],'identity');assert.equal(options.headers['If-Match'],'"review-2"');item=inert(url,{hasEncoding:true,encoding,cancel(){cancels++;return Promise.reject(0);}});return item.value;};const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(v.checks.ordinaryVerified,false);assert.equal(cancels,1);assert.equal(item.reads(),0);assert.equal(f.trace.includes('put:33'),false);assert.equal(f.gets.length,1);await new Promise(resolve=>setImmediate(resolve));}
});

test('independent strict inherited validators reject malformed lengths, oversized bytes, weak tags, MIME/status and same-length hash corruption',async()=>{
  const mutations=[r=>r.headers.delete('content-length'),r=>r.headers.set('content-length',String(P.uploadBytes+1)),r=>r.headers.set('content-length','1048576, 1048576'),r=>r.headers.set('etag','W/"review-2"'),r=>r.headers.set('etag','"other"'),r=>r.headers.set('content-type','application/octet-stream; charset=utf-8'),r=>Object.defineProperty(r,'status',{value:206})];
  for(const mutate of mutations){const f=fixture();f.hooks.fetch=url=>{const r=f.response(url);mutate(r);return r;};const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(v.checks.ordinaryVerified,false);assert.equal(f.trace.includes('put:33'),false);}
  for(const bytes of [new Uint8Array(P.uploadBytes),new Uint8Array(P.uploadBytes+1)]){const f=fixture();f.hooks.fetch=url=>f.response(url,{bytes});const v=await probe(f.env,f.dependencies);assert.equal(v.ok,false);assert.equal(v.checks.ordinaryVerified,false);assert.equal(f.trace.includes('put:33'),false);}
});

test('independent event-loop starvation and finite empty-byte bounds still close resources before later mutations',async()=>{
  for(const starvation of [true,false]){const f=fixture();let reads=0,cancels=0;f.hooks.fetch=url=>{const item=inert(url,{cancel(){cancels++;}});item.value.body.getReader=()=>({read(){reads++;if(starvation)blocked(25);return Promise.resolve({done:false,value:new Uint8Array(0)});},cancel(){cancels++;},releaseLock(){}});return item.value;};const v=await probe(f.env,{...f.dependencies,...starvation?{bodyIdleMs:5}:{}});assert.equal(v.ok,false);assert.ok(reads<=65);if(starvation){assert.equal(v.phase,'deadline');assert.equal(reads,1);}assert.ok(cancels>=1);assert.equal(f.trace.includes('put:33'),false);}
  const f=fixture();let cancel=0;f.hooks.fetch=url=>{blocked(30);return inert(url,{cancel(){cancel++;}}).value;};const v=await probe(f.env,{...f.dependencies,callTimeoutMs:5});assert.equal(v.ok,false);assert.equal(v.phase,'deadline');assert.equal(cancel,1);assert.equal(f.trace.includes('put:33'),false);
});

test('independent lazy authority guards see late overrides and EOF token expiry without touching hosted options or rewriting mode',async()=>{
  for(const failure of ['override','expiry']){const f=fixture(),nativeFetch=globalThis.fetch;let optionReads=0,clock=Date.now();Object.defineProperty(f.env,'NODE_OPTIONS',{enumerable:true,get(){optionReads++;throw Error('must-not-copy-options');}});
    f.hooks.fetch=url=>{if(failure==='override'){Object.defineProperty(f.env,'NEXT_PUBLIC_DEBUG',{enumerable:true,get(){return 'late';}});return f.response(url);}const r=f.response(url),reader=r.body.getReader();let complete=false;return {...r,url:r.url,status:r.status,redirected:r.redirected,headers:r.headers,body:{getReader(){return {async read(){const part=await reader.read();if(part.done&&!complete){complete=true;clock+=700000;}return part;},cancel:()=>reader.cancel(),releaseLock:()=>reader.releaseLock()};},cancel:()=>reader.cancel()}};};
    const v=await probe(f.env,{...f.dependencies,now:()=>clock});closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(f.trace.filter(x=>x==='list').length,1);assert.equal(f.trace.includes('put:33'),false);assert.equal(f.env.PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE,P.mode);assert.equal(optionReads,0);assert.equal(globalThis.fetch,nativeFetch);
  }
});

test('independent versioned result mapping preserves earned checks and every frozen failure field',async()=>{
  const execute=async identity=>{const f=fixture();if(!identity)f.env.PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE='single-write-v1';f.hooks.fetch=(url,options,index)=>{const r=f.response(url);if(index===2)r.headers.set('etag','"wrong-on-second-read"');if(identity)assert.equal(options.headers['Accept-Encoding'],'identity');else assert.equal(Object.hasOwn(options.headers,'Accept-Encoding'),false);return r;};return identity?probe(f.env,f.dependencies):writer(f.env,f.dependencies);};
  const original=await execute(false),versioned=await execute(true);closed(versioned);assert.equal(original.checks.ordinaryVerified,true);assert.equal(versioned.checks.ordinaryVerified,true);assert.equal(versioned.checks.staleDenied,false);assert.deepEqual(versioned,{...original,schema:P.schema});assert.equal(versioned.requiresReconciliation,true);
});
