import { afterEach,expect,test,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { randomBytes } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createStudentService } from "../../src/server/students/service";
import { parseStudentCsv } from "../../src/server/students/validation";
import { AccessDenied,AccessUnavailable } from "../../src/server/access/errors";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { ReadingUnavailable,type Snapshot } from "../../src/lib/readings/proposals";
import * as s from "../../src/server/db/index";

const open:Awaited<ReturnType<typeof accessFixture>>[]=[];
afterEach(async()=>{await Promise.all(open.splice(0).map(f=>f.client.close()));});
const student={firstName:"Synthetic",lastName:"New learner",ceremonyDate:"2027-01-02",parentEmail:"contact@example.test"};
async function fixture(){
  const f=await accessFixture();open.push(f);let time=Date.now();
  const loadReading=vi.fn(async(date:string,calendar:"diaspora"|"israel")=>({fetchedAt:time,snapshot:{date:parseCeremonyDate(date),calendar,
    reading:{parashah:"Synthetic",type:"shabbat",summary:"",source:"Hebcal",aliyot:[{n:1,ref:"Genesis 1:1-3"},{n:"M",ref:"Numbers 1:1-2",reason:"Synthetic special maftir"}],
      triennial:{year:2,aliyot:[{n:1,ref:"Genesis 1:1-3"}]}},haftarah:"Isaiah 1:1-3"} satisfies Snapshot}));
  const service=createStudentService({access:f.service,signingSecret:randomBytes(48).toString("base64url"),loadReading,now:()=>time});
  const request=(who:"admin"|"multi"|"learner"="admin",method="POST",origin="http://localhost:3000")=>({...f.request(who,"http://localhost:3000",{origin}),method});
  return {...f,studentsService:service,loadReading,mutation:request,advance:()=>{time+=6*60000;}};
}
async function denied(action:()=>Promise<unknown>,status=403){try{await action();return false;}catch(error){return error instanceof AccessDenied && error.status===status;}}
async function databaseCode(action:()=>PromiseLike<unknown>,code:string){try{await action();return false;}catch(error){const e=error as {code?:string;cause?:{code?:string}};return (e.cause?.code??e.code)===code;}}
const csv=(last="Imported")=>`firstName,lastName,ceremonyDate,parentEmail,ownEmail\nSynthetic,${last},2027-01-02,shared@example.test,`;

test("admin roster creation treats parent contact only as contact, refuses role/origin escalation and stale edits",async()=>{
  const f=await fixture();
  for(const [who,mode] of [["multi","tutor"],["multi","parent"],["learner","student"]] as const){
    expect(await denied(()=>f.studentsService.create(f.mutation(who),{mode,student}))).toBe(true);
  }
  expect(await denied(()=>f.studentsService.create(f.mutation("admin","GET"),{mode:"admin",student}))).toBe(true);
  expect(await denied(()=>f.studentsService.create(f.mutation("admin","POST","https://forged.example.test"),{mode:"admin",student}))).toBe(true);
  for(const invalid of [{...student,parentEmail:""},{...student,ceremonyDate:"2027-02-29"},{...student,ownEmail:student.parentEmail}])expect(await denied(()=>f.studentsService.create(f.mutation(),{mode:"admin",student:invalid}))).toBe(true);
  const created=await f.studentsService.create(f.mutation(),{mode:"admin",student:{...student,tenantId:"other",role:"admin"}});
  const rows=await f.studentsService.listRoster(f.mutation(),{mode:"admin"});
  expect(rows.some(row=>row.id===created.id)).toBe(true);
  await f.owner(async()=>{
    const [row]=await f.db.select().from(s.student).where(eq(s.student.id,created.id));expect(row.tenantId==="crc").toBe(true);
    expect((await f.db.select().from(s.guardian).where(eq(s.guardian.studentId,created.id))).length).toBe(0);
    expect((await f.db.select().from(s.studentIdentity).where(eq(s.studentIdentity.studentId,created.id))).length).toBe(0);
    expect((await f.db.select().from(s.invite)).length).toBe(0);
  });
  expect(f.loadReading).not.toHaveBeenCalled();
  expect(await denied(()=>f.studentsService.edit(f.mutation(),{mode:"admin",studentId:f.students[3].id,expectedRevision:1,student}),404)).toBe(true);
  const changed=await f.studentsService.edit(f.mutation(),{mode:"admin",studentId:created.id,expectedRevision:1,student:{...student,lastName:"Changed"}});
  expect(changed.ok).toBe(true);
  expect(await f.studentsService.edit(f.mutation(),{mode:"admin",studentId:created.id,expectedRevision:1,student})).toEqual({ok:false,code:"stale-revision"});
  expect(await denied(()=>f.studentsService.disable(f.mutation("multi"),{mode:"tutor",studentId:created.id,expectedRevision:2}))).toBe(true);
  expect((await f.studentsService.disable(f.mutation(),{mode:"admin",studentId:created.id,expectedRevision:2})).ok).toBe(true);
  expect((await f.studentsService.disable(f.mutation(),{mode:"admin",studentId:f.students[0].id,expectedRevision:1})).ok).toBe(true);
  expect(await denied(()=>f.service.readStudent(f.mutation("multi"),{mode:"tutor",studentId:f.students[0].id}),404)).toBe(true);
});

