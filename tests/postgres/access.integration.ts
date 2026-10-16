import { afterEach, expect, test, vi } from "vitest";
import { randomBytes } from "node:crypto";
// Marker-only mock in this explicit integration suite. Production services and
// the actual Better Auth cookie validation/session API are never replaced.
vi.mock("server-only",()=>({}));
import { eq, sql } from "drizzle-orm";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";
import { deferred, newRequestId, postgresAccessFixture, settleRace, waitForEntry } from "./access-fixture";
import { createInvitationService } from "../../src/server/invitations/service";
import { createStudentService } from "../../src/server/students/service";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { query } from "./disposable.mjs";

type Fixture=Awaited<ReturnType<typeof postgresAccessFixture>>;
type Revocation="link"|"grant"|"session";
const fixtures:Fixture[]=[];
async function fixture(){const f=await postgresAccessFixture();fixtures.push(f);return f;}
afterEach(async()=>{for(const f of fixtures.splice(0))await f.close();});

async function denied(action:()=>Promise<unknown>,status:number){
  try{await action();return false;}catch(error){return error instanceof AccessDenied && error.status===status;}
}
async function permissionDenied(action:()=>Promise<unknown>){
  try{await action();return false;}catch(error){const safe=error as {code?:string;cause?:{code?:string}};return (safe.cause?.code??safe.code)==="42501";}
}
function write(f:Fixture,requestId:string,options:{entered?:ReturnType<typeof deferred>;release?:ReturnType<typeof deferred>;fail?:boolean}={}){
  return f.a.withStudentCapability(f.request("tutor"),{mode:"tutor",studentId:f.student.id,capability:"set-reading"},async(tx,actor)=>{
    options.entered?.resolve();
    if(options.release)await options.release.promise;
    const [assignment]=await tx.insert(s.assignment).values({tenantId:actor.tenantId,studentId:actor.studentId,kind:"torah",basis:"custom",ref:"Genesis 1:1",status:"confirmed",setByMembershipId:actor.membershipId}).returning({id:s.assignment.id});
    await tx.insert(s.auditEvent).values({tenantId:actor.tenantId,actorUserId:actor.userId,actorMembershipId:actor.membershipId,
      roleGrantId:actor.roleGrantId,mode:actor.mode,actingStudentId:actor.studentId,action:"reading.set",targetType:"assignment",targetId:assignment.id,requestId});
    if(options.fail)throw new Error("Synthetic callback failure");
    return assignment.id;
  });
}
function revoke(f:Fixture,kind:Revocation,options:{entered?:ReturnType<typeof deferred>;release?:ReturnType<typeof deferred>;committedRequestId?:string}={}){
  return f.b.withAdminCapability(f.request("admin"),{mode:"admin",capability:"manage-relationships"},async(tx)=>{
    if(options.committedRequestId){
      const committed=await tx.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.requestId,options.committedRequestId));
      if(committed.length!==1)throw new Error("Authorized operation was not committed before revocation");
    }
    if(kind==="link")await tx.update(s.tutorStudent).set({revokedAt:new Date()}).where(eq(s.tutorStudent.id,f.link.id));
    if(kind==="grant")await tx.update(s.roleGrant).set({revokedAt:new Date()}).where(eq(s.roleGrant.id,f.tutorGrant.id));
    if(kind==="session")await tx.delete(s.session).where(eq(s.session.id,f.tutor.sessionId));
    options.entered?.resolve();
    if(options.release)await options.release.promise;
    return true;
  });
}
async function nextActionDenied(f:Fixture,kind:Revocation){
  const status=kind==="session"?401:kind==="grant"?403:404;
  expect(await denied(()=>f.a.readStudent(f.request("tutor"),{mode:"tutor",studentId:f.student.id}),status)).toBe(true);
  expect(await denied(()=>write(f,newRequestId()),status)).toBe(true);
}

