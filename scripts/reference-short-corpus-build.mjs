#!/usr/bin/env node
// Offline corpus orchestration. Importing this module never launches a builder.
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,open,lstat,stat,realpath,readdir,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {dirname,join,resolve,relative,isAbsolute,basename,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {insideGitWorkingTree} from './private-paths.mjs';
import {isolatedEnv} from '../tests/helpers/isolatedEnv.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),MiB=1024*1024;
export const CORPUS_CAPS=Object.freeze({parents:16,cuts:256,seconds:4096});
const BASELINE='2a02d0fd39c2f6f25f154a7d178d1543d1e82a7b',NATIVE_SOURCE='5049c82f1707b75cdb89d26862d5bbef4d6d8ff0',PARENT='48c8147becc417690de2f8546ae63870d34422f5d95668671ea1a9f5d7c7efdf',NATIVE='10e746d10ab1807b5ff15617574e036dcee1e7ba2b0c17778685e7e9898946eb';
export const CORPUS_BASELINE=Object.freeze({schema:'reference-short-corpus-baseline/v2',sourceCommit:BASELINE,sha256:'d0e534792a347cf4414a6818d6bcd018fc390c022b5f4fa41b10fbce12e3155c',count:661});
const OWN=['scripts/reference-short-corpus-build.mjs','tests/reference-short-corpus-build.test.mjs'];
const TOOL_PINS=Object.freeze({node:'f13ac3ca23248dc389507e8fe38c34489ab7edb3e6d6700eb6da6a0b7e128eaf',compiler:'f9ecfbdc93753d2c972d66a8d0d75f5bd737fd4a5f88b422d9091ea282bcb2c7',ffmpeg:'57c56e369d5b4873b4d93fc1a1d833cb7cd8bc9325c14b05c34ce60b22842d8a',ffprobe:'afe05347caaabe479b3c4eae71992b6ec1e11c57266a1d665deb0f9fe9847208'});
const sha=b=>createHash('sha256').update(b).digest('hex'),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=code=>{throw Object.assign(Error('Offline corpus build refused'),{code});};
const key=s=>`${s.asset}\0${s.ref}`;
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail('shape');const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value'))fail('shape');out[k]=d.value;}return out;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const within=(root,p)=>{const r=relative(root,p);return r!==''&&!r.startsWith('..')&&!isAbsolute(r);};
/** Closed selected bytes, never an arbitrary config-supplied baseline authority.
 * OWN2 stays separate so neither driver nor tests enter their own hash cycle. */
export function parseCorpusBaselineSnapshot(value){
 if(!(value instanceof Uint8Array))fail('baseline');const proto=Object.getPrototypeOf(Uint8Array.prototype),n=Object.getOwnPropertyDescriptor(proto,'byteLength').get.call(value);if(n<1||n>MiB)fail('baseline');
 const buffer=Object.getOwnPropertyDescriptor(proto,'buffer').get.call(value),offset=Object.getOwnPropertyDescriptor(proto,'byteOffset').get.call(value);if(!(buffer instanceof ArrayBuffer))fail('baseline');
 const raw=new Uint8Array(new Uint8Array(buffer,offset,n));if(sha(raw)!==CORPUS_BASELINE.sha256)fail('baseline');const b=exact(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),['schema','sourceCommit','files']);
 if(b.schema!==CORPUS_BASELINE.schema||b.sourceCommit!==BASELINE||!Array.isArray(b.files)||b.files.length!==CORPUS_BASELINE.count)fail('baseline');
 const seen=new Set();const files=b.files.map(v=>{const p=exact(v,['path','sha256']);if(typeof p.path!=='string'||OWN.includes(p.path)||seen.has(p.path)||!digest(p.sha256))fail('baseline');seen.add(p.path);return Object.freeze(p);});
 return Object.freeze(files);
}
/** Pure partition over facts produced by the genuine catalog worker. No parser or
 * authority seal is implemented here. A hold must match a real selected cut. */