test("adult create and kind edits remain tenant-scoped CAS contact changes with no implicit account or guardian changes",async()=>{
  const f=await fixture();
  const adult={...student,studentKind:"adult",parentEmail:null,ownEmail:"learner@example.test"};
  for(const [who,mode] of [["multi","tutor"],["multi","parent"],["learner","student"]] as const)expect(await denied(()=>f.studentsService.create(f.mutation(who),{mode,student:adult}))).toBe(true);
  const created=await f.studentsService.create(f.mutation(),{mode:"admin",student:adult});
  const roster=await f.studentsService.listRoster(f.mutation(),{mode:"admin"});
  expect(roster.find(row=>row.id===created.id)).toMatchObject({studentKind:"adult",parentEmail:null,ownEmail:"learner@example.test"});
  expect(await denied(()=>f.service.readStudent(f.mutation("learner"),{mode:"student",studentId:created.id}),404)).toBe(true);
  const authority=()=>f.owner(async()=>({guardians:await f.db.select().from(s.guardian),identities:await f.db.select().from(s.studentIdentity),grants:await f.db.select().from(s.roleGrant),invites:await f.db.select().from(s.invite)}));
  const before=await authority();
  expect((await f.studentsService.edit(f.mutation(),{mode:"admin",studentId:f.students[0].id,expectedRevision:1,student:adult})).ok).toBe(true);
  expect(await authority()).toEqual(before);
  expect(await f.studentsService.edit(f.mutation(),{mode:"admin",studentId:f.students[0].id,expectedRevision:1,student})).toEqual({ok:false,code:"stale-revision"});
  expect(await denied(()=>f.studentsService.edit(f.mutation(),{mode:"admin",studentId:f.students[3].id,expectedRevision:1,student:adult}),404)).toBe(true);
  for(const [who,mode] of [["multi","parent"],["multi","tutor"],["learner","student"]] as const){
    const view=await f.service.readStudent(f.mutation(who),{mode,studentId:f.students[0].id});
    expect(Object.keys(view).sort()).toEqual(["ceremonyDate","firstName","id","lastName","revision"]);
  }
  expect((await f.studentsService.edit(f.mutation(),{mode:"admin",studentId:f.students[0].id,expectedRevision:2,student})).ok).toBe(true);
  expect(await authority()).toEqual(before);
  expect(f.loadReading).not.toHaveBeenCalled();
});

test("extended adult CSV confirms exact nullable contacts without inviting or inferring account authority",async()=>{
  const f=await fixture(),csv="studentKind,firstName,lastName,ceremonyDate,parentEmail,ownEmail\nadult,Synthetic,Adult,2027-01-02,,learner@example.test";
  const preview=await f.studentsService.previewImport(f.mutation(),{mode:"admin",csv,allowDuplicates:false});
  expect(preview.canConfirm).toBe(true);
  expect(await denied(()=>f.studentsService.confirmImport(f.mutation(),{mode:"admin",csv:csv.replace("adult,Synthetic","child,Synthetic"),allowDuplicates:false,binding:preview.binding!}))).toBe(true);
  const result=await f.studentsService.confirmImport(f.mutation(),{mode:"admin",csv,allowDuplicates:false,binding:preview.binding!});
  if(!result.ok)throw new Error("Synthetic adult import failed");
  expect((await f.studentsService.listRoster(f.mutation(),{mode:"admin"})).find(row=>row.id===result.ids[0])).toMatchObject({studentKind:"adult",parentEmail:null,ownEmail:"learner@example.test"});
  expect(await denied(()=>f.service.readStudent(f.mutation("learner"),{mode:"student",studentId:result.ids[0]}),404)).toBe(true);
  expect((await f.studentsService.previewImport(f.mutation(),{mode:"admin",csv,allowDuplicates:false})).duplicateRows).toEqual([2]);
});

