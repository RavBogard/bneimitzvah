import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createPracticeService } from "../../src/server/practice/service";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
import { deferred, postgresAccessFixture } from "./access-fixture";
const fixtures: Awaited<ReturnType<typeof postgresAccessFixture>>[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0))await f.close();});
async function fixture() {
 const f=await postgresAccessFixture();fixtures.push(f);const [member]=await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId,f.admin.id));
 const [assignment]=await f.ownerDb.insert(s.assignment).values({tenantId:"crc",studentId:f.student.id,kind:"torah",basis:"custom",ref:"Genesis 1:1",status:"confirmed",setByMembershipId:member.id}).returning();
 await f.ownerDb.insert(s.assignmentVerse).values({tenantId:"crc",studentId:f.student.id,assignmentId:assignment.id,ordinal:1,verseRef:"Genesis 1:1"});
 const catalog=parseRelatedMetadata(["a","b"].map(id=>({_id:id,sourceRef:`Invented ${id}`,index_title:"Invented Work",category:"Commentary",anchorRef:"Genesis 1:1"})),"Genesis 1:1"),hash=projectRelatedCatalog(catalog,"Genesis 1:1").catalogHash;
 const build=(access:typeof f.a,related=async()=>catalog)=>createSourceAssignmentsService({access,practice:createPracticeService({access}),related});
 const a=build(f.a),b=build(f.b),selection={mode:"tutor" as const,studentId:f.student.id,kind:"torah" as const,assignmentId:assignment.id,assignmentRevision:1};
 const request=()=>{const r=f.request("tutor");r.headers.set("origin","http://localhost:3000");return {...r,method:"POST"};};
 const write=(sourceIds=["a"])=>({verseRef:"Genesis 1:1",expectedVersion:0,mutationId:randomUUID(),sourceIds,catalogHash:hash});
 return {...f,assignment,catalog,hash,build,aService:a,bService:b,selection,request,write};
}
test("native identical-intent competing full protocols commit once with one exact receipt and audit",async()=>{
 const f=await fixture(),release=deferred(),entered=deferred();let count=0;
 const related=async()=>{if(++count===2)entered.resolve();await release.promise;return f.catalog;};
 const a=f.build(f.a,related),b=f.build(f.b,related),write=f.write();
 const pending=Promise.all([a.replace(f.request(),f.selection,write),b.replace(f.request(),f.selection,write)]);
 try{await entered.promise;release.resolve();const results=await pending;expect(results.map(r=>r.ok)).toEqual([true,true]);expect(results.filter(r=>r.ok&&"replayed" in r&&r.replayed)).toHaveLength(1);
 expect(await f.ownerDb.select().from(s.verseSourceAssignment).where(eq(s.verseSourceAssignment.studentId,f.student.id))).toHaveLength(1);
 expect(await f.ownerDb.select().from(s.auditEvent).where(and(eq(s.auditEvent.actingStudentId,f.student.id),eq(s.auditEvent.action,"source-assignment.set")))).toHaveLength(1);
 }finally{release.resolve();await pending.catch(()=>{});}
});
test("native different intents at the same absent head never adopt the winner's payload",async()=>{
 const f=await fixture(),release=deferred(),entered=deferred();let count=0;const related=async()=>{if(++count===2)entered.resolve();await release.promise;return f.catalog;};
 const a=f.build(f.a,related),b=f.build(f.b,related),wa=f.write(["a"]),wb=f.write(["b"]),pending=Promise.all([a.replace(f.request(),f.selection,wa),b.replace(f.request(),f.selection,wb)]);
 try{await entered.promise;release.resolve();const results=await pending;expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toEqual([{ok:false,code:"conflict"}]);
 const receipts=await Promise.all([a.receipt(f.request(),f.selection,wa),b.receipt(f.request(),f.selection,wb)]);expect(receipts.filter(r=>r.ok&&"outcome"in r&&r.outcome==="committed")).toHaveLength(1);expect(receipts.filter(r=>r.ok&&"outcome"in r&&r.outcome==="unconfirmed")).toHaveLength(1);
 }finally{release.resolve();await pending.catch(()=>{});}
});
test("native audit rejection rolls back both full snapshot and receipt",async()=>{
 const f=await fixture();await f.ownerDb.execute((await import("drizzle-orm")).sql`create function synthetic_source_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action='source-assignment.set' then raise exception 'Synthetic failure'; end if; return NEW; end $$; create trigger synthetic_source_audit_failure before insert on audit_event for each row execute function synthetic_source_audit_failure()`);
 const write=f.write();try{await expect(f.aService.replace(f.request(),f.selection,write)).rejects.toBeDefined();expect(await f.ownerDb.select().from(s.verseSourceAssignment).where(eq(s.verseSourceAssignment.studentId,f.student.id))).toHaveLength(0);expect(await f.bService.receipt(f.request(),f.selection,write)).toMatchObject({ok:true,outcome:"unconfirmed"});}
 finally{await f.ownerDb.execute((await import("drizzle-orm")).sql`drop trigger synthetic_source_audit_failure on audit_event; drop function synthetic_source_audit_failure()`);}
});
