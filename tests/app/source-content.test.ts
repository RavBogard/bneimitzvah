import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import * as s from "../../src/server/db/index";
import {portalRoutesFixture} from "./portal-routes-fixture";
import {createSourceContentService} from "../../src/server/study/source-content-service";
import {createSourceAssignmentsService} from "../../src/server/study/source-assignments-service";
import {createHttpDispatcher} from "../../src/server/http/dispatch";
import {parseRelatedMetadata,parseEditionMetadata} from "../../src/server/study/sources/metadata";
import {projectRelatedCatalog} from "../../src/server/study/sources/discovery";
import {projectEditionCatalog,editionPage,selectEdition} from "../../src/server/study/sources/editions";
import {parseSourceContent,SourceContentUnavailable} from "../../src/server/study/sources/content";
const source={id:"invented",ref:"Invented Complete Work 1:1:1",indexTitle:"Invented Complete Work",category:"Commentary",labels:{en:null,he:null}} as const;
const edition={versionTitle:"Invented Edition",language:"en",actualLanguage:"he",license:"Public Domain",source:"inert invented provenance"} as const;
const rawEdition=(overrides={})=>({title:source.indexTitle,versionTitle:edition.versionTitle,language:edition.language,actualLanguage:edition.actualLanguage,license:edition.license,versionSource:edition.source,...overrides});
const catalog=()=>parseEditionMetadata([rawEdition()],source.indexTitle);
const body=()=>({ref:source.ref,indexTitle:source.indexTitle,textDepth:3,sections:["1","1","1"],toSections:["1","1","1"],isSpanning:false,warnings:[],versions:[{versionTitle:edition.versionTitle,language:edition.language,actualLanguage:"he",languageFamilyName:"hebrew",license:edition.license,versionSource:edition.source,text:"Invented scalar example."}]});
const fixtures:Awaited<ReturnType<typeof portalRoutesFixture>>[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0))await f.client.close();});
async function fixture(){const f=await portalRoutesFixture();fixtures.push(f);
 const assignment=await f.owner(async()=>{const[a]=await f.db.insert(s.assignment).values({tenantId:"crc",studentId:f.students[0].id,kind:"torah",basis:"custom",ref:"Genesis 1:1-2",status:"confirmed",setByMembershipId:f.adminMember.id}).returning();await f.db.insert(s.assignmentVerse).values([1,2].map(n=>({tenantId:"crc",studentId:f.students[0].id,assignmentId:a.id,ordinal:n,verseRef:`Genesis 1:${n}`})));return a;});
 const selection={mode:"admin" as const,studentId:f.students[0].id,kind:"torah" as const,assignmentId:assignment.id,assignmentRevision:1};
 const related=parseRelatedMetadata([{_id:source.id,sourceRef:source.ref,index_title:source.indexTitle,category:source.category,anchorRef:"Genesis 1:1"}],"Genesis 1:1"),sourceCatalogHash=projectRelatedCatalog(related,"Genesis 1:1").catalogHash;
 const editionCatalogHash=projectEditionCatalog(catalog(),source.indexTitle).editionCatalogHash;
 const loaders={related:vi.fn(async()=>related),editions:vi.fn(async()=>catalog()),content:vi.fn(async()=>body())};
 const build=(overrides:Partial<typeof loaders>={})=>createSourceContentService({access:f.service,practice:f.runtime.practice,...loaders,...overrides});
 const service=build(),intent={verseRef:"Genesis 1:1",sourceId:String(source.id),sourceScope:"related" as const,sourceCatalogHash,editionCatalogHash,editionTitle:edition.versionTitle,language:"he" as const};
 const readRequest=()=>f.request("/api/source",{who:"admin"});
 const assign=async()=>{const service=createSourceAssignmentsService({access:f.service,practice:f.runtime.practice,related:loaders.related});const write={verseRef:intent.verseRef,expectedVersion:0,mutationId:randomUUID(),sourceIds:[source.id],catalogHash:sourceCatalogHash};return service.replace(f.request("/api/source",{who:"admin",method:"POST"}),selection,write);};
 return {...f,selection,loaders,build,service,intent,readRequest,assign};}