test("signed preparation is separate from confirmation; assigned tutor persists exact cross-chapter verses and maftir",async()=>{
  const f=await fixture(),id=f.students[0].id;
  expect(await denied(()=>f.studentsService.prepareReading(f.mutation("multi"),{mode:"parent",studentId:id}))).toBe(true);
  expect(await denied(()=>f.studentsService.prepareReading(f.mutation("multi"),{mode:"tutor",studentId:f.students[1].id}),404)).toBe(true);
  expect(f.loadReading).not.toHaveBeenCalled();
  const prepared=await f.studentsService.prepareReading(f.mutation("multi"),{mode:"tutor",studentId:id,ranges:["Genesis 1:31-2:2"]});
  expect(prepared.status==="prepared" && prepared.requiresConfirmation && prepared.verseCount===3).toBe(true);
  if(prepared.status!=="prepared")throw new Error("Expected synthetic prepared reading");
  await f.owner(async()=>{expect((await f.db.select().from(s.assignment)).length).toBe(0);});
  expect(await denied(()=>f.studentsService.confirmReading(f.mutation("multi"),{mode:"tutor",studentId:id,binding:prepared.binding.slice(0,-1)+"z"}))).toBe(true);
  expect(await denied(()=>f.studentsService.confirmReading(f.mutation(),{mode:"admin",studentId:id,binding:prepared.binding}))).toBe(true);
  const confirmed=await f.studentsService.confirmReading(f.mutation("multi"),{mode:"tutor",studentId:id,binding:prepared.binding});expect(confirmed.ok).toBe(true);
  expect(await f.studentsService.confirmReading(f.mutation("multi"),{mode:"tutor",studentId:id,binding:prepared.binding})).toEqual({ok:false,code:"stale-revision"});
  await f.owner(async()=>{
    const [assignment]=await f.db.select().from(s.assignment).where(eq(s.assignment.studentId,id));
    const verses=await f.db.select().from(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId,assignment.id)).orderBy(s.assignmentVerse.ordinal);
    expect(verses.map(row=>row.verseRef)).toEqual(["Genesis 1:31","Genesis 2:1","Genesis 2:2"]);
    expect(assignment.basis==="custom" && assignment.proposalSnapshot?.maftir!==null).toBe(true);
    expect(await databaseCode(()=>f.db.insert(s.assignment).values({tenantId:"crc",studentId:id,kind:"torah",basis:"custom",ref:"Genesis 1:1",setByMembershipId:f.adminMember.id}),"23505")).toBe(true);
  });
  const haft=await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,kind:"haftarah"});
  if(haft.status!=="prepared")throw new Error("Expected synthetic haftarah");
  expect((await f.studentsService.confirmReading(f.mutation(),{mode:"admin",studentId:id,binding:haft.binding})).ok).toBe(true);
  const full=await f.studentsService.prepareReading(f.mutation("multi"),{mode:"tutor",studentId:id,pick:" FULL "});
  if(full.status!=="prepared")throw new Error("Expected full preparation");
  expect(full.basis).toBe("full");expect(Number.isFinite(full.sourceFetchedAt)).toBe(true);
  expect((await f.studentsService.confirmReading(f.mutation("multi"),{mode:"tutor",studentId:id,binding:full.binding})).ok).toBe(true);
  await f.owner(async()=>{const [row]=await f.db.select().from(s.assignment).where(eq(s.assignment.kind,"torah"));expect(row.basis==="full" && row.proposalSnapshot?.sourceFetchedAt===full.sourceFetchedAt).toBe(true);});
  const aliyah=await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:" Aliyah:1 "});expect(aliyah.status==="prepared" && aliyah.basis==="selection").toBe(true);
});

test("date edits retain confirmed verses and original confirmation while marking review and rejecting stale preparations",async()=>{
  const f=await fixture(),id=f.students[0].id;
  expect((await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id})).status).toBe("needs-selection");
  const prepared=await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:"triennial"});
  if(prepared.status!=="prepared")throw new Error("Expected synthetic preparation");
  expect((await f.studentsService.confirmReading(f.mutation(),{mode:"admin",studentId:id,binding:prepared.binding})).ok).toBe(true);
  const oldPreparation=await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:"triennial"});
  if(oldPreparation.status!=="prepared")throw new Error("Expected synthetic preparation");
  const edited=await f.studentsService.edit(f.mutation(),{mode:"admin",studentId:id,expectedRevision:1,student:{...student,ceremonyDate:"2027-01-09"}});
  expect(edited.ok && edited.readingNeedsReview).toBe(true);
  expect(await f.studentsService.confirmReading(f.mutation(),{mode:"admin",studentId:id,binding:oldPreparation.binding})).toEqual({ok:false,code:"stale-revision"});
  await f.owner(async()=>{
    const [assignment]=await f.db.select().from(s.assignment).where(eq(s.assignment.studentId,id));
    expect(assignment.status==="confirmed" && assignment.ref==="Genesis 1:1-3").toBe(true);
    expect(assignment.proposalSnapshot?.confirmationDate==="2027-01-02" && assignment.proposalSnapshot?.needsReview===true).toBe(true);
    expect((await f.db.select().from(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId,assignment.id))).length).toBe(3);
  });
  const newer=await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:"triennial"});if(newer.status!=="prepared")throw new Error("Expected preparation");
  f.advance();expect(await denied(()=>f.studentsService.confirmReading(f.mutation(),{mode:"admin",studentId:id,binding:newer.binding}))).toBe(true);
});

