import {test} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {isolatedEnv} from './helpers/isolatedEnv.mjs';
import {PRIVATE_MEDIA_SINGLE_READ_PROBE as P,runPrivateMediaSingleReadProbe as probe,runPrivateMediaSingleWriteProbe as writer,singleWriteBody} from '../scripts/private-media-single-write-probe.mjs';
import {PRIVATE_MEDIA_PROBE as I} from '../scripts/private-media-oidc-probe.mjs';
const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',key=`acceptance/${run}/single-write/normal.bin`,origin=new URL(`https://${P.storeId.slice(6)}.private.blob.vercel-storage.com`).origin,encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function environment(){const seconds=Math.floor(Date.now()/1000);return {PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run,
  VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:I.projectId,VERCEL_ORG_ID:I.teamId,VERCEL_OIDC_TOKEN:`${encode({typ:'JWT',alg:'RS256',kid:'synthetic-read'})}.${encode({iss:`https://oidc.vercel.com/${I.teamSlug}`,aud:`https://vercel.com/${I.teamSlug}`,owner:I.teamSlug,owner_id:I.teamId,project:I.projectName,project_id:I.projectId,environment:'production',sub:`owner:${I.teamSlug}:project:${I.projectName}:environment:production`,iat:seconds-1,nbf:seconds-1,exp:seconds+600})}.${encode('synthetic-signature')}`};}
class BlobNotFoundError extends Error{}
function fixture(options={}){
 const env=environment(),calls=[],hooks={},tag='"synthetic-read-etag"';let mutationReads=0;
 const sdk={BlobNotFoundError,
  list:async input=>{calls.push('list');assert.equal(input.oidcToken,env.VERCEL_OIDC_TOKEN);assert.equal(input.storeId,P.storeId);return hooks.list?hooks.list(input):{blobs:[],hasMore:false};},
  head:async path=>{calls.push('head');assert.equal(path,key);if(options.missing)throw new BlobNotFoundError();if(hooks.head)return hooks.head();return {pathname:key,url:`${origin}/${key}`,size:options.headSize??1048576,etag:options.headTag??tag};},
  issueSignedToken:async input=>{calls.push('grant');assert.equal(input.pathname,key);assert.deepEqual(input.operations,['get']);const scope={storeId:P.storeId,pathname:key,operations:['get'],validUntil:input.validUntil};hooks.scope?.(scope);return {delegationToken:`${encode(scope)}.${encode('signature')}`,clientSigningToken:'a'.repeat(43),validUntil:input.validUntil};},
  presignUrl:async(g,o)=>{calls.push('presign');assert.equal(o.pathname,key);assert.equal(o.operation,'get');assert.equal(o.access,'private');assert.equal(o.useCache,false);return {presignedUrl:hooks.signed??`${origin}/${key}?cache=0&vercel-blob-delegation=${g.delegationToken}&vercel-blob-signature=${'b'.repeat(43)}`};},
 };
 for(const name of ['put','del','copy','rename','putFromUrl','createMultipartUpload','uploadPart','completeMultipartUpload'])Object.defineProperty(sdk,name,{get(){mutationReads++;throw Error('synthetic-sensitive');}});
 const fetch=async(url,input)=>{calls.push('get');assert.equal(input.method,'GET');assert.equal(input.headers,undefined);assert.equal(input.redirect,'error');assert.equal(input.credentials,'omit');assert.equal(input.cache,'no-store');assert.equal(input.referrerPolicy,'no-referrer');assert.equal(new URL(url).pathname,`/${key}`);if(hooks.fetch)return hooks.fetch(url,input);
  const bytes=singleWriteBody(options.kind??'upload'),headers={'content-type':options.type??'application/octet-stream',etag:options.getTag??tag};if(!options.noLength)headers['content-length']=options.length??String(bytes.length);if(options.encoding)headers['content-encoding']='gzip';
  const response=new Response(bytes,{status:options.status??200,headers});Object.defineProperty(response,'url',{value:options.responseUrl??url.href});return response;
 };
 return {env,sdk,calls,hooks,get mutationReads(){return mutationReads;},deps:{loadSdk:async()=>sdk,fetch}};
}
function closed(value){assert.deepEqual(Object.keys(value).sort(),['observations','ok','outcome','phase','readOnly','schema']);assert.equal(value.schema,P.schema);assert.equal(value.readOnly,true);assert.ok(P.phases.includes(value.phase));assert.deepEqual(Object.keys(value.observations).sort(),['body','contentEncodingPresent','contentLengthExpected','contentLengthPresent','contentTypeExpected','etagMatchesHead','head','metadataAfter','metadataBefore','status','urlConfined','urlExact']);assert.ok(!JSON.stringify(value).includes('synthetic-sensitive'));}

