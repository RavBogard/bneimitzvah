import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
const forbiddenMail=vi.hoisted(()=>vi.fn(()=>{throw new Error("Mail is forbidden in quiet roster import");}));
vi.mock("../../src/server/mail/transport",()=>({createMailTransport:forbiddenMail,projectMagicLink:forbiddenMail}));
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { invitesFixture } from "./invites-fixture";
import { parseStudentCsv } from "../../src/server/students/validation";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";
import { parsePreview } from "../../src/components/portal/workspace/csv-import/api";
import { parseStudents } from "../../src/components/portal/workspace/api";

const opened:{client:{close:()=>Promise<unknown>}}[]=[];
afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.client.close()));vi.clearAllMocks();});
async function fixture(){const f=await portalRoutesFixture();opened.push(f);return f;}
const legacy="firstName,lastName,ceremonyDate,parentEmail,ownEmail";
const full=legacy+",service_slot,parashah,tutor,parent1_name,household_phone,parent2_name,parent2_email,hebrew_name,notes";
const cells=(values:string[])=>values.map(value=>/[",\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value).join(",");
function values(patch:Partial<Record<string,string>>={}){
  const row={firstName:"Synthetic",lastName:"Intake",ceremonyDate:"2027-01-02",parentEmail:"parent@example.test",ownEmail:"",service_slot:"havdalah",parashah:"Synthetic display only",tutor:"Synthetic Tutor",parent1_name:"Synthetic Parent",household_phone:"555-0100",parent2_name:"Second Parent",parent2_email:"second@example.test",hebrew_name:"שֵׁם",notes:'Synthetic, quoted "note"\r\nNext line',...patch};
  return full.split(",").map(key=>row[key as keyof typeof row]);
}
const csv=(...rows:string[][])=>full+"\n"+rows.map(cells).join("\n");
async function databaseSnapshot(f:Awaited<ReturnType<typeof fixture>>){
  return f.owner(async()=>{
    const names=(await f.client.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row=>row.tablename).filter(name=>name!=="student" && name!=="audit_event");
    const result:Record<string,unknown>={};
    for(const name of names){if(!/^[a-z_]+$/.test(name))throw new Error("Unexpected synthetic table");result[name]=(await f.client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from public."${name}" t`)).rows;}
    return result;
  });
}

test("exact legacy, explicit-kind and full headers retain values while malformed input has row-only errors",()=>{
  expect(parseStudentCsv(legacy+"\nSynthetic,Legacy,2027-01-02,parent@example.test,").rows).toEqual([{firstName:"Synthetic",lastName:"Legacy",ceremonyDate:"2027-01-02",serviceSlot:"unknown",studentKind:"child",parentEmail:"parent@example.test",ownEmail:null}]);
  expect(parseStudentCsv("studentKind,"+legacy+"\nadult,Synthetic,Adult,2027-01-02,,adult@example.test").rows[0]).toMatchObject({studentKind:"adult",parentEmail:null,ownEmail:"adult@example.test"});
  const parsed=parseStudentCsv(csv(values({firstName:"  Synthetic  ",parent2_email:" Second@Example.test "})));
  expect(parsed.issues).toEqual([]);expect(parsed.rows[0]).toMatchObject({firstName:"Synthetic",serviceSlot:"havdalah",secondParentEmail:"second@example.test",hebrewName:"שֵׁם",importMetadata:{version:1,adminNotes:'Synthetic, quoted "note"\nNext line',parashahLabel:"Synthetic display only",tutorMatch:null}});
  const adult=parseStudentCsv("studentKind,"+full+"\n"+cells(["adult",...values({parentEmail:"",ownEmail:"adult@example.test",parent2_email:"",parent2_name:""})]));
  expect(adult.rows[0]).toMatchObject({studentKind:"adult",parentEmail:null,ownEmail:"adult@example.test"});
  for(const header of [legacy,"studentKind,"+legacy,full,"studentKind,"+full]){
    const labels=header.split(","),explicitKind=labels[0]==="studentKind";
    const data=labels.length<10?["Synthetic","Quoted header","2027-01-02","parent@example.test",""]:values();
    if(explicitKind)data.unshift("child");
    const quotedHeader=labels.map(label=>`"${label}"`).join(",");
    expect(parseStudentCsv(quotedHeader+"\n"+cells(data)).issues).toEqual([]);
    const mergeIndex=labels.length<10?1:labels.indexOf("parent1_name");
    const mergedLabels=[...labels];mergedLabels.splice(mergeIndex,2,labels.slice(mergeIndex,mergeIndex+2).join(","));
    const mergedData=[...data];mergedData.splice(mergeIndex,2,data.slice(mergeIndex,mergeIndex+2).join(","));
    expect(mergedLabels).toHaveLength(labels.length-1);
    expect(()=>parseStudentCsv(cells(mergedLabels)+"\n"+cells(mergedData))).toThrow(AccessDenied);
  }
  for(const invalid of [full+",extra\n"+cells(values()),full.replace("parent2_name","Parent2_Name")+"\n"+cells(values()),"firstName,firstName\nSynthetic,Synthetic",csv(values())+'\n"unterminated',"x".repeat(1024*1024+1)])expect(()=>parseStudentCsv(invalid)).toThrow(AccessDenied);
  for(const patch of [{notes:"x".repeat(4097)},{tutor:"bad\u0000name"},{hebrew_name:"bad\nname"},{parent2_email:"bad\n@example.test"},{parentEmail:""},{ownEmail:"second@example.test"},{ceremonyDate:"2027-02-29"},{service_slot:"afternoon"}]){
    const rejected=parseStudentCsv(csv(values(patch)));expect(rejected.rows).toEqual([]);expect(rejected.issues).toEqual([{row:2,code:"invalid-row"}]);
  }
  expect(parseStudentCsv(full+"\n"+cells([...values(),"extra"])).issues).toEqual([{row:2,code:"invalid-columns"}]);
});

test("actual HTTP import preserves rich pending intake and changes only student and audit rows without mail or reading work",async()=>{
  const f=await fixture();
  await f.owner(async()=>{await f.db.update(s.user).set({name:"  SYNTHETIC   Tutor  "}).where(eq(s.user.id,f.identities.multi.id));});
  const before=await databaseSnapshot(f),magicLinks=f.delivered.length,deliveries=f.deliveries.length;
  const source=csv(values(),values({lastName:"Missing second contact",tutor:"Nobody Known",parent2_email:""}));
  const previewResponse=await f.call("/api/admin/students/import/preview",{who:"admin",body:{csv:source,allowDuplicates:false}});
  expect(previewResponse.status).toBe(200);const preview=await previewResponse.json();
  expect(preview).toMatchObject({canConfirm:true,validRows:2,tutorMatches:[{row:2,status:"matched"},{row:3,status:"unmatched"}],missingSecondParentRows:[3],tutorAssignmentsPending:true});
  expect(parsePreview(preview,false)).toEqual(preview);
  expect(Object.keys(preview.tutorMatches[0]).sort()).toEqual(["row","status"]);
  expect(await databaseSnapshot(f)).toEqual(before);
  const response=await f.call("/api/admin/students/import/confirm",{who:"admin",body:{csv:source,allowDuplicates:false,binding:preview.binding}});
  expect(response.status).toBe(201);const created=await response.json();expect(created.ids).toHaveLength(2);
  expect(await databaseSnapshot(f)).toEqual(before);expect(f.deliveries).toHaveLength(deliveries);expect(f.delivered).toHaveLength(magicLinks);expect(forbiddenMail).not.toHaveBeenCalled();
  const roster=await (await f.call("/api/admin/students",{who:"admin"})).json();
  expect(parseStudents(roster,true)).toEqual(roster.students);
  const imported=roster.students.find((row:{id:string})=>row.id===created.ids[0]);
  expect(imported).toMatchObject({hebrewName:"שֵׁם",secondParentEmail:"second@example.test",serviceSlot:"havdalah",importMetadata:{parent1Name:"Synthetic Parent",householdPhone:"555-0100",parent2Name:"Second Parent",tutorMatch:{status:"matched",grantId:f.tutorGrant.id},parashahLabel:"Synthetic display only",adminNotes:'Synthetic, quoted "note"\nNext line'}});
  await f.owner(async()=>{expect(await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action,"student.import"))).toHaveLength(2);});
  const edit=await f.call(`/api/admin/students/${imported.id}/edit`,{who:"admin",body:{expectedRevision:imported.revision,student:{firstName:"Synthetic",lastName:"Ordinary edit",ceremonyDate:"2027-01-02",serviceSlot:"havdalah",parentEmail:"parent@example.test"}}});
  expect(edit.status).toBe(200);
  const retained=await (await f.call("/api/admin/students",{who:"admin"})).json();expect(retained.students.find((row:{id:string})=>row.id===imported.id)).toMatchObject({hebrewName:imported.hebrewName,secondParentEmail:imported.secondParentEmail,importMetadata:imported.importMetadata});
  await f.owner(async()=>{await f.db.update(s.student).set({importMetadata:imported.importMetadata,secondParentEmail:imported.secondParentEmail,hebrewName:imported.hebrewName}).where(eq(s.student.id,f.students[0].id));});
  for(const [who,mode] of [["multi","tutor"],["multi","parent"],["learner","student"]] as const){
    const view=await (await f.call(`/api/students/${f.students[0].id}?mode=${mode}`,{who})).json();expect(Object.keys(view.student??view).sort()).toEqual(["ceremonyDate","firstName","id","lastName","revision"]);
    expect((await f.call("/api/admin/students",{who})).status).toBe(403);
  }
});

test("only existing verified active same-tenant exact tutors match and changed matching snapshots invalidate confirmation",async()=>{
  const f=await fixture();
  await f.owner(async()=>{await f.db.update(s.user).set({name:"Synthetic Tutor"}).where(eq(s.user.id,f.identities.multi.id));});
  // Request is the real signed fixture Request with its origin/cookie retained.
  const request=f.request("/",{who:"admin",method:"POST"});
  const check=async()=>f.runtime.students.previewImport(request,{mode:"admin",csv:csv(values()),allowDuplicates:false});
  let review=await check();expect(review.tutorMatches).toEqual([{row:2,status:"matched"}]);
  await f.owner(async()=>{await f.db.update(s.roleGrant).set({revokedAt:new Date(),revision:2}).where(eq(s.roleGrant.id,f.tutorGrant.id));});
  expect(await f.runtime.students.confirmImport(request,{mode:"admin",csv:csv(values()),allowDuplicates:false,binding:review.binding!})).toEqual({ok:false,code:"stale-revision"});
  expect((await check()).tutorMatches).toEqual([{row:2,status:"unmatched"}]);
  await f.owner(async()=>{
    await f.db.update(s.user).set({name:"Synthetic Tutor"}).where(eq(s.user.id,f.identities.learner.id));
    await f.db.insert(s.roleGrant).values({tenantId:"other",membershipId:(await f.db.select().from(s.membership).where(eq(s.membership.tenantId,"other")))[0].id,role:"tutor"});
  });
  expect((await check()).tutorMatches).toEqual([{row:2,status:"unmatched"}]);
  await f.owner(async()=>{await f.db.insert(s.roleGrant).values({tenantId:"crc",membershipId:f.learnerMember.id,role:"tutor"});await f.db.update(s.user).set({emailVerified:false}).where(eq(s.user.id,f.identities.learner.id));});
  expect((await check()).tutorMatches).toEqual([{row:2,status:"unmatched"}]);
  await f.owner(async()=>{await f.db.update(s.user).set({emailVerified:true}).where(eq(s.user.id,f.identities.learner.id));});
  review=await check();expect(review.tutorMatches).toEqual([{row:2,status:"matched"}]);
  await f.owner(async()=>{await f.db.update(s.user).set({name:"Synthetic Tutor renamed"}).where(eq(s.user.id,f.identities.learner.id));});
  expect(await f.runtime.students.confirmImport(request,{mode:"admin",csv:csv(values()),allowDuplicates:false,binding:review.binding!})).toEqual({ok:false,code:"stale-revision"});
  await f.owner(async()=>{await f.db.update(s.user).set({name:"Synthetic Tutor"}).where(eq(s.user.id,f.identities.learner.id));await f.db.update(s.user).set({name:"Synthetic Tutor"}).where(eq(s.user.id,f.identities.admin.id));await f.db.insert(s.roleGrant).values({tenantId:"crc",membershipId:f.adminMember.id,role:"tutor"});});
  expect((await check()).tutorMatches).toEqual([{row:2,status:"ambiguous"}]);
  expect((await f.call("/api/admin/students/import/preview",{who:"multi",body:{csv:csv(values()),allowDuplicates:false}})).status).toBe(403);
});

test("pending second parent contact blocks student identity through issue, reissue, review and acceptance but grants no access",async()=>{
  const f=await invitesFixture();opened.push(f);const id=f.students[2].id,selection={mode:"admin" as const,role:"student" as const,studentId:id,email:"student-new@example.test"};
  await f.owner(async()=>{await f.db.update(s.student).set({secondParentEmail:selection.email}).where(eq(s.student.id,id));});
  await expect(f.invitations.issue(f.request("admin"),selection)).rejects.toMatchObject({status:403});
  await f.owner(async()=>{await f.db.update(s.student).set({secondParentEmail:null}).where(eq(s.student.id,id));});
  const issued=await f.invitations.issue(f.request("admin"),selection),token=f.token(),review=await f.invitations.preview(f.request("newStudent"),{token});
  await f.owner(async()=>{await f.db.update(s.student).set({secondParentEmail:selection.email}).where(eq(s.student.id,id));});
  await expect(f.invitations.reissue(f.request("admin"),{mode:"admin",inviteId:issued.inviteId})).rejects.toMatchObject({status:403});
  await expect(f.invitations.preview(f.request("newStudent"),{token})).rejects.toMatchObject({status:404});
  await expect(f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding})).rejects.toMatchObject({status:404});
  await f.owner(async()=>{expect(await f.db.select().from(s.guardian).where(eq(s.guardian.studentId,id))).toHaveLength(0);expect(await f.db.select().from(s.studentIdentity).where(eq(s.studentIdentity.studentId,id))).toHaveLength(0);});
  const parentInvite=await f.invitations.issue(f.request("admin"),{...selection,role:"parent"});expect(parentInvite.inviteId).toBeTruthy();const parentToken=f.token();
  const parentReview=await f.invitations.preview(f.request("newStudent"),{token:parentToken});
  await f.invitations.acceptReviewed(f.request("newStudent"),{token:parentToken,reviewBinding:parentReview.reviewBinding});
  expect((await f.service.readStudent(f.request("newStudent"),{mode:"parent",studentId:id})).id).toBe(id);
});
