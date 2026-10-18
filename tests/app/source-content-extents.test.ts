import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { parseSourceContent,parseSourceContentResponse,SourceContentUnavailable } from "../../src/server/study/sources/content";
import { parseSourceSegments,sourceNumericCitation } from "../../src/server/study/sources/content-extents";
import { createSefariaContentReader } from "../../src/server/study/sources/content-reader";
import { createSourceContentService } from "../../src/server/study/source-content-service";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { parseRelatedMetadata,parseEditionMetadata } from "../../src/server/study/sources/metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
import { projectEditionCatalog } from "../../src/server/study/sources/editions";
const work="Invented Extent Work",edition={versionTitle:"Invented Extent Edition",language:"en",actualLanguage:"he",license:"CC0",source:"inert invented provenance"} as const;
const source=(ref=`${work} 2:7`)=>({id:"invented_extent",ref,indexTitle:work,category:"Commentary",labels:{en:null,he:null}});
function raw(ref=source().ref,text:unknown=["Invented first.",""," Invented e\u0301.\n"]):Record<string,unknown>{const range=ref.includes("-"),parts=ref.slice(work.length+1).split("-"),sections=parts[0].split(":"),end=range?[...sections.slice(0,-1),parts[1]]:sections;return {ref,indexTitle:work,textDepth:range?sections.length:sections.length+1,isComplex:false,addressTypes:Array(range?sections.length:sections.length+1).fill("Integer"),index_offsets_by_depth:{},sections,toSections:end,isSpanning:false,warnings:[],missings:[],versions:[{versionTitle:edition.versionTitle,language:edition.language,actualLanguage:"he",languageFamilyName:"hebrew",license:edition.license,versionSource:edition.source,text}]};}
const parse=(value:unknown=raw(),ref=source().ref)=>parseSourceSegments(value,{source:source(ref),edition,language:"he"});
const fixtures:Awaited<ReturnType<typeof portalRoutesFixture>>[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0))await f.client.close();});
test("parents copy/freeze exact positions including empty/all-missing/zero observations and NFD",()=>{
 const body=raw(),value=parse(body);expect(value.extent).toEqual({kind:"parent",parentRef:source().ref,requestedStart:null,requestedEnd:null,observedStart:"1",observedEnd:"3"});expect(value.segments).toEqual([{ref:`${work} 2:7:1`,status:"text",text:"Invented first."},{ref:`${work} 2:7:2`,status:"missing",text:null},{ref:`${work} 2:7:3`,status:"text",text:" Invented e\u0301.\n"}]);
 (body.versions as {text:unknown[]}[])[0].text[0]="Changed";expect(value.segments[0]).toMatchObject({text:"Invented first."});expect(Object.isFrozen(value.segments[0])).toBe(true);expect(Object.isFrozen(value.extent)).toBe(true);
 for(const ref of [`${work} 7`,`${work} 1:2:3`])expect(parse(raw(ref,["Invented"]),ref).segments[0].ref).toBe(ref+":1");
 expect(parse(raw(source().ref,[]))).toMatchObject({segments:[],extent:{observedStart:null,observedEnd:null}});expect(parse(raw(source().ref,["",""])).segments.every(row=>row.status==="missing")).toBe(true);expect(parse(raw(source().ref,Array(64).fill(""))).segments).toHaveLength(64);
});
test("range binds exact shortened endpoints and retains every missing slot",()=>{
 const ref=`${work} 2:7:3-5`,value=parse(raw(ref,["","Invented middle.",""]),ref);expect(value.extent).toEqual({kind:"range",parentRef:`${work} 2:7`,requestedStart:"3",requestedEnd:"5",observedStart:"3",observedEnd:"5"});expect(value.segments.map(row=>row.ref)).toEqual([`${work} 2:7:3`,`${work} 2:7:4`,`${work} 2:7:5`]);expect(value.segments.map(row=>row.status)).toEqual(["missing","text","missing"]);
 for(const text of [[],["x"],["x","y"],["x","y","z","too long"]])expect(()=>parse(raw(ref,text),ref)).toThrow();
});
test("new proof requires own empty plain offsets, Integer/noncomplex/depth/STRING vectors and current version facts",()=>{
 const absent=raw();delete absent.index_offsets_by_depth;expect(()=>parse(absent)).toThrow();
 for(const patch of [{index_offsets_by_depth:null},{index_offsets_by_depth:[]},{index_offsets_by_depth:{"3":0}},{index_offsets_by_depth:{"3":[]}},{isComplex:true},{textDepth:4},{addressTypes:["Integer","Integer","Talmud"]},{sections:[2,7]},{sections:["02","7"]},{toSections:["2","8"]},{ref:`${work} 2:8`},{isSpanning:true},{spanningRefs:["Invented"]},{warnings:[{}]},{missings:["hebrew"]}])expect(()=>parse({...raw(),...patch})).toThrow();
 const missing=raw();delete missing.missings;expect(parse(missing).segments).toEqual(parse(raw()).segments);
 for(const patch of [{license:"Public Domain"},{versionSource:"Changed"},{language:"he"},{actualLanguage:"en"},{languageFamilyName:"english"},{sources:["Invented other edition"]}]){const value=raw();Object.assign((value.versions as object[])[0],patch);expect(()=>parse(value)).toThrow();}
 const accepted=raw();Object.assign((accepted.versions as object[])[0],{sources:[]});expect(parse(accepted).segments).toHaveLength(3);
});
test("unsafe aliases, deep/named/cross-parent/large ranges and non-scalar positions never flatten or pad",()=>{
 for(const ref of [`${work} 0:7`,`${work} 2:07`,`${work} ２:7`,`${work} +2:7`,`${work} Named 2:7`,`${work} 2:7:3-2:7:5`,`${work} 2:7:3-8:1`,`${work} 2:7:3-3`,`${work} 2:7:5-3`,`${work} 2:7:1-65`,`${work} 2:7:2147483648-2147483649`])expect(()=>sourceNumericCitation(source(ref))).toThrow();
 for(const ref of [`${work} 1:2:3:4`,`${work} 2147483648:7`])expect(()=>parse(raw(ref,[]),ref)).toThrow();
 const sparse=Array(2);sparse[1]="Invented";for(const values of [sparse,[null],[[]],[["nested"]],["   "],["<b>Invented</b>"],["&amp;"],["\ud800"],["x\u202ey"],Array(65).fill("")])expect(()=>parse(raw(source().ref,values))).toThrow();
 const getter=vi.fn(),body=raw();Object.defineProperty(body,"index_offsets_by_depth",{get(){getter();return {};}});expect(()=>parse(body)).toThrow();expect(getter).not.toHaveBeenCalled();
 const values=["Invented"];Object.defineProperty(values,"0",{get(){getter();return "changed";}});expect(()=>parse(raw(source().ref,values))).toThrow();expect(getter).not.toHaveBeenCalled();
});
test("64KiB is aggregate across rows; scalar v1 parser/dispatcher remain unchanged without new proof",()=>{
 expect(parse(raw(source().ref,["a".repeat(32768),"b".repeat(32768)])).segments).toHaveLength(2);expect(()=>parse(raw(source().ref,["a".repeat(32769),"b".repeat(32768)]))).toThrow(SourceContentUnavailable);
 const leaf=source(`${work} 2:7:1`),body=raw(leaf.ref,"Invented scalar.");body.textDepth=3;delete body.isComplex;delete body.addressTypes;delete body.index_offsets_by_depth;delete body.missings;
 expect(parseSourceContent(body,{source:leaf,edition,language:"he"})).toMatchObject({schema:"study-source-text/v1",text:"Invented scalar."});expect(parseSourceContentResponse(body,{source:leaf,edition,language:"he"})).toEqual(parseSourceContent(body,{source:leaf,edition,language:"he"}));
});
test("fixed-host transport permits only the original bounded short range and makes one exact no-fill GET",async()=>{
 const ref=`${work} 2:7:3-5`,fetch=vi.fn(async()=>new Response(JSON.stringify(raw(ref)),{headers:{"content-type":"application/json"}})),reader=createSefariaContentReader({fetch:fetch as typeof globalThis.fetch});
 await reader.text({ref,indexTitle:work,editionTitle:edition.versionTitle,language:edition.language,actualLanguage:"he",motherTongue:"hebrew"},new AbortController().signal);expect(fetch).toHaveBeenCalledOnce();const[url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(decodeURIComponent(new URL(url).pathname)).toBe(`/api/v3/texts/${ref}`);expect(new URL(url).searchParams.get("fill_in_missing_segments")).toBe("0");expect(options.method).toBe("GET");
});
async function fixture(){const f=await portalRoutesFixture();fixtures.push(f);const assignment=await f.owner(async()=>{const[a]=await f.db.insert(s.assignment).values({tenantId:"crc",studentId:f.students[0].id,kind:"torah",basis:"custom",ref:"Genesis 1:1",status:"confirmed",setByMembershipId:f.adminMember.id}).returning();await f.db.insert(s.assignmentVerse).values({tenantId:"crc",studentId:f.students[0].id,assignmentId:a.id,ordinal:1,verseRef:"Genesis 1:1"});return a;});
 const selection={mode:"admin" as const,studentId:f.students[0].id,kind:"torah" as const,assignmentId:assignment.id,assignmentRevision:1},related=parseRelatedMetadata([{_id:source().id,sourceRef:source().ref,index_title:work,category:"Commentary",anchorRef:"Genesis 1:1"}],"Genesis 1:1"),editions=parseEditionMetadata([{title:work,versionTitle:edition.versionTitle,language:edition.language,actualLanguage:edition.actualLanguage,license:edition.license,versionSource:edition.source}],work),hash=projectRelatedCatalog(related,"Genesis 1:1").catalogHash;
 const request=()=>f.request("/api/source",{who:"admin"}),build=(content:()=>Promise<unknown>)=>createSourceContentService({access:f.service,practice:f.runtime.practice,related:async()=>related,editions:async()=>editions,content});
 const intent={verseRef:"Genesis 1:1",sourceId:source().id,sourceScope:"related" as const,sourceCatalogHash:hash,editionCatalogHash:projectEditionCatalog(editions,work).editionCatalogHash,editionTitle:edition.versionTitle,language:"he" as const};
 const assignments=createSourceAssignmentsService({access:f.service,practice:f.runtime.practice,related:async()=>related}),set=(ids:string[],version:number)=>assignments.replace(f.request("/api/source",{who:"admin",method:"POST"}),selection,{verseRef:"Genesis 1:1",sourceIds:ids,expectedVersion:version,mutationId:randomUUID(),catalogHash:hash});return {...f,selection,request,build,intent,set};}
test("actual source lanes return empty observations and final head/reading/denial checks outrank extent outcomes",async()=>{
 const f=await fixture();expect(await f.build(async()=>raw(source().ref,[])).text(f.request(),f.selection,f.intent)).toMatchObject({ok:true,text:{schema:"study-source-segments/v1",segments:[]}});
 await f.set([source().id],0);const {sourceCatalogHash,...rest}=f.intent,assigned={...rest,sourceScope:"assigned" as const,expectedSetVersion:1};
 const changed=f.build(async()=>{await f.set([],1);return raw(source().ref,Array(64).fill('"'.repeat(1024)));});expect(await changed.text(f.request(),f.selection,assigned)).toEqual({ok:false,error:"source-set-changed"});
 const drift=f.build(async()=>{await f.owner(()=>f.db.update(s.student).set({revision:sql`${s.student.revision}+1`}).where(eq(s.student.id,f.selection.studentId)));const value=raw();delete value.index_offsets_by_depth;return value;});expect(await drift.text(f.request(),f.selection,f.intent)).toEqual({ok:false,error:"stale-revision"});
 const denied=f.build(async()=>{await f.owner(()=>f.db.update(s.session).set({expiresAt:new Date(0)}).where(eq(s.session.id,f.identities.admin.sessionId)));return raw(source().ref,["",""]);});await expect(denied.text(f.request(),f.selection,f.intent)).rejects.toMatchObject({status:401});
});
test("actual complete escaped envelope cap holds an otherwise legal aggregate without truncation",async()=>{const f=await fixture();expect(await f.build(async()=>raw(source().ref,Array(64).fill('"'.repeat(1024)))).text(f.request(),f.selection,f.intent)).toEqual({ok:false,error:"unavailable"});});

test("collection parsing remains inside the original20s public clock and final denial still wins",async()=>{
 const f=await fixture(),marker="Invented extent parse deadline marker";let now=0;vi.spyOn(performance,"now").mockImplementation(()=>now);const original=Buffer.byteLength;
 vi.spyOn(Buffer,"byteLength").mockImplementation((value,encoding)=>{if(value===marker)now=20001;return original(value,encoding);});
 expect(await f.build(async()=>raw(source().ref,[marker])).text(f.request(),f.selection,f.intent)).toEqual({ok:false,error:"unavailable"});
 now=0;const denied=f.build(async()=>{await f.owner(()=>f.db.update(s.session).set({expiresAt:new Date(0)}).where(eq(s.session.id,f.identities.admin.sessionId)));return raw(source().ref,[marker]);});await expect(denied.text(f.request(),f.selection,f.intent)).rejects.toMatchObject({status:401});
});
