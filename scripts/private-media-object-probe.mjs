import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {PRIVATE_MEDIA_PROBE,runPrivateMediaOidcProbe,assertPrivateMediaNativeContext} from './private-media-oidc-probe.mjs';

export const PRIVATE_MEDIA_OBJECT_PROBE=Object.freeze({
  schema:'private-media-object-roundtrip/v1',mode:'roundtrip-v1',storeId:PRIVATE_MEDIA_PROBE.storeId,
  markerBytes:64,rangeBytes:16,errorBytes:4096,etagBytes:256,grantMs:60000,
  callTimeoutMs:10000,bodyIdleMs:5000,totalTimeoutMs:90000,maxApplicationCalls:12,
  maxConsecutiveEmptyChunks:64,
  phases:Object.freeze(['selection','metadata-before','sdk-load','put','head-before','grant','presign','range',
    'stale-etag','unsigned','head-after','delete','absence','metadata-after','complete','deadline']),
});
const P=PRIVATE_MEDIA_OBJECT_PROBE,need=value=>{if(!value)throw 0;};
const prefix='PRIVATE_MEDIA_OBJECT_PROBE_',flags=['MODE','STORE_ID','RUN_ID'].map(s=>prefix+s);
const marker=()=>Uint8Array.from({length:P.markerBytes},(_,index)=>index);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function discard(resource){
  try{void Promise.resolve(resource?.cancel()).catch(()=>{});}catch{}
  try{resource?.releaseLock?.();}catch{}
}
const etag=value=>typeof value==='string'&&value.length<=P.etagBytes&&/^"[\x21\x23-\x7e]+"$/.test(value);
const fixedOrigin=new URL(`https://${P.storeId.slice('store_'.length)}.private.blob.vercel-storage.com`).origin;
function selection(env){
  const supplied=Object.keys(env).filter(key=>key.startsWith(prefix));
  if(!supplied.length)return null;
  need(supplied.length===flags.length&&supplied.every(key=>flags.includes(key))&&env[flags[0]]===P.mode&&env[flags[1]]===P.storeId);
  const run=env[flags[2]];need(typeof run==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(run));
  need(!Object.keys(env).some(key=>key.startsWith('PRIVATE_MEDIA_OIDC_PROBE_')));
  return {run,key:`acceptance/${run}/roundtrip-marker.bin`};
}
// Copy names/accessors, never environment values or NODE_OPTIONS. The original
// metadata probe alone supplies override checks and actual permission evidence.
function metadataEnvironment(env,run){
  const flags={PRIVATE_MEDIA_OIDC_PROBE_MODE:'production-allow',PRIVATE_MEDIA_OIDC_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:run};
  // Forward future guard keys too. A snapshot of initial property names would
  // hide endpoint/debug/CA overrides introduced during asynchronous work.
  return new Proxy(Object.create(null),{
    ownKeys:()=>[...new Set([...Object.keys(env).filter(key=>key!=='NODE_OPTIONS'&&!key.startsWith(prefix)),...Object.keys(flags)])],
    getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}),
    get:(_,key)=>Object.hasOwn(flags,key)?flags[key]:key==='NODE_OPTIONS'?undefined:env[key],
    set:(_,key,value)=>Reflect.set(env,key,value),
    deleteProperty:(_,key)=>Reflect.deleteProperty(env,key),
  });
}
function urlFor(value,key,signed=false,delegation){
  need(typeof value==='string'&&value.length<=8192);
  const url=new URL(value);need(url.origin===fixedOrigin&&url.pathname===`/${key}`&&!url.username&&!url.password&&!url.hash);
  if(!signed)need(!url.search);
  else{
    need(url.searchParams.size===3&&url.searchParams.get('cache')==='0'
      &&url.searchParams.get('vercel-blob-delegation')===delegation
      &&/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('vercel-blob-signature')??''));
  }
  return url;
}
function verifyObject(value,key,expectedEtag,withSize){
  need(object(value)&&value.pathname===key&&value.contentType==='application/octet-stream'&&etag(value.etag));
  urlFor(value.url,key);if(expectedEtag!==undefined)need(value.etag===expectedEtag);
  if(withSize)need(value.size===P.markerBytes);
  return value.etag;
}
function verifyGrant(value,key,requestedUntil,now){
  need(object(value)&&typeof value.delegationToken==='string'&&value.delegationToken.length<=4096
    &&typeof value.clientSigningToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.clientSigningToken)
    &&Number.isSafeInteger(value.validUntil)&&value.validUntil>now&&value.validUntil<=requestedUntil);
  const parts=value.delegationToken.split('.');need(parts.length===2&&parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)));
  const bytes=Buffer.from(parts[0],'base64url');need(bytes.toString('base64url')===parts[0]);
  const scope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  need(object(scope)&&typeof scope.storeId==='string'&&scope.storeId.replace(/^store_/,'').toLowerCase()===P.storeId.slice(6).toLowerCase()
    &&scope.pathname===key&&Array.isArray(scope.operations)&&scope.operations.length===1&&scope.operations[0]==='get'&&scope.validUntil===value.validUntil);
}