test("range/customs failures cannot write and audit failure rolls back roster mutation",async()=>{
  const f=await fixture(),id=f.students[0].id;
  for(const ranges of [["Genesis 1:99"],["Genesis 1:1","Genesis 1:1"],["Genesis 2:1","Genesis 1:1"],Array(33).fill("Genesis 1:1"),["Genesis 1:1-50:26"]])expect(await denied(()=>f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,ranges}))).toBe(true);
  await f.owner(async()=>{await f.db.update(s.tenant).set({customs:{calendar:"unreviewed"}}).where(eq(s.tenant.id,"crc"));});
  expect(await denied(()=>f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id}))).toBe(true);
  await f.owner(async()=>{await f.client.exec("CREATE FUNCTION reject_roster_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic rollback'; END $$; CREATE TRIGGER reject_roster_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_roster_audit();");});
  let unavailable=false;try{await f.studentsService.create(f.mutation(),{mode:"admin",student});}catch(error){unavailable=error instanceof AccessUnavailable;}
  expect(unavailable).toBe(true);
  await f.owner(async()=>{expect((await f.db.select().from(s.student)).length).toBe(4);});
});

test("preparation revalidates provider metadata before signing and never retains arbitrary summaries",async()=>{
  const f=await fixture(),id=f.students[0].id;
  const original=await f.loadReading("2027-01-02","diaspora");
  f.loadReading.mockResolvedValueOnce({...original,snapshot:{...original.snapshot,date:parseCeremonyDate("2027-01-09")}});
  expect(await denied(()=>f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:"triennial"}))).toBe(true);
  f.loadReading.mockResolvedValueOnce({...original,snapshot:{...original.snapshot,reading:{...original.snapshot.reading!,aliyot:[{n:1,ref:"Genesis 1:99"}]}}});
  expect(await denied(()=>f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:"triennial"}))).toBe(true);
  f.loadReading.mockResolvedValueOnce({...original,snapshot:{...original.snapshot,reading:{...original.snapshot.reading!,summary:"Synthetic unapproved body"}}});
  const prepared=await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:"triennial"});
  if(prepared.status!=="prepared")throw new Error("Expected preparation");
  expect((await f.studentsService.confirmReading(f.mutation(),{mode:"admin",studentId:id,binding:prepared.binding})).ok).toBe(true);
  await f.owner(async()=>{const [row]=await f.db.select().from(s.assignment);expect(JSON.stringify(row.proposalSnapshot).includes("Synthetic unapproved body")).toBe(false);});
});

test("manual ranges can be confirmed with truthful unavailable provenance; automatic and opaque failures never guess",async()=>{
  const f=await fixture(),id=f.students[0].id;
  f.loadReading.mockRejectedValue(new ReadingUnavailable("invalid-response"));
  const manual=await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,ranges:["Genesis 1:1-3"]});
  expect(manual.status==="prepared" && manual.sourceStatus==="unavailable" && manual.sourceFetchedAt===null && manual.warning==="calendar-source-unavailable" && manual.maftir===null && manual.requiresConfirmation).toBe(true);
  if(manual.status!=="prepared")throw new Error("Expected explicit manual preparation");
  expect((await f.studentsService.confirmReading(f.mutation(),{mode:"admin",studentId:id,binding:manual.binding})).ok).toBe(true);
  await f.owner(async()=>{const [row]=await f.db.select().from(s.assignment);expect(row.proposalSnapshot?.sourceStatus==="unavailable" && row.proposalSnapshot?.sourceFetchedAt===null).toBe(true);expect((row.proposalSnapshot?.source as Snapshot).reading).toBeNull();});
  await expect(f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,pick:"triennial"})).rejects.toBeInstanceOf(ReadingUnavailable);
  f.loadReading.mockRejectedValue(new Error("Synthetic opaque provider diagnostic"));
  let sanitized=false;
  try{await f.studentsService.prepareReading(f.mutation(),{mode:"admin",studentId:id,ranges:["Genesis 1:1-3"]});}
  catch(error){sanitized=error instanceof AccessUnavailable && error.message==="Access service unavailable" && !("cause" in error);}
  expect(sanitized).toBe(true);
});

