import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { installLoopbackFetchGuard } from "./egress";
import type { createRecordingCapture } from "../../src/components/portal/workspace/recordings/capture";
vi.mock("server-only", () => ({}));
import { verifyCanonicalRecordingWav } from "../../src/server/recordings/media-wav";
type Capture = ReturnType<typeof createRecordingCapture>;
type Review = { make: typeof createRecordingCapture; a: Capture; b: Capture; abort: AbortController; pending: ReturnType<Capture["start"]>; stopped: ReturnType<Capture["stop"]>;
  streams: MediaStream[]; contexts: AudioContext[]; nodes: AudioWorkletNode[]; calls: number; writes: string[]; stops: number; pcm: number; releasePermission?: () => void; releaseResume?: () => void; releaseClose?: () => void };
declare global { interface Window { captureReview: Review } }
let browser: Browser, server: Server, origin: string, worklet: string, isolation: Awaited<ReturnType<typeof isolatedEnv>>, restore: () => void;
const contexts: BrowserContext[] = [], variants = new Map<string,string>();
beforeAll(async()=>{
  isolation=await isolatedEnv();restore=installLoopbackFetchGuard();
  const output=join(isolation.home,"independent-capture");
  await promisify(execFile)(process.execPath,["node_modules/typescript/bin/tsc","--ignoreConfig","--target","es2022","--module","esnext","--lib","dom,es2022","--skipLibCheck","--outDir",output,"src/components/portal/workspace/recordings/capture.ts"],{env:isolation.env});
  const javascript=await readFile(join(output,"capture.js"),"utf8");worklet=await readFile("public/recording-capture-worklet.js","utf8");
  const resources=new Map([["/",{type:"text/html",body:'<!doctype html><script type="module" src="/boot.js"></script>'}],
    ["/boot.js",{type:"text/javascript",body:'import {createRecordingCapture} from "/capture.js";window.captureReview.make=createRecordingCapture;'}],
    ["/capture.js",{type:"text/javascript",body:javascript}],["/recording-capture-worklet.js",{type:"text/javascript",body:worklet}]]);
  server=createServer((request,response)=>{
    let resource=request.method==="GET"?resources.get(request.url??""):undefined;
    const variant=/(?:^|;\s*)reviewVariant=(\d+)(?:;|$)/.exec(request.headers.cookie??"")?.[1];
    if(resource && request.url==="/recording-capture-worklet.js" && variant && variants.has(variant))resource={type:"text/javascript",body:variants.get(variant)!};
    response.writeHead(resource?200:404,{"content-type":resource?.type??"text/plain","cache-control":"no-store","content-security-policy":"default-src 'none';script-src 'self';connect-src 'self'"});response.end(resource?.body??"Not found");
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const address=server.address();if(!address || typeof address==="string")throw Error("Owned capture fixture unavailable");origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({channel:"chromium",headless:true,env:isolation.env,args:["--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required"]});
});
afterAll(async()=>{try{await Promise.all(contexts.map(context=>context.close()));await browser?.close();}finally{restore?.();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await isolation?.cleanup();}});

async function page(options:{permission?:boolean;resume?:boolean;module?:string}={}){
  const context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false});contexts.push(context);await context.grantPermissions(["microphone"],{origin});
  if(options.module){const key=String(variants.size+1);variants.set(key,options.module);await context.addCookies([{name:"reviewVariant",value:key,url:origin,sameSite:"Strict"}]);}
  await context.route("**/*",async route=>{if(new URL(route.request().url()).origin!==origin)throw Error("Unexpected capture egress");await route.continue();});
  await context.addInitScript(({permission,resume})=>{
    const stats={streams:[],contexts:[],nodes:[],calls:0,writes:[],stops:0,pcm:0} as unknown as Review;window.captureReview=stats;
    const forbidden=(name:string)=>{stats.writes.push(name);throw Error("Unexpected local capture side effect");};
    window.fetch=(()=>forbidden("fetch")) as typeof fetch;navigator.sendBeacon=(()=>forbidden("beacon")) as typeof navigator.sendBeacon;
    XMLHttpRequest.prototype.open=(()=>forbidden("xhr")) as typeof XMLHttpRequest.prototype.open;
    Storage.prototype.setItem=()=>forbidden("storage");indexedDB.open=(()=>forbidden("indexeddb")) as typeof indexedDB.open;
    caches.open=(()=>forbidden("cache")) as typeof caches.open;URL.createObjectURL=()=>forbidden("object-url");
    const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{const count=++stats.calls,value=await get(constraints);stats.streams.push(value);if(permission && count===1)await new Promise<void>(resolve=>{stats.releasePermission=resolve;});return value;};
    const NativeContext=AudioContext,NativeNode=AudioWorkletNode;
    window.AudioContext=class extends NativeContext{constructor(options?:AudioContextOptions){super(options);stats.contexts.push(this);}override resume(){const value=super.resume();return resume?value.then(()=>new Promise<void>(resolve=>{stats.releaseResume=resolve;})):value;}};
    window.AudioWorkletNode=class extends NativeNode{constructor(context:BaseAudioContext,name:string,options?:AudioWorkletNodeOptions){super(context,name,options);stats.nodes.push(this);this.port.addEventListener("message",event=>{if(event.data.type==="pcm")stats.pcm++;});this.port.start();const post=this.port.postMessage.bind(this.port);this.port.postMessage=((value:unknown)=>{if((value as {type?:string})?.type==="stop")stats.stops++;post(value);}) as typeof this.port.postMessage;}};
  },{permission:options.permission??false,resume:options.resume??false});
  const tab=await context.newPage();await tab.goto(origin);await tab.waitForFunction(()=>!!window.captureReview.make);return tab;
}
async function start(tab:Page){return tab.evaluate(async()=>{const r=window.captureReview;r.abort=new AbortController();r.a=r.make({signal:r.abort.signal});return r.a.start();});}
async function released(tab:Page){await tab.waitForFunction(()=>{const r=window.captureReview;return r.streams.every(s=>s.getTracks().every(t=>t.readyState==="ended")) && r.contexts.every(c=>c.state==="closed");});expect(await tab.evaluate(()=>window.captureReview.writes)).toEqual([]);}