/** Unwired dedicated prebuild probe. SDK control JSON inherits the reviewed
 * trusted-provider exception: abort/deadlines and retry0, but no strict control
 * response-byte, redirect or wire-dispatch bound. Object fetches are bounded. */
export async function runPrivateMediaObjectProbe(env=process.env,dependencies={}){
  let phase='selection',writeAttempted=false,finished=false,totalTimer,token,selected;
  const checks={putVerified:false,rangeVerified:false,staleEtagDenied:false,unsignedDenied:false,deleted:false};
  const controller=new AbortController(),resources=new Set();
  const result=(ok,outcome)=>Object.freeze({schema:P.schema,ok,phase,outcome,writeAttempted,checks:Object.freeze({...checks})});
  const monotonic=()=>performance.now(),now=dependencies.now??Date.now;
  let end,callMs,idleMs,applicationCalls=0;
  function live(){
    if(monotonic()>=end){phase='deadline';controller.abort();}
    need(!finished&&!controller.signal.aborted);
    assertPrivateMediaNativeContext(env,now(),token);
  }
  async function bounded(action,ms,onTimeout){
    let timer;const deadline=monotonic()+ms;
    try{
      const value=await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>{onTimeout?.();reject(0);},ms);})]);
      // Timers cannot preempt SDK JSON parsing or a synchronous stream read.
      // Recheck elapsed time before any result can advance the probe.
      if(monotonic()>=deadline){onTimeout?.();throw 0;}
      return value;
    }finally{clearTimeout(timer);}
  }
  async function step(label,action,provider=true){
    phase=label;live();
    const duration=Math.max(1,Math.min(callMs,end-monotonic()));
    const value=await bounded(()=>{live();if(provider)need(++applicationCalls<=P.maxApplicationCalls);return action(controller.signal);},duration,()=>{phase='deadline';controller.abort();});
    live();return value;
  }
  async function body(response,limit,expected){
    need(!response.headers.has('content-length')||/^\d+$/.test(response.headers.get('content-length'))&&Number(response.headers.get('content-length'))<=limit);
    if(!response.body){need(!expected&&(!response.headers.has('content-length')||response.headers.get('content-length')==='0'));return;}
    const reader=response.body.getReader();resources.delete(response.body);resources.add(reader);
    let total=0,empty=0,progressDeadline=monotonic()+idleMs;const chunks=[];
    try{
      for(;;){
        live();const remaining=progressDeadline-monotonic();if(remaining<=0){phase='deadline';controller.abort();throw 0;}
        const part=await bounded(()=>reader.read(),Math.min(remaining,end-monotonic()),()=>{phase='deadline';controller.abort();});live();
        if(part.done)break;need(part.value instanceof Uint8Array);total+=part.value.byteLength;need(total<=limit);
        if(part.value.byteLength){empty=0;progressDeadline=monotonic()+idleMs;if(expected)chunks.push(part.value);}
        else need(++empty<=P.maxConsecutiveEmptyChunks);
      }
      if(expected){need(total===expected.length);let offset=0;for(const chunk of chunks)for(const byte of chunk)need(byte===expected[offset++]);}
    }finally{resources.delete(reader);discard(reader);}
  }
  try{
    selected=selection(env);if(!selected)return null;
    for(const [value,max] of [[dependencies.callTimeoutMs??P.callTimeoutMs,P.callTimeoutMs],[dependencies.bodyIdleMs??P.bodyIdleMs,P.bodyIdleMs],[dependencies.totalTimeoutMs??P.totalTimeoutMs,P.totalTimeoutMs]])need(Number.isSafeInteger(value)&&value>0&&value<=max);
    callMs=dependencies.callTimeoutMs??P.callTimeoutMs;idleMs=dependencies.bodyIdleMs??P.bodyIdleMs;end=monotonic()+(dependencies.totalTimeoutMs??P.totalTimeoutMs);
    totalTimer=setTimeout(()=>{phase='deadline';controller.abort();},dependencies.totalTimeoutMs??P.totalTimeoutMs);
    // Identity before the first list rejects other environments; metadata then
    // repeats all full override/native checks and performs actual provider I/O.
    token=assertPrivateMediaNativeContext(env,now());
    const facade=metadataEnvironment(env,selected.run);
    const loadSdk=async()=>{
      live();
      if(!dependencies.loadSdk){
        const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.resolve('@vercel/blob')),'utf8'));
        live();need(metadata.version===PRIVATE_MEDIA_PROBE.sdkVersion);
      }
      const value=await(dependencies.loadSdk??(()=>import('@vercel/blob')))();live();return value;
    };
    async function metadata(label){
      const value=await step(label,()=>runPrivateMediaOidcProbe(facade,{now,timeoutMs:Math.max(1,Math.floor(Math.min(callMs,end-monotonic()))),loadSdk}));
      need(value?.ok===true&&value.mode==='production-allow'&&value.environmentMatch===true&&value.outcome==='allowed');
    }
    await metadata('metadata-before');
    const sdk=await step('sdk-load',loadSdk,false);
    const options=()=>({oidcToken:token,storeId:P.storeId,abortSignal:controller.signal});
    const value=await step('put',signal=>{writeAttempted=true;return sdk.put(selected.key,marker(),{...options(),access:'private',contentType:'application/octet-stream',addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:60,abortSignal:signal});});
    const originalEtag=verifyObject(value,selected.key);
    verifyObject(await step('head-before',()=>sdk.head(selected.key,options())),selected.key,originalEtag,true);checks.putVerified=true;
    const until=now()+P.grantMs;
    const grant=await step('grant',()=>sdk.issueSignedToken({...options(),pathname:selected.key,operations:['get'],validUntil:until}));
    verifyGrant(grant,selected.key,until,now());
    const signed=await step('presign',()=>sdk.presignUrl(grant,{operation:'get',pathname:selected.key,access:'private',validUntil:grant.validUntil,useCache:false}),false);
    const signedUrl=urlFor(signed?.presignedUrl,selected.key,true,grant.delegationToken);
    const fetcher=dependencies.fetch??globalThis.fetch;
    async function fetchObject(label,url,headers){
      const response=await step(label,async signal=>{
        const response=await fetcher(url,{method:'GET',headers,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});
        if(finished||controller.signal.aborted){discard(response?.body);throw 0;}
        if(response?.body)resources.add(response.body);return response;
      });
      need(object(response)&&Number.isInteger(response.status)&&response.headers&&typeof response.headers.get==='function'&&!response.redirected&&typeof response.url==='string');
      if(response.url)urlFor(response.url,selected.key,url===signedUrl,grant.delegationToken);
      return response;
    }
    const range=await fetchObject('range',signedUrl,{Range:'bytes=0-15','If-Match':originalEtag});
    need(range.status===206&&range.headers.get('content-range')==='bytes 0-15/64'&&range.headers.get('etag')===originalEtag
      &&range.headers.get('content-type')==='application/octet-stream'&&range.headers.get('content-length')==='16');
    await body(range,P.rangeBytes,marker().subarray(0,P.rangeBytes));checks.rangeVerified=true;
    const stale=originalEtag==='"object-probe-stale-a"'?'"object-probe-stale-b"':'"object-probe-stale-a"';
    const rejected=await fetchObject('stale-etag',signedUrl,{Range:'bytes=0-15','If-Match':stale});need(rejected.status===412);
    await body(rejected,P.errorBytes);checks.staleEtagDenied=true;
    const unsignedUrl=urlFor(value.url,selected.key);unsignedUrl.searchParams.set('cache','0');
    // Same exact object/origin, with no delegation/signature/Authorization.
    const denied=await step('unsigned',async signal=>{const response=await fetcher(unsignedUrl,{method:'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});
      if(finished||controller.signal.aborted){discard(response?.body);throw 0;}if(response?.body)resources.add(response.body);return response;});
    need(object(denied)&&denied.headers&&typeof denied.headers.get==='function'&&!denied.redirected&&[401,403].includes(denied.status));
    if(denied.url){const observed=new URL(denied.url);need(observed.origin===fixedOrigin&&observed.pathname===`/${selected.key}`&&observed.search==='?cache=0'&&!observed.hash&&!observed.username&&!observed.password);}
    await body(denied,P.errorBytes);
    verifyObject(await step('head-after',()=>sdk.head(selected.key,options())),selected.key,originalEtag,true);checks.unsignedDenied=true;
    await step('delete',()=>sdk.del(selected.key,{...options(),ifMatch:originalEtag}));
    await step('absence',async()=>{try{await sdk.head(selected.key,options());}catch(error){need(error instanceof sdk.BlobNotFoundError);return;}throw 0;});checks.deleted=true;
    await metadata('metadata-after');live();need(Object.values(checks).every(value=>value===true));phase='complete';return result(true,'passed');
  }catch{return result(false,writeAttempted?'requires-reconciliation':'failed');}
  finally{
    finished=true;clearTimeout(totalTimer);controller.abort();
    for(const resource of resources)discard(resource);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const value=process.argv.length===2?await runPrivateMediaObjectProbe():Object.freeze({schema:P.schema,ok:false,phase:'selection',outcome:'failed',writeAttempted:false,
    checks:Object.freeze({putVerified:false,rangeVerified:false,staleEtagDenied:false,unsignedDenied:false,deleted:false})});
  if(value){process.stdout.write(JSON.stringify(value)+'\n');process.exitCode=value.ok?0:1;}
}