test("CSV preview is admin-only and binds input, duplicate decision, actor and current roster against alteration/replay",async()=>{
  const f=await fixture();
  expect(await denied(()=>f.studentsService.previewImport(f.mutation("multi"),{mode:"tutor",csv:csv(),allowDuplicates:false}))).toBe(true);
  const preview=await f.studentsService.previewImport(f.mutation(),{mode:"admin",csv:csv(),allowDuplicates:false});
  expect(preview.canConfirm && preview.validRows===1).toBe(true);if(!preview.binding)throw new Error("Expected synthetic import binding");
  const anotherSession=await f.signIn("admin@example.test");
  const otherRequest={...f.mutation(),headers:new Headers({origin:"http://localhost:3000",cookie:anotherSession.cookie})};
  expect(await denied(()=>f.studentsService.confirmImport(otherRequest,{mode:"admin",csv:csv(),allowDuplicates:false,binding:preview.binding!}))).toBe(true);
  expect(await denied(()=>f.studentsService.confirmImport(f.mutation(),{mode:"admin",csv:csv("Altered"),allowDuplicates:false,binding:preview.binding!}))).toBe(true);
  expect(await denied(()=>f.studentsService.confirmImport(f.mutation(),{mode:"admin",csv:csv(),allowDuplicates:true,binding:preview.binding!}))).toBe(true);
  expect((await f.studentsService.confirmImport(f.mutation(),{mode:"admin",csv:csv(),allowDuplicates:false,binding:preview.binding})).ok).toBe(true);
  expect(await f.studentsService.confirmImport(f.mutation(),{mode:"admin",csv:csv(),allowDuplicates:false,binding:preview.binding})).toEqual({ok:false,code:"stale-revision"});
  const duplicates=await f.studentsService.previewImport(f.mutation(),{mode:"admin",csv:csv(),allowDuplicates:false});expect(duplicates.canConfirm).toBe(false);expect(duplicates.binding).toBeNull();
  const explicit=await f.studentsService.previewImport(f.mutation(),{mode:"admin",csv:csv(),allowDuplicates:true});if(!explicit.binding)throw new Error("Expected confirmed duplicate choice");
  expect((await f.studentsService.confirmImport(f.mutation(),{mode:"admin",csv:csv(),allowDuplicates:true,binding:explicit.binding})).ok).toBe(true);
  const mixed=csv().split("\n")[0]+"\nSynthetic,Invalid,not-a-date,shared@example.test,\n"+csv().split("\n")[1]+"\n"+csv().split("\n")[1];
  const mixedPreview=await f.studentsService.previewImport(f.mutation(),{mode:"admin",csv:mixed,allowDuplicates:true});
  expect(mixedPreview.issues).toEqual([{row:2,code:"invalid-row"}]);expect(mixedPreview.duplicateRows).toEqual([3,4]);expect(mixedPreview.binding).toBeNull();
  await f.owner(async()=>{expect((await f.db.select().from(s.student)).length).toBe(6);expect((await f.db.select().from(s.invite)).length).toBe(0);});
  expect(f.loadReading).not.toHaveBeenCalled();
});

test("CSV parser handles quoted fields and enforces row/byte/date/contact bounds; numeric catalog is structurally complete",()=>{
  expect(parseStudentCsv(csv('"Imported, learner"')).rows[0].lastName).toBe("Imported, learner");
  expect(parseStudentCsv(csv().replace("2027-01-02","2027-02-29")).issues.length).toBe(1);
  for(const invalid of ["x".repeat(1024*1024+1),csv()+"\n"+Array(500).fill("Synthetic,Extra,2027-01-02,fixture@example.test,").join("\n"),csv('"unclosed')])expect(()=>parseStudentCsv(invalid)).toThrow();
  expect(Object.keys(TANAKH_VERSE_COUNTS).length).toBe(39);expect(TANAKH_VERSE_COUNTS.Genesis.length).toBe(50);expect(TANAKH_VERSE_COUNTS.Genesis[0]).toBe(31);expect(TANAKH_VERSE_COUNTS.Deuteronomy.at(-1)).toBe(12);
});
