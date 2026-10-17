import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {isolatedEnv} from './helpers/isolatedEnv.mjs';
import {PRIVATE_MEDIA_IDENTITY_WRITE_PROBE as P,runPrivateMediaIdentityWriteProbe as probe,runPrivateMediaSingleWriteProbe as writer,singleWriteBody} from '../scripts/private-media-single-write-probe.mjs';
import {PRIVATE_MEDIA_PROBE as I} from '../scripts/private-media-oidc-probe.mjs';
const run='55555555-5555-4555-8555-555555555555',encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),origin=`https://${P.storeId.slice(6)}.private.blob.vercel-storage.com`;
function environment(){const seconds=Math.floor(Date.now()/1000);return {PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run,
  VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:I.projectId,VERCEL_ORG_ID:I.teamId,VERCEL_OIDC_TOKEN:`${encode({typ:'JWT',alg:'RS256',kid:'synthetic-single'})}.${encode({iss:`https://oidc.vercel.com/${I.teamSlug}`,aud:`https://vercel.com/${I.teamSlug}`,owner:I.teamSlug,owner_id:I.teamId,project:I.projectName,project_id:I.projectId,environment:'production',sub:`owner:${I.teamSlug}:project:${I.projectName}:environment:production`,iat:seconds-1,nbf:seconds-1,exp:seconds+600})}.${encode('synthetic-signature')}`};}
class BlobPreconditionFailedError extends Error{}
function fixture({winner='retire',ack=true,adapterStatus,hook}={}){
  const env=environment(),trace=[],objects=new Map(),requests=[];let serial=0,pendingRetire;
  const info=(key,item)=>({url:`${origin}/${key}`,pathname:key,contentType:'application/octet-stream',etag:item.etag,size:item.bytes.length});
  const apply=(key,bytes,condition)=>{const old=objects.get(key);if(condition===undefined?!!old:old?.etag!==condition)throw new BlobPreconditionFailedError();const item={bytes:Uint8Array.from(bytes),etag:`"synthetic-${++serial}"`};objects.set(key,item);return info(key,item);};
  const sdk={BlobPreconditionFailedError,
    list:async()=>{trace.push('list');hook?.('list',env);return {blobs:[],hasMore:false};},
    put:async(key,body,options)=>{assert.equal(options.oidcToken,env.VERCEL_OIDC_TOKEN);assert.equal(options.storeId,P.storeId);assert.equal(options.multipart,false);assert.equal(options.access,'private');assert.equal(options.addRandomSuffix,false);assert.equal(options.contentType,'application/octet-stream');trace.push(`sdk-put:${body.length}`);hook?.('sdk-put',env);return apply(key,body,options.ifMatch);},
    head:async key=>{trace.push('head');return info(key,objects.get(key));},
    issueSignedToken:async options=>{trace.push('grant');return {delegationToken:`${encode({storeId:P.storeId,pathname:options.pathname,operations:['get'],validUntil:options.validUntil})}.${encode('signature')}`,clientSigningToken:'a'.repeat(43),validUntil:options.validUntil};},
    presignUrl:async(g,o)=>({presignedUrl:`${origin}/${o.pathname}?cache=0&vercel-blob-delegation=${g.delegationToken}&vercel-blob-signature=${'b'.repeat(43)}`}),
  };
  const fetch=async(url,options)=>{trace.push('fetch');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers['Accept-Encoding'],'identity');const key=new URL(url).pathname.slice(1),item=objects.get(key);assert.equal(options.headers['If-Match'],item.etag);hook?.('fetch',env);const response=new Response(item.bytes,{headers:{'content-length':String(item.bytes.length),'content-type':'application/octet-stream',etag:item.etag}});Object.defineProperty(response,'url',{value:url.href});return response;};
  const request=(options,respond)=>{
    assert.equal(options.hostname,'vercel.com');assert.equal(options.port,443);assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.headers.expect,'100-continue');
    const req=new EventEmitter(),socket=new EventEmitter(),parts=[];socket.encrypted=true;socket.authorized=true;let destroyed=false;
    req.flushHeaders=()=>{};req.destroy=()=>{destroyed=true;trace.push('destroy');};
    req.write=(part,cb)=>{parts.push(part);trace.push('u-prefix');queueMicrotask(cb);return true;};
    const send=()=>{if(destroyed)return;const body=Buffer.concat(parts),key=new URL(`https://vercel.com${options.path}`).searchParams.get('pathname');let status=200,value;
      try{value=apply(key,body,options.headers['x-if-match']);}catch{status=412;value={error:{code:'precondition_failed'}};}if(adapterStatus){status=adapterStatus;value={error:{code:'unknown'}};}
      const res=new EventEmitter();res.statusCode=status;res.complete=true;res.headers={};res.destroy=()=>{trace.push('response-destroy');};respond(res);queueMicrotask(()=>{res.emit('data',Buffer.from(JSON.stringify(value)));res.emit('end');});};
    req.end=(part,cb)=>{if(part)parts.push(part);trace.push(parts.reduce((n,b)=>n+b.length,0)===P.uploadBytes?'u-finish':'r-dispatch');cb?.();hook?.('dispatch',env);
      if(parts.reduce((n,b)=>n+b.length,0)===P.retireBytes&&winner==='upload')pendingRetire=send;
      else{send();if(pendingRetire){const waiting=pendingRetire;pendingRetire=undefined;waiting();}}};
    requests.push(req);queueMicrotask(()=>{req.emit('socket',socket);if(ack)req.emit('continue');socket.emit('secureConnect');});return req;
  };
  return {env,trace,objects,requests,sdk,dependencies:{loadSdk:async()=>sdk,fetch,request}};
}

