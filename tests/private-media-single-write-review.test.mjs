import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {PRIVATE_MEDIA_SINGLE_WRITE_PROBE as P,singleWriteBody,singleWriteProtocol,startSingleWriteTransport,runPrivateMediaSingleWriteProbe as probe} from '../scripts/private-media-single-write-probe.mjs';
const run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tag='"prior-object"';
const input=(kind='upload')=>({run,slot:'held',kind,...kind==='permit'?{}:{ifMatch:tag},oidcToken:'synthetic'});
const digest=value=>createHash('sha256').update(value).digest('hex');
const blocked=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function wire(){
  let req,socket,responseCallback,sentOptions,destroyed=0;const writes=[],trace=[];
  const request=(options,callback)=>{
    sentOptions=options;responseCallback=callback;req=new EventEmitter();socket=new EventEmitter();socket.encrypted=true;socket.authorized=true;
    req.write=(bytes,done)=>{writes.push(Buffer.from(bytes));trace.push('prefix');queueMicrotask(()=>done?.());return true;};
    req.end=(bytes,done)=>{writes.push(Buffer.from(bytes));trace.push('end');queueMicrotask(()=>done?.());};
    req.destroy=()=>{destroyed++;trace.push('destroy');};
    req.flushHeaders=()=>{trace.push('headers');queueMicrotask(()=>{req.emit('socket',socket);socket.emit('secureConnect');req.emit('continue');});};
    return req;
  };
  const respond=(status,body,alter=()=>{})=>{
    const response=new EventEmitter();response.statusCode=status;response.complete=true;response.headers={'content-length':String(Buffer.byteLength(body))};response.destroy=()=>{destroyed++;};
    responseCallback(response);alter(response);response.emit('data',Buffer.from(body));response.emit('end');return response;
  };
  return {request,respond,writes,trace,get req(){return req;},get options(){return sentOptions;},get socket(){return socket;},get destroyed(){return destroyed;}};
}

test('actual pinned SDK ordinary PUT matches closed adapter for all three bodies without multipart or ambient auth',async()=>{
  const previous=getGlobalDispatcher(),previousRetries=process.env.VERCEL_BLOB_RETRIES,agent=new MockAgent();process.env.VERCEL_BLOB_RETRIES="0";agent.disableNetConnect();setGlobalDispatcher(agent);
  try{
    const sdk=await import('@vercel/blob'),pool=agent.get('https://vercel.com');let count=0;
    for(const kind of ['permit','upload','retire']){
      const raw=singleWriteProtocol(input(kind)),critical=['authorization','x-vercel-blob-store-id','x-api-version','x-api-blob-request-attempt','x-vercel-blob-access','x-content-type','x-add-random-suffix','x-allow-overwrite','x-cache-control-max-age','x-if-match'];
      pool.intercept({method:'PUT',path:path=>path===raw.options.path}).reply(options=>{
        count++;const headers=new Headers(options.headers);
        for(const key of critical)assert.equal(headers.get(key),raw.options.headers[key]??null,`semantic header ${key}`);
        assert.equal(digest(Buffer.from(options.body)),digest(raw.body));
        assert.match(headers.get('x-api-blob-request-id'),new RegExp(`^${P.storeId.slice(6)}:[0-9]+:[a-f0-9]+$`));
        return {statusCode:200,data:{url:'https://example.invalid/synthetic',pathname:'synthetic',contentType:'application/octet-stream',contentDisposition:'attachment',etag:'"synthetic"'},responseOptions:{headers:{'content-type':'application/json'}}};
      });
      await sdk.put(raw.url.searchParams.get('pathname'),raw.body,{abortSignal:AbortSignal.timeout(1000),oidcToken:'synthetic',storeId:P.storeId,access:'private',contentType:'application/octet-stream',addRandomSuffix:false,allowOverwrite:kind!=='permit',multipart:false,cacheControlMaxAge:60,...kind==='permit'?{}:{ifMatch:tag}});
      assert.equal(raw.url.origin,'https://vercel.com');assert.equal(raw.options.port,443);assert.equal(raw.options.rejectUnauthorized,true);assert.equal(raw.options.agent,false);
      assert.equal(raw.options.method,'PUT');assert.equal(raw.options.path.startsWith('/api/blob/?pathname='),true);
    }
    assert.equal(count,3);agent.assertNoPendingInterceptors();
    const a=singleWriteProtocol(input()),b=singleWriteProtocol(input());assert.notEqual(a.options.headers['x-api-blob-request-id'],b.options.headers['x-api-blob-request-id']);
  }finally{if(previousRetries===undefined)delete process.env.VERCEL_BLOB_RETRIES;else Reflect.set(process.env,"VERCEL_BLOB_RETRIES",previousRetries);setGlobalDispatcher(previous);await agent.close();}
});

