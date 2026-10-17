import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {isolatedEnv} from './helpers/isolatedEnv.mjs';
import {PRIVATE_MEDIA_SINGLE_WRITE_PROBE as P,runPrivateMediaSingleWriteProbe as probe,singleWriteProtocol,startSingleWriteTransport,singleWriteBody} from '../scripts/private-media-single-write-probe.mjs';
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
  const fetch=async(url,options)=>{trace.push('fetch');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');const key=new URL(url).pathname.slice(1),item=objects.get(key);assert.equal(options.headers['If-Match'],item.etag);hook?.('fetch',env);return new Response(item.bytes,{headers:{'content-length':String(item.bytes.length),'content-type':'application/octet-stream',etag:item.etag}});};
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
function closed(v){assert.deepEqual(Object.keys(v).sort(),['checks','evidence','ok','outcome','phase','race','requiresReconciliation','schema','writeAttempted']);assert.equal(v.schema,P.schema);assert.ok(P.phases.includes(v.phase));assert.ok(!JSON.stringify(v).includes('synthetic-'));}

test('default is silent/no import; partial, unknown and combined selection never reaches SDK',async()=>{
  let loads=0;assert.equal(await probe({get VERCEL_OIDC_TOKEN(){throw 0;}},{loadSdk:async()=>{loads++;throw 0;}}),null);
  for(const env of [{PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_EXTRA:'x'},{...environment(),PRIVATE_MEDIA_OBJECT_PROBE_MODE:'roundtrip-v1'}]){const v=await probe(env,{loadSdk:async()=>{loads++;throw 0;}});closed(v);assert.equal(v.ok,false);assert.equal(v.writeAttempted,false);}
  assert.equal(loads,0);
});
test('closed protocol is exact conditional ordinary PUT and marker lengths cannot equal allowed even chunks',()=>{
  for(const kind of ['permit','upload','retire']){const v=singleWriteProtocol({run,slot:'held',kind,ifMatch:kind==='permit'?undefined:'"a"',oidcToken:'synthetic'});assert.equal(v.url.origin,'https://vercel.com');assert.equal(v.url.pathname,'/api/blob/');assert.equal(v.options.method,'PUT');assert.equal(v.options.headers['x-api-version'],'13');assert.equal(v.options.headers['x-api-blob-request-attempt'],'0');assert.equal(v.options.headers['x-allow-overwrite'],kind==='permit'?'0':'1');assert.equal(v.options.headers.authorization,'Bearer synthetic');assert.equal(v.options.headers['x-if-match'],kind==='permit'?undefined:'"a"');assert.equal(v.body.length,kind==='permit'?31:kind==='retire'?33:1048576);assert.match(v.options.headers['x-api-blob-request-id'],new RegExp(`^${P.storeId}:[0-9]+:[0-9a-f]+$`));}
  assert.notDeepEqual(singleWriteBody('permit'),singleWriteBody('retire'));assert.throws(()=>singleWriteProtocol({run,slot:'outside',kind:'upload',ifMatch:'"a"',oidcToken:'x'}));assert.throws(()=>singleWriteProtocol({run,slot:'normal',kind:'upload',ifMatch:'W/"a"',oidcToken:'x'}));
});
for(const winner of ['retire','upload'])test(`known ${winner} winning OCC branch establishes R without unknown retries`,async()=>{
  const f=fixture({winner}),v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,true,JSON.stringify({v,trace:f.trace}));assert.equal(v.phase,'complete');assert.equal(v.race,winner==='retire'?'retirement-won':'upload-won');assert.equal(v.evidence,'continue');assert.ok(Object.values(v.checks).every(Boolean));assert.equal(v.requiresReconciliation,false);
  assert.ok(f.trace.indexOf('u-prefix')<f.trace.indexOf('r-dispatch'));assert.ok(f.trace.indexOf('r-dispatch')<f.trace.indexOf('u-finish'));assert.equal(f.objects.size,2);for(const item of f.objects.values())assert.deepEqual(item.bytes,singleWriteBody('retire'));
  assert.equal(f.trace.filter(v=>v==='sdk-put:1048576').length,4); // ordinary U and three intentional stale attempts
  assert.equal(f.trace.filter(v=>v==='sdk-put:33').length,winner==='upload'?2:1);
});
test('prefix-only evidence is inconclusive even with confirmed retirement and cannot pass',async()=>{const f=fixture({ack:false}),v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.outcome,'inconclusive');assert.equal(v.evidence,'prefix-flushed');assert.equal(v.requiresReconciliation,true);assert.ok(v.checks.heldRetired);});
test('unknown adapter response stops before another action or cleanup replay',async()=>{const f=fixture({adapterStatus:503}),v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(v.checks.heldRetired,false);assert.ok(f.trace.filter(v=>v==='destroy').length>=1);assert.equal(f.trace.filter(v=>v==='sdk-put:33').length,1);});
test('late override fences next work and never reflects the input value',async()=>{let hits=0;const f=fixture({hook:(stage,env)=>{if(stage==='fetch'&&++hits===1)env.VERCEL_BLOB_API_URL='https://synthetic-sensitive.invalid';}});const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.requiresReconciliation,true);assert.equal(f.trace.includes('u-prefix'),false);assert.equal(f.trace.filter(v=>v==='sdk-put:33').length,0);});
test('shortening-only deadline stops a stalled metadata request and ignores late completion',async()=>{const f=fixture();let release;f.sdk.list=()=>new Promise(resolve=>{release=resolve;});const v=await probe(f.env,{...f.dependencies,callTimeoutMs:5,totalTimeoutMs:20});closed(v);assert.equal(v.phase,'deadline');assert.equal(v.writeAttempted,false);release({blobs:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.trace.some(v=>v.startsWith('sdk-put')),false);for(const key of ['callTimeoutMs','bodyIdleMs','totalTimeoutMs']){const x=fixture(),r=await probe(x.env,{...x.dependencies,[key]:P[key]+1});assert.equal(r.ok,false);assert.equal(x.trace.length,0);}});
test('default prebuild begins with new selection guard and exits silently in isolated child',async()=>{const isolated=await isolatedEnv();try{const output=execFileSync(process.execPath,['scripts/private-media-single-write-probe.mjs'],{env:isolated.env,encoding:'utf8',timeout:10000});assert.equal(output,'');const pkg=JSON.parse(execFileSync(process.execPath,['-e',"process.stdout.write(require('fs').readFileSync('package.json','utf8'))"],{env:isolated.env,encoding:'utf8'}));assert.equal(pkg.scripts.prebuild,'node scripts/private-media-single-write-probe.mjs && node scripts/private-media-oidc-probe.mjs && node scripts/private-media-object-probe.mjs');}finally{await isolated.cleanup();}});