test('allabsent silent, partial/combined/unknown flags refuse before credentials/SDK; writer cannot dispatch readonly mode',async()=>{
 let calls=0;const deps={loadSdk:async()=>{calls++;throw 0;}};assert.equal(await probe({get VERCEL_OIDC_TOKEN(){throw 0;}},deps),null);
 for(const env of [{PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_EXTRA:'x'},{...environment(),PRIVATE_MEDIA_OBJECT_PROBE_MODE:'roundtrip-v1'},{...environment(),PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:'single-write-v1'}]){const value=await probe(env,deps);closed(value);assert.equal(value.ok,false);assert.equal(value.phase,'selection');}
 const f=fixture();assert.equal((await writer(f.env,f.deps)).writeAttempted,false);assert.equal(calls,0);assert.equal(f.calls.length,0);
});
for(const kind of ['permit','upload','retire'])test(`bounded known ${kind} EOF is observed only, with zero mutation member access`,async()=>{
 const f=fixture({kind,headSize:kind==='permit'?31:kind==='retire'?33:1048576}),value=await probe(f.env,f.deps);closed(value);assert.equal(value.ok,true);assert.equal(value.outcome,'observed');assert.equal(value.phase,'complete');assert.equal(value.observations.body,kind);assert.equal(value.observations.head,kind);assert.equal(value.observations.contentLengthExpected,kind==='upload');assert.equal(value.observations.etagMatchesHead,true);assert.equal(f.mutationReads,0);assert.deepEqual(f.calls,['list','grant','presign','head','get','list']);
});
test('missing/wirecompressed lengths, mismatched MIME/HEAD/ETag and normalized query URL remain closed observations',async()=>{
 for(const options of [{noLength:true,missing:true},{length:'100',encoding:true,headSize:7,headTag:'"another"',type:'application/unknown'}]){const f=fixture(options),value=await probe(f.env,f.deps);closed(value);assert.equal(value.ok,true);assert.equal(value.observations.contentLengthExpected,false);if(options.missing)assert.equal(value.observations.head,'missing');else{assert.equal(value.observations.head,'other');assert.equal(value.observations.contentTypeExpected,false);assert.equal(value.observations.contentEncodingPresent,true);assert.equal(value.observations.etagMatchesHead,false);}}
 const f=fixture();f.hooks.fetch=async url=>{const normalized=new URL(url);const entries=[...normalized.searchParams].reverse();normalized.search='';for(const [key,value]of entries)normalized.searchParams.append(key,value);const r=new Response(singleWriteBody('upload'),{headers:{'content-length':'1048576'}});Object.defineProperty(r,'url',{value:normalized.href});return r;};const value=await probe(f.env,f.deps);assert.equal(value.ok,true);assert.equal(value.observations.urlConfined,true);assert.equal(value.observations.urlExact,false);
});
test('strict confinement and GET-only capability prevent broad/unexpected reads',async()=>{
 for(const mutate of [s=>{s.operations.push('put');},s=>{s.pathname='*';},s=>{s.storeId='store_other';}]){const f=fixture();f.hooks.scope=mutate;const value=await probe(f.env,f.deps);assert.equal(value.ok,false);assert.equal(f.calls.includes('get'),false);}
 for(const bad of ['','https://outside.invalid/synthetic',`${origin}/${key}?cache=0&vercel-blob-signature=x`]){const f=fixture({responseUrl:bad}),value=await probe(f.env,f.deps);assert.equal(value.ok,false);assert.equal(value.observations.urlConfined,false);assert.equal(value.observations.metadataAfter,false);}
});
test('unexpected GET statuses and unrecognized bytes never count as observed; declared/decoded caps cancel',async()=>{
 for(const status of [206,401,403,404,412,500]){const f=fixture({status}),value=await probe(f.env,f.deps);closed(value);assert.equal(value.ok,false);assert.notEqual(value.observations.status,'none');assert.equal(value.observations.metadataAfter,false);}
 const f=fixture();f.hooks.fetch=async url=>{const r=new Response(new Uint8Array(16),{headers:{'content-length':'16'}});Object.defineProperty(r,'url',{value:url.href});return r;};assert.equal((await probe(f.env,f.deps)).observations.body,'other');
 for(const declared of [true,false]){const f=fixture();let cancelled=0;f.hooks.fetch=async url=>{const stream=new ReadableStream({start(c){if(!declared)c.enqueue(new Uint8Array(1048577));},cancel(){cancelled++;}});const r=new Response(stream,{headers:{'content-length':declared?'1048577':'1'}});Object.defineProperty(r,'url',{value:url.href});return r;};const value=await probe(f.env,f.deps);assert.equal(value.ok,false);assert.equal(cancelled,1);assert.equal(value.observations.metadataAfter,false);}
});
test('idle/no-progress and total deadlines cannot emit observed; late returned bytes are cancelled without metadata continuation',async()=>{
 const f=fixture();let cancelled=0;f.hooks.fetch=async url=>{const r=new Response(new ReadableStream({cancel(){cancelled++;}}));Object.defineProperty(r,'url',{value:url.href});return r;};const value=await probe(f.env,{...f.deps,bodyIdleMs:5});assert.equal(value.ok,false);assert.equal(value.phase,'deadline');assert.equal(cancelled,1);
 const late=fixture();let deliver;late.hooks.fetch=()=>new Promise(resolve=>{deliver=resolve;});const result=await probe(late.env,{...late.deps,callTimeoutMs:5});assert.equal(result.ok,false);const r=new Response(new ReadableStream({cancel(){cancelled++;}}));deliver(r);await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,2);assert.equal(late.calls.filter(x=>x==='list').length,1);
});
test('post-I/O authority/endpoint changes refuse diagnostic success and no later SDK step runs',async()=>{
 for(const mutate of [env=>{env.VERCEL_BLOB_API_URL='https://synthetic-sensitive.invalid';},env=>{env.VERCEL_ENV='preview';},env=>{env.VERCEL_OIDC_TOKEN='changed';}]){const f=fixture();f.hooks.fetch=async url=>{mutate(f.env);const r=new Response(singleWriteBody('upload'));Object.defineProperty(r,'url',{value:url.href});return r;};const value=await probe(f.env,f.deps);closed(value);assert.equal(value.ok,false);assert.equal(value.observations.metadataAfter,false);assert.equal(f.calls.filter(x=>x==='list').length,1);}
});
test('default CLI is silent and readonly argument refusal emits only new closed result in isolated process',async()=>{
 const clean=await isolatedEnv({PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode});try{
  let value;try{execFileSync(process.execPath,['scripts/private-media-single-write-probe.mjs','--unsupported'],{env:clean.env,encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.fail();}catch(error){value=JSON.parse(error.stdout);}closed(value);assert.equal(value.ok,false);assert.equal(value.phase,'selection');
  delete clean.env.PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE;assert.equal(execFileSync(process.execPath,['scripts/private-media-single-write-probe.mjs'],{env:clean.env,encoding:'utf8'}),'');
 }finally{await clean.cleanup();}
});

test('HEAD identity/size stays confined while weak matching ETags only record disagreement',async()=>{
 for(const changed of [{pathname:'another-key'},{url:'https://outside.invalid/object'},{size:1048577},{size:-1},{etag:'x'.repeat(257)}]){const f=fixture();f.hooks.head=()=>({pathname:key,url:`${origin}/${key}`,size:1048576,etag:'"normal"',...changed});const value=await probe(f.env,f.deps);assert.equal(value.ok,false);assert.equal(f.calls.includes('get'),false);}
 const f=fixture({headTag:'W/"weak"',getTag:'W/"weak"'}),value=await probe(f.env,f.deps);assert.equal(value.ok,true);assert.equal(value.observations.etagMatchesHead,false);
});