test("actual access callbacks enforce mode/tenant boundaries, column grants and atomic audit rollback",async()=>{
  await expect(waitForEntry(deferred().promise,Promise.reject(new Error("Synthetic opaque failure"))))
    .rejects.toThrow("Access operation failed before the test barrier");
  const f=await fixture();
  expect((await f.a.readStudent(f.request("tutor"),{mode:"tutor",studentId:f.student.id})).id===f.student.id).toBe(true);
  expect(await denied(()=>f.a.readStudent(f.request("tutor"),{mode:"tutor",studentId:f.otherStudent.id}),404)).toBe(true);
  expect(await denied(()=>f.a.readStudent(f.request("tutor","http://localhost:3101"),{mode:"tutor",studentId:f.otherStudent.id}),403)).toBe(true);
  let parentCallbackCalled=false;
  expect(await denied(()=>f.a.withStudentCapability(f.request("tutor"),{mode:"parent",studentId:f.student.id,capability:"set-reading"},async()=>{parentCallbackCalled=true;}),403)).toBe(true);
  expect(parentCallbackCalled).toBe(false);
  for(const statement of [sql`update tenant set enabled=false where id='crc'`,sql`update tenant set id='changed' where id='crc'`,sql`update tenant_host set origin='https://changed.example.test' where tenant_id='crc'`]){
    expect(await permissionDenied(()=>withTenantTransaction(f.aDb,{tenantId:"crc"},async tx=>{await tx.execute(statement);}))).toBe(true);
  }
  const requestId=newRequestId();
  let sanitized=false;
  try{await write(f,requestId,{fail:true});}catch(error){sanitized=error instanceof AccessUnavailable && error.message==="Access service unavailable" && !("cause" in error);}
  expect(sanitized).toBe(true);
  expect((await f.ownerDb.select({id:s.assignment.id}).from(s.assignment)).length).toBe(0);
  expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.requestId,requestId))).length).toBe(0);
});

test("an authorized write commits before a competing link/grant/session revocation, then every next action is denied",async()=>{
  for(const kind of ["link","grant","session"] as const){
    const f=await fixture();
    const entered=deferred(),release=deferred();
    const requestId=newRequestId();
    // Attach rejection handlers immediately so a failed race cannot leak a raw
    // unhandled provider error while the lock observer is still checking.
    const operation=write(f,requestId,{entered,release}).then(id=>({ok:true as const,id}),()=>({ok:false as const}));
    let revocation:Promise<boolean>|undefined;
    try {
      await waitForEntry(entered.promise,operation);
      revocation=revoke(f,kind,{committedRequestId:requestId}).then(()=>true,()=>false);
      await f.waitForLock(f.pidB,f.pidA);
      release.resolve();
      expect((await operation).ok).toBe(true);
      expect(await revocation).toBe(true);
      expect((await f.ownerDb.select({id:s.assignment.id}).from(s.assignment)).length).toBe(1);
      expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.requestId,requestId))).length).toBe(1);
      await nextActionDenied(f,kind);
    } finally {
      release.resolve();
      await settleRace(revocation?[operation,revocation]:[operation]);
    }
  }
});

test("revocation committed first wins the reverse race and the waiting capability callback never writes",async()=>{
  for(const kind of ["link","grant","session"] as const){
    const f=await fixture();
    const entered=deferred(),release=deferred();
    const revocation=revoke(f,kind,{entered,release}).then(()=>true,()=>false);
    let operation:Promise<boolean>|undefined;
    try {
      await waitForEntry(entered.promise,revocation);
      operation=write(f,newRequestId()).then(()=>false,error=>error instanceof AccessDenied && error.status===(kind==="session"?401:kind==="grant"?403:404));
      await f.waitForLock(f.pidA,f.pidB);
      release.resolve();
      expect(await revocation).toBe(true);
      expect(await operation).toBe(true);
      expect((await f.ownerDb.select({id:s.assignment.id}).from(s.assignment)).length).toBe(0);
      expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent)).length).toBe(0);
      await nextActionDenied(f,kind);
    } finally {
      release.resolve();
      await settleRace(operation?[revocation,operation]:[revocation]);
    }
  }
});

