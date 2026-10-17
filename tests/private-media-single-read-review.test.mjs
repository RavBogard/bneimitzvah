import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {isolatedEnv} from './helpers/isolatedEnv.mjs';
import {PRIVATE_MEDIA_PROBE as I} from '../scripts/private-media-oidc-probe.mjs';
import {PRIVATE_MEDIA_SINGLE_READ_PROBE as R,runPrivateMediaSingleReadProbe as probe,runPrivateMediaSingleWriteProbe as writer,singleWriteBody} from '../scripts/private-media-single-write-probe.mjs';
const run='cccccccc-cccc-4ccc-8ccc-cccccccccccc',key=`acceptance/${run}/single-write/normal.bin`,origin=`https://${I.storeId.slice(6)}.private.blob.vercel-storage.com`,plainUrl=`${origin}/${key}`;
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),blocked=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function immutableSpans(source){
  // Normalize complete line endings before a regex can separate CR from LF.
  const normalized=source.replace(/\r\n/g,'\n');
  return [/function selection\(env\)[\s\S]*?(?=\nfunction facade)/,/export async function runPrivateMediaSingleWriteProbe\([\s\S]*?\n}/].map(pattern=>{const span=normalized.match(pattern)?.[0];assert.ok(span);return span;});
}
function unchangedWriter(actual,baseline){assert.deepEqual(immutableSpans(actual),immutableSpans(baseline));}
function environment(){const seconds=Math.floor(Date.now()/1000);return {PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:'read-only-v1',PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:I.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run,
  VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:I.projectId,VERCEL_ORG_ID:I.teamId,
  VERCEL_OIDC_TOKEN:`${encode({typ:'JWT',alg:'RS256',kid:'review-key'})}.${encode({iss:`https://oidc.vercel.com/${I.teamSlug}`,aud:`https://vercel.com/${I.teamSlug}`,owner:I.teamSlug,owner_id:I.teamId,project:I.projectName,project_id:I.projectId,environment:'production',sub:`owner:${I.teamSlug}:project:${I.projectName}:environment:production`,iat:seconds-1,nbf:seconds-1,exp:seconds+600})}.${encode('synthetic')}`};}
function fixture(){
  const env=environment(),calls=[],hooks={};let mutationAccess=0;
  class BlobNotFoundError extends Error{}
  const facts=()=>({pathname:key,url:plainUrl,contentType:'application/octet-stream',size:1048576,etag:'"head-tag"'});
  const invoke=(name,fn,...args)=>{calls.push(name);return hooks[name]?hooks[name](...args):fn(...args);};
  const sdk={BlobNotFoundError,
    list:o=>invoke('list',()=>({blobs:[],hasMore:false}),o),
    head:(...args)=>invoke('head',facts,...args),
    issueSignedToken:o=>invoke('grant',()=>({delegationToken:`${encode({storeId:I.storeId,pathname:key,operations:['get'],validUntil:o.validUntil})}.${encode('mac')}`,clientSigningToken:'a'.repeat(43),validUntil:o.validUntil}),o),
    presignUrl:(g,o)=>invoke('presign',()=>({presignedUrl:`${plainUrl}?cache=0&vercel-blob-delegation=${g.delegationToken}&vercel-blob-signature=${'b'.repeat(43)}`}),g,o),
  };
  for(const name of ['put','del','copy','upload','createMultipartUpload','createMultipartUploader','uploadPart','completeMultipartUpload'])Object.defineProperty(sdk,name,{get(){mutationAccess++;throw Error('mutation-unreachable');}});
  const response=(url,bytes=singleWriteBody('upload'),headers={})=>{
    const value=new Response(bytes,{headers:{'content-type':'application/octet-stream',etag:'"head-tag"','content-length':String(bytes.length),...headers}});Object.defineProperty(value,'url',{value:String(url)});return value;
  };
  const fetch=(url,options)=>invoke('fetch',()=>{assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(new Headers(options.headers).has('range'),false);assert.equal(new Headers(options.headers).has('if-match'),false);return response(url);},url,options);
  return {env,sdk,hooks,calls,facts,response,dependencies:{loadSdk:async()=>sdk,fetch},get mutationAccess(){return mutationAccess;}};
}
function closed(v){assert.deepEqual(Object.keys(v).sort(),['observations','ok','outcome','phase','readOnly','schema']);assert.equal(v.schema,'private-media-single-read/v1');assert.equal(v.readOnly,true);assert.ok(R.phases.includes(v.phase));assert.deepEqual(Object.keys(v.observations).sort(),['body','contentEncodingPresent','contentLengthExpected','contentLengthPresent','contentTypeExpected','etagMatchesHead','head','metadataAfter','metadataBefore','status','urlConfined','urlExact']);assert.equal(Object.hasOwn(v,'checks'),false);assert.equal(Object.hasOwn(v,'writeAttempted'),false);assert.equal(JSON.stringify(v).includes(run),false);}
function readerResponse(url,read,headers={},onCancel=()=>{}){return {url:String(url),redirected:false,status:200,headers:new Headers({'content-type':'application/octet-stream',...headers}),body:{getReader(){return {read,cancel:onCancel,releaseLock(){}};},cancel:onCancel}};}

test('review immutability extraction tolerates only whole-source LF/CRLF differences and rejects changed code or spacing',()=>{
  const lf='function selection(env){return env;}\nfunction facade(){}\nexport async function runPrivateMediaSingleWriteProbe(env){\n  return env;\n}\n';
  const crlf=lf.replace(/\n/g,'\r\n');
  unchangedWriter(lf,crlf);unchangedWriter(crlf,lf);
  // The old post-extraction normalization left this boundary's CR behind.
  unchangedWriter(lf.replace('\nfunction facade','\r\nfunction facade'),lf);
  for(const changed of [lf.replace('return env;}','return null;}'),lf.replace('  return env;','  return null;'),lf.replace('  return env;','  return  env;')])assert.throws(()=>unchangedWriter(changed,lf),{code:'ERR_ASSERTION'});
});
test('review preserves writer and selection bytes and CLI chooses the read-only schema before refusing identity',async()=>{
  const isolated=await isolatedEnv();try{
    const current=await readFile(new URL('../scripts/private-media-single-write-probe.mjs',import.meta.url),'utf8'),old=execFileSync('git',['show','8caaeda2e24269f4c3b8d872a69d4942931371f2:scripts/private-media-single-write-probe.mjs'],{env:isolated.env,encoding:'utf8'});
    unchangedWriter(current,old);
    let output;try{output=execFileSync(process.execPath,['scripts/private-media-single-write-probe.mjs'],{env:{...isolated.env,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:'read-only-v1',PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:I.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000});}catch(error){assert.equal(error.status,1);output=error.stdout;}
    const v=JSON.parse(output);closed(v);assert.equal(v.ok,false);assert.equal(v.observations.metadataBefore,false);
  }finally{await isolated.cleanup();}
});

test('review selection rejects expansions without token reads and direct writer never accepts read mode',async()=>{
  let imports=0,tokenReads=0;const deps={loadSdk:()=>{imports++;throw 0;}};
  assert.equal(await probe({},deps),null);
  for(const env of [{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_SLOT:'held'},{...environment(),PRIVATE_MEDIA_OBJECT_PROBE_MODE:'roundtrip-v1'},{...environment(),PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:run},{PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:'read-only-v1'}]){
    Object.defineProperty(env,'VERCEL_OIDC_TOKEN',{enumerable:true,get(){tokenReads++;throw 0;}});const v=await probe(env,deps);closed(v);assert.equal(v.phase,'selection');assert.equal(v.ok,false);
  }
  const f=fixture(),v=await writer(f.env,deps);assert.equal(v.ok,false);assert.equal(v.writeAttempted,false);assert.equal(v.phase,'selection');assert.equal(imports,0);assert.equal(tokenReads,0);
});

test('review known permit can be observed despite size-only HEAD, omitted length, encoding, MIME and normalized URL disagreement with no mutation access',async()=>{
  const f=fixture();f.hooks.head=()=>({...f.facts(),size:33});f.hooks.fetch=url=>{
    const changed=new URL(url),entries=[...changed.searchParams].reverse();changed.search="";for(const [name,value] of entries)changed.searchParams.append(name,value);return f.response(changed,singleWriteBody('permit'),{'content-length':null,'content-type':'different/type','content-encoding':'gzip',etag:'"different-tag"'});
  };
  // Headers omit rather than stringify a missing Content-Length.
  const fetchHook=f.hooks.fetch;f.hooks.fetch=(...args)=>{const response=fetchHook(...args);response.headers.delete('content-length');return response;};
  const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,true);assert.equal(v.outcome,'observed');assert.equal(v.observations.head,'retire');assert.equal(v.observations.body,'permit');assert.equal(v.observations.contentLengthPresent,false);assert.equal(v.observations.contentLengthExpected,false);assert.equal(v.observations.contentTypeExpected,false);assert.equal(v.observations.contentEncodingPresent,true);assert.equal(v.observations.etagMatchesHead,false);assert.equal(v.observations.urlConfined,true);assert.equal(v.observations.urlExact,false);assert.equal(f.mutationAccess,0);assert.deepEqual(f.calls,['list','grant','presign','head','fetch','list']);
});

test('review scope and URL confinement fail before byte fetch without mutation or unrelated object access',async()=>{
  for(const change of [s=>({...s,operations:['get','put']}),s=>({...s,pathname:key+'/other'}),s=>({...s,storeId:'store_other'}),s=>({...s,validUntil:s.validUntil+1})]){
    const f=fixture();f.hooks.grant=o=>({delegationToken:`${encode(change({storeId:I.storeId,pathname:key,operations:['get'],validUntil:o.validUntil}))}.${encode('mac')}`,clientSigningToken:'a'.repeat(43),validUntil:o.validUntil});const v=await probe(f.env,f.dependencies);assert.equal(v.ok,false);assert.equal(v.phase,'grant');assert.equal(f.calls.includes('presign'),false);assert.equal(f.calls.includes('fetch'),false);assert.equal(f.mutationAccess,0);
  }
  for(const change of [u=>{u.hostname='example.invalid';},u=>{u.pathname+='/other';},u=>u.searchParams.append('cache','0'),u=>u.searchParams.set('cache','1')]){
    const f=fixture();f.hooks.presign=g=>{const u=new URL(`${plainUrl}?cache=0&vercel-blob-delegation=${g.delegationToken}&vercel-blob-signature=${'b'.repeat(43)}`);change(u);return {presignedUrl:u.href};};const v=await probe(f.env,f.dependencies);assert.equal(v.ok,false);assert.equal(v.phase,'presign');assert.equal(f.calls.includes('fetch'),false);assert.equal(f.mutationAccess,0);
  }
});

test('review decoded cap cannot be bypassed by a small declared wire length and oversized declaration is rejected before reads',async()=>{
  for(const declared of ['31',String(1048577)]){const f=fixture();let reads=0,cancels=0;f.hooks.fetch=url=>readerResponse(url,()=>{reads++;return Promise.resolve({done:false,value:new Uint8Array(1048577)});},{'content-length':declared,'content-encoding':'gzip'},()=>{cancels++;});const v=await probe(f.env,f.dependencies);closed(v);assert.equal(v.ok,false);assert.equal(v.observations.metadataAfter,false);assert.equal(reads,declared==='31'?1:0);assert.ok(cancels>=1);assert.equal(f.calls.filter(x=>x==='list').length,1);}
});

test('review empty reads are finite and elapsed byte-idle is checked after synchronous settlement',async()=>{
  for(const starvation of [false,true]){const f=fixture();let reads=0,cancels=0;f.hooks.fetch=url=>readerResponse(url,()=>{reads++;if(starvation)blocked(25);return Promise.resolve({done:false,value:new Uint8Array(0)});},{},()=>{cancels++;});const v=await probe(f.env,{...f.dependencies,...starvation?{bodyIdleMs:5}:{}});assert.equal(v.ok,false);assert.ok(reads<=65);if(starvation){assert.equal(reads,1);assert.equal(v.phase,'deadline');}assert.ok(cancels>=1);assert.equal(v.observations.metadataAfter,false);}
});

test('review synchronous SDK elapsed deadline and EOF-time identity expiry cannot produce observations or later work',async()=>{
  const f=fixture();f.hooks.list=()=>{blocked(30);return {blobs:[],hasMore:false};};const v=await probe(f.env,{...f.dependencies,callTimeoutMs:5});assert.equal(v.ok,false);assert.equal(v.phase,'deadline');assert.deepEqual(f.calls,['list']);
  const g=fixture();let clock=Date.now(),read=0;g.hooks.fetch=url=>readerResponse(url,()=>{read++;if(read===1)return Promise.resolve({done:false,value:singleWriteBody('retire')});clock+=700000;return Promise.resolve({done:true});});const value=await probe(g.env,{...g.dependencies,now:()=>clock});assert.equal(value.ok,false);assert.equal(value.observations.metadataAfter,false);assert.equal(g.calls.filter(x=>x==='list').length,1);
});

test('review a timed-out fetch settling late is cancelled without metadata-after or changed terminal result',async()=>{
  const f=fixture();let settle,cancels=0;f.hooks.fetch=()=>new Promise(resolve=>{settle=resolve;});const v=await probe(f.env,{...f.dependencies,callTimeoutMs:30});closed(v);assert.equal(v.ok,false);assert.equal(v.phase,'deadline');const frozen=JSON.stringify(v),before=f.calls.slice();settle({body:{cancel(){cancels++;return new Promise(()=>{});}}});await new Promise(resolve=>setImmediate(resolve));assert.equal(cancels,1);assert.deepEqual(f.calls,before);assert.equal(JSON.stringify(v),frozen);
});

test('review actual pinned SDK sends explicit native GET-only grant and presigns the fixed key without ambient fallback',async()=>{
  const f=fixture(),previous=getGlobalDispatcher(),agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent);const wire=[];let signedBody;
  try{
    const control=agent.get('https://vercel.com'),json={'content-type':'application/json'};
    control.intercept({method:'GET',path:p=>new URL(p,'https://vercel.com').searchParams.get('limit')==='1'}).reply(o=>{wire.push({method:o.method,headers:new Headers(o.headers)});return {statusCode:200,data:{blobs:[],hasMore:false},responseOptions:{headers:json}};}).times(2);
    control.intercept({method:'POST',path:'/api/blob/signed-token'}).reply(o=>{wire.push({method:o.method,headers:new Headers(o.headers)});signedBody=JSON.parse(o.body);return {statusCode:200,data:{delegationToken:`${encode({storeId:I.storeId,pathname:key,operations:['get'],validUntil:signedBody.validUntil})}.${encode('mac')}`,clientSigningToken:'a'.repeat(43),validUntil:signedBody.validUntil},responseOptions:{headers:json}};});
    control.intercept({method:'GET',path:p=>new URL(p,'https://vercel.com').searchParams.get('url')===key}).reply(o=>{wire.push({method:o.method,headers:new Headers(o.headers)});return {statusCode:200,data:f.facts(),responseOptions:{headers:json}};});
    const v=await probe(f.env,{fetch:f.dependencies.fetch,callTimeoutMs:1000});closed(v);assert.equal(v.ok,true);assert.equal(v.outcome,'observed');assert.deepEqual(signedBody.operations,['get']);assert.equal(signedBody.pathname,key);assert.deepEqual(Object.keys(signedBody).sort(),['operations','pathname','validUntil']);assert.equal(wire.length,4);for(const item of wire){assert.equal(item.headers.get('authorization'),`Bearer ${f.env.VERCEL_OIDC_TOKEN}`);assert.equal(item.headers.get('x-vercel-blob-store-id'),I.storeId.slice(6));}agent.assertNoPendingInterceptors();
  }finally{setGlobalDispatcher(previous);await agent.close();}
});
