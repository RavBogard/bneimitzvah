import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {PRIVATE_MEDIA_PROBE as I,runPrivateMediaOidcProbe,assertPrivateMediaNativeContext} from './private-media-oidc-probe.mjs';

export const PRIVATE_MEDIA_SINGLE_WRITE_PROBE=Object.freeze({schema:'private-media-single-write/v1',mode:'single-write-v1',storeId:I.storeId,
  permitBytes:31,uploadBytes:1048576,retireBytes:33,prefixBytes:8192,errorBytes:4096,controlBytes:8192,etagBytes:256,
  maxOutgoingBytes:6*1048576,maxApplicationCalls:32,totalTimeoutMs:120000,callTimeoutMs:10000,bodyIdleMs:5000,maxEmptyReads:64,
  phases:Object.freeze(['selection','metadata-before','sdk-load','permit','upload','verify','stale','retire','held-start','retire-dispatch','held-finish','race-resolve','metadata-after','complete','deadline'])});
const P=PRIVATE_MEDIA_SINGLE_WRITE_PROBE,need=v=>{if(!v)throw 0;},object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const prefix='PRIVATE_MEDIA_SINGLE_WRITE_PROBE_',flags=['MODE','STORE_ID','RUN_ID'].map(s=>prefix+s),runPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const tag=v=>typeof v==='string'&&v.length<=P.etagBytes&&/^"[\x21\x23-\x7e]+"$/.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const origin=new URL(`https://${P.storeId.slice(6)}.private.blob.vercel-storage.com`).origin;
export function singleWriteBody(kind){need(['permit','upload','retire'].includes(kind));return Uint8Array.from({length:kind==='permit'?P.permitBytes:kind==='upload'?P.uploadBytes:P.retireBytes},(_,i)=>kind==='permit'?(i*3+7)%256:kind==='retire'?(i*5+193)%256:i%251);}
function keyFor(run,slot){need(typeof run==='string'&&runPattern.test(run)&&['normal','held'].includes(slot));return `acceptance/${run}/single-write/${slot}.bin`;}
/** Closed pinned2.8.2 ordinary PUT mapping. No arbitrary endpoint/header input.
 * Actual SDK MockAgent serialization is the independent compatibility test. */
export function singleWriteProtocol({run,slot,kind,ifMatch,oidcToken}){
  const key=keyFor(run,slot);need(typeof oidcToken==='string'&&oidcToken.length>0&&oidcToken.length<16384&&!/[\r\n]/.test(oidcToken));
  need(kind==='permit'?ifMatch===undefined:tag(ifMatch));const body=singleWriteBody(kind);
  const url=new URL('https://vercel.com/api/blob/');url.searchParams.set('pathname',key);
  const headers={'x-api-blob-request-id':`${P.storeId.slice(6)}:${Date.now()}:${randomBytes(8).toString('hex')}`,'x-vercel-blob-store-id':P.storeId.slice(6),'x-api-blob-request-attempt':'0','x-api-version':'13',
    authorization:`Bearer ${oidcToken}`,'x-vercel-blob-access':'private','x-content-type':'application/octet-stream','x-add-random-suffix':'0','x-allow-overwrite':kind==='permit'?'0':'1','x-cache-control-max-age':'60'};
  if(ifMatch!==undefined)headers['x-if-match']=ifMatch;
  return {url,body,options:{protocol:'https:',hostname:'vercel.com',port:443,path:url.pathname+url.search,method:'PUT',headers,rejectUnauthorized:true,agent:false}};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return {promise,resolve,reject};}
/** Only fixed synthetic bodies/protocol, explicit fresh OIDC, no automatic retry.
 * request injection is for deterministic offline socket/event traces only. */