test("concurrent redemption contends on live authority and creates exactly one grant, guardian and acceptance audit",async()=>{
  const f=await fixture();
  const recipient=await f.signIn("pg-recipient");
  const throttleSecret=randomBytes(48).toString("base64url");
  let privateUrl="";
  const invitationsA=createInvitationService({db:f.aDb,access:f.a,throttleSecret,transport:async message=>{privateUrl=message.url;}});
  const invitationsB=createInvitationService({db:f.bDb,access:f.b,throttleSecret,transport:async()=>{}});
  const adminRequest={...f.request("admin"),method:"POST",headers:new Headers({...Object.fromEntries(f.request("admin").headers),origin:"http://localhost:3000"})};
  const issued=await invitationsA.issue(adminRequest,{mode:"admin",role:"parent",email:"pg-recipient@example.test",studentId:f.student.id});
  expect(issued.delivery==="sent").toBe(true);
  const token=new URL(privateUrl).searchParams.get("token");
  if(!token)throw new Error("Synthetic invitation delivery missing");
  const request={url:"http://localhost:3000/invitations/accept",method:"POST",headers:new Headers({origin:"http://localhost:3000",cookie:recipient.cookie})};
  const entered=deferred(),release=deferred();let claimed=false;
  const restore=await f.intercept("a",text=>!claimed && text.includes('from "invite"') && text.trimEnd().endsWith("for update"),async proceed=>{
    claimed=true;const result=await proceed();entered.resolve();await release.promise;return result;
  });
  const first=invitationsA.accept(request,{token}).then(()=>({accepted:true,denied:false}),()=>({accepted:false,denied:false}));
  let second:Promise<{accepted:boolean;denied:boolean}>|undefined;
  try{
    await waitForEntry(entered.promise,first);
    second=invitationsB.accept(request,{token}).then(()=>({accepted:true,denied:false}),error=>({accepted:false,denied:error instanceof AccessDenied && error.status===404}));
    await f.waitForLock(f.pidB,f.pidA);
    release.resolve();
    expect((await first).accepted).toBe(true);expect((await second).denied).toBe(true);
    const members=await f.ownerDb.select({id:s.membership.id}).from(s.membership).where(eq(s.membership.userId,recipient.id));expect(members.length).toBe(1);
    const grants=await f.ownerDb.select({id:s.roleGrant.id}).from(s.roleGrant).where(eq(s.roleGrant.membershipId,members[0].id));expect(grants.length).toBe(1);
    expect((await f.ownerDb.select({id:s.guardian.id}).from(s.guardian).where(eq(s.guardian.parentGrantId,grants[0].id))).length).toBe(1);
    expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.action,"invite.accept"))).length).toBe(1);
    expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.action,"grant.issue"))).length).toBe(1);
    expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.action,"guardian.link"))).length).toBe(1);
    const [row]=await f.ownerDb.select({acceptedAt:s.invite.acceptedAt}).from(s.invite).where(eq(s.invite.id,issued.inviteId));expect(row.acceptedAt!==null).toBe(true);
  }finally{release.resolve();restore();await settleRace(second?[first,second]:[first]);}
});