test("full deterministic512 catalog keeps every row and licenses/provenance in its hash",()=>{
 const rows=Array.from({length:512},(_,i)=>rawEdition({versionTitle:`Invented ${String(i).padStart(3,"0")}`}));
 const a=projectEditionCatalog(parseEditionMetadata(rows,source.indexTitle),source.indexTitle),b=projectEditionCatalog(parseEditionMetadata([...rows].reverse(),source.indexTitle),source.indexTitle);
 expect(a.editionCatalogHash).toBe(b.editionCatalogHash);expect(a.entries).toHaveLength(512);expect(editionPage(a,510)).toMatchObject({totalEntries:512,nextEditionOffset:null,entries:[{versionTitle:"Invented 510"},{versionTitle:"Invented 511"}]});
 expect(projectEditionCatalog(parseEditionMetadata([...rows,],source.indexTitle),source.indexTitle).editionCatalogHash).toBe(a.editionCatalogHash);
 const changed=rows.map((r,i)=>i===400?{...r,license:"CC0"}:r);expect(projectEditionCatalog(parseEditionMetadata(changed,source.indexTitle),source.indexTitle).editionCatalogHash).not.toBe(a.editionCatalogHash);
 const ambiguous=projectEditionCatalog(parseEditionMetadata([rawEdition(),rawEdition({language:"he"})],source.indexTitle),source.indexTitle);expect(selectEdition(ambiguous,"he",edition.versionTitle)).toBeNull();
});
test("exact scalar is preserved while string address, edition, rights and all body facts are bound",()=>{
 const valid=body();valid.versions[0].text="  Invented\nscalar e\u0301.  ";expect(parseSourceContent(valid,{source,edition,language:"he"}).text).toBe(valid.versions[0].text);
 for(const change of [{sections:[1,1,1]},{sections:["01","1","1"]},{toSections:["1","1","2"]},{textDepth:2},{ref:source.indexTitle+" 1:1"},{isSpanning:true},{spanningRefs:["Invented"]},{warnings:[{}]},{versions:[]},{versions:[...body().versions,...body().versions]}])expect(()=>parseSourceContent({...body(),...change},{source,edition,language:"he"})).toThrow(SourceContentUnavailable);
 for(const change of [{language:"he"},{actualLanguage:"en"},{languageFamilyName:"english"},{versionSource:"changed"},{license:"CC0"},{versionTitle:"Changed"},{text:["Invented"]},{text:"<b>Invented</b>"},{text:"Invented &amp; value"},{text:"\ud800"},{text:"x".repeat(65537)}]){const raw=body();Object.assign(raw.versions[0],change);expect(()=>parseSourceContent(raw,{source,edition,language:"he"})).toThrow(SourceContentUnavailable);}
});
test("actual SDK related and assigned lanes resolve exact server metadata without related I/O for retained citations",async()=>{
 const f=await fixture();expect(await f.service.text(f.readRequest(),f.selection,f.intent)).toMatchObject({ok:true,sourceCatalogHash:f.intent.sourceCatalogHash,text:{text:"Invented scalar example.",provenance:{provider:"Sefaria",license:"Public Domain"}}});
 expect((f.loaders.content.mock.calls as unknown as unknown[][])[0][0]).toMatchObject({language:"en",actualLanguage:"he",motherTongue:"hebrew"});await f.assign();f.loaders.related.mockClear();
 const {sourceCatalogHash,...rest}=f.intent;expect(await f.service.text(f.readRequest(),f.selection,{...rest,sourceScope:"assigned",expectedSetVersion:1})).toMatchObject({ok:true,expectedSetVersion:1});expect(f.loaders.related).not.toHaveBeenCalled();
 expect(await f.service.text(f.readRequest(),f.selection,{...rest,sourceScope:"assigned",expectedSetVersion:2})).toEqual({ok:false,error:"source-set-changed"});
});
test("final original authority and reading win over public failures and caller-input mutation",async()=>{
 const f=await fixture(),selection={...f.selection},intent={...f.intent},request=f.readRequest(),headers=new Headers(request.headers);
 const service=f.build({content:vi.fn(async()=>{selection.mode="admin";intent.sourceId="changed";headers.set("cookie","bogus");await f.owner(()=>f.db.update(s.student).set({revision:sql`${s.student.revision}+1`}).where(eq(s.student.id,f.selection.studentId)));throw Error("private provider cause");})});
 expect(await service.text({url:request.url,headers},selection,intent)).toEqual({ok:false,error:"stale-revision"});
 const denied=f.build({editions:vi.fn(async()=>{await f.owner(()=>f.db.update(s.session).set({expiresAt:new Date(0)}).where(eq(s.session.id,f.identities.admin.sessionId)));throw Error("private");})});
 await expect(denied.text(f.readRequest(),f.selection,f.intent)).rejects.toMatchObject({status:401});
});
test("closed HTTP methods, selectors, lane exclusivity and fixed errors are private",async()=>{
 const f=await fixture(),dispatch=createHttpDispatcher(async action=>action({...f.runtime,sourceContent:f.service})),path=`/api/students/${f.selection.studentId}/source-text`;
 const query=new URLSearchParams(Object.entries({...f.selection,...f.intent}).filter(([k])=>k!=="studentId").map(([k,v])=>[k,String(v)]));
 const response=await dispatch(f.request(`${path}?${query}`,{who:"admin"}));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
 for(const suffix of ["&language=en","&sourceRef=Invented","&expectedSetVersion=1","&studentId=other"]){const r=await dispatch(f.request(`${path}?${query}${suffix}`,{who:"admin"}));expect(r.status).toBe(400);}
 expect((await dispatch(f.request(path,{who:"admin",method:"HEAD"}))).status).toBe(405);
 const unsupported=new URLSearchParams(query);unsupported.set("editionTitle","Unknown");const held=await dispatch(f.request(`${path}?${unsupported}`,{who:"admin"}));expect(held.status).toBe(422);expect(await held.json()).toEqual({ok:false,error:"unsupported-edition"});
});