export function startSingleWriteTransport(input,{signal,request=httpsRequest,live=()=>{},callTimeoutMs=P.callTimeoutMs,bodyIdleMs=P.bodyIdleMs}={}){
  need(signal instanceof AbortSignal&&Number.isSafeInteger(callTimeoutMs)&&callTimeoutMs>0&&callTimeoutMs<=P.callTimeoutMs&&Number.isSafeInteger(bodyIdleMs)&&bodyIdleMs>0&&bodyIdleMs<=P.bodyIdleMs);
  const wire=singleWriteProtocol(input),held=input.kind==='upload',dispatched=deferred(),result=deferred();
  let req,res,timer,idleTimer,done=false,secure=false,flushed=false,continued=false,ended=false,empty=0;const started=performance.now(),chunks=[];let bytes=0,progress=started;
  const clean=()=>{clearTimeout(timer);clearTimeout(idleTimer);signal.removeEventListener('abort',stop);};
  const stop=()=>{if(done)return;done=true;clean();dispatched.reject(0);result.reject(0);try{res?.destroy();}catch{}try{req?.destroy();}catch{}};
  const check=()=>{live();need(!done&&!signal.aborted&&performance.now()-started<callTimeoutMs);if(res)need(performance.now()-progress<bodyIdleMs);};
  const observe=action=>(...args)=>{if(done)return;try{check();action(...args);}catch{stop();}};
  const ready=()=>{if(secure&&flushed)dispatched.resolve(continued?'continue':'prefix-flushed');};
  const armIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(stop,Math.max(1,bodyIdleMs-(performance.now()-progress)));};
  const finish=()=>{check();need(held&&!ended);ended=true;req.end(wire.body.subarray(P.prefixBytes));};
  try{
    check();signal.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,callTimeoutMs);
    const headers={...wire.options.headers,'content-length':String(wire.body.length),'expect':'100-continue'};
    req=request({...wire.options,headers},observe(response=>{
      res=response;need(Number.isInteger(res.statusCode)&&[200,201,412].includes(res.statusCode));
      const limit=res.statusCode===412?P.errorBytes:P.controlBytes;const length=res.headers?.['content-length'];need(length===undefined||typeof length==='string'&&/^\d+$/.test(length)&&Number(length)<=limit);
      progress=performance.now();armIdle();
      res.on('data',observe(chunk=>{need(chunk instanceof Uint8Array);bytes+=chunk.length;need(bytes<=limit);if(chunk.length){progress=performance.now();empty=0;chunks.push(chunk);}else need(++empty<=P.maxEmptyReads);armIdle();}));
      res.on('error',stop);res.on('aborted',stop);
      res.on('end',observe(()=>{need(res.complete===true);const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));need(object(value));if(res.statusCode===412)need(value.error?.code==='precondition_failed');done=true;clean();result.resolve({status:res.statusCode,value,evidence:continued?'continue':'prefix-flushed'});}));
    }));
    req.on('error',stop);req.on('continue',observe(()=>{continued=true;ready();}));
    req.on('socket',observe(socket=>{
      need(socket&&typeof socket.once==='function');socket.once('secureConnect',observe(()=>{
        need(socket.encrypted===true&&socket.authorized===true);secure=true;
        if(held)req.write(wire.body.subarray(0,P.prefixBytes),observe(()=>{flushed=true;ready();}));
        else{ended=true;req.end(wire.body,observe(()=>{flushed=true;ready();}));}
      }));
      socket.once('error',stop);
    }));
    req.flushHeaders();
  }catch{stop();}
  return Object.freeze({dispatched:dispatched.promise,result:result.promise,finish,destroy:stop,evidence:()=>continued?'continue':flushed&&secure?'prefix-flushed':'none'});
}
function selection(env){const supplied=Object.keys(env).filter(k=>k.startsWith(prefix));if(!supplied.length)return null;
  need(supplied.length===3&&supplied.every(k=>flags.includes(k))&&env[flags[0]]===P.mode&&env[flags[1]]===P.storeId);
  const run=env[flags[2]];keyFor(run,'normal');need(!Object.keys(env).some(k=>k.startsWith('PRIVATE_MEDIA_OIDC_PROBE_')||k.startsWith('PRIVATE_MEDIA_OBJECT_PROBE_')));return run;}
