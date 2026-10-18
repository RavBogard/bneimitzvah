// Controlled fake clock/media/network delays, not real phone/audio latency.
import { createHash } from "node:crypto";
import { afterEach,expect,it,vi } from "vitest";
import { createReadingPlayback } from "../../src/components/portal/workspace/study/main-playback";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import type { ReferenceResolution } from "../../src/lib/reference-audio/source";
import type { ReferenceAudioElement } from "../../src/lib/reference-audio/playback";
const bytes=new Uint8Array([11,22,33]),text="אבג דהו";
const sha=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const source={schema:"reference-source/v1" as const,asset:"ra_"+"a".repeat(32),url:"https://archive.org/download/PockettorahAudioFiles/Synthetic-performance.mp3",bytes:bytes.length,sha256:sha(bytes)};
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
afterEach(()=>vi.useRealTimers());
function rig(){
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout","performance"]});
  const metrics={resolver:0,fetch:0,abortedFetch:0,media:0,metadata:0,starts:[] as number[]};
  class Media extends EventTarget{
    src="";preload="";duration=40;currentTime=0;playbackRate=1;preservesPitch=true;
    async play(){metrics.starts.push(performance.now());} pause(){}
    load(){if(this.src){metrics.metadata++;setTimeout(()=>this.dispatchEvent(new Event("loadedmetadata")),40);}}
    removeAttribute(){this.src="";}
  }
  const owner=createReadingPlayback({verses:[0,1].map(i=>({ref:`Genesis 1:${i+1}`,readingText:text,wordCount:2})),
    load:async(index)=>{metrics.resolver++;await wait(30);const start=10+index*10;
      return {source,verse:{schema:"reference-verse/v1",ref:`Genesis 1:${index+1}`,table:"torah",playback:{status:"ready",asset:source.asset,clip:{start,end:start+5}},
        words:{status:"ready",readingTextSha256:sha(text),starts:[start,start+2]},attribution:REFERENCE_ATTRIBUTION}} satisfies ReferenceResolution;},
    onState(){},onActiveWord(){},platform:{digest:async value=>sha(value),audio(){metrics.media++;return new Media() as ReferenceAudioElement;},
      createUrl:()=>"blob:synthetic-performance",revokeUrl(){},fetch:async(_url,init)=>{
        metrics.fetch++;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,80);init?.signal?.addEventListener("abort",()=>{metrics.abortedFetch++;clearTimeout(timer);reject(Error("synthetic-abort"));},{once:true});});
        const response=new Response(bytes);Object.defineProperty(response,"url",{value:"https://ia800000.us.archive.org/synthetic-performance.mp3"});return response;},
      scheduler:{frame:()=>1,cancelFrame(){},timer:()=>1 as unknown as ReturnType<typeof setTimeout>,clearTimer(){}}}});
  return {owner,metrics};
}
it("measures controlled cold, same-verse and adjacent same-asset preparation",async()=>{
  const f=rig(),first=f.owner.select(0,0);await vi.advanceTimersByTimeAsync(200);await first;
  const firstStart=f.metrics.starts[0],at=performance.now();await f.owner.select(0,1);const sameVerse=f.metrics.starts.at(-1)!-at;
  const before=performance.now(),next=f.owner.select(1,0);await vi.advanceTimersByTimeAsync(200);await next;
  const adjacent=f.metrics.starts.at(-1)!-before;
  console.log(JSON.stringify({fixture:"controlled-reference-preparation",resolverDelay:30,networkDelay:80,metadataDelay:40,cold:firstStart,sameVerse,adjacent,...f.metrics}));
  expect(f.metrics.starts).toHaveLength(3);expect(f.metrics.resolver).toBe(2);expect(f.metrics.fetch).toBe(1);
  expect(f.metrics.media).toBe(1);expect(f.metrics.metadata).toBe(1);expect(firstStart).toBe(150);expect(sameVerse).toBe(0);expect(adjacent).toBe(30);f.owner.dispose();
});
it("measures rapid different-verse intent while verified asset fetch is in flight",async()=>{
  const f=rig(),first=f.owner.select(0,0);await vi.advanceTimersByTimeAsync(50);
  const at=performance.now(),next=f.owner.select(1,1);await vi.advanceTimersByTimeAsync(250);await Promise.all([first,next]);
  console.log(JSON.stringify({fixture:"controlled-reference-inflight",resolverDelay:30,networkDelay:80,metadataDelay:40,latestTapToStart:f.metrics.starts[0]-at,...f.metrics}));
  expect(f.metrics.starts).toHaveLength(1);expect(f.owner.state.verse).toBe(1);expect(f.metrics.fetch).toBe(1);expect(f.metrics.abortedFetch).toBe(0);
  expect(f.metrics.media).toBe(1);expect(f.metrics.metadata).toBe(1);expect(f.metrics.starts[0]-at).toBe(100);f.owner.dispose();
});
