import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {isolatedEnv} from './helpers/isolatedEnv.mjs';
import {PRIVATE_MEDIA_OBJECT_PROBE as P,runPrivateMediaObjectProbe as probe} from '../scripts/private-media-object-probe.mjs';
import {PRIVATE_MEDIA_PROBE as I,assertPrivateMediaNativeContext} from '../scripts/private-media-oidc-probe.mjs';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher,fetch as undiciFetch} from 'undici';

const run='44444444-4444-4444-8444-444444444444',key=`acceptance/${run}/roundtrip-marker.bin`;
const origin=new URL(`https://${I.storeId.slice(6)}.private.blob.vercel-storage.com`).origin,url=`${origin}/${key}`;
const tag='"synthetic-object-etag"',bytes=()=>Uint8Array.from({length:64},(_,i)=>i),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function environment(changed={},labels={}){
  const seconds=Math.floor(Date.now()/1000);
  const claims={iss:`https://oidc.vercel.com/${I.teamSlug}`,aud:`https://vercel.com/${I.teamSlug}`,owner:I.teamSlug,owner_id:I.teamId,
    project:I.projectName,project_id:I.projectId,environment:'production',sub:`owner:${I.teamSlug}:project:${I.projectName}:environment:production`,iat:seconds-1,nbf:seconds-1,exp:seconds+600,...changed};
  return {PRIVATE_MEDIA_OBJECT_PROBE_MODE:P.mode,PRIVATE_MEDIA_OBJECT_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_OBJECT_PROBE_RUN_ID:run,
    VERCEL_ENV:'production',VERCEL:'1',VERCEL_PROJECT_ID:I.projectId,VERCEL_ORG_ID:I.teamId,
    VERCEL_OIDC_TOKEN:`${encode({typ:'JWT',alg:'RS256',kid:'synthetic-object'})}.${encode(claims)}.${encode('synthetic-signature')}`,...labels};
}
class BlobError extends Error{}
class BlobNotFoundError extends BlobError{}
const closed=value=>{
  assert.deepEqual(Object.keys(value).sort(),['checks','ok','outcome','phase','schema','writeAttempted']);assert.equal(value.schema,P.schema);
  assert.ok(P.phases.includes(value.phase));assert.deepEqual(Object.keys(value.checks).sort(),['deleted','putVerified','rangeVerified','staleEtagDenied','unsignedDenied']);
  assert.ok(Object.values(value.checks).every(v=>typeof v==='boolean'));assert.ok(!JSON.stringify(value).includes('synthetic-sensitive'));
};
function fixture(){
  const env=environment(),calls=[],hooks={};let deleted=false;
  const object=()=>({url,downloadUrl:url,pathname:key,contentType:'application/octet-stream',etag:tag,size:64,uploadedAt:new Date()});
  const invoke=async(name,args,normal)=>{calls.push(name);if(hooks[name])return hooks[name](...args);return normal();};
  const sdk={BlobError,BlobNotFoundError,
    list:options=>invoke('list',[options],()=>{assert.equal(options.limit,1);assert.equal(options.prefix,`acceptance/${run}/`);return {blobs:[],hasMore:false};}),
    put:(path,body,options)=>invoke('put',[path,body,options],()=>{assert.equal(path,key);assert.deepEqual(body,bytes());assert.equal(options.oidcToken,env.VERCEL_OIDC_TOKEN);assert.equal(options.storeId,I.storeId);
      assert.equal(options.access,'private');assert.equal(options.addRandomSuffix,false);assert.equal(options.allowOverwrite,false);assert.equal(options.contentType,'application/octet-stream');return object();}),
    head:(path,options)=>invoke('head',[path,options],()=>{assert.equal(path,key);if(deleted)throw new BlobNotFoundError();return object();}),
    issueSignedToken:options=>invoke('grant',[options],()=>{assert.deepEqual(options.operations,['get']);assert.equal(options.pathname,key);
      return {delegationToken:`${encode({storeId:I.storeId,pathname:key,operations:['get'],validUntil:options.validUntil})}.${encode('synthetic-signature')}`,clientSigningToken:'a'.repeat(43),validUntil:options.validUntil};}),
    presignUrl:(grant,options)=>invoke('presign',[grant,options],()=>{assert.equal(options.operation,'get');assert.equal(options.access,'private');assert.equal(options.useCache,false);
      const signed=new URL(url);signed.searchParams.set('cache','0');signed.searchParams.set('vercel-blob-delegation',grant.delegationToken);signed.searchParams.set('vercel-blob-signature','b'.repeat(43));return {presignedUrl:signed.href};}),
    del:(path,options)=>invoke('delete',[path,options],()=>{assert.equal(path,key);assert.equal(options.ifMatch,tag);deleted=true;}),
  };
  const fetch=async(input,options)=>{
    const parsed=new URL(input);assert.equal(parsed.origin,origin);assert.equal(parsed.pathname,`/${key}`);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
    const stage=!parsed.searchParams.has('vercel-blob-delegation')?'unsigned':options.headers['If-Match']===tag?'range':'stale';
    return invoke(stage,[input,options],()=>stage==='range'?new Response(bytes().slice(0,16),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 0-15/64',etag:tag,'content-length':'16'}})
      :new Response(null,{status:stage==='stale'?412:403}));
  };
  return {env,calls,hooks,sdk,object,dependencies:{loadSdk:async()=>sdk,fetch}};
}

test('disabled import/CLI is silent and unsupported/partial flags or arguments cannot reach SDK',async()=>{
  const isolated=await isolatedEnv();try{
    assert.equal(execFileSync(process.execPath,['scripts/private-media-object-probe.mjs'],{env:isolated.env,encoding:'utf8',timeout:10000}), '');
    let calls=0;assert.equal(await probe({}, {loadSdk:async()=>{calls++;throw 0;}}),null);assert.equal(calls,0);
    for(const labels of [{PRIVATE_MEDIA_OBJECT_PROBE_MODE:undefined},{PRIVATE_MEDIA_OBJECT_PROBE_MODE:'other'},
      {PRIVATE_MEDIA_OBJECT_PROBE_STORE_ID:'store_other'},{PRIVATE_MEDIA_OBJECT_PROBE_RUN_ID:'other'},{PRIVATE_MEDIA_OBJECT_PROBE_EXTRA:'unused'},
      {PRIVATE_MEDIA_OIDC_PROBE_MODE:'production-allow'}]){
      const value=await probe({...environment(),...labels},{loadSdk:async()=>{calls++;throw 0;}});closed(value);assert.equal(value.ok,false);assert.equal(value.writeAttempted,false);
    }
    assert.equal(calls,0);
    assert.throws(()=>execFileSync(process.execPath,['scripts/private-media-object-probe.mjs','extra'],{env:isolated.env,stdio:'pipe',timeout:10000}));
  }finally{await isolated.cleanup();}
});

test('fixed Production assertion reuses full guarded context and exact token continuity without provider calls',()=>{
  const env=environment(),token=assertPrivateMediaNativeContext(env,Date.now());assert.equal(token,env.VERCEL_OIDC_TOKEN);
  assert.equal(assertPrivateMediaNativeContext(env,Date.now(),token),token);
  for(const value of [environment({environment:'preview'}),environment({owner_id:'other'}),environment({exp:0}),{...env,VERCEL:undefined}])assert.throws(()=>assertPrivateMediaNativeContext(value,Date.now()));
  assert.throws(()=>assertPrivateMediaNativeContext(env,Date.now(),'other'));
});

test('one complete synthetic roundtrip validates bytes, conditional semantics, denial bracket and exact-key deletion',async()=>{
  const f=fixture();let optionReads=0;Object.defineProperty(f.env,'NODE_OPTIONS',{enumerable:true,get(){optionReads++;throw 0;}});
  const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.ok,true);assert.equal(value.phase,'complete');assert.equal(value.outcome,'passed');
  assert.deepEqual(Object.values(value.checks),[true,true,true,true,true]);assert.equal(optionReads,0);
  assert.deepEqual(f.calls,['list','put','head','grant','presign','range','stale','unsigned','head','delete','head','list']);
});