test("two first reading inserts contend on the unique index and commit one exact assignment/audit with a typed stale loser",async()=>{
  const f=await fixture(),signingSecret=randomBytes(48).toString("base64url");
  const loadReading=async(date:string,calendar:"diaspora"|"israel")=>({fetchedAt:Date.now(),snapshot:{date:parseCeremonyDate(date),calendar,reading:null,haftarah:null}});
  const studentsA=createStudentService({access:f.a,signingSecret,loadReading});
  const studentsB=createStudentService({access:f.b,signingSecret,loadReading});
  const request={...f.request("tutor"),method:"POST",headers:new Headers({...Object.fromEntries(f.request("tutor").headers),origin:"http://localhost:3000"})};
  const prepared=await studentsA.prepareReading(request,{mode:"tutor",studentId:f.student.id,ranges:["Genesis 1:31-2:2"]});
  if(prepared.status!=="prepared")throw new Error("Synthetic reading preparation failed");
  const enteredA=deferred(),enteredB=deferred(),executeA=deferred(),executeB=deferred(),ackA=deferred(),releaseAck=deferred();
  let claimedA=false,claimedB=false;
  const restoreA=await f.intercept("a",text=>!claimedA && text.startsWith('insert into "assignment" '),async proceed=>{
    claimedA=true;enteredA.resolve();await executeA.promise;const result=await proceed();ackA.resolve();await releaseAck.promise;return result;
  });
  const restoreB=await f.intercept("b",text=>!claimedB && text.startsWith('insert into "assignment" '),async proceed=>{
    claimedB=true;enteredB.resolve();await executeB.promise;return proceed();
  });
  const selection={mode:"tutor" as const,studentId:f.student.id,binding:prepared.binding};
  const first=studentsA.confirmReading(request,selection).then(result=>({accepted:result.ok,stale:!result.ok && result.code==="stale-revision"}),()=>({accepted:false,stale:false}));
  const second=studentsB.confirmReading(request,selection).then(result=>({accepted:result.ok,stale:!result.ok && result.code==="stale-revision"}),()=>({accepted:false,stale:false}));
  try{
    await waitForEntry(enteredA.promise,first);await waitForEntry(enteredB.promise,second);
    executeA.resolve();await waitForEntry(ackA.promise,first);
    executeB.resolve();await f.waitForLock(f.pidB,f.pidA);
    const wait=(await query<{waiting:boolean}>(f.owner,"SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='transactionid' AND NOT granted) AS waiting",[f.pidB])).rows[0];expect(wait.waiting).toBe(true);
    releaseAck.resolve();
    expect((await first).accepted).toBe(true);expect((await second).stale).toBe(true);
    const assignments=await f.ownerDb.select({id:s.assignment.id}).from(s.assignment);expect(assignments.length).toBe(1);
    const verses=await f.ownerDb.select({ref:s.assignmentVerse.verseRef}).from(s.assignmentVerse).orderBy(s.assignmentVerse.ordinal);
    expect(verses.map(row=>row.ref)).toEqual(["Genesis 1:31","Genesis 2:1","Genesis 2:2"]);
    expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.action,"reading.set"))).length).toBe(1);
  }finally{
    executeA.resolve();executeB.resolve();releaseAck.resolve();restoreA();restoreB();await settleRace([first,second]);
  }
});

test("an authorized old-child practice write commits before a competing switch without closing another tab",async()=>{
  const f=await fixture(),practice=await f.practice();
  const old=await practice.a.enter(practice.request(),{studentId:f.student.id});
  const otherTab=await practice.a.enter(practice.request(),{studentId:practice.sibling.id});
  const entered=deferred(),release=deferred(),requestId=newRequestId();
  let switchSawCommittedWrite=false,claimed=false;
  const restore=await f.intercept("b",text=>!claimed && text.startsWith('update "practice_context" ') && text.includes('"revoked_at"'),async proceed=>{
    claimed=true;
    // This executes inside the actual switch after its tenant UPDATE lock was
    // granted. A separate physical owner connection must already see the write
    // committed before the switch can mutate the old context. No fake results.
    const rows=await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.requestId,requestId));
    if(rows.length!==1)throw new Error("Practice write was not committed before switch");
    switchSawCommittedWrite=true;
    return proceed();
  });
  // A synthetic audit insert is the real practice-write transaction side effect;
  // translation/recording writes are future separately-reviewed features.
  const operation=practice.a.withPracticeCapability(practice.request(old.handle),{mode:"child-practice",studentId:f.student.id,capability:"practice-write"},async(tx,actor)=>{
    await tx.insert(s.auditEvent).values({tenantId:actor.tenantId,actorUserId:actor.userId,actorMembershipId:actor.membershipId,
      roleGrantId:actor.roleGrantId,mode:actor.mode,guardianId:actor.relationshipId,actingStudentId:actor.studentId,action:"context.enter",
      targetType:"synthetic-practice-write",targetId:actor.context!.id,requestId});
    entered.resolve(); // INSERT acknowledged; authority/context SHARE locks held.
    await release.promise;
    return true;
  }).then(()=>true,()=>false);
  let switching:Promise<Awaited<ReturnType<typeof practice.b.switch>>|null>|undefined;
  try{
    await waitForEntry(entered.promise,operation);
    switching=practice.b.switch(practice.request(old.handle),{studentId:practice.sibling.id}).then(result=>result,()=>null);
    await f.waitForLock(f.pidB,f.pidA); // Observed PG blocking edge, not a delay.
    release.resolve();
    expect(await operation).toBe(true);
    const switched=await switching;
    expect(switched!==null && switchSawCommittedWrite).toBe(true);
    expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.requestId,requestId))).length).toBe(1);
    expect(await denied(()=>practice.a.read(practice.request(old.handle),{mode:"child-practice",studentId:f.student.id}),404)).toBe(true);
    expect((await practice.a.read(practice.request(otherTab.handle),{mode:"child-practice",studentId:practice.sibling.id})).context?.id===otherTab.context.id).toBe(true);
    if(!switched)throw new Error("Expected practice switch result missing");
    expect((await practice.b.read(practice.request(switched.handle),{mode:"child-practice",studentId:practice.sibling.id})).context?.id===switched.context.id).toBe(true);
  }finally{release.resolve();restore();await settleRace(switching?[operation,switching]:[operation]);}
});

