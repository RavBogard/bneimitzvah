import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { eq } from "drizzle-orm";
import { invitesFixture } from "./invites-fixture";
import * as s from "../../src/server/db/index";

// The CSV import is gone (Daniel, 2026-11-17). A second parent's address still arrives through Add student and the Maven intake.
const opened:{client:{close:()=>Promise<unknown>}}[]=[];
afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.client.close()));vi.clearAllMocks();});

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