test('other environments, full bad identities and existing overrides fail before any object request',async()=>{
  for(const env of [environment({environment:'preview'}),environment({project_id:'other'}),environment({exp:0}),environment({}, {VERCEL_ENV:'preview'}),
    environment({}, {DEBUG:'synthetic-sensitive'}),environment({}, {VERCEL_BLOB_API_URL:'https://invalid.example'}),environment({}, {NODE_TLS_REJECT_UNAUTHORIZED:'0'})]){
    const f=fixture();closed(await probe(env,f.dependencies));assert.equal(f.calls.includes('put'),false);assert.equal(f.calls.length,0);
  }
  const f=fixture();f.hooks.list=()=>{throw new BlobError('synthetic-sensitive provider error');};const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.writeAttempted,false);assert.deepEqual(f.calls,['list']);
});

test('unknown PUT and malformed object facts stop with no cleanup/replay or later read',async()=>{
  for(const change of [()=>{throw new BlobError('synthetic-sensitive');},f=>({...f.object(),url:'https://invalid.example/object'}),f=>({...f.object(),pathname:'other'}),
    f=>({...f.object(),contentType:'audio/wav'}),f=>({...f.object(),etag:'W/"weak"'}),f=>({...f.object(),etag:'"bad\r\n"'}),f=>({...f.object(),etag:'"'+'a'.repeat(255)+'"'})]){
    const f=fixture();f.hooks.put=()=>change(f);const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.outcome,'requires-reconciliation');assert.equal(value.writeAttempted,true);assert.deepEqual(f.calls,['list','put']);
  }
  const f=fixture();f.hooks.head=()=>({...f.object(),size:65});const value=await probe(f.env,f.dependencies);assert.equal(value.ok,false);assert.deepEqual(f.calls,['list','put','head']);
});