export function partitionCorpusSelection(rows,nativeFacts){
 if(!Array.isArray(rows)||!rows.length||rows.length>10000||!Array.isArray(nativeFacts))fail('partition');
 const selected=new Map();for(const r of rows){if(!r||typeof r.asset!=='string'||typeof r.ref!=='string'||selected.has(key(r))||!r.clip||!Number.isFinite(r.clip.start)||!Number.isFinite(r.clip.end)||r.clip.start<0||r.clip.end<=r.clip.start)fail('partition');selected.set(key(r),r);}
 const held=new Map();for(const f of nativeFacts){const r=selected.get(key(f));if(!r||held.has(key(f))||r.parentSHA256!==f.parentSHA256||r.parentBytes!==f.parentBytes||!Number.isSafeInteger(f.rate)||!Number.isSafeInteger(f.nativeFrames)||f.nativeFrames<1||f.firstFrame!==Math.floor(r.clip.start*f.rate)||f.lastExclusive!==Math.ceil(r.clip.end*f.rate)||f.lastExclusive<=f.nativeFrames||f.marginFrames!==f.nativeFrames-f.lastExclusive||f.capacityFits!==false)fail('capacity-hold');held.set(key(f),f);}
 const keep=rows.filter(r=>!held.has(key(r))),parents=new Map();for(const r of keep){if(!parents.has(r.asset))parents.set(r.asset,[]);parents.get(r.asset).push(r);}
 const batches=[];let batch=[],cuts=0,seconds=0;
 const flush=()=>{if(batch.length)batches.push(batch.flat());batch=[];cuts=0;seconds=0;};
 for(const asset of [...parents.keys()].sort()){const group=parents.get(asset).sort((a,b)=>a.ref<b.ref?-1:a.ref>b.ref?1:0),duration=group.reduce((s,r)=>s+r.clip.end-r.clip.start,0);
  if(group.length>CORPUS_CAPS.cuts||duration>CORPUS_CAPS.seconds)fail('parent-budget');
  if(batch.length===CORPUS_CAPS.parents||cuts+group.length>CORPUS_CAPS.cuts||seconds+duration>CORPUS_CAPS.seconds)flush();batch.push(group);cuts+=group.length;seconds+=duration;
 }flush();
 if(batches.flat().length!==keep.length||new Set(batches.flat().map(key)).size!==keep.length)fail('partition');
 return {selected:keep,held:[...held.values()],batches};
}
/** No retries or error swallowing. inspect must complete before the next child. */
export async function runCorpusBatches(batches,run,inspect){const results=[];for(let i=0;i<batches.length;i++){const value=await run(batches[i],i);await inspect(value,batches[i],i);results.push(value);}return results;}
export function validateCorpusChild(report,provenance,expected){
 if(!report||report.ok!==true||report.code!==null||report.phase!=='final-pins'||report.inputsAndSourcePreserved!==true||report.publication!==false||!same(report.cleanup,{work:true,runtime:true,home:true})||report.cuts!==expected.rows.length||report.parents!==new Set(expected.rows.map(r=>r.asset)).size||report.manifestSHA256!==provenance?.manifestSHA256)fail('child-report');
 if(provenance.sourceCommit!==expected.sourceCommit||!same(provenance.sourcePins,expected.sourcePins)||!same(provenance.tools,expected.tools)||!same(provenance.compilerFiles?.slice().sort(),expected.compilerFiles?.slice().sort())||provenance.parentCatalogSHA256!==expected.parentSHA256||provenance.inputSHA256!==expected.inputSHA256||provenance.recipe!==expected.recipe||provenance.geometry!=='floor-start-ceil-exclusive-end/v1'||provenance.publication!==false||provenance.bodyVerifiedCount!==expected.rows.length||!Array.isArray(provenance.cuts)||provenance.cuts.length!==expected.rows.length)fail('child-provenance');
 const found=new Set();for(const c of provenance.cuts){const r=expected.rows.find(r=>key(r)===key(c.selection??{}));if(!r||found.has(key(r))||!same(c.selection,r)||!c.fact||c.fact.parentAsset!==r.asset||c.fact.parentSHA256!==r.parentSHA256||c.fact.parentBytes!==r.parentBytes||!same(c.fact.clip,r.clip)||c.firstFrame!==Math.floor(r.clip.start*c.fact.sampleRate)||c.lastExclusive!==Math.ceil(r.clip.end*c.fact.sampleRate)||c.parentFrames!==c.fact.parentFrames||!digest(c.canonicalPCM16SHA256)||!digest(c.body?.sha256)||c.body.sha256!==c.fact.encoded?.sha256||!Number.isSafeInteger(c.fact.encoded?.bytes)||c.fact.encoded.bytes<1||c.fact.encoded.bytes>MiB)fail('child-cut');validateNormalization(c,expected);found.add(key(r));}
 return provenance.cuts;
}
function validateNormalization(c,expected){
 const reject=()=>fail('child-normalization'),integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
 const record=(v,keys)=>{const out=exact(v,keys);for(const k of keys)if(Object.getOwnPropertyDescriptor(v,k).enumerable!==true)reject();return out;};
 const pins=expected.sourcePins.filter(p=>p.path==='src/server/reference-audio/short-source-gapless.ts');if(pins.length!==1||!digest(pins[0].sha256)||expected.recipe!=='pockettorah-mp3-64k-gapless/v2')reject();
 const a=record(c.normalization,['changed','physicalFrames','surplusFrames','original','normalized','changedOffsets','schema','normalizerSHA256']);
 const fields=['sampleRate','channels','mpegVersion','samplesPerFrame','frameCount','delay','padding','presentationFrames','checksum','tagCRC','strictTagCRC','musicCRC','bytes','sha256','audioSHA256'];
 const before=record(a.original,fields),after=record(a.normalized,fields),rate=c.fact.sampleRate,channels=c.fact.channels,N=c.lastExclusive-c.firstFrame,encoded=c.fact.encoded;
 if(![8000,11025,12000,16000,22050,24000,32000,44100,48000].includes(rate)||![1,2].includes(channels)||!integer(N,1,rate*75)||!integer(c.firstFrame,0,rate*14400)||!integer(c.lastExclusive,1,rate*14400)||!integer(c.parentFrames,c.lastExclusive,rate*14400)||c.parentFrames*channels*2>512*MiB)reject();
 if(encoded.codec!=='mp3'||encoded.bitrate!==64000||encoded.sampleRate!==rate||encoded.channels!==channels||encoded.presentationFrames!==N||encoded.recipe!==expected.recipe||a.schema!=='reference-short-normalization/v1'||a.normalizerSHA256!==pins[0].sha256||a.physicalFrames!==N)reject();
 const samples=rate>=32000?1152:576,version=rate>=32000?1:rate>=16000?2:2.5;
 for(const p of[before,after])if(p.sampleRate!==rate||p.channels!==channels||p.mpegVersion!==version||p.samplesPerFrame!==samples||!integer(p.frameCount,1,MiB)||p.delay!==576||!integer(p.padding,0,3000)||!integer(p.presentationFrames,1,rate*75)||p.frameCount*samples-p.delay-p.padding!==p.presentationFrames||!integer(p.bytes,1,MiB)||!digest(p.sha256)||!digest(p.audioSHA256)||![p.tagCRC,p.strictTagCRC,p.musicCRC].every(v=>integer(v,0,65535)))reject();
 if(!['strict','ffmpeg-fixed190'].includes(before.checksum)||(before.checksum==='strict')!==(before.tagCRC===before.strictTagCRC)||after.checksum!=='strict'||after.tagCRC!==after.strictTagCRC||before.frameCount!==after.frameCount||before.bytes!==after.bytes||after.bytes!==encoded.bytes||after.sha256!==encoded.sha256||before.audioSHA256!==after.audioSHA256||before.musicCRC!==after.musicCRC||after.presentationFrames!==N||!integer(a.surplusFrames,0,samples)||before.presentationFrames-N!==a.surplusFrames||after.padding-before.padding!==a.surplusFrames)reject();
 const offsets=a.changedOffsets;if(!Array.isArray(offsets)||Object.getPrototypeOf(offsets)!==Array.prototype||offsets.length>4||Reflect.ownKeys(offsets).length!==offsets.length+1)reject();
 let prior=-1;for(let i=0;i<offsets.length;i++){const d=Object.getOwnPropertyDescriptor(offsets,String(i));if(!d||!Object.hasOwn(d,'value')||d.enumerable!==true||!integer(d.value,0,after.bytes-1)||d.value<=prior)reject();prior=d.value;}
 if(typeof a.changed!=='boolean'||a.changed!==(offsets.length>0)||(a.changed?before.sha256===after.sha256:before.sha256!==after.sha256)||(!a.changed&&(!same(before,after)||a.surplusFrames!==0)))reject();
}
export function validateCorpusBodySet(names,hashes){const wanted=new Set(hashes.map(h=>`${h}.mp3`));if(wanted.size!==hashes.length||names.length!==wanted.size+3||!['manifest.json','private-provenance.json','build-report.json'].every(n=>names.includes(n))||names.some(n=>!wanted.has(n)&&!['manifest.json','private-provenance.json','build-report.json'].includes(n)))fail('body-set');return true;}
async function noLinks(p){p=resolve(p);if(p.startsWith('\\\\'))fail('path');for(;;){if((await lstat(p)).isSymbolicLink())fail('path');const up=dirname(p);if(up===p)break;p=up;}}
async function regular(p,cap,external=false,empty=false){p=resolve(p);await noLinks(p);const s=await lstat(p);if(!s.isFile()||s.size<(empty?0:1)||s.size>cap||await realpath(p)!==p||external&&await insideGitWorkingTree(p))fail('path');return p;}
async function hashFile(p,cap){const before=await stat(p),h=createHash('sha256');let bytes=0;for await(const b of createReadStream(p)){bytes+=b.length;if(bytes>cap)fail('budget');h.update(b);}const after=await stat(p);if(before.size!==bytes||after.size!==bytes||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs)fail('changed-file');return {sha256:h.digest('hex'),bytes};}
async function readBounded(p,cap){await regular(p,cap,true);const handle=await open(p,'r'),buffer=Buffer.alloc(cap+1);let n=0;try{while(n<=cap){const r=await handle.read(buffer,n,buffer.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}if(n>cap)fail('budget');return Buffer.from(buffer.subarray(0,n));}finally{await handle.close();}}
async function pinned(p,cap){p=exact(p,['path','sha256']);if(!digest(p.sha256))fail('pin');const path=await regular(p.path,cap,true),bytes=await readBounded(path,cap);if(sha(bytes)!==p.sha256)fail('pin');return {path,sha256:p.sha256,bytes};}
async function run(path,args,env,{cap=MiB,timeout=60000,log}={}){
 let used=0,errors=0,refused=false,output=Buffer.alloc(log?0:cap),handle;if(log)handle=await open(log,'wx',0o600);
 const child=spawn(path,args,{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const writes=[];const collect=(b,isError)=>{if(isError){errors+=b.length;if(errors>64*1024){refused=true;child.kill();}}else{used+=b.length;if(used>cap){refused=true;child.kill();return;}}
  if(log){child[isError?'stderr':'stdout'].pause();const w=(async()=>{let sent=0;while(sent<b.length){const part=await handle.write(b,sent,b.length-sent);if(part.bytesWritten<1)throw Error('log');sent+=part.bytesWritten;}child[isError?'stderr':'stdout'].resume();})();writes.push(w);w.catch(()=>{refused=true;child.kill();});}else if(!isError&&used<=cap)b.copy(output,used-b.length);};
 child.stdout.on('data',b=>collect(b,false));child.stderr.on('data',b=>collect(b,true));const timer=setTimeout(()=>{refused=true;child.kill();},timeout);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(c,s)=>c===0&&!s&&!refused?yes():no(Error('child')));});await Promise.all(writes);return log?null:output.subarray(0,used);}catch{fail('child');}finally{clearTimeout(timer);await Promise.allSettled(writes);await handle?.close();}
}
export const CORPUS_WORKER=String.raw`
import{createRequire}from'node:module';import{readFile,realpath,lstat,open}from'node:fs/promises';import{join,dirname,resolve}from'node:path';import{createHash}from'node:crypto';
const r=createRequire(import.meta.url),q=JSON.parse(await readFile(process.argv[1],'utf8')),at=p=>join(q.compiled,p),sha=b=>createHash('sha256').update(b).digest('hex');
const {verifyShortBuildServerOnly}=await import(q.cliURL);
await verifyShortBuildServerOnly(['short-source-build','short-source-manifest','short-source-body','short-source-gapless','catalog'].map(n=>at('src/server/reference-audio/'+n+'.js')),q.serverOnly);
const catalog=r(at('src/server/reference-audio/catalog.js')),core=r(at('src/server/reference-audio/short-source-build.js')),manifest=r(at('src/server/reference-audio/short-source-manifest.js')),body=r(at('src/server/reference-audio/short-source-body.js')),source=r(at('src/lib/reference-audio/short-source.js')),parentSource=r(at('src/lib/reference-audio/source.js'));
const parent=await readFile(q.parent);if(sha(parent)!==q.parentSHA)throw Error('pin');const c=catalog.parseReferenceCatalog(JSON.parse(parent));if(!c)throw Error('catalog');
if(q.mode==='select'){const refs=new Map();for(const a of c.assets)for(const v of a.verses){if(!refs.has(v.ref))refs.set(v.ref,[]);refs.get(v.ref).push({a,v});}const selected=[...refs.values()].filter(rows=>rows.length===1&&rows[0].v.playback.status==='ready').map(([{a,v}])=>({asset:a.id,parentSHA256:a.sha256,parentBytes:a.bytes,archiveFile:a.archiveFile,ref:v.ref,clip:v.playback.clip}));console.log(JSON.stringify({recipe:source.SHORT_SOURCE_RECIPE,selected,parents:c.assets.length,entries:c.assets.reduce((n,a)=>n+a.verses.length,0),ambiguousRefs:[...refs.values()].filter(x=>x.length>1).length,ambiguousReadyEntries:[...refs.values()].filter(x=>x.length>1).flat().filter(x=>x.v.playback.status==='ready').length,timingHolds:c.assets.flatMap(a=>a.verses).filter(v=>v.playback.status!=='ready').length}));}
else{const plan=await core.planShortSourceBuild({parentCatalogBytes:parent,parentCatalogSHA256:q.parentSHA,facts:q.cuts.map(c=>c.fact)});if(plan.status!=='planned')throw Error('plan');const encoded=new TextEncoder().encode(plan.manifestJSON),loaded=await manifest.createShortSourceManifestLoader({sha256:plan.manifestSHA256,parentCatalogSHA256:q.parentSHA,parentCatalogBytes:parent,get:async()=>new ReadableStream({start(x){x.enqueue(encoded);x.close();}})})();
const seen=new Set();for(const cut of q.cuts){const selected=q.rows.find(r=>r.asset===cut.selection.asset&&r.ref===cut.selection.ref),a=c.assets.find(a=>a.id===selected?.asset),v=a?.verses.find(v=>v.ref===selected.ref);if(!selected||!v||seen.has(selected.asset+'\0'+selected.ref))throw Error('coverage');seen.add(selected.asset+'\0'+selected.ref);const resolution={verse:v,source:parentSource.parseReferenceSource({schema:'reference-source/v1',asset:a.id,sha256:a.sha256,bytes:a.bytes,url:parentSource.REFERENCE_ARCHIVE_PREFIX+a.archiveFile})};const entry=manifest.findShortSource(loaded,resolution);if(!entry)throw Error('finder');const file=await open(cut.body.path,'r'),buffer=Buffer.alloc(1048577);let used=0;try{while(used<buffer.length){const n=(await file.read(buffer,used,buffer.length-used,used)).bytesRead;if(!n)break;used+=n;}if(used>1048576)throw Error('body-budget');}finally{await file.close();}const bytes=buffer.subarray(0,used);const receipt=body.verifyShortSourceBody(entry,bytes);const verified=body.readVerifiedShortSourceBody(receipt);if(sha(verified.bytes)!==cut.body.sha256)throw Error('body');}
for(const hold of q.holds??[]){const a=c.assets.find(a=>a.id===hold.asset),v=a?.verses.find(v=>v.ref===hold.ref);if(!v||manifest.findShortSource(loaded,{verse:v,source:parentSource.parseReferenceSource({schema:'reference-source/v1',asset:a.id,sha256:a.sha256,bytes:a.bytes,url:parentSource.REFERENCE_ARCHIVE_PREFIX+a.archiveFile})})!==null)throw Error('held-coverage');}if(seen.size!==q.rows.length||plan.sourceCount!==q.rows.length)throw Error('coverage');console.log(JSON.stringify({manifestJSON:plan.manifestJSON,manifestSHA256:plan.manifestSHA256,verified:q.rows.length}));}
`;
export async function buildReferenceShortCorpus(supplied){
 let iso,runtime,work,output,outputCreated=false,phase='configuration',completed=0,ok=false,code=null,selectionReportSHA256=null,manifestSHA256=null;const cleanup={runtime:true,work:true,home:true};
 try{
  const config=exact(supplied,['sourceCommit','baselinePins','ownPins','tools','parentCatalog','nativeCapacity','audioRoot','outputDir']);if(!/^[a-f0-9]{40}$/.test(config.sourceCommit))fail('source');
  const base=await pinned(config.baselinePins,MiB);if(base.sha256!==CORPUS_BASELINE.sha256)fail('baseline');const baseline=parseCorpusBaselineSnapshot(base.bytes);
  if(!Array.isArray(config.ownPins)||config.ownPins.length!==2)fail('source');const own=config.ownPins.map(p=>exact(p,['path','sha256']));if(!OWN.every(path=>own.some(p=>p.path===path&&digest(p.sha256))))fail('source');
  const sourcePins=[...baseline.map(({path,sha256})=>({path,sha256})),...own],map=new Map();for(const p of sourcePins){if(isAbsolute(p.path)||!within(ROOT,resolve(ROOT,p.path))||relative(ROOT,resolve(ROOT,p.path)).replaceAll('\\','/')!==p.path||map.has(p.path)||!digest(p.sha256))fail('source');map.set(p.path,p.sha256);}
  iso=await isolatedEnv({CI:'1'});const git=async args=>(await run('git',args,iso.env,{cap:65536})).toString();
  const verifySources=async()=>{if((await git(['rev-parse','HEAD'])).trim()!==config.sourceCommit||(await git(['status','--porcelain','--untracked-files=no'])).length)fail('source');for(const [path,expected]of map){const p=await regular(join(ROOT,path),256*MiB,false,true);if((await hashFile(p,256*MiB)).sha256!==expected)fail('source');}};await verifySources();
  const tools=exact(config.tools,['node','compiler','ffmpeg','ffprobe']);const verifyTools=async()=>{for(const [name,raw]of Object.entries(tools)){const t=exact(raw,['path','sha256']);if(t.sha256!==TOOL_PINS[name]||(await hashFile(await regular(t.path,256*MiB),256*MiB)).sha256!==t.sha256)fail('tool');}if((await hashFile(process.execPath,256*MiB)).sha256!==tools.node.sha256)fail('tool');};await verifyTools();
  const parent=await pinned(config.parentCatalog,8*MiB),native=await pinned(config.nativeCapacity,MiB);if(parent.sha256!==PARENT||native.sha256!==NATIVE)fail('input');const evidence=JSON.parse(native.bytes);if(evidence.sourceCommit!==NATIVE_SOURCE||evidence.parentCatalogSHA256!==PARENT||evidence.decodeOnly!==true||evidence.cutsEncoded!==0||evidence.publication!==false||evidence.facts?.length!==7)fail('native-evidence');
  const audioRoot=resolve(config.audioRoot);await noLinks(audioRoot);if(await realpath(audioRoot)!==audioRoot||!(await lstat(audioRoot)).isDirectory()||await insideGitWorkingTree(audioRoot))fail('path');
  output=resolve(config.outputDir);await noLinks(dirname(output));if(await realpath(dirname(output))!==dirname(output)||within(audioRoot,output)||output===audioRoot||await insideGitWorkingTree(output)||basename(output).startsWith('.'))fail('path');try{await lstat(output);fail('output-exists');}catch(e){if(e.code!=='ENOENT')throw e;}await mkdir(output,{mode:0o700});outputCreated=true;work=await mkdtemp(join(output,'.work-'));
  const cliURL=pathToFileURL(join(ROOT,'scripts/reference-short-build.mjs')).href,{shortBuildCompilerArgs}=await import(cliURL);
  phase='compile';await mkdir(join(ROOT,'.local-logs'),{recursive:true});await noLinks(join(ROOT,'.local-logs'));runtime=await mkdtemp(join(ROOT,'.local-logs/corpus-runtime-'));
  const compile=(await run(tools.compiler.path,shortBuildCompilerArgs(runtime),iso.env,{cap:4*MiB,timeout:60000})).toString();
  const compilerFiles=[...new Set(compile.split(/\r?\n/).filter(p=>/^[A-Za-z]:[\\/]|^\//.test(p)))];
  for(const p of compilerFiles){const k=relative(ROOT,p).replaceAll('\\','/');if(!map.has(k)||(await hashFile(await regular(p,256*MiB,false,true),256*MiB)).sha256!==map.get(k))fail('compile-closure');}await verifySources();
  const parentSnapshot=join(work,'parent.json');await writeFile(parentSnapshot,parent.bytes,{flag:'wx',mode:0o600});const serverOnly={emptyFile:await realpath(join(ROOT,'node_modules/server-only/empty.js')),packageFile:await realpath(join(ROOT,'node_modules/server-only/package.json')),emptySHA256:map.get('node_modules/server-only/empty.js'),packageSHA256:map.get('node_modules/server-only/package.json')};let calls=0;
  const worker=async value=>{const path=join(work,`request-${calls++}.json`);await writeFile(path,JSON.stringify({...value,compiled:runtime,parent:parentSnapshot,parentSHA:PARENT,cliURL,serverOnly}),{flag:'wx',mode:0o600});return JSON.parse((await run(tools.node.path,['--conditions=react-server','--input-type=module','-e',CORPUS_WORKER,path],iso.env,{cap:16*MiB,timeout:120000})).toString());};
  phase='selection';const selected=await worker({mode:'select'});if(selected.parents!==431||selected.entries!==7073||selected.selected.length!==6993||selected.ambiguousRefs!==22||selected.ambiguousReadyEntries!==44||selected.timingHolds!==36)fail('coverage');
  const partition=partitionCorpusSelection(selected.selected,evidence.facts);if(partition.selected.length!==6986||new Set(partition.selected.map(r=>r.asset)).size!==428||partition.held.length!==7)fail('coverage');
  const selectionReport={schema:'reference-short-corpus-selection/v1',sourceCommit:config.sourceCommit,baselineCommit:BASELINE,baselineSHA256:CORPUS_BASELINE.sha256,parentCatalogSHA256:PARENT,nativeEvidenceCommit:NATIVE_SOURCE,nativeEvidenceSHA256:NATIVE,algorithm:'asset-id-ascending-whole-parent-next-fit/v1',caps:CORPUS_CAPS,counts:{catalogEntries:7073,defaultEligible:6993,selected:6986,parents:428,capacityHeld:7,ambiguousRefs:22,ambiguousReadyEntries:44,timingHeld:36},held:partition.held,batches:partition.batches.map(rows=>rows.map(({asset,ref})=>({asset,ref}))),publication:false};const selectionBytes=Buffer.from(JSON.stringify(selectionReport)+'\n');selectionReportSHA256=sha(selectionBytes);await writeFile(join(output,'selection.json'),selectionBytes,{flag:'wx',mode:0o600});
  phase='parent-inventory';const originals=[];
  for(const a of new Map(selected.selected.map(r=>[r.asset,r])).values()){const path=await regular(join(audioRoot,a.archiveFile),32*MiB,true),s=await stat(path);if(dirname(path)!==audioRoot||!same(await hashFile(path,32*MiB),{sha256:a.parentSHA256,bytes:a.parentBytes}))fail('parent-pin');originals.push({path,sha256:a.parentSHA256,bytes:a.parentBytes,ino:s.ino,mtimeMs:s.mtimeMs});}
  const allCuts=[],bodyHashes=new Set(),childArtifacts=[];await mkdir(join(output,'children'),{mode:0o700});
  await runCorpusBatches(partition.batches,async(rows,index)=>{
   phase='child';await verifySources();await verifyTools();const stem=join(output,'children',String(index).padStart(3,'0'));const inputPath=stem+'-input.json',inputBytes=Buffer.from(JSON.stringify({schema:'reference-short-build-input/v1',parentCatalogSHA256:PARENT,selections:rows.map(({asset,ref})=>({asset,ref}))})+'\n'),inputSHA256=sha(inputBytes);await writeFile(inputPath,inputBytes,{flag:'wx',mode:0o600});
   const childConfig={sourceCommit:config.sourceCommit,sourcePins,tools,parentCatalog:{path:parent.path,sha256:PARENT},input:{path:inputPath,sha256:inputSHA256},audioRoot,outputDir:stem+'-output'},configPath=stem+'-config.json';await writeFile(configPath,JSON.stringify(childConfig)+'\n',{flag:'wx',mode:0o600});
   // Same30min outer ceiling as the unchanged child's own live() fence.
   // A killed/incomplete child is a STOP, never inferred success or retried.
   await run(tools.node.path,[join(ROOT,'scripts/reference-short-build.mjs'),'--config',configPath],iso.env,{cap:MiB,timeout:30*60000,log:stem+'-private.log'});
   return {rows,inputSHA256,inputPath,path:childConfig.outputDir,configPath,logPath:stem+'-private.log',configSHA256:sha(await readFile(configPath))};
  },async(value,rows)=>{
   phase='child-verification';const report=JSON.parse(await readBounded(join(value.path,'build-report.json'),MiB)),provenance=JSON.parse(await readBounded(join(value.path,'private-provenance.json'),8*MiB));const cuts=validateCorpusChild(report,provenance,{rows,sourceCommit:config.sourceCommit,sourcePins,tools,parentSHA256:PARENT,inputSHA256:value.inputSHA256,recipe:selected.recipe,compilerFiles});
   const entries=await readdir(value.path,{withFileTypes:true});if(entries.some(e=>!e.isFile()||e.isSymbolicLink()))fail('body-set');validateCorpusBodySet(entries.map(e=>e.name),cuts.map(c=>c.body.sha256));
   if(sha(await readBounded(join(value.path,'manifest.json'),8*MiB))!==provenance.manifestSHA256)fail('child-manifest');
   for(const c of cuts){if(resolve(c.body.path)!==join(value.path,`${c.body.sha256}.mp3`)||bodyHashes.has(c.body.sha256))fail('body-set');const measured=await hashFile(await regular(c.body.path,MiB,true),MiB);if(measured.sha256!==c.body.sha256||measured.bytes!==c.fact.encoded.bytes)fail('body');bodyHashes.add(c.body.sha256);allCuts.push(c);}
   if(sha(await readBounded(value.configPath,MiB))!==value.configSHA256)fail('changed-config');
   for(const [path,cap]of [[value.inputPath,8*MiB],[value.configPath,MiB],[value.logPath,2*MiB],...['build-report.json','private-provenance.json','manifest.json'].map(n=>[join(value.path,n),8*MiB])])childArtifacts.push({path,cap,...await hashFile(await regular(path,cap,true),cap)});
   completed++;
  });
  phase='candidate';const candidate=join(output,'candidate');await mkdir(candidate,{mode:0o700});const copied=[];for(const c of allCuts){const destination=join(candidate,`${c.body.sha256}.mp3`);await pipeline(createReadStream(c.body.path),createWriteStream(destination,{flags:'wx',mode:0o600}));if(!same(await hashFile(destination,MiB),{sha256:c.body.sha256,bytes:c.fact.encoded.bytes}))fail('copy');copied.push({...c,body:{path:destination,sha256:c.body.sha256}});}
  const final=await worker({mode:'final',rows:partition.selected,holds:partition.held,cuts:copied});if(final.verified!==6986||!digest(final.manifestSHA256)||sha(Buffer.from(final.manifestJSON))!==final.manifestSHA256)fail('candidate');manifestSHA256=final.manifestSHA256;
  await verifySources();await verifyTools();for(const p of [parent,native,base])if((await hashFile(p.path,8*MiB)).sha256!==p.sha256)fail('changed-input');
  for(const o of originals){const p=await regular(o.path,32*MiB,true),s=await stat(p);if(s.ino!==o.ino||s.mtimeMs!==o.mtimeMs||!same(await hashFile(p,32*MiB),{sha256:o.sha256,bytes:o.bytes}))fail('changed-parent');}
  for(const p of childArtifacts)if(!same(await hashFile(await regular(p.path,p.cap,true),p.cap),{sha256:p.sha256,bytes:p.bytes}))fail('changed-child');
  for(const c of allCuts)if(!same(await hashFile(await regular(c.body.path,MiB,true),MiB),{sha256:c.body.sha256,bytes:c.fact.encoded.bytes}))fail('changed-child');
  if((await hashFile(join(output,'selection.json'),8*MiB)).sha256!==selectionReportSHA256)fail('changed-selection');
  await writeFile(join(candidate,'manifest.json'),final.manifestJSON,{flag:'wx',mode:0o600});await writeFile(join(candidate,'private-provenance.json'),JSON.stringify({schema:'reference-short-corpus-provenance/v1',sourceCommit:config.sourceCommit,sourcePins,tools,parentCatalogSHA256:PARENT,nativeEvidenceSHA256:NATIVE,selectionReportSHA256,cuts:copied,childArtifacts,manifestSHA256,bodyVerifiedCount:6986,childCount:completed,originalsPreserved:true,publication:false})+'\n',{flag:'wx',mode:0o600});
  if((await readdir(candidate)).length!==6988)fail('candidate-set');ok=true;
 }catch(e){code=typeof e?.code==='string'&&/^[a-z-]{1,32}$/.test(e.code)?e.code:phase;}
 finally{for(const [name,path,parent]of [['runtime',runtime,join(ROOT,'.local-logs')],['work',work,output]]){try{if(path){await noLinks(path);if(await realpath(path)!==resolve(path)||!within(await realpath(parent),await realpath(path)))fail('cleanup');await rm(path,{recursive:true});}}catch{cleanup[name]=false;}}try{if(iso){await iso.cleanup();try{await lstat(iso.home);cleanup.home=false;}catch(e){if(e.code!=='ENOENT')throw e;}}}catch{cleanup.home=false;}}
 if(Object.values(cleanup).some(v=>!v)){ok=false;code='cleanup';}
 const report=Object.freeze({schema:'reference-short-corpus-build/v1',ok,code:ok?null:code,phase,completedChildren:completed,targetCuts:6986,capacityHeld:7,selectionReportSHA256,manifestSHA256:ok?manifestSHA256:null,cleanup,publication:false});
 if(outputCreated){try{await writeFile(join(output,'corpus-report.json'),JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});}catch{return Object.freeze({...report,ok:false,code:'report'});}}return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){let report;try{if(process.argv.length!==4||process.argv[2]!=='--config')fail('configuration');report=await buildReferenceShortCorpus(JSON.parse(await readBounded(process.argv[3],2*MiB)));}catch{report={schema:'reference-short-corpus-build/v1',ok:false,code:'configuration',publication:false};}console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;}