test("a committed practice switch denies a waiting old-handle write and keeps the other tab usable",async()=>{
  const f=await fixture(),practice=await f.practice();
  const old=await practice.a.enter(practice.request(),{studentId:f.student.id});
  const otherTab=await practice.a.enter(practice.request(),{studentId:practice.sibling.id});
  const entered=deferred(),release=deferred(),requestId=newRequestId();
  let claimed=false,callbackCalled=false;
  const restore=await f.intercept("b",text=>!claimed && text.startsWith('update "practice_context" ') && text.includes('"revoked_at"'),async proceed=>{
    claimed=true;
    const result=await proceed(); // Real old-context UPDATE acknowledgement.
    entered.resolve();
    await release.promise;
    return result;
  });
  const switching=practice.b.switch(practice.request(old.handle),{studentId:practice.sibling.id}).then(result=>result,()=>null);
  let operation:Promise<boolean>|undefined;
  try{
    await waitForEntry(entered.promise,switching);
    operation=practice.a.withPracticeCapability(practice.request(old.handle),{mode:"child-practice",studentId:f.student.id,capability:"practice-write"},async(tx,actor)=>{
      callbackCalled=true;
      await tx.insert(s.auditEvent).values({tenantId:actor.tenantId,actorUserId:actor.userId,actorMembershipId:actor.membershipId,
        roleGrantId:actor.roleGrantId,mode:actor.mode,guardianId:actor.relationshipId,actingStudentId:actor.studentId,action:"context.enter",
        targetType:"synthetic-practice-write",targetId:actor.context!.id,requestId});
    }).then(()=>false,error=>error instanceof AccessDenied && error.status===404);
    await f.waitForLock(f.pidA,f.pidB);
    release.resolve();
    const switched=await switching;
    expect(switched!==null).toBe(true);
    expect(await operation).toBe(true);
    expect(callbackCalled).toBe(false);
    expect((await f.ownerDb.select({id:s.auditEvent.id}).from(s.auditEvent).where(eq(s.auditEvent.requestId,requestId))).length).toBe(0);
    const [closed]=await f.ownerDb.select({revokedAt:s.practiceContext.revokedAt}).from(s.practiceContext).where(eq(s.practiceContext.id,old.context.id));
    expect(closed.revokedAt!==null).toBe(true);
    expect((await practice.a.read(practice.request(otherTab.handle),{mode:"child-practice",studentId:practice.sibling.id})).context?.id===otherTab.context.id).toBe(true);
    if(!switched)throw new Error("Expected practice switch result missing");
    expect((await practice.b.read(practice.request(switched.handle),{mode:"child-practice",studentId:practice.sibling.id})).context?.id===switched.context.id).toBe(true);
  }finally{release.resolve();restore();await settleRace(operation?[switching,operation]:[switching]);}
});