test('overscoped signed material and wrong object origin cannot produce a byte request',async()=>{
  for(const mutation of [scope=>{scope.pathname='*';},scope=>{scope.operations.push('put');},scope=>{scope.storeId='store_other';},scope=>{scope.validUntil+=1;}]){
    const f=fixture();f.hooks.grant=options=>{const scope={storeId:I.storeId,pathname:key,operations:['get'],validUntil:options.validUntil};mutation(scope);
      return {delegationToken:`${encode(scope)}.${encode('sig')}`,clientSigningToken:'a'.repeat(43),validUntil:options.validUntil};};
    const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.ok,false);assert.equal(f.calls.includes('range'),false);assert.equal(f.calls.includes('delete'),false);
  }
  const f=fixture();f.hooks.presign=()=>({presignedUrl:'https://invalid.example/signed'});assert.equal((await probe(f.env,f.dependencies)).ok,false);assert.equal(f.calls.includes('range'),false);
});

test('successful range requires exact status, type, ETag, range, declared length and actual sixteen bytes',async()=>{
  for(const response of [()=>new Response(bytes().slice(0,16),{status:200}),()=>new Response(bytes().slice(0,16),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 1-16/64',etag:tag,'content-length':'16'}}),
    ()=>new Response(bytes().slice(0,17),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 0-15/64',etag:tag,'content-length':'16'}}),
    ()=>new Response(new Uint8Array(16),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 0-15/64',etag:tag,'content-length':'16'}})]){
    const f=fixture();f.hooks.range=response;const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.checks.rangeVerified,false);assert.equal(f.calls.includes('delete'),false);
  }
});

test('stale If-Match must specifically fail412 and unsigned access must be auth denial, never404 or transport failure',async()=>{
  for(const stage of ['stale','unsigned'])for(const status of [200,206,404,500]){
    const f=fixture();f.hooks[stage]=()=>new Response(null,{status});const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.ok,false);assert.equal(f.calls.includes('delete'),false);
  }
  for(const stage of ['stale','unsigned']){
    const f=fixture();f.hooks[stage]=()=>new Response(new Uint8Array(4097),{status:stage==='stale'?412:403});assert.equal((await probe(f.env,f.dependencies)).ok,false);assert.equal(f.calls.includes('delete'),false);
    const g=fixture();g.hooks[stage]=()=>{throw Error('synthetic-sensitive transport');};assert.equal((await probe(g.env,g.dependencies)).ok,false);assert.equal(g.calls.includes('delete'),false);
  }
});

test('only the specific same-object absence passes; conditional delete uncertainty never triggers cleanup replay',async()=>{
  const failed=fixture();failed.hooks.delete=()=>{throw new BlobError('synthetic-sensitive');};const value=await probe(failed.env,failed.dependencies);closed(value);assert.equal(value.outcome,'requires-reconciliation');assert.equal(failed.calls.filter(v=>v==='delete').length,1);
  const absent=fixture();let heads=0;absent.hooks.head=()=>{heads++;if(heads===3)throw new BlobError('synthetic-sensitive404');return absent.object();};
  const result=await probe(absent.env,absent.dependencies);closed(result);assert.equal(result.checks.deleted,false);assert.equal(absent.calls.filter(v=>v==='delete').length,1);
});

test('fresh native identity guards every continuation, including after final deletion and metadata proof',async()=>{
  for(const stage of ['put','range','delete']){
    const f=fixture();if(stage==='put')f.hooks.put=()=>{f.env.VERCEL='0';return f.object();};
    if(stage==='range')f.hooks.range=()=>{f.env.VERCEL_OIDC_TOKEN+='a';return new Response(bytes().slice(0,16),{status:206});};
    if(stage==='delete')f.hooks.delete=()=>{f.env.VERCEL_ORG_ID='other';};
    const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.ok,false);assert.equal(value.outcome,'requires-reconciliation');
    if(stage!=='delete')assert.equal(f.calls.includes('delete'),false);else assert.equal(f.calls.filter(v=>v==='head').length,2);
  }
});

test('deadlines bound stalled imports, PUT and byte bodies; late settlement starts no later action',async()=>{
  let release,loads=0;const f=fixture();
  const value=await probe(f.env,{...f.dependencies,callTimeoutMs:5,loadSdk:()=>{loads++;return new Promise(resolve=>{release=()=>resolve(f.sdk);});}});
  closed(value);assert.equal(value.phase,'deadline');release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0);assert.equal(loads,1);
  const p=fixture();let putRelease;p.hooks.put=()=>new Promise(resolve=>{putRelease=()=>resolve(p.object());});
  const pending=await probe(p.env,{...p.dependencies,callTimeoutMs:5});closed(pending);assert.equal(pending.outcome,'requires-reconciliation');putRelease();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(p.calls,['list','put']);
  const b=fixture();let canceled=0;b.hooks.range=()=>new Response(new ReadableStream({cancel(){canceled++;return new Promise(()=>{});}}),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 0-15/64',etag:tag,'content-length':'16'}});
  const body=await probe(b.env,{...b.dependencies,bodyIdleMs:5});closed(body);assert.equal(body.phase,'deadline');assert.equal(canceled,1);assert.equal(b.calls.includes('delete'),false);
  const late=fixture();let finishFetch,discarded=0;late.hooks.range=()=>new Promise(resolve=>{finishFetch=()=>resolve(new Response(new ReadableStream({cancel(){discarded++;}}),{status:206}));});
  const timed=await probe(late.env,{...late.dependencies,callTimeoutMs:5});closed(timed);finishFetch();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(discarded,1);assert.equal(late.calls.includes('delete'),false);
});

test('invalid timeout increases and malformed cancellation surfaces remain fixed failures',async()=>{
  for(const setting of [{callTimeoutMs:10001},{bodyIdleMs:5001},{totalTimeoutMs:90001},{callTimeoutMs:0},{totalTimeoutMs:1.5}]){
    const f=fixture();const value=await probe(f.env,{...f.dependencies,...setting});closed(value);assert.equal(f.calls.length,0);assert.equal(value.writeAttempted,false);
  }
  const f=fixture();f.hooks.range=()=>({body:{cancel(){throw Error('synthetic-sensitive');}},url:'',headers:new Headers(),status:206});
  const value=await probe(f.env,f.dependencies);closed(value);assert.equal(value.outcome,'requires-reconciliation');assert.equal(f.calls.includes('delete'),false);
});

test('actual pinned SDK uses explicitOIDC, one nonoverwriting PUT, read-only signing scope and original-ETag exact-key delete',async()=>{
  const previous=getGlobalDispatcher(),agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent);
  try{
    const control=agent.get('https://vercel.com'),objects=agent.get(origin),env=environment();let lists=0,heads=0,puts=0,deletes=0,signed=0,fetches=0;
    const facts={url,pathname:key,contentType:'application/octet-stream',etag:tag,size:64,uploadedAt:new Date().toISOString(),downloadUrl:url};
    const headers={ 'content-type':'application/json' };
    control.intercept({method:'GET',path:path=>{const u=new URL(path,'https://vercel.com');return u.pathname==='/api/blob'&&u.searchParams.get('limit')==='1';}})
      .reply(()=>{lists++;return {statusCode:200,data:{blobs:[],hasMore:false},responseOptions:{headers}};}).times(2);
    control.intercept({method:'PUT',path:path=>new URL(path,'https://vercel.com').searchParams.get('pathname')===key})
      .reply(options=>{puts++;assert.deepEqual(new Uint8Array(options.body),bytes());const h=new Headers(options.headers);assert.equal(h.get('authorization'),`Bearer ${env.VERCEL_OIDC_TOKEN}`);assert.equal(h.get('x-add-random-suffix'),'0');assert.equal(h.get('x-allow-overwrite'),'0');return {statusCode:200,data:facts,responseOptions:{headers}};});
    control.intercept({method:'GET',path:path=>new URL(path,'https://vercel.com').searchParams.get('url')===key})
      .reply(()=>{heads++;return {statusCode:200,data:facts,responseOptions:{headers}};}).times(2);
    control.intercept({method:'POST',path:'/api/blob/signed-token'}).reply(options=>{
      signed++;const body=JSON.parse(options.body);assert.equal(body.pathname,key);assert.deepEqual(body.operations,['get']);assert.ok(body.validUntil>Date.now()&&body.validUntil<=Date.now()+60000);
      return {statusCode:200,data:{delegationToken:`${encode({storeId:I.storeId,pathname:key,operations:['get'],validUntil:body.validUntil})}.${encode('sig')}`,clientSigningToken:'a'.repeat(43),validUntil:body.validUntil},responseOptions:{headers}};
    });
    objects.intercept({method:'GET',path:path=>{const u=new URL(path,origin);return u.pathname===`/${key}`&&u.searchParams.has('vercel-blob-delegation');}}).reply(options=>{
      fetches++;const h=new Headers(options.headers);assert.equal(h.get('range'),'bytes=0-15');assert.equal(h.get('authorization'),null);
      if(h.get('if-match')!==tag)return {statusCode:412,data:'',responseOptions:{headers:{'content-type':'text/plain'}}};
      return {statusCode:206,data:Buffer.from(bytes().slice(0,16)),responseOptions:{headers:{'content-type':'application/octet-stream','content-range':'bytes 0-15/64',etag:tag,'content-length':'16'}}};
    }).times(2);
    objects.intercept({method:'GET',path:`/${key}?cache=0`}).reply(()=>{fetches++;return {statusCode:403,data:'',responseOptions:{headers:{'content-type':'text/plain'}}};});
    control.intercept({method:'POST',path:'/api/blob/delete'}).reply(options=>{deletes++;assert.deepEqual(JSON.parse(options.body),{urls:[key]});assert.equal(new Headers(options.headers).get('x-if-match'),tag);return {statusCode:200,data:{},responseOptions:{headers}};});
    control.intercept({method:'GET',path:path=>new URL(path,'https://vercel.com').searchParams.get('url')===key})
      .reply(()=>{heads++;return {statusCode:404,data:{error:{code:'not_found',message:'synthetic-sensitive'}},responseOptions:{headers}};});
    const result=await probe(env,{fetch:undiciFetch});closed(result);assert.equal(result.ok,true);assert.deepEqual([lists,heads,puts,deletes,signed,fetches],[2,3,1,1,1,3]);agent.assertNoPendingInterceptors();
  }finally{setGlobalDispatcher(previous);await agent.close();}
});

test('actual SDK ambiguous PUT503 dispatches once and cannot trigger reads, deletion or an automatic retry',async()=>{
  const previous=getGlobalDispatcher(),agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent);
  try{
    const control=agent.get('https://vercel.com');let putCalls=0;
    control.intercept({method:'GET',path:path=>new URL(path,'https://vercel.com').searchParams.get('limit')==='1'}).reply(200,{blobs:[],hasMore:false});
    control.intercept({method:'PUT',path:path=>new URL(path,'https://vercel.com').searchParams.get('pathname')===key})
      .reply(()=>{putCalls++;return {statusCode:503,data:{error:{code:'service_unavailable',message:'synthetic-sensitive'}}};}).persist();
    const value=await probe(environment());closed(value);assert.equal(value.outcome,'requires-reconciliation');assert.equal(putCalls,1);assert.equal(value.checks.putVerified,false);
  }finally{setGlobalDispatcher(previous);await agent.close();}
});
