import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { parseRelatedMetadata, type RelatedSourceCatalog } from "../../src/server/study/sources/metadata";
import { createSefariaMetadataReader } from "../../src/server/study/sources/sefaria-metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0))await f.client.close();});
async function fixture() {
  const f=await portalRoutesFixture();fixtures.push(f);
  const assignment=await f.owner(async()=>{const [a]=await f.db.insert(s.assignment).values({tenantId:"crc",studentId:f.students[0].id,kind:"torah",basis:"custom",ref:"Genesis 1:1-2",status:"confirmed",setByMembershipId:f.adminMember.id}).returning();await f.db.insert(s.assignmentVerse).values([1,2].map(n=>({tenantId:"crc",studentId:f.students[0].id,assignmentId:a.id,ordinal:n,verseRef:`Genesis 1:${n}`})));return a;});
  const raw=Array.from({length:40},(_,i)=>({_id:`source_${String(i).padStart(2,"0")}`,sourceRef:`Invented Work ${i}`,index_title:"Invented Work",category:"Commentary",anchorRef:"Genesis 1:1"}));
  const fetch=vi.fn(async()=>new Response(JSON.stringify(raw),{headers:{"content-type":"application/json"}})),reader=createSefariaMetadataReader({fetch:fetch as typeof globalThis.fetch});
  const catalog=parseRelatedMetadata(raw,"Genesis 1:1"),hash=projectRelatedCatalog(catalog,"Genesis 1:1").catalogHash;
  const selection={mode:"admin" as const,studentId:f.students[0].id,kind:"torah" as const,assignmentId:assignment.id,assignmentRevision:1};
  const build=(related=reader.related)=>createSourceAssignmentsService({access:f.service,practice:f.runtime.practice,related});const service=build();
  const dispatch=createHttpDispatcher(async action=>action({...f.runtime,sourceAssignments:service}));const writeRequest=()=>f.request("/api/source",{who:"admin",method:"POST"});
  const write=(sourceIds=["source_00"],expectedVersion=0)=>({verseRef:"Genesis 1:1",expectedVersion,mutationId:randomUUID(),sourceIds,catalogHash:hash});
  const path=`/api/students/${selection.studentId}/source-assignments`,body=(intent:ReturnType<typeof write>)=>({mode:selection.mode,kind:selection.kind,assignmentId:selection.assignmentId,assignmentRevision:selection.assignmentRevision,...intent});
  return {...f,assignment,selection,fetch,catalog,hash,build,service,dispatch,writeRequest,write,path,body};
}
test("actual SDK staff writes full sets, resolves off-page IDs, replays original snapshot and removes offline",async()=>{
 const f=await fixture(),w=f.write(["source_31","source_00"]);const first=await f.service.replace(f.writeRequest(),f.selection,w);expect(first).toMatchObject({ok:true,replayed:false,committedVersion:1,currentLatestVersion:1,committed:{citations:[{id:"source_00"},{id:"source_31"}]}});expect(f.fetch).toHaveBeenCalledTimes(1);
 const second=await f.service.replace(f.writeRequest(),f.selection,f.write(["source_31"],1));expect(second).toMatchObject({ok:true,committedVersion:2});expect(f.fetch).toHaveBeenCalledTimes(1);
 expect(await f.service.replace(f.writeRequest(),f.selection,w)).toMatchObject({ok:true,replayed:true,committedVersion:1,currentLatestVersion:2,committed:{citations:[{id:"source_00"},{id:"source_31"}]}});
 expect(await f.service.receipt(f.writeRequest(),f.selection,w)).toMatchObject({ok:true,outcome:"committed",committedVersion:1,currentLatestVersion:2});
 expect(await f.service.replace(f.writeRequest(),f.selection,f.write(["source_31"],2))).toEqual({ok:false,code:"no-change"});
 expect(await f.service.replace(f.writeRequest(),f.selection,f.write([],2))).toMatchObject({ok:true,committedVersion:3,committed:{citations:[]}});expect(f.fetch).toHaveBeenCalledTimes(1);
 expect(await f.service.read(f.writeRequest(),f.selection,"Genesis 1:1")).toMatchObject({ok:true,currentVersion:3,citations:[]});
 expect(await f.owner(()=>f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action,"source-assignment.set")))).toHaveLength(3);
});
test("new reading revision has version0 and no old receipt/history reactivation",async()=>{
 const f=await fixture(),w=f.write();await f.service.replace(f.writeRequest(),f.selection,w);
 await f.owner(async()=>{await f.db.update(s.assignment).set({revision:2}).where(eq(s.assignment.id,f.assignment.id));});
 expect(await f.service.receipt(f.writeRequest(),f.selection,w)).toEqual({ok:false,code:"stale-revision"});
 expect(await f.service.read(f.writeRequest(),{...f.selection,assignmentRevision:2},"Genesis 1:1")).toMatchObject({ok:true,currentVersion:0,citations:[]});
 expect(await f.service.receipt(f.writeRequest(),{...f.selection,assignmentRevision:2},w)).toEqual({ok:false,code:"conflict"});
});
test("committed receipt compatibility permits incidental revisions but never changed intent or staff mode",async()=>{
 const f=await fixture(),w=f.write();await f.service.replace(f.writeRequest(),f.selection,w);
 await f.owner(async()=>{await f.db.update(s.student).set({revision:sql`${s.student.revision}+1`}).where(eq(s.student.id,f.selection.studentId));await f.db.update(s.roleGrant).set({revision:sql`${s.roleGrant.revision}+1`}).where(eq(s.roleGrant.id,f.adminGrant.id));});
 expect(await f.service.replace(f.writeRequest(),f.selection,w)).toMatchObject({ok:true,replayed:true,committedVersion:1});
 expect(await f.service.replace(f.writeRequest(),f.selection,{...w,sourceIds:["source_01"]})).toEqual({ok:false,code:"conflict"});
 expect(await f.service.receipt(f.writeRequest(),f.selection,f.write())).toMatchObject({ok:true,outcome:"unconfirmed"});
});
test("original phase bindings and source errors are subordinate to final authority and revision checks",async()=>{
 const f=await fixture();const changed=f.build(async()=>{await f.owner(async()=>{await f.db.update(s.student).set({revision:sql`${s.student.revision}+1`}).where(eq(s.student.id,f.selection.studentId));});throw new Error("PRIVATE_SOURCE_CAUSE");});
 expect(await changed.replace(f.writeRequest(),f.selection,f.write())).toEqual({ok:false,code:"stale-revision"});
 const expired=f.build(async()=>{await f.owner(async()=>{await f.db.update(s.session).set({expiresAt:new Date(0)}).where(eq(s.session.id,f.identities.admin.sessionId));});throw new Error("PRIVATE_SOURCE_CAUSE");});
 await expect(expired.replace(f.writeRequest(),f.selection,f.write())).rejects.toMatchObject({status:401});
 expect(await f.owner(()=>f.db.select().from(s.verseSourceAssignment))).toHaveLength(0);
});
test("missing added proof/candidates and changed catalog are closed without adopting snapshots",async()=>{
 const f=await fixture(),w=f.write(),{catalogHash,...withoutHash}=w;expect(await f.service.replace(f.writeRequest(),f.selection,withoutHash)).toEqual({ok:false,code:"invalid-request"});expect(f.fetch).not.toHaveBeenCalled();
 expect(await f.service.replace(f.writeRequest(),f.selection,{...w,catalogHash:"0".repeat(64)})).toEqual({ok:false,code:"source-catalog-changed"});
 expect(await f.service.replace(f.writeRequest(),f.selection,{...w,sourceIds:["not_in_catalog"]})).toEqual({ok:false,code:"invalid-request"});
 await expect(f.build(async()=>{throw new Error("PRIVATE");}).replace(f.writeRequest(),f.selection,w)).rejects.toBeDefined();
 expect(await f.owner(()=>f.db.select().from(s.verseSourceAssignment))).toHaveLength(0);
});
test("late retry confirms exact committed receipt before mapping its failed lookup",async()=>{
 const f=await fixture(),w=f.write();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const retry=f.build(async()=>{entered();await gate;throw new Error("PRIVATE");}),pending=retry.replace(f.writeRequest(),f.selection,w);await started;
 await f.service.replace(f.writeRequest(),f.selection,w);release();expect(await pending).toMatchObject({ok:true,replayed:true,committedVersion:1,currentLatestVersion:1});
 expect(await f.owner(()=>f.db.select().from(s.verseSourceAssignment))).toHaveLength(1);
});
test("HTTP closed methods/body/envelope and literal capability deny without source I/O",async()=>{
 const f=await fixture();for(const method of ["HEAD","PUT","DELETE","OPTIONS"])expect((await f.dispatch(f.request(f.path,{method,who:"admin"}))).status).toBe(405);
 for(const who of ["multi","learner"] as const){const mode=who==="learner"?"student":"parent";expect((await f.dispatch(f.request(f.path,{who,body:{...f.body(f.write()),mode}}))).status).toBe(403);}
 for(const extra of [{ref:"unused"},{citations:[]},{studentId:f.selection.studentId}])expect((await f.dispatch(f.request(f.path,{who:"admin",body:{...f.body(f.write()),...extra}}))).status).toBe(400);
 expect(f.fetch).not.toHaveBeenCalled();const r=await f.dispatch(f.request(f.path,{who:"admin",body:f.body(f.write())}));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("private, no-store");expect(Buffer.byteLength(await r.text())).toBeLessThan(131072);
 const query=new URLSearchParams({mode:"student",kind:"torah",assignmentId:f.assignment.id,assignmentRevision:"1",verseRef:"Genesis 1:1"});expect((await f.dispatch(f.request(`${f.path}?${query}`,{who:"learner"}))).status).toBe(200);
});
test("audit failure rolls back full snapshot and receipt and abort never schedules an insert",async()=>{
 const f=await fixture();await f.owner(()=>f.client.exec("create function synthetic_source_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action='source-assignment.set' then raise exception 'Synthetic failure'; end if; return NEW; end $$; create trigger synthetic_source_audit_failure before insert on audit_event for each row execute function synthetic_source_audit_failure()"));
 await expect(f.service.replace(f.writeRequest(),f.selection,f.write())).rejects.toBeDefined();expect(await f.owner(()=>f.db.select().from(s.verseSourceAssignment))).toHaveLength(0);
 const controller=new AbortController(),service=f.build(async ref=>{controller.abort();return parseRelatedMetadata([],ref);}),request=f.writeRequest();await expect(service.replace({url:request.url,headers:request.headers,method:"POST",signal:controller.signal},f.selection,f.write())).rejects.toBeDefined();expect(await f.owner(()=>f.db.select().from(s.verseSourceAssignment))).toHaveLength(0);
});