test("independent idle, pre-abort and stop-before-start do not request permission, network or persistence",async()=>{
  const tab=await page();expect(await tab.evaluate(async()=>{const r=window.captureReview;r.abort=new AbortController();r.a=r.make({signal:r.abort.signal});const idle=r.a.state(),stop=await r.a.stop();r.a.dispose();const disposed=await r.a.start();r.abort.abort();r.b=r.make({signal:r.abort.signal});return {idle,stop,disposed,preaborted:await r.b.start(),calls:r.calls,contexts:r.contexts.length,writes:r.writes};})).toEqual({idle:"idle",stop:{ok:false,error:"invalid-state"},disposed:{ok:false,error:"aborted"},preaborted:{ok:false,error:"aborted"},calls:0,contexts:0,writes:[]});
});
test("late permission from a disposed take cannot stop or replace a newer live take",async()=>{
  const tab=await page({permission:true});await tab.evaluate(()=>{const r=window.captureReview;r.abort=new AbortController();r.a=r.make({signal:r.abort.signal});r.pending=r.a.start();});await tab.waitForFunction(()=>!!window.captureReview.releasePermission);
  expect(await tab.evaluate(async()=>{const r=window.captureReview;r.a.dispose();return r.pending;})).toEqual({ok:false,error:"aborted"});
  expect(await tab.evaluate(async()=>{const r=window.captureReview;r.b=r.make({signal:new AbortController().signal});return r.b.start();})).toEqual({ok:true});
  await tab.evaluate(()=>window.captureReview.releasePermission!());await tab.waitForFunction(()=>window.captureReview.streams[0].getTracks().every(t=>t.readyState==="ended"));
  expect(await tab.evaluate(()=>{const r=window.captureReview;return {old:r.a.state(),fresh:r.b.state(),freshLive:r.streams[1].getTracks().every(t=>t.readyState==="live"),calls:r.calls};})).toEqual({old:"disposed",fresh:"recording",freshLive:true,calls:2});
  await tab.waitForFunction(()=>window.captureReview.pcm>0);expect((await tab.evaluate(()=>window.captureReview.b.stop())).ok).toBe(true);await released(tab);
});
test("late AudioContext resume after abort cannot restore capture or return successful start",async()=>{
  const tab=await page({resume:true});await tab.evaluate(()=>{const r=window.captureReview;r.abort=new AbortController();r.a=r.make({signal:r.abort.signal});r.pending=r.a.start();});await tab.waitForFunction(()=>!!window.captureReview.releaseResume);
  expect(await tab.evaluate(async()=>{const r=window.captureReview;r.abort.abort();return r.pending;})).toEqual({ok:false,error:"aborted"});
  await tab.evaluate(()=>window.captureReview.releaseResume!());await released(tab);expect(await tab.evaluate(()=>window.captureReview.a.stop())).toEqual({ok:false,error:"aborted"});
});
test("concurrent stop shares one flush and abort during held close rejects otherwise valid bytes",async()=>{
  const tab=await page();expect(await start(tab)).toEqual({ok:true});await tab.waitForTimeout(220);
  expect(await tab.evaluate(()=>{const r=window.captureReview,context=r.contexts[0],close=context.close.bind(context);context.close=()=>{void close();return new Promise<void>(resolve=>{r.releaseClose=resolve;});};r.stopped=r.a.stop();return r.stopped===r.a.stop();})).toBe(true);
  await tab.waitForFunction(()=>!!window.captureReview.releaseClose);
  expect(await tab.evaluate(async()=>{const r=window.captureReview;r.abort.abort();r.releaseClose!();return r.stopped;})).toEqual({ok:false,error:"aborted"});
  expect(await tab.evaluate(()=>({state:window.captureReview.a.state(),stops:window.captureReview.stops}))).toEqual({state:"disposed",stops:1});await released(tab);
});
test("independent real transferred chunks reconstruct exact WAV bytes through server verification",async()=>{
  const module='registerProcessor("canonical-recording-capture",class extends AudioWorkletProcessor{constructor(){super();this.port.postMessage({v:1,type:"ready",sampleRate:24000});this.port.onmessage=()=>{for(let sequence=0;sequence<2;sequence++){const frames=sequence?7:4096,buffer=new ArrayBuffer(frames*2),view=new DataView(buffer);for(let i=0;i<frames;i++)view.setInt16(i*2,sequence?-12345:23456,true);this.port.postMessage({v:1,type:"pcm",sequence,frames,buffer},[buffer]);}this.port.postMessage({v:1,type:"done",chunks:2,frames:4103});};}process(_i,o){for(const a of o)for(const c of a)c.fill(0);return true;}});';
  const tab=await page({module});expect(await start(tab)).toEqual({ok:true});const result=await tab.evaluate(async()=>{const value=await window.captureReview.a.stop();return value.ok?{ok:true as const,bytes:Array.from(new Uint8Array(await value.blob.arrayBuffer())),frames:value.frameCount,duration:value.durationMs,type:value.blob.type}:value;});
  expect(result.ok).toBe(true);if(!result.ok)return;const bytes=Uint8Array.from(result.bytes),view=new DataView(bytes.buffer);expect(result.frames).toBe(4103);expect(result.duration).toBe(171);expect(result.type).toBe("audio/wav");
  for(let i=0;i<4103;i++)expect(view.getInt16(44+i*2,true)).toBe(i<4096?23456:-12345);
  expect(await verifyCanonicalRecordingWav(new Blob([bytes]).stream(),{signal:new AbortController().signal})).toEqual({ok:true,value:{mediaType:"audio/wav",byteLength:8250,frameCount:4103,durationMs:171,contentSha256:createHash("sha256").update(bytes).digest("hex")}});await released(tab);
});
test("a wrong final frame total cannot yield a partial Blob from an actual worklet",async()=>{
  const module='registerProcessor("canonical-recording-capture",class extends AudioWorkletProcessor{constructor(){super();this.port.postMessage({v:1,type:"ready",sampleRate:24000});this.port.onmessage=()=>{this.port.postMessage({v:1,type:"pcm",sequence:0,frames:1,buffer:new ArrayBuffer(2)});this.port.postMessage({v:1,type:"done",chunks:1,frames:2});};}process(_i,o){for(const a of o)for(const c of a)c.fill(0);return true;}});';
  const tab=await page({module});expect(await start(tab)).toEqual({ok:true});expect(await tab.evaluate(()=>window.captureReview.a.stop())).toEqual({ok:false,error:"invalid-capture"});await released(tab);
});
test("worklet transfer boundaries preserve a long three-channel pattern exactly and never monitor any output",()=>{
  type Message={type:string;sequence?:number;frames?:number;buffer?:ArrayBuffer};
  type Processor={process(input:Float32Array[][],output:Float32Array[][]):boolean;port:{onmessage:(event:{data:unknown})=>void}};
  let Constructor:new()=>Processor;const messages:Message[]=[];
  runInNewContext(worklet,{sampleRate:24000,ArrayBuffer,DataView,Math,Number,Object,AudioWorkletProcessor:class{port={onmessage:undefined,postMessage(value:Message,transfer:Transferable[]=[]){messages.push(structuredClone(value,{transfer}));}};},registerProcessor(_name:string,value:new()=>Processor){Constructor=value;}});
  const processor=new Constructor!(),patterns=[[-1,1,.5,-.5,4,-4,1,0],[-1,1,-.5,.5,2,-2,0,0],[-1,1,0,0,0,0,-1,0]],expected=[-32768,32767,0,0,32767,-32768,0,0];let offset=0;
  for(const length of [17,4096,1,333,6490]){const inputs=patterns.map(pattern=>Float32Array.from({length},(_,i)=>pattern[(offset+i)%8])),outputs=[[new Float32Array(length).fill(.75),new Float32Array(length).fill(-.75)],[new Float32Array(length).fill(1)]];
    expect(processor.process([inputs],outputs)).toBe(true);for(const output of outputs)for(const channel of output)expect(channel.every(sample=>sample===0)).toBe(true);offset+=length;}
  processor.port.onmessage({data:{v:1,type:"stop"}});const pcm=messages.filter(message=>message.type==="pcm");expect(pcm.map(message=>message.sequence)).toEqual([0,1,2]);expect(pcm.map(message=>message.frames)).toEqual([4096,4096,2745]);
  const bytes=Buffer.concat(pcm.map(message=>Buffer.from(message.buffer!)));for(let i=0;i<offset;i++)expect(bytes.readInt16LE(i*2)).toBe(expected[i%8]);
  const count=messages.length;processor.port.onmessage({data:{v:1,type:"stop"}});expect(messages.length).toBe(count);const output=new Float32Array(128).fill(1);expect(processor.process([],[[output]])).toBe(false);expect(output.every(value=>value===0)).toBe(true);
});
