import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq } from "drizzle-orm";
import { invitesFixture } from "./invites-fixture";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";

const opened:Awaited<ReturnType<typeof invitesFixture>>[]=[];
async function fixture(){const f=await invitesFixture();opened.push(f);await f.owner(async()=>{await f.db.update(s.student).set({studentKind:"adult",parentEmail:null,ownEmail:"student-new@example.test"}).where(eq(s.student.id,f.students[2].id));});return f;}
afterEach(async()=>{vi.useRealTimers();await Promise.all(opened.splice(0).map(f=>f.client.close()));});
const selection=(studentId:string)=>({mode:"admin" as const,role:"student" as const,studentId,email:"student-new@example.test"});
async function denied(action:()=>Promise<unknown>,status?:number){try{await action();return false;}catch(error){return error instanceof AccessDenied && (status===undefined || error.status===status);}}

test("null adult parent contact works across issue, reissue, preview and explicit verified acceptance without weakening parent exclusion",async()=>{
  const f=await fixture(),input=selection(f.students[2].id);
  expect(await denied(()=>f.invitations.issue(f.request("admin"),{...input,email:"multi@example.test"}),403)).toBe(true);
  const first=await f.invitations.issue(f.request("admin"),input),old=f.token();
  await f.invitations.reissue(f.request("admin"),{mode:"admin",inviteId:first.inviteId}); const token=f.token();
  expect(await denied(()=>f.invitations.preview(f.request("newStudent"),{token:old}))).toBe(true);
  expect(await denied(()=>f.invitations.preview(f.request("recipient"),{token}))).toBe(true);
  expect(await denied(()=>f.invitations.preview(f.request("newStudent","http://localhost:3101"),{token}))).toBe(true);
  const review=await f.invitations.preview(f.request("newStudent"),{token});
  const accepted=await f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding});
  expect(accepted.studentId).toBe(input.studentId);
  expect((await f.service.readStudent(f.request("newStudent"),{mode:"student",studentId:input.studentId})).id).toBe(input.studentId);
  expect(await denied(()=>f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding}))).toBe(true);
});

test("pending adult reviews reread locked contact after null-to-present and adult-to-child edits",async()=>{
  const f=await fixture(),input=selection(f.students[2].id),issued=await f.invitations.issue(f.request("admin"),input),token=f.token();
  const review=await f.invitations.preview(f.request("newStudent"),{token});
  await f.owner(async()=>{await f.db.update(s.student).set({studentKind:"child",parentEmail:input.email,ownEmail:null,revision:2}).where(eq(s.student.id,input.studentId));});
  expect(await denied(()=>f.invitations.reissue(f.request("admin"),{mode:"admin",inviteId:issued.inviteId}),403)).toBe(true);
  expect(await denied(()=>f.invitations.preview(f.request("newStudent"),{token}),404)).toBe(true);
  expect(await denied(()=>f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding}),404)).toBe(true);
  await f.owner(async()=>{expect((await f.db.select().from(s.membership).where(eq(s.membership.userId,f.identities.newStudent.id))).length).toBe(0);});
});

test("malformed nonnull parent contacts fail closed in all four paths instead of acting as absent contacts",async()=>{
  const f=await fixture(),input=selection(f.students[2].id),issued=await f.invitations.issue(f.request("admin"),input),token=f.token();
  const review=await f.invitations.preview(f.request("newStudent"),{token});
  await f.owner(async()=>{await f.db.update(s.student).set({parentEmail:"malformed-contact"}).where(eq(s.student.id,input.studentId));});
  for(const action of [()=>f.invitations.issue(f.request("admin"),input),()=>f.invitations.reissue(f.request("admin"),{mode:"admin",inviteId:issued.inviteId}),()=>f.invitations.preview(f.request("newStudent"),{token}),()=>f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding})])expect(await denied(action)).toBe(true);
});

test("null contact cannot bypass revoked identity-link history",async()=>{
  const f=await fixture(),input=selection(f.students[2].id);
  await f.invitations.issue(f.request("admin"),input); let token=f.token();
  let review=await f.invitations.preview(f.request("newStudent"),{token});
  await f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding});
  await f.invitations.issue(f.request("admin"),input); token=f.token();
  review=await f.invitations.preview(f.request("newStudent"),{token});
  await f.owner(async()=>{await f.db.update(s.studentIdentity).set({revokedAt:new Date(Date.now()+1000)}).where(eq(s.studentIdentity.studentId,input.studentId));});
  expect(await denied(()=>f.invitations.preview(f.request("newStudent"),{token}),404)).toBe(true);
  expect(await denied(()=>f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding}),404)).toBe(true);
});

test("null contact cannot bypass parent grants acquired after a pending student invitation was reviewed",async()=>{
  const f=await fixture(),input=selection(f.students[2].id),issued=await f.invitations.issue(f.request("admin"),input),token=f.token();
  const review=await f.invitations.preview(f.request("newStudent"),{token});
  await f.owner(async()=>{const [membership]=await f.db.insert(s.membership).values({tenantId:"crc",userId:f.identities.newStudent.id}).returning();await f.db.insert(s.roleGrant).values({tenantId:"crc",membershipId:membership.id,role:"parent"});});
  expect(await denied(()=>f.invitations.reissue(f.request("admin"),{mode:"admin",inviteId:issued.inviteId}),403)).toBe(true);
  expect(await denied(()=>f.invitations.preview(f.request("newStudent"),{token}),404)).toBe(true);
  expect(await denied(()=>f.invitations.acceptReviewed(f.request("newStudent"),{token,reviewBinding:review.reviewBinding}),404)).toBe(true);
});
