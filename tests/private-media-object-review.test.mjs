import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PRIVATE_MEDIA_PROBE as I} from '../scripts/private-media-oidc-probe.mjs';
import {PRIVATE_MEDIA_OBJECT_PROBE as P,runPrivateMediaObjectProbe as probe} from '../scripts/private-media-object-probe.mjs';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';

const run='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',key=`acceptance/${run}/roundtrip-marker.bin`;
const origin=new URL(`https://${I.storeId.slice(6)}.private.blob.vercel-storage.com`).origin,url=`${origin}/${key}`,tag='"independent-etag"';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function fixture(){
  const seconds=Math.floor(Date.now()/1000),claims={owner:I.teamSlug,owner_id:I.teamId,project:I.projectName,project_id:I.projectId,environment:'production',sub:`owner:${I.teamSlug}:project:${I.projectName}:environment:production`,iss:`https://oidc.vercel.com/${I.teamSlug}`,aud:`https://vercel.com/${I.teamSlug}`,iat:seconds-1,nbf:seconds-1,exp:seconds+600};
  const env={PRIVATE_MEDIA_OBJECT_PROBE_MODE:P.mode,PRIVATE_MEDIA_OBJECT_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_OBJECT_PROBE_RUN_ID:run,VERCEL_ENV:'production',VERCEL:'1',VERCEL_ORG_ID:I.teamId,VERCEL_PROJECT_ID:I.projectId,
    VERCEL_OIDC_TOKEN:`${encode({typ:'JWT',alg:'RS256',kid:'independent-key'})}.${encode(claims)}.${encode('signature')}`};
  const calls=[],hooks={};let deleted=false;
  class BlobError extends Error{}class BlobNotFoundError extends BlobError{}
  const facts=()=>({url,pathname:key,contentType:'application/octet-stream',etag:tag,size:64});
  const invoke=(name,normal,...args)=>{calls.push(name);return hooks[name]?hooks[name](...args):normal(...args);};
  const sdk={BlobError,BlobNotFoundError,
    list:options=>invoke('list',()=>({blobs:[],hasMore:false}),options),
    put:(...args)=>invoke('put',facts,...args),
    head:(...args)=>invoke('head',()=>{if(deleted)throw new BlobNotFoundError();return facts();},...args),
    issueSignedToken:options=>invoke('grant',()=>({delegationToken:`${encode({storeId:I.storeId,pathname:key,operations:['get'],validUntil:options.validUntil})}.${encode('mac')}`,clientSigningToken:'a'.repeat(43),validUntil:options.validUntil}),options),
    presignUrl:(grant,options)=>invoke('presign',()=>{const u=new URL(url);u.searchParams.set('cache','0');u.searchParams.set('vercel-blob-delegation',grant.delegationToken);u.searchParams.set('vercel-blob-signature','b'.repeat(43));return {presignedUrl:u.href};},grant,options),
    del:(...args)=>invoke('delete',()=>{deleted=true;},...args),
  };
  const fetch=(input,options)=>{
    const u=new URL(input),name=!u.searchParams.has('vercel-blob-delegation')?'unsigned':options.headers['If-Match']===tag?'range':'stale';
    return invoke(name,()=>name==='range'?new Response(Uint8Array.from({length:16},(_,i)=>i),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 0-15/64','content-length':'16',etag:tag}}):new Response(null,{status:name==='stale'?412:403}),input,options);
  };
  return {env,sdk,hooks,calls,facts,dependencies:{loadSdk:async()=>sdk,fetch}};
}
const blocked=milliseconds=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds);

test('elapsed per-call deadline still rejects synchronous SDK work when timer callbacks cannot run',async()=>{
  const f=fixture();f.hooks.list=()=>{blocked(30);return {blobs:[],hasMore:false};};
  const value=await probe(f.env,{...f.dependencies,callTimeoutMs:5});
  assert.equal(value.ok,false);assert.equal(value.phase,'deadline');assert.equal(value.writeAttempted,false);
  assert.deepEqual(f.calls,['list']);
});

test('elapsed body-idle deadline rejects synchronous reader settlement before any subsequent request',async()=>{
  const f=fixture();let reads=0,canceled=0;
  f.hooks.range=()=>({status:206,redirected:false,url:'',headers:new Headers({'content-type':'application/octet-stream','content-range':'bytes 0-15/64','content-length':'16',etag:tag}),body:{getReader(){return {read(){reads++;if(reads===1){blocked(25);return Promise.resolve({done:false,value:Uint8Array.from({length:16},(_,i)=>i)});}return Promise.resolve({done:true});},cancel(){canceled++;},releaseLock(){}};}}});
  const value=await probe(f.env,{...f.dependencies,bodyIdleMs:5});
  assert.equal(value.ok,false);assert.equal(value.phase,'deadline');assert.equal(value.outcome,'requires-reconciliation');
  assert.equal(canceled,1);assert.equal(f.calls.includes('stale'),false);assert.equal(f.calls.includes('delete'),false);
});

test('empty byte reads stop at the finite bound and cannot accumulate arbitrary retained chunks or continue',async()=>{
  const f=fixture();let reads=0,canceled=0;
  f.hooks.range=()=>({status:206,redirected:false,url:'',headers:new Headers({'content-type':'application/octet-stream','content-range':'bytes 0-15/64','content-length':'16',etag:tag}),body:{getReader(){return {read(){reads++;if(reads<=1000)return Promise.resolve({done:false,value:new Uint8Array(0)});if(reads===1001)return Promise.resolve({done:false,value:Uint8Array.from({length:16},(_,i)=>i)});return Promise.resolve({done:true});},cancel(){canceled++;},releaseLock(){}};}}});
  const value=await probe(f.env,f.dependencies);assert.equal(value.ok,false);assert.equal(value.checks.rangeVerified,false);assert.equal(value.outcome,'requires-reconciliation');
  assert.ok(reads<=65);assert.equal(canceled,1);assert.equal(f.calls.includes('stale'),false);assert.equal(f.calls.includes('delete'),false);
});

test('a newly introduced override remains visible to final full metadata guards without reading hosted options',async()=>{
  const f=fixture();let lists=0,optionReads=0;
  Object.defineProperty(f.env,'NODE_OPTIONS',{enumerable:true,get(){optionReads++;throw Error('SECRET_MARKER');}});
  f.hooks.list=()=>{lists++;if(lists===1)f.env.DEBUG='SECRET_MARKER';return {blobs:[],hasMore:false};};
  const value=await probe(f.env,f.dependencies);assert.equal(value.ok,false);assert.equal(value.outcome,'failed');
  assert.equal(value.writeAttempted,false);assert.equal(f.calls.includes('put'),false);
  assert.equal(lists,1);assert.equal(optionReads,0);assert.equal(JSON.stringify(value).includes('SECRET_MARKER'),false);
});

test('grant identity/scope/expiry and signed URL cannot widen even after a verified PUT',async()=>{
  const mutations=[
    scope=>({...scope,pathname:'other'}),scope=>({...scope,storeId:'store_wrong'}),scope=>({...scope,operations:['get','put']}),
    scope=>({...scope,operations:['get','get']}),scope=>({...scope,validUntil:scope.validUntil+1}),
  ];
  for(const change of mutations){
    const f=fixture();f.hooks.grant=options=>({delegationToken:`${encode(change({storeId:I.storeId,pathname:key,operations:['get'],validUntil:options.validUntil}))}.${encode('mac')}`,clientSigningToken:'a'.repeat(43),validUntil:options.validUntil});
    const value=await probe(f.env,f.dependencies);assert.equal(value.ok,false);assert.equal(value.phase,'grant');assert.equal(value.checks.putVerified,true);assert.equal(f.calls.includes('presign'),false);assert.equal(f.calls.includes('delete'),false);
  }
  for(const change of [u=>u.searchParams.set('cache','1'),u=>u.searchParams.set('vercel-blob-valid-until',String(Date.now()+100000)),u=>u.searchParams.set('vercel-blob-delegation','different'),u=>{u.hostname='invalid.example';}]){
    const f=fixture();f.hooks.presign=grant=>{const u=new URL(url);u.searchParams.set('cache','0');u.searchParams.set('vercel-blob-delegation',grant.delegationToken);u.searchParams.set('vercel-blob-signature','b'.repeat(43));change(u);return {presignedUrl:u.href};};
    const value=await probe(f.env,f.dependencies);assert.equal(value.ok,false);assert.equal(value.phase,'presign');assert.equal(f.calls.includes('range'),false);assert.equal(f.calls.includes('delete'),false);
  }
});

test('wrong actual range bytes or oversized/redirected denial never permit deletion',async()=>{
  for(const replace of [
    ()=>new Response(new Uint8Array(16),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 0-15/64','content-length':'16',etag:tag}}),
    ()=>new Response(null,{status:200}),
    ()=>({status:206,redirected:true,url,headers:new Headers(),body:null}),
  ]){const f=fixture();f.hooks.range=replace;const value=await probe(f.env,f.dependencies);assert.equal(value.ok,false);assert.equal(value.checks.rangeVerified,false);assert.equal(f.calls.includes('delete'),false);}
  for(const stage of ['stale','unsigned']){
    const f=fixture();f.hooks[stage]=()=>new Response(new Uint8Array(4097),{status:stage==='stale'?412:403});
    const value=await probe(f.env,f.dependencies);assert.equal(value.ok,false);assert.equal(f.calls.includes('delete'),false);
  }
});

test('fresh token clock crossing after object I/O prevents any next action or cleanup replay',async()=>{
  const f=fixture();let clock=Date.now();f.hooks.put=()=>{clock+=700000;return f.facts();};
  const value=await probe(f.env,{...f.dependencies,now:()=>clock});assert.equal(value.ok,false);assert.equal(value.writeAttempted,true);assert.deepEqual(f.calls,['list','put']);assert.equal(value.outcome,'requires-reconciliation');
});

test('late delete completion and unbounded cancellation cannot emit success or start absence checking',async()=>{
  const f=fixture();let settle;f.hooks.delete=()=>new Promise(resolve=>{settle=resolve;});
  const value=await probe(f.env,{...f.dependencies,callTimeoutMs:30});assert.equal(value.phase,'deadline');assert.equal(value.checks.deleted,false);
  const before=f.calls.slice();settle();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.calls,before);assert.equal(f.calls.filter(x=>x==='head').length,2);
});

test('actual pinned SDK wire uses only explicit native auth and rejects an overbroad delegated GET grant before any byte fetch',async()=>{
  const previous=getGlobalDispatcher(),agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent);
  const originalStatic=process.env.BLOB_READ_WRITE_TOKEN;
  try{
    const f=fixture(),control=agent.get('https://vercel.com'),headers={'content-type':'application/json'};let requests=0,fetches=0;
    const check=options=>{requests++;assert.equal(new Headers(options.headers).get('authorization'),`Bearer ${f.env.VERCEL_OIDC_TOKEN}`);};
    control.intercept({method:'GET',path:path=>new URL(path,'https://vercel.com').searchParams.get('limit')==='1'}).reply(options=>{check(options);process.env.BLOB_READ_WRITE_TOKEN='unused';return {statusCode:200,data:{blobs:[],hasMore:false},responseOptions:{headers}};});
    control.intercept({method:'PUT',path:path=>new URL(path,'https://vercel.com').searchParams.get('pathname')===key}).reply(options=>{check(options);assert.deepEqual(new Uint8Array(options.body),Uint8Array.from({length:64},(_,i)=>i));return {statusCode:200,data:f.facts(),responseOptions:{headers}};});
    control.intercept({method:'GET',path:path=>new URL(path,'https://vercel.com').searchParams.get('url')===key}).reply(options=>{check(options);return {statusCode:200,data:f.facts(),responseOptions:{headers}};});
    control.intercept({method:'POST',path:'/api/blob/signed-token'}).reply(options=>{
      check(options);const body=JSON.parse(options.body);assert.deepEqual(body.operations,['get']);assert.equal(body.pathname,key);
      return {statusCode:200,data:{delegationToken:`${encode({storeId:I.storeId,pathname:key,operations:['get','put'],validUntil:body.validUntil})}.${encode('mac')}`,clientSigningToken:'a'.repeat(43),validUntil:body.validUntil},responseOptions:{headers}};
    });
    const value=await probe(f.env,{fetch:async()=>{fetches++;throw Error('must not fetch');}});
    assert.equal(value.ok,false);assert.equal(value.phase,'grant');assert.equal(value.outcome,'requires-reconciliation');assert.equal(requests,4);assert.equal(fetches,0);agent.assertNoPendingInterceptors();
  }finally{if(originalStatic===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else Reflect.set(process.env,'BLOB_READ_WRITE_TOKEN',originalStatic);setGlobalDispatcher(previous);await agent.close();}
});