function closed(v){assert.deepEqual(Object.keys(v).sort(),['checks','evidence','ok','outcome','phase','race','requiresReconciliation','schema','writeAttempted']);assert.equal(v.schema,P.schema);assert.ok(P.phases.includes(v.phase));assert.equal(JSON.stringify(v).includes('synthetic-'),false);}
function inertResponse(url,{encoding,hasEncoding=false,cancel=()=>{},urlValue=String(url)}={}){
 let reads=0;const headers=new Headers({'content-length':String(P.uploadBytes),'content-type':'application/octet-stream',etag:'"synthetic-2"'});if(hasEncoding)headers.set('content-encoding',encoding);
 return {value:{url:urlValue,status:200,redirected:false,headers,body:{getReader(){reads++;throw 0;},cancel}},reads:()=>reads};
}

test('identity selection is exact before token or dependency access and direct old writer refuses new mode',async()=>{
 let reads=0,loads=0;const deps={loadSdk:async()=>{loads++;throw 0;}};
 assert.equal(await probe({get VERCEL_OIDC_TOKEN(){reads++;throw 0;}},deps),null);
 for(const env of [{PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:'single-write-v1'},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:'read-only-v1'},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:'wrong'},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:'not-uuid'},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_EXTRA:'x'},{...environment(),PRIVATE_MEDIA_OIDC_PROBE_MODE:'production-allow'},{...environment(),PRIVATE_MEDIA_OBJECT_PROBE_RUN_ID:run}]){
  Object.defineProperty(env,'VERCEL_OIDC_TOKEN',{enumerable:true,get(){reads++;throw 0;}});const v=await probe(env,deps);closed(v);assert.equal(v.phase,'selection');assert.equal(v.writeAttempted,false);
 }
 const old=await writer(environment(),deps);assert.equal(old.ok,false);assert.equal(old.schema,'private-media-single-write/v1');assert.equal(reads,0);assert.equal(loads,0);
});

for(const winner of ['retire','upload'])test(`identity GET preserves complete ${winner} winner proof without mode/global rewrites`,async()=>{
 const f=fixture({winner}),originalFetch=globalThis.fetch;let startupReads=0,fetches=0;
 Object.defineProperty(f.env,'NODE_OPTIONS',{enumerable:true,get(){startupReads++;throw 0;}});f.env['BLOB_READ_WRITE_TOKEN']='unused';
 const get=f.dependencies.fetch;f.dependencies.fetch=async(url,options)=>{fetches++;assert.deepEqual(Object.keys(options.headers).sort(),['Accept-Encoding','If-Match']);assert.equal(options.headers['Accept-Encoding'],'identity');return get(url,options);};
 const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,true);assert.ok(Object.values(v.checks).every(Boolean));assert.equal(v.phase,'complete');assert.equal(v.race,winner==='retire'?'retirement-won':'upload-won');assert.equal(v.evidence,'continue');assert.equal(v.requiresReconciliation,false);assert.ok(fetches>=5);
 assert.equal(startupReads,0);assert.equal(globalThis.fetch,originalFetch);assert.equal(f.env.PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE,P.mode);assert.equal(Object.hasOwn(f.env,'BLOB_READ_WRITE_TOKEN'),false);assert.equal(f.env.VERCEL_BLOB_RETRIES,'0');
 assert.ok(f.trace.indexOf('r-dispatch')<f.trace.indexOf('u-finish'));for(const item of f.objects.values())assert.deepEqual(item.bytes,singleWriteBody('retire'));
});

test('inconclusive held evidence stays inconclusive under the new schema',async()=>{
 const f=fixture({ack:false}),v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.outcome,'inconclusive');assert.equal(v.evidence,'prefix-flushed');assert.equal(v.requiresReconciliation,true);assert.equal(v.checks.heldRetired,true);
});

test('every Content-Encoding header is rejected before body access and cancellation never blocks',async()=>{
 for(const encoding of ['', 'identity','gzip','br, gzip','unknown']){
  const f=fixture();let cancelled=0,item;f.dependencies.fetch=async url=>{item=inertResponse(url,{hasEncoding:true,encoding,cancel(){cancelled++;return new Promise(()=>{});}});return item.value;};
  const v=await probe(f.env,{...f.dependencies,callTimeoutMs:50});closed(v);assert.equal(v.ok,false);assert.equal(v.phase,'verify');assert.equal(v.requiresReconciliation,true);assert.equal(cancelled,1);assert.equal(item.reads(),0);assert.equal(f.trace.includes('sdk-put:33'),false);assert.equal(f.trace.includes('u-prefix'),false);
 }
 const f=fixture();f.dependencies.fetch=async url=>inertResponse(url,{hasEncoding:true,encoding:'gzip',cancel(){return Promise.reject(Error('sensitive-error'));}}).value;const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);await new Promise(resolve=>setImmediate(resolve));
});