test('raw held upload sends only positive prefix until explicit finish and verified R dispatch can precede suffix',async()=>{
  const u=wire(),r=wire(),signal=new AbortController().signal;
  const held=startSingleWriteTransport(input(),{signal,request:u.request});await held.dispatched;
  assert.equal(u.options.headers.expect,"100-continue");assert.equal(u.options.headers["content-length"],String(P.uploadBytes));assert.equal(u.options.rejectUnauthorized,true);assert.equal(u.options.agent,false);
  assert.equal(Buffer.concat(u.writes).length,P.prefixBytes);assert.ok(P.prefixBytes>0&&P.prefixBytes<P.uploadBytes);assert.equal(u.trace.includes('end'),false);
  const retiring=startSingleWriteTransport(input('retire'),{signal,request:r.request});await retiring.dispatched;
  assert.equal(Buffer.concat(r.writes).length,P.retireBytes);
  held.finish();assert.equal(Buffer.concat(u.writes).length,P.uploadBytes);
  r.respond(200,'{"etag":"synthetic"}');u.respond(412,'{"error":{"code":"precondition_failed"}}');
  assert.deepEqual((await Promise.all([held.result,retiring.result])).map(value=>value.status),[412,200]);
  assert.equal(held.evidence(),'continue');held.destroy();retiring.destroy();
});

test('raw response rejects unrelated or malformed 412 instead of treating status alone as known OCC conflict',async()=>{
  for(const body of ['{"error":{"code":"not_allowed"}}','{}','[]','not-json']){
    const f=wire(),t=startSingleWriteTransport(input('retire'),{signal:new AbortController().signal,request:f.request});await t.dispatched;
    f.respond(412,body);await assert.rejects(t.result);assert.ok(f.destroyed>0);t.destroy();
  }
});

test('raw progress idle fence rejects event-loop-starved data before progress can reset the deadline',async()=>{
  const f=wire(),t=startSingleWriteTransport(input('retire'),{signal:new AbortController().signal,request:f.request,callTimeoutMs:1000,bodyIdleMs:5});await t.dispatched;
  f.respond(200,'{}',()=>blocked(25));await assert.rejects(t.result);assert.ok(f.destroyed>0);t.destroy();
});

test('late event after abort cannot send held suffix or restore positive result',async()=>{
  const f=wire(),controller=new AbortController(),t=startSingleWriteTransport(input(),{signal:controller.signal,request:f.request});await t.dispatched;
  controller.abort();assert.throws(()=>t.finish());f.req.emit('continue');f.respond(200,'{}');await assert.rejects(t.result);
  assert.equal(Buffer.concat(f.writes).length,P.prefixBytes);assert.ok(f.destroyed>0);
});

test('odd marker lengths distinguish every allowed even chunk and retained protocol has no caller endpoint or auth bag',()=>{
  assert.equal(singleWriteBody('permit').length%2,1);assert.equal(singleWriteBody('retire').length%2,1);assert.equal(singleWriteBody('upload').length%2,0);
  assert.notEqual(digest(singleWriteBody('permit')),digest(singleWriteBody('retire')));
  for(const value of [{...input(),run:'../escape'}, {...input(),slot:'../../other'}, {...input(),ifMatch:'W/"weak"'}, {...input(),ifMatch:'"bad\r\nvalue"'}])assert.throws(()=>singleWriteProtocol(value));
  const protocol=singleWriteProtocol({...input(),url:'https://example.invalid',headers:{authorization:'ignored'}});
  assert.equal(protocol.url.origin,'https://vercel.com');assert.equal(protocol.options.headers.authorization,'Bearer synthetic');
});

test('partial or combined selection fails before identity, SDK, raw request and legacy write opportunity',async()=>{
  let loads=0,requests=0,tokenReads=0;
  const dependencies={loadSdk:()=>{loads++;throw 0;},request:()=>{requests++;throw 0;}};
  assert.equal(await probe({},dependencies),null);
  for(const fields of [{PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId},{PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode},
    {PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run,PRIVATE_MEDIA_OBJECT_PROBE_MODE:'roundtrip-v1'},
    {PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE:P.mode,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_SINGLE_WRITE_PROBE_RUN_ID:run,PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:run}]){
    const env={...fields};Object.defineProperty(env,'VERCEL_OIDC_TOKEN',{enumerable:true,get(){tokenReads++;throw 0;}});
    const value=await probe(env,dependencies);assert.equal(value.ok,false);assert.equal(value.phase,'selection');assert.equal(value.writeAttempted,false);
  }
  assert.deepEqual([loads,requests,tokenReads],[0,0,0]);
});
test('unverified TLS or context invalidation before secure dispatch sends zero synthetic body bytes',async()=>{
  for(const cause of ['tls','context']){
    const f=wire();let allowed=true;
    const t=startSingleWriteTransport(input(),{signal:new AbortController().signal,request:f.request,live:()=>{if(!allowed)throw 0;}});
    if(cause==='tls')f.socket.authorized=false;else allowed=false;
    await assert.rejects(t.dispatched);await assert.rejects(t.result);
    assert.equal(f.writes.length,0);assert.ok(f.destroyed>0);t.destroy();
  }
});