function facade(env,run){const f={PRIVATE_MEDIA_OIDC_PROBE_MODE:'production-allow',PRIVATE_MEDIA_OIDC_PROBE_STORE_ID:P.storeId,PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:run};return new Proxy(Object.create(null),{
  ownKeys:()=>[...new Set([...Object.keys(env).filter(k=>k!=='NODE_OPTIONS'&&!k.startsWith(prefix)),...Object.keys(f)])],getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}),get:(_,k)=>Object.hasOwn(f,k)?f[k]:k==='NODE_OPTIONS'?undefined:env[k],set:(_,k,v)=>Reflect.set(env,k,v),deleteProperty:(_,k)=>Reflect.deleteProperty(env,k)});}
function discard(value){try{void Promise.resolve(value?.cancel()).catch(()=>{});}catch{}try{value?.releaseLock?.();}catch{}}

export async function runPrivateMediaSingleWriteProbe(env=process.env,deps={}){
  let phase='selection',writeAttempted=false,finished=false,timer,token,run,race='none',evidence='none',end,callMs,idleMs,calls=0,outgoing=0;
  const checks={ordinaryVerified:false,staleDenied:false,ordinaryRetired:false,heldRetired:false},controller=new AbortController(),resources=new Set(),transports=new Set();
  const result=(ok,outcome)=>Object.freeze({schema:P.schema,ok,phase,outcome,writeAttempted,requiresReconciliation:!ok&&writeAttempted,race,evidence,checks:Object.freeze({...checks})});
  const now=deps.now??Date.now;
  function live(){if(performance.now()>=end){phase='deadline';controller.abort();}need(!finished&&!controller.signal.aborted);assertPrivateMediaNativeContext(env,now(),token);}
  async function bound(action,ms){let t;const deadline=performance.now()+ms;try{const v=await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{t=setTimeout(()=>{phase='deadline';controller.abort();reject(0);},ms);})]);if(performance.now()>=deadline){phase='deadline';controller.abort();throw 0;}live();return v;}finally{clearTimeout(t);}}
  async function step(label,action,provider=true){phase=label;live();return bound(()=>{live();if(provider)need(++calls<=P.maxApplicationCalls);return action();},Math.max(1,Math.min(callMs,end-performance.now())));}
  const spend=body=>{need(body instanceof Uint8Array);outgoing+=body.length;need(outgoing<=P.maxOutgoingBytes);writeAttempted=true;};
  function verify(v,key,expected){need(object(v)&&v.pathname===key&&v.contentType==='application/octet-stream'&&tag(v.etag));const url=new URL(v.url);need(url.origin===origin&&url.pathname===`/${key}`&&!url.search&&!url.hash&&!url.username&&!url.password);if(expected!==undefined)need(v.etag===expected);return v.etag;}
  async function readBody(response,expected){need(response?.body&&response.headers&&response.redirected===false);need(response.headers.get('content-length')===String(expected.length));const reader=response.body.getReader();resources.add(reader);let count=0,empty=0,progress=performance.now();const digest=createHash('sha256');try{for(;;){live();const remaining=idleMs-(performance.now()-progress);if(remaining<=0){phase='deadline';controller.abort();throw 0;}const part=await bound(()=>reader.read(),Math.min(remaining,end-performance.now()));if(part.done)break;need(part.value instanceof Uint8Array);count+=part.value.length;need(count<=expected.length);if(part.value.length){empty=0;progress=performance.now();digest.update(part.value);}else need(++empty<=P.maxEmptyReads);}need(count===expected.length&&digest.digest('hex')===hash(expected));}finally{resources.delete(reader);discard(reader);}}
  try{
    run=selection(env);if(run===null)return null;
    callMs=deps.callTimeoutMs??P.callTimeoutMs;idleMs=deps.bodyIdleMs??P.bodyIdleMs;const total=deps.totalTimeoutMs??P.totalTimeoutMs;
    for(const [v,max]of[[callMs,P.callTimeoutMs],[idleMs,P.bodyIdleMs],[total,P.totalTimeoutMs]])need(Number.isSafeInteger(v)&&v>0&&v<=max);
    end=performance.now()+total;timer=setTimeout(()=>{phase='deadline';controller.abort();},total);token=assertPrivateMediaNativeContext(env,now());
    const loadSdk=async()=>{live();if(!deps.loadSdk){const p=JSON.parse(await readFile(new URL('../package.json',import.meta.resolve('@vercel/blob')),'utf8'));live();need(p.version===I.sdkVersion);}const sdk=await(deps.loadSdk??(()=>import('@vercel/blob')))();live();return sdk;};
    const metadataEnv=facade(env,run);
    async function metadata(label){const v=await step(label,()=>runPrivateMediaOidcProbe(metadataEnv,{now,timeoutMs:Math.max(1,Math.floor(Math.min(callMs,end-performance.now()))),loadSdk}));need(v?.ok&&v.mode==='production-allow'&&v.environmentMatch&&v.outcome==='allowed');}
    await metadata('metadata-before');const sdk=await step('sdk-load',loadSdk,false),opts=()=>({oidcToken:token,storeId:P.storeId,abortSignal:controller.signal});
    async function put(slot,kind,condition,label){const body=singleWriteBody(kind),key=keyFor(run,slot);const v=await step(label,()=>{spend(body);return sdk.put(key,body,{...opts(),access:'private',contentType:'application/octet-stream',addRandomSuffix:false,allowOverwrite:kind!=='permit',multipart:false,cacheControlMaxAge:60,...condition===undefined?{}:{ifMatch:condition}});});return verify(v,key);}
    async function grant(slot){const key=keyFor(run,slot),until=now()+P.totalTimeoutMs;const request={pathname:key,operations:['get'],validUntil:until};const v=await step('verify',()=>{outgoing+=Buffer.byteLength(JSON.stringify(request));need(outgoing<=P.maxOutgoingBytes);return sdk.issueSignedToken({...opts(),...request});});need(object(v)&&typeof v.delegationToken==='string'&&v.delegationToken.length<=4096&&typeof v.clientSigningToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v.clientSigningToken)&&Number.isSafeInteger(v.validUntil)&&v.validUntil>now()&&v.validUntil<=until);
      const parts=v.delegationToken.split('.');need(parts.length===2&&parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)));const raw=Buffer.from(parts[0],'base64url');need(raw.toString('base64url')===parts[0]);const scope=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));need(scope.storeId?.replace(/^store_/,'').toLowerCase()===P.storeId.slice(6).toLowerCase()&&scope.pathname===key&&Array.isArray(scope.operations)&&scope.operations.length===1&&scope.operations[0]==='get'&&scope.validUntil===v.validUntil);
      const signed=await step('verify',()=>sdk.presignUrl(v,{operation:'get',pathname:key,access:'private',validUntil:v.validUntil,useCache:false}),false);need(typeof signed?.presignedUrl==='string'&&signed.presignedUrl.length<=8192);const url=new URL(signed.presignedUrl);need(url.origin===origin&&url.pathname===`/${key}`&&!url.hash&&!url.username&&!url.password&&url.searchParams.size===3&&url.searchParams.get('cache')==='0'&&url.searchParams.get('vercel-blob-delegation')===v.delegationToken&&/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('vercel-blob-signature')??''));return url;}
    async function current(slot,expected,etag,url){const key=keyFor(run,slot),head=await step('verify',()=>sdk.head(key,opts()));verify(head,key,etag);need(head.size===expected.length);
      const response=await step('verify',async()=>{const r=await(deps.fetch??globalThis.fetch)(url,{method:'GET',headers:{'If-Match':etag},signal:controller.signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(finished||controller.signal.aborted){discard(r?.body);throw 0;}if(r?.body)resources.add(r.body);return r;});
      need(response.status===200&&response.headers.get('etag')===etag&&response.headers.get('content-type')==='application/octet-stream');if(response.url)need(response.url===url.href);await readBody(response,expected);resources.delete(response.body);}
    async function stale(slot,a){await step('stale',async()=>{spend(singleWriteBody('upload'));try{await sdk.put(keyFor(run,slot),singleWriteBody('upload'),{...opts(),access:'private',contentType:'application/octet-stream',addRandomSuffix:false,allowOverwrite:true,multipart:false,cacheControlMaxAge:60,ifMatch:a});}catch(error){need(error instanceof sdk.BlobPreconditionFailedError);return;}throw 0;});}
    const a=await put('normal','permit',undefined,'permit'),b=await put('normal','upload',a,'upload');need(b!==a);const normalUrl=await grant('normal');await current('normal',singleWriteBody('upload'),b,normalUrl);checks.ordinaryVerified=true;
    await stale('normal',a);await current('normal',singleWriteBody('upload'),b,normalUrl);checks.staleDenied=true;
    const r=await put('normal','retire',b,'retire');need(r!==a&&r!==b);await current('normal',singleWriteBody('retire'),r,normalUrl);await stale('normal',a);await current('normal',singleWriteBody('retire'),r,normalUrl);checks.ordinaryRetired=true;
    const heldA=await put('held','permit',undefined,'permit'),heldUrl=await grant('held');
    function transport(kind,condition){live();need(++calls<=P.maxApplicationCalls);spend(singleWriteBody(kind));const t=startSingleWriteTransport({run,slot:'held',kind,ifMatch:condition,oidcToken:token},{signal:controller.signal,request:deps.request,live,callTimeoutMs:callMs,bodyIdleMs:idleMs});transports.add(t);return t;}
    phase='held-start';const held=transport('upload',heldA);evidence=await step('held-start',()=>held.dispatched,false);
    phase='retire-dispatch';const retiring=transport('retire',heldA);await step('retire-dispatch',()=>retiring.dispatched,false);
    // R has real verified-TLS/body-dispatch evidence BEFORE U's remaining bytes.
    evidence=held.evidence();await step('held-finish',()=>held.finish(),false);
    const [uResult,rResult]=await step('race-resolve',()=>Promise.all([held.result,retiring.result]),false);
    let finalTag;
    if(rResult.status!==412&&uResult.status===412){finalTag=verify(rResult.value,keyFor(run,'held'));need(finalTag!==heldA);race='retirement-won';}
    else if(uResult.status!==412&&rResult.status===412){const heldB=verify(uResult.value,keyFor(run,'held'));need(heldB!==heldA);await current('held',singleWriteBody('upload'),heldB,heldUrl);finalTag=await put('held','retire',heldB,'retire');need(finalTag!==heldB&&finalTag!==heldA);race='upload-won';}
    else throw 0;
    await current('held',singleWriteBody('retire'),finalTag,heldUrl);await stale('held',heldA);await current('held',singleWriteBody('retire'),finalTag,heldUrl);checks.heldRetired=true;
    await metadata('metadata-after');live();need(Object.values(checks).every(Boolean));if(evidence!=='continue')return result(false,'inconclusive');phase='complete';return result(true,'passed');
  }catch{return result(false,writeAttempted?'requires-reconciliation':'failed');}
  finally{finished=true;clearTimeout(timer);controller.abort();for(const t of transports)t.destroy();for(const r of resources)discard(r);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const value=process.argv.length===2?await runPrivateMediaSingleWriteProbe():{schema:P.schema,ok:false,phase:'selection',outcome:'failed',writeAttempted:false,requiresReconciliation:false,race:'none',evidence:'none',checks:{ordinaryVerified:false,staleDenied:false,ordinaryRetired:false,heldRetired:false}};
  if(value){process.stdout.write(JSON.stringify(value)+'\n');process.exitCode=value.ok?0:1;}
}
