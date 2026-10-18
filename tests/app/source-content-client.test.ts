import {afterEach,expect,test,vi} from "vitest";
import {PortalRequestError} from "../../src/components/portal/api";
import type {Assigned} from "../../src/components/portal/workspace/api";
import {captureSourceContent,createSourceContentClient,parseSourceEditionResponse,parseSourceTextResponse,SourceContentError,isSourceMissing,type SourceContentTarget,type SourceEditionPage,type SourceContentClient,type EditionChoice} from "../../src/components/portal/workspace/study/sources/content-api";
import {createSourceContentOwner} from "../../src/components/portal/workspace/study/sources/content-owner";
import {createSourceContentBudget} from "../../src/components/portal/workspace/study/sources/content-budget";
const H="a".repeat(64),E="b".repeat(64),id="10000000-0000-4000-8000-000000000001",aid="10000000-0000-4000-8000-000000000002";
const source={id:"invented",ref:"Invented Complete Work 1:1:1",indexTitle:"Invented Complete Work",category:"Commentary",labels:{en:"Invented",he:null}};
const edition={versionTitle:"Invented Edition",language:"en",actualLanguage:"he",license:"Public Domain",source:"javascript:inert provenance"};
const target:SourceContentTarget={source,sourceScope:"related",sourceCatalogHash:H};
function baseline(mode:Assigned["mode"]="admin"):Assigned{return {mode,student:{id,revision:1,firstName:"Invented",lastName:"Reader",ceremonyDate:"2027-01-02"},context:mode==="child-practice"?{id:aid,authorityRevision:1,studentId:id,studentRevision:1,expiresAt:new Date(Date.now()+60000).toISOString()}:null,readings:[{id:aid,kind:"torah",revision:1,ranges:["Genesis 1:1"],verses:["Genesis 1:1"],needsReview:false,aliyahStarts:null,basis:"custom",confirmationDate:"2027-01-02",source:{status:"unknown",fetchedAt:null,date:null,calendar:null,attribution:null}}]};}
function capture(base=baseline(),supplied=target){return captureSourceContent({baseline:base,kind:"torah",offset:0,selection:base.context?{handle:"h".repeat(43),context:base.context}:undefined},supplied);}
const page=(offset=0,total=1):SourceEditionPage=>({schema:"study-edition-page/v1",workTitle:source.indexTitle,editionCatalogHash:E,editionOffset:offset,pageSize:10,totalEntries:total,receivedRows:total,heldCount:0,duplicateCount:0,nextEditionOffset:offset+10<total?offset+10:null,entries:Array.from({length:Math.min(10,total-offset)},(_,i)=>({...edition,versionTitle:total===1?edition.versionTitle:`Invented ${String(offset+i).padStart(3,"0")}`}))});
const text=(value="Invented שָׁלוֹם\ne\u0301.")=>({schema:"study-source-text/v1",ref:source.ref,text:value,edition:{versionTitle:edition.versionTitle,language:edition.language,actualLanguage:"he"},provenance:{provider:"Sefaria",sourceRef:source.ref,editionTitle:edition.versionTitle,license:edition.license,versionSource:edition.source,format:"text_only"}});
function envelope(payload:object,base=baseline(),scope=target){return {ok:true,studentId:id,studentRevision:1,mode:base.mode,context:base.context,assignment:{id:aid,revision:1,kind:"torah",needsReview:false},verseRef:"Genesis 1:1",source:scope.source,...(scope.sourceScope==="related"?{sourceCatalogHash:scope.sourceCatalogHash}:{expectedSetVersion:scope.expectedSetVersion}),...payload};}
const choice:EditionChoice={editionCatalogHash:E,edition,language:"he"};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
const held=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
test("all reader modes capture one verse and onlyGET explicit edition before text",async()=>{
 for(const mode of ["admin","tutor","student","parent","child-practice"] as const){const base=baseline(mode),fetcher=vi.fn(async(url:string)=>response(envelope(url.includes("source-editions")?{editions:page()}:{text:text()},base)));vi.stubGlobal("fetch",fetcher);
 const client=createSourceContentClient({baseline:base,kind:"torah",offset:0,selection:base.context?{handle:"h".repeat(43),context:base.context}:undefined},target);expect(fetcher).not.toHaveBeenCalled();await client.editions({editionOffset:0},new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(1);await client.text(choice,new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(2);
 const[url,opts]=fetcher.mock.calls[1] as unknown as [string,RequestInit];expect(new URL(url,"https://example.test").searchParams.get("language")).toBe("he");expect(url).not.toContain("javascript");expect(url).not.toContain("hhhh");expect(opts.method).toBe("GET");expect(new Headers(opts.headers).get("X-Practice-Context")).toBe(base.context?"h".repeat(43):null);}
});
test("closed DTOs bind source lane/envelope,512paging and exact edition provenance while preserving NFD",()=>{
 const c=capture();expect(parseSourceEditionResponse(envelope({editions:page(510,512)}),c,{editionOffset:510,editionCatalogHash:E}).entries).toHaveLength(2);
 expect(parseSourceTextResponse(envelope({text:text()}),c,choice).text).toBe(text().text);
 for(const patch of [{studentRevision:2},{verseRef:"Genesis 1:2"},{expectedSetVersion:1},{source:{...source,ref:"Invented 2"}},{sourceCatalogHash:"c".repeat(64)},{context:{}}])expect(()=>parseSourceTextResponse({...envelope({text:text()}),...patch},c,choice)).toThrow();
 for(const patch of [{schema:"wrong"},{editionCatalogHash:E},{text:["Invented"]},{text:"<b>Invented</b>"},{text:"&amp;"},{provenance:{...text().provenance,versionSource:"changed"}},{edition:{...text().edition,language:"he"}}])expect(()=>parseSourceTextResponse(envelope({text:{...text(),...patch}}),c,choice)).toThrow();
 const repeated={...page(0,2),entries:[edition,{...edition,actualLanguage:"en"}]};expect(()=>parseSourceEditionResponse(envelope({editions:repeated}),c,{editionOffset:0})).toThrow();
 expect(()=>parseSourceTextResponse(envelope({text:text('"'.repeat(65536))}),c,choice)).toThrow();expect(parseSourceTextResponse(envelope({text:text("x".repeat(65536))}),c,choice).text).toHaveLength(65536);
});
test("request inputs captured before I/O and accessors are rejected without invocation",async()=>{
 const base=baseline(),mutable={...target,source:{...source}},gate=held<Response>(),fetcher=vi.fn(()=>gate.promise);vi.stubGlobal("fetch",fetcher);const client=createSourceContentClient({baseline:base,kind:"torah",offset:0},mutable);
 const pending=client.editions({editionOffset:0},new AbortController().signal);await Promise.resolve();base.student.revision=2;mutable.source.ref="Changed";gate.resolve(response(envelope({editions:page()})));expect((await pending).workTitle).toBe(source.indexTitle);
 const getter=vi.fn();expect(()=>captureSourceContent({baseline:baseline(),kind:"torah",offset:0},{...target,source:{...source,get ref(){getter();return "Changed";}}})).toThrow();expect(getter).not.toHaveBeenCalled();
});
test("only exactclosed source-not-found404 is local; actual404 remains authority denial",async()=>{
 const client=createSourceContentClient({baseline:baseline(),kind:"torah",offset:0},target);
 for(const payload of [{ok:false,error:"source-not-found"},{error:"not-found"},{ok:false,error:"source-not-found",extra:true}]){vi.stubGlobal("fetch",vi.fn(async()=>response(payload,404)));try{await client.editions({editionOffset:0},new AbortController().signal);throw Error("Expected refusal");}catch(error){expect(isSourceMissing(error)).toBe(Object.hasOwn(payload,"ok")&&!Object.hasOwn(payload,"extra"));expect(error).toBeInstanceOf(PortalRequestError);}}
});
test("owner fences late replies and requires accepted page choice with no fallback",async()=>{
 const gate=held<SourceEditionPage>(),api:SourceContentClient={editions:vi.fn(()=>gate.promise),text:vi.fn(async()=>text() as ReturnType<SourceContentClient["text"]> extends Promise<infer T>?T:never)},owner=createSourceContentOwner({api});
 expect(owner.state.phase).toBe("closed");const pending=owner.open();owner.clear();gate.resolve(page());expect(await pending).toBe(false);expect(owner.state.page).toBeNull();
 api.editions=vi.fn(async()=>page());await owner.open();expect(api.text).not.toHaveBeenCalled();expect(await owner.choose({...choice,edition:{...edition,versionTitle:"Other"}})).toBe(false);expect(await owner.choose(choice)).toBe(true);expect(owner.state.phase).toBe("text");owner.back();expect(owner.state.text).toBeNull();owner.dispose();expect(owner.state.phase).toBe("disposed");
});
test("owner local missing/unsupported differs from actual denial and stale clears without repinning",async()=>{
 for(const refusal of [new SourceContentError(404,"source-not-found"),new SourceContentError(422,"unsupported-source"),new PortalRequestError(404),new SourceContentError(409,"source-set-changed")]){const api:SourceContentClient={editions:async()=>{throw refusal;},text:async()=>{throw Error("No body");}},owner=createSourceContentOwner({api});await owner.open();expect(owner.state.phase).toBe(isSourceMissing(refusal)||refusal.status===422?"held":refusal.status===404?"disposed":"stale");expect(owner.state.text).toBeNull();}
});
test("endpoint uses30s total and5s idle with late response cancellation",async()=>{
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout","performance"]});const gate=held<Response>(),canceled=vi.fn();vi.stubGlobal("fetch",vi.fn(()=>gate.promise));const client=createSourceContentClient({baseline:baseline(),kind:"torah",offset:0},target),pending=client.editions({editionOffset:0},new AbortController().signal),assertion=expect(pending).rejects.toBeInstanceOf(PortalRequestError);
 await vi.advanceTimersByTimeAsync(30001);await assertion;gate.resolve(new Response(new ReadableStream({cancel:canceled}),{headers:{"content-type":"application/json"}}));await Promise.resolve();await Promise.resolve();expect(canceled).toHaveBeenCalled();
});
test("45s action caps sequential phases and synchronous overruns cannot evade12s phase budget",async()=>{
 let time=0;vi.spyOn(performance,"now").mockImplementation(()=>time);const caller=new AbortController(),budget=createSourceContentBudget(caller.signal);
 await budget.run(12000,async()=>{time=11000;});await budget.run(30000,async()=>{time=40000;});await expect(budget.run(12000,async()=>{time=45000;})).rejects.toMatchObject({status:503});expect(caller.signal.aborted).toBe(false);budget.dispose();
 time=0;const second=createSourceContentBudget(caller.signal);await expect(second.run(12000,async()=>{time=12000;})).rejects.toMatchObject({status:503});second.dispose();
});

test("every observed malformed404 stays authority404 and nested accessors are refused without executing",async()=>{
 const client=createSourceContentClient({baseline:baseline(),kind:"torah",offset:0},target);
 for(const build of [()=>new Response("{",{status:404,headers:{"content-type":"application/json"}}),()=>new Response("{}",{status:404,headers:{"content-type":"text/plain"}}),()=>new Response(new ReadableStream({start(controller){controller.error(Error("Invented"));}}),{status:404,headers:{"content-type":"application/json"}})]){vi.stubGlobal("fetch",vi.fn(async()=>build()));await expect(client.editions({editionOffset:0},new AbortController().signal)).rejects.toMatchObject({status:404});}
 const getter=vi.fn(),raw=envelope({text:{...text(),get provenance(){getter();return text().provenance;}}});expect(()=>parseSourceTextResponse(raw,capture(),choice)).toThrow();expect(getter).not.toHaveBeenCalled();
});
