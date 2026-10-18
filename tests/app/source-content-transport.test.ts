import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createSefariaContentReader} from "../../src/server/study/sources/content-reader";
import {SourceContentUnavailable,type ContentSelection} from "../../src/server/study/sources/content";
const selection:ContentSelection={ref:"Invented Complete Work 1:1:1",indexTitle:"Invented Complete Work",editionTitle:"Invented Edition",language:"en",actualLanguage:"he",motherTongue:"hebrew"};
const json=(body:BodyInit|null)=>new Response(body,{headers:{"content-type":"application/json"}});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
test("one fixed official GET selects exact explicit mother-language/title with no fill, redirect, credentials or cache",async()=>{
 const fetch=vi.fn(async()=>json('{"invented":true}'));const reader=createSefariaContentReader({fetch:fetch as typeof globalThis.fetch});expect(await reader.text(selection,new AbortController().signal)).toEqual({invented:true});
 expect(fetch).toHaveBeenCalledTimes(1);const[url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit],parsed=new URL(url);
 expect(parsed.origin).toBe("https://www.sefaria.org");expect(decodeURIComponent(parsed.pathname)).toBe("/api/v3/texts/Invented Complete Work 1:1:1");expect([...parsed.searchParams]).toEqual([["version","hebrew|Invented Edition"],["fill_in_missing_segments","0"],["return_format","text_only"]]);
 expect(options).toMatchObject({method:"GET",credentials:"omit",referrerPolicy:"no-referrer",redirect:"error",cache:"no-store",headers:{accept:"application/json"}});
});
test("transport rejects2MiB overflow, fatalUTF8, malformed JSON, badheaders and nonbytes",async()=>{
 const cases=[()=>json("x".repeat(2*1024*1024+1)),()=>json(new Uint8Array([0xc3,0x28])),()=>json("{"),()=>new Response("{}",{headers:{"content-type":"text/html"}}),()=>new Response("{}",{status:301,headers:{"content-type":"application/json"}}),()=>new Response("{}",{headers:{"content-type":"application/json","content-length":String(2*1024*1024+1)}}),()=>json(new ReadableStream({start(c){c.enqueue("wrong" as unknown as Uint8Array);c.close();}}))];
 for(const response of cases){const reader=createSefariaContentReader({fetch:vi.fn(async()=>response()) as typeof globalThis.fetch});await expect(reader.text(selection,new AbortController().signal)).rejects.toBeInstanceOf(SourceContentUnavailable);}
});
test("late headers are canceled after total timeout even if fetch ignores abort",async()=>{
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout","performance"]});let resolve!:(r:Response)=>void;const canceled=vi.fn();
 const reader=createSefariaContentReader({fetch:vi.fn(()=>new Promise<Response>(r=>resolve=r)) as typeof globalThis.fetch});const pending=reader.text(selection,new AbortController().signal);const assertion=expect(pending).rejects.toBeInstanceOf(SourceContentUnavailable);
 await vi.advanceTimersByTimeAsync(10001);await assertion;resolve(json(new ReadableStream({cancel:canceled})));await Promise.resolve();await Promise.resolve();expect(canceled).toHaveBeenCalledTimes(1);
});
test("no-progress5s and65 empty reads cancel locked bodies without retry",async()=>{
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout","performance"]});const canceled=vi.fn(),fetch=vi.fn(async()=>json(new ReadableStream({cancel:canceled}))),reader=createSefariaContentReader({fetch:fetch as typeof globalThis.fetch});
 const pending=reader.text(selection,new AbortController().signal),assertion=expect(pending).rejects.toBeInstanceOf(SourceContentUnavailable);await vi.advanceTimersByTimeAsync(5001);await assertion;expect(canceled).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
 vi.useRealTimers();const empties=vi.fn();const emptyReader=createSefariaContentReader({fetch:vi.fn(async()=>json(new ReadableStream({pull(c){c.enqueue(new Uint8Array());},cancel:empties}))) as typeof globalThis.fetch});await expect(emptyReader.text(selection,new AbortController().signal)).rejects.toBeInstanceOf(SourceContentUnavailable);expect(empties).toHaveBeenCalledTimes(1);
});
test("caller abort cancels pendingbody and invalid selector never starts fetch",async()=>{
 const caller=new AbortController(),canceled=vi.fn(),fetch=vi.fn(async()=>json(new ReadableStream({cancel:canceled}))),reader=createSefariaContentReader({fetch:fetch as typeof globalThis.fetch});const pending=reader.text(selection,caller.signal),assertion=expect(pending).rejects.toBeInstanceOf(SourceContentUnavailable);await Promise.resolve();await Promise.resolve();caller.abort();await assertion;expect(canceled).toHaveBeenCalledTimes(1);
 fetch.mockClear();for(const input of [{...selection,editionTitle:"Invented|other"},{...selection,ref:"Invented Complete Work 1:01:1"},{...selection,motherTongue:"english" as const}])await expect(reader.text(input,new AbortController().signal)).rejects.toBeInstanceOf(SourceContentUnavailable);expect(fetch).not.toHaveBeenCalled();
});