test("absolute per-call deadline fences synchronous returns in every public stage and final denial still wins",async()=>{
 const f=await fixture();let time=0;vi.spyOn(performance,"now").mockImplementation(()=>time);
 for(const stage of ["related","editions","content"] as const){time=0;for(const loader of Object.values(f.loaders))loader.mockClear();
   const service=f.build({[stage]:vi.fn(async()=>{time=10000;return stage==="related"?await f.loaders.related():stage==="editions"?catalog():body();})});
   expect(await service.text(f.readRequest(),f.selection,f.intent)).toEqual({ok:false,error:"unavailable"});
   if(stage!=="content")expect(f.loaders.content).not.toHaveBeenCalled();
 }
 time=0;const service=f.build({content:vi.fn(async()=>{await f.owner(()=>f.db.update(s.session).set({expiresAt:new Date(0)}).where(eq(s.session.id,f.identities.admin.sessionId)));time=10001;return body();})});
 await expect(service.text(f.readRequest(),f.selection,f.intent)).rejects.toMatchObject({status:401});
});

test("authorized absent sources are local404 while genuine scope denial retains its fixed authority envelope",async()=>{
 const f=await fixture();const missing={...f.intent,sourceId:"absent"};expect(await f.service.text(f.readRequest(),f.selection,missing)).toEqual({ok:false,error:"source-not-found"});
 await f.assign();const {sourceCatalogHash,...rest}=missing;expect(await f.service.text(f.readRequest(),f.selection,{...rest,sourceScope:"assigned",expectedSetVersion:1})).toEqual({ok:false,error:"source-not-found"});
 const dispatch=createHttpDispatcher(async action=>action({...f.runtime,sourceContent:f.service})),path=`/api/students/${f.selection.studentId}/source-text`,query=new URLSearchParams(Object.entries({...f.selection,...missing}).filter(([k])=>k!=="studentId").map(([k,v])=>[k,String(v)]));
 const local=await dispatch(f.request(`${path}?${query}`,{who:"admin"}));expect(local.status).toBe(404);expect(await local.json()).toEqual({ok:false,error:"source-not-found"});
 const stale=f.build({related:vi.fn(async()=>{await f.owner(()=>f.db.update(s.student).set({revision:sql`${s.student.revision}+1`}).where(eq(s.student.id,f.selection.studentId)));return await f.loaders.related();})});expect(await stale.text(f.readRequest(),f.selection,missing)).toEqual({ok:false,error:"stale-revision"});
 const deny=f.build({related:vi.fn(async()=>{await f.owner(()=>f.db.update(s.session).set({expiresAt:new Date(0)}).where(eq(s.session.id,f.identities.admin.sessionId)));return await f.loaders.related();})});await expect(deny.text(f.readRequest(),f.selection,missing)).rejects.toMatchObject({status:401});
});
