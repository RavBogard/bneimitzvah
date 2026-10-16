import { afterEach, expect, test, vi } from "vitest";
// Marker-only mock in this explicit integration suite. Production services and
// the actual Better Auth cookie validation/session API are never replaced.
vi.mock("server-only",()=>({}));
import { eq, sql } from "drizzle-orm";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";
import { deferred, newRequestId, postgresAccessFixture, settleRace, waitForEntry } from "./access-fixture";

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