test('missing or nonexact confined response URL is refused and its body is cancelled',async()=>{
 for(const change of [()=>'',()=>undefined,()=>`https://outside.invalid/${run}`,url=>url.origin+url.pathname,url=>url.href+'&extra=1']){
  const f=fixture();let item,cancelled=0;f.dependencies.fetch=async url=>{item=inertResponse(url,{urlValue:change(url),cancel(){cancelled++;}});if(change(url)===undefined)delete item.value.url;return item.value;};
  const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(cancelled,1);assert.equal(item.reads(),0);assert.equal(f.trace.includes('sdk-put:33'),false);
 }
});

test('frozen verifier still rejects status, MIME, length, strong-tag and exact-body failures',async()=>{
 for(const mutate of [r=>{Object.defineProperty(r,'status',{value:206});},r=>r.headers.set('content-type','audio/wav'),r=>r.headers.delete('content-length'),r=>r.headers.set('content-length','1'),r=>r.headers.set('etag','W/"synthetic-2"'),r=>r.headers.set('etag','"different"')]){
  const f=fixture(),get=f.dependencies.fetch;f.dependencies.fetch=async(...args)=>{const r=await get(...args);mutate(r);return r;};const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(f.trace.includes('sdk-put:33'),false);
 }
 const f=fixture(),get=f.dependencies.fetch;f.dependencies.fetch=async(...args)=>{const r=await get(...args),bytes=new Uint8Array(P.uploadBytes);const bad=new Response(bytes,{headers:r.headers});Object.defineProperty(bad,'url',{value:r.url});return bad;};const v=await probe(f.env,f.dependencies);assert.equal(v.ok,false);assert.equal(v.checks.ordinaryVerified,false);
});

test('late fetch response after the old deadline is cancelled once and cannot continue metadata or writes',async()=>{
 const f=fixture();let release,cancelled=0;f.dependencies.fetch=()=>new Promise(resolve=>{release=resolve;});const v=await probe(f.env,{...f.dependencies,callTimeoutMs:5});closed(v);assert.equal(v.phase,'deadline');assert.equal(v.requiresReconciliation,true);assert.equal(f.trace.filter(x=>x==='list').length,1);
 const item=inertResponse('https://outside.invalid',{cancel(){cancelled++;return Promise.reject(0);}});release(item.value);await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);assert.equal(item.reads(),0);assert.equal(f.trace.includes('sdk-put:33'),false);
});

test('lazy facade retains initial and newly introduced native guard rejection',async()=>{
 const denied=fixture();denied.env.DEBUG='1';const value=await probe(denied.env,denied.dependencies);closed(value);assert.equal(value.ok,false);assert.equal(value.writeAttempted,false);assert.equal(denied.trace.length,0);
 const f=fixture(),get=f.dependencies.fetch;f.dependencies.fetch=async(...args)=>{const r=await get(...args);f.env.VERCEL_BLOB_API_URL='https://outside.invalid';return r;};const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(f.trace.includes('sdk-put:33'),false);assert.equal(f.trace.filter(x=>x==='list').length,1);
});

test('CLI remains silent disabled and exact mode/argument refusal uses the new closed schema',async()=>{
 const isolated=await isolatedEnv();try{
  assert.equal(execFileSync(process.execPath,['scripts/private-media-single-write-probe.mjs'],{env:isolated.env,encoding:'utf8',timeout:5000}),'');
  for(const args of [[],['--unsupported']]){let output;try{execFileSync(process.execPath,['scripts/private-media-single-write-probe.mjs',...args],{env:{...isolated.env,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000});assert.fail();}catch(error){assert.equal(error.status,1);output=error.stdout;}const v=JSON.parse(output);closed(v);assert.equal(v.ok,false);assert.equal(v.writeAttempted,false);assert.equal(output.trim().split('\n').length,1);}
 }finally{await isolated.cleanup();}
});

test('all frozen writer/read functions and selections retain exact source bytes',async()=>{
 const isolated=await isolatedEnv();try{
  const source=(await readFile(new URL('../scripts/private-media-single-write-probe.mjs',import.meta.url),'utf8')).replace(/\r\n/g,'\n'),old=execFileSync('git',['show','53a31dd:scripts/private-media-single-write-probe.mjs'],{env:isolated.env,encoding:'utf8'}).replace(/\r\n/g,'\n');
  for(const pattern of [/function selection\(env\)[\s\S]*?(?=\nfunction facade)/,/export async function runPrivateMediaSingleWriteProbe\([\s\S]*?\n}/,/export async function runPrivateMediaSingleReadProbe\([\s\S]*?\n}/]){assert.ok(old.match(pattern));assert.equal(source.match(pattern)?.[0],old.match(pattern)[0]);}
 }finally{await isolated.cleanup();}
});
