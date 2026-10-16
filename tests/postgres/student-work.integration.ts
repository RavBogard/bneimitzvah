import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createStudentWorkService } from "../../src/server/student-work/service";
import { createPracticeService } from "../../src/server/practice/service";
import type { WorkSelection } from "../../src/server/student-work/validation";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";
import { AccessDenied } from "../../src/server/access/errors";
import { createStudentService } from "../../src/server/students/service";

type Fixture = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
// Attach a rejection handler when starting each race; keep driver SQL/params
// out of assertions and guarantee cleanup can await every pending operation.
function safe<T>(operation: PromiseLike<T>) {
  return Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));
}
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; current && depth < 4; depth++, current = current.cause as typeof current) {
      if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    }
    return "unknown";
  }
}
async function observeOwnerWait(f: Fixture, blocked: number, blocker: number) {
  // B is idle in these forward races. The owner is blocked on A, so it cannot
  // also serve its own pg_blocking_pids observation query.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await f.bDb.execute(sql`select ${blocker}::integer = any(pg_blocking_pids(${blocked}::integer)) as blocked`);
    if (state.rows[0]?.blocked === true) return;
    await delay(10);
  }
  throw new Error("Expected PostgreSQL owner blocking edge was not observed");
}
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [assignment] = await f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: member.id }).returning();
  await f.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
  const a = createStudentWorkService({ access: f.a, practice: createPracticeService({ access: f.a }), authorityBindingSecret: "synthetic-work-authority-binding-secret" });
  const b = createStudentWorkService({ access: f.b, practice: createPracticeService({ access: f.b }), authorityBindingSecret: "synthetic-work-authority-binding-secret" });
  const selection: WorkSelection = { mode: "tutor", studentId: f.student.id, kind: "torah", assignmentId: assignment.id, assignmentRevision: 1 };
  function request(who: "admin" | "tutor" = "tutor") {
    const request = f.request(who); request.headers.set("origin", "http://localhost:3000"); return { ...request, method: "POST" };
  }
  const write = (text = "Synthetic note", expectedVersion = 0) => ({ verseRef: "Genesis 1:1", text, expectedVersion, mutationId: randomUUID() });
  return { ...f, workA: a, workB: b, selection, assignment, workRequest: request, write };
}

function cutServices(f: Awaited<ReturnType<typeof fixture>>) {
  const reviewTime=Date.now(),signingSecret="synthetic-pg-aliyah-review-signing-secret",loadReading=async()=>{throw new Error("Unexpected synthetic calendar request");};
  return {a:createStudentService({access:f.a,signingSecret,loadReading,now:()=>reviewTime}),b:createStudentService({access:f.b,signingSecret,loadReading,now:()=>reviewTime})};
}
test("cut-only confirmations contend on the real assignment lock: one CAS winner preserves provenance and verse identities",async()=>{
 const f=await fixture(),services=cutServices(f),input={mode:"tutor" as const,studentId:f.student.id,preparationMode:"current-assignment" as const,expectedAssignmentRevision:1};
 const aReview=await services.a.prepareReading(f.workRequest(),{...input,aliyahStarts:[]}),bReview=await services.b.prepareReading(f.workRequest(),{...input,aliyahStarts:["Genesis 1:2"]});
 if(aReview.status!=="prepared" || bReview.status!=="prepared")throw new Error("Expected synthetic cuts reviews");
 const before={assignment:(await f.ownerDb.select().from(s.assignment))[0],verses:await f.ownerDb.select().from(s.assignmentVerse)};
 const entered=deferred(),release=deferred(),stop=await f.intercept("a",text=>text.startsWith('update "assignment"'),async proceed=>{const result=await proceed();entered.resolve();await release.promise;return result;});
 const a=safe(services.a.confirmReading(f.workRequest(),{mode:"tutor",studentId:f.student.id,binding:aReview.binding}));let b:Promise<unknown>|undefined;
 try{await waitForEntry(entered.promise,a);b=safe(services.b.confirmReading(f.workRequest(),{mode:"tutor",studentId:f.student.id,binding:bReview.binding}));await f.waitForLock(f.pidB,f.pidA);}finally{release.resolve();stop();await Promise.all([a,b]);}
 expect(await a).toMatchObject({ok:true,revision:2});expect(await b).toEqual({ok:false,code:"stale-revision"});
 expect((await f.ownerDb.select().from(s.assignment))[0]).toEqual({...before.assignment,revision:2,aliyahStarts:[]});expect(await f.ownerDb.select().from(s.assignmentVerse)).toEqual(before.verses);
 expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action,"reading.set"))).toHaveLength(1);
});

for(const phase of ["confirmation","preparation"] as const)test(`cut-only ${phase} rejects a session that expires across its real assignment lock wait`,async()=>{
 const f=await fixture(),services=cutServices(f),expiresAt=Date.now()+60_000;
 await f.ownerDb.update(s.session).set({expiresAt:new Date(expiresAt)}).where(eq(s.session.id,f.tutor.sessionId));
 const input={mode:"tutor" as const,studentId:f.student.id,preparationMode:"current-assignment" as const,expectedAssignmentRevision:1,aliyahStarts:[]};
 const prepared=phase==="confirmation"?await services.a.prepareReading(f.workRequest(),input):null;if(prepared && prepared.status!=="prepared")throw new Error("Expected valid cuts envelope");
 const before={assignments:await f.ownerDb.select().from(s.assignment),verses:await f.ownerDb.select().from(s.assignmentVerse),audit:await f.ownerDb.select().from(s.auditEvent)};
 const entered=deferred(),release=deferred(),hold=safe(f.ownerDb.transaction(async tx=>{await tx.execute(sql`select id from assignment where id=${f.assignment.id} for update`);entered.resolve();await release.promise;return {held:true};}));
 let operation:Promise<unknown>|undefined,restore:(()=>void)|undefined;
 try{
  await waitForEntry(entered.promise,hold);const ownerPid=(await query<{pid:number}>(f.owner,"select pg_backend_pid() as pid")).rows[0].pid;
  operation=phase==="confirmation"?safe(services.a.confirmReading(f.workRequest(),{mode:"tutor",studentId:f.student.id,binding:prepared!.binding})):safe(services.a.prepareReading(f.workRequest(),input));
  await f.waitForLock(f.pidA,ownerPid);const clock=vi.spyOn(Date,"now").mockReturnValue(expiresAt+1);restore=()=>clock.mockRestore();
 }finally{release.resolve();await Promise.all([hold,operation]);restore?.();}
 expect(await operation).toEqual({denied:401});
 expect({assignments:await f.ownerDb.select().from(s.assignment),verses:await f.ownerDb.select().from(s.assignmentVerse),audit:await f.ownerDb.select().from(s.auditEvent)}).toEqual(before);
});

for (const race of ["same-base", "identical-retry", "uuid-mismatch"] as const) test(`real first-version contention ${race} yields exactly one version/audit`, async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "tutor_note"'), async proceed => {
    const value = await proceed(); entered.resolve(); await release.promise; return value;
  });
  const first = f.write();
  const second = race === "same-base" ? f.write("Different synthetic note") : race === "uuid-mismatch" ? { ...first, text: "Different same-UUID note" } : first;
  const a = safe(f.workA.append(f.workRequest(), f.selection, "note", first));
  let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.workB.append(f.workRequest(), f.selection, "note", second));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true, replayed: false, committedVersion: 1 });
  expect(await b).toMatchObject(race === "identical-retry" ? { ok: true, replayed: true, committedVersion: 1, currentLatestVersion: 1 } : { ok: false, code: "conflict" });
  expect(await f.ownerDb.select().from(s.tutorNote)).toHaveLength(1);
  expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action, "note.append"))).toHaveLength(1);
});

test("audit failure rolls back version/receipt and identical retry can commit once", async () => {
  const f = await fixture(), input = f.write();
  const stop = await f.intercept("a", text => text.startsWith('insert into "audit_event"'), async () => { throw new Error("Synthetic rollback"); });
  try { await expect(f.workA.append(f.workRequest(), f.selection, "note", input)).rejects.toBeDefined(); } finally { stop(); }
  expect(await f.ownerDb.select().from(s.tutorNote)).toHaveLength(0);
  expect(await f.workB.append(f.workRequest(), f.selection, "note", input)).toMatchObject({ ok: true, replayed: false, committedVersion: 1 });
  await f.workB.append(f.workRequest(), f.selection, "note", f.write("Newer", 1));
  expect(await f.workA.append(f.workRequest(), f.selection, "note", input)).toMatchObject({ replayed: true, committedVersion: 1, currentLatestVersion: 2 });
  expect(await f.workB.receipt(f.workRequest(), f.selection, "note", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 1, currentLatestVersion: 2 });
});

test("authorized append holds SHARE relationship lock until commit; revocation then denies later reads and writes", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "tutor_note"'), async proceed => {
    const value = await proceed(); entered.resolve(); await release.promise; return value;
  });
  const operation = safe(f.workA.append(f.workRequest(), f.selection, "note", f.write()));
  let revoke: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, operation);
    const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    revoke = safe(f.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id)).then(() => ({ committed: true })));
    await observeOwnerWait(f, ownerPid, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([operation, revoke]); }
  expect(await operation).toMatchObject({ ok: true }); expect(await revoke).toEqual({ committed: true });
  await expect(f.workB.page(f.workRequest(), f.selection)).rejects.toMatchObject({ status: 404 });
  await expect(f.workB.append(f.workRequest(), f.selection, "note", f.write("Later", 1))).rejects.toMatchObject({ status: 404 });
  expect(await f.workB.history(f.workRequest("admin"), { ...f.selection, mode: "admin" }, "note", "Genesis 1:1")).toMatchObject({ versions: [{ version: 1, author: { displayName: expect.any(String) } }] });
});

test("session expiry during a real uniqueness wait denies after waking and keeps winner only", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "tutor_note"'), async proceed => {
    const value = await proceed(); entered.resolve(); await release.promise; return value;
  });
  const a = safe(f.workA.append(f.workRequest("admin"), { ...f.selection, mode: "admin" }, "note", f.write()));
  let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    const expiresAt = new Date(Date.now() + 1500);
    await f.ownerDb.update(s.session).set({ expiresAt }).where(eq(s.session.id, f.tutor.sessionId));
    b = f.workB.append(f.workRequest(), f.selection, "note", f.write()).then(value => ({ value }), error => ({ status: error.status }));
    await f.waitForLock(f.pidB, f.pidA);
    await delay(Math.max(0, expiresAt.getTime() - Date.now() + 30));
  } finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true }); expect(await b).toEqual({ status: 401 });
  expect(await f.ownerDb.select().from(s.tutorNote)).toHaveLength(1);
});

test("session deletion cascades child context while retained attribution/history survives for a current reader", async () => {
  const f = await fixture(), practice = await f.practice();
  const child = await practice.a.enter(practice.request(), { studentId: f.student.id });
  const selection = { ...f.selection, mode: "child-practice" as const }, input = f.write("Synthetic assisted draft");
  expect(await f.workA.append(practice.request(child.handle), selection, "draft", input)).toMatchObject({ ok: true });
  await f.ownerDb.delete(s.session).where(eq(s.session.id, f.tutor.sessionId));
  expect(await f.ownerDb.select().from(s.practiceContext)).toHaveLength(0);
  const [row] = await f.ownerDb.select().from(s.translationDraft);
  expect(row).toMatchObject({ contextId: child.context.id, actorUserId: f.tutor.id });
  await expect(f.workB.history(practice.request(child.handle), selection, "draft", input.verseRef)).rejects.toMatchObject({ status: 401 });
  expect(await f.workB.history(f.workRequest("admin"), { ...f.selection, mode: "admin" }, "draft", input.verseRef)).toMatchObject({ versions: [{ version: 1, author: { mode: "child-practice", assisted: true } }] });
});

test("assignment replacement waits on append; removed work cannot be read/replayed and re-add exposes original history", async () => {
  const f = await fixture(), input = f.write(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "tutor_note"'), async proceed => {
    const value = await proceed(); entered.resolve(); await release.promise; return value;
  });
  const save = safe(f.workA.append(f.workRequest(), f.selection, "note", input));
  let replacement: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, save);
    const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    replacement = safe(f.ownerDb.transaction(async tx => {
      await tx.update(s.assignment).set({ ref: "Genesis 1:2-3", revision: 2 }).where(eq(s.assignment.id, f.assignment.id));
      await tx.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id));
      await tx.insert(s.assignmentVerse).values([2, 3].map((verse, i) => ({ tenantId: "crc", studentId: f.student.id, assignmentId: f.assignment.id, ordinal: i + 1, verseRef: `Genesis 1:${verse}` })));
      return { committed: true };
    }));
    await observeOwnerWait(f, ownerPid, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([save, replacement]); }
  expect(await save).toMatchObject({ ok: true }); expect(await replacement).toEqual({ committed: true });
  expect(await f.workB.append(f.workRequest(), f.selection, "note", input)).toEqual({ ok: false, code: "stale-revision" });
  const current = { ...f.selection, assignmentRevision: 2 };
  await expect(f.workB.history(f.workRequest(), current, "note", input.verseRef)).rejects.toMatchObject({ status: 404 });
  await expect(f.workB.receipt(f.workRequest(), current, "note", input.verseRef, input.mutationId)).rejects.toMatchObject({ status: 404 });
  await f.ownerDb.transaction(async tx => {
    await tx.update(s.assignment).set({ ref: "Genesis 1:1-3", revision: 3 }).where(eq(s.assignment.id, f.assignment.id));
    await tx.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id));
    await tx.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: f.student.id, assignmentId: f.assignment.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
  });
  expect(await f.workB.history(f.workRequest(), { ...current, assignmentRevision: 3 }, "note", input.verseRef)).toMatchObject({ versions: [{ assignmentRevision: 1, version: 1 }] });
});

test("recovery finds the old commit only after the assignment UPDATE waited for its writer", async () => {
  const f = await fixture(), input = f.write(), initial = await f.workA.page(f.workRequest(), f.selection);
  if (!initial.ok) throw new Error("Synthetic work authority missing");
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "tutor_note"'), async proceed => { const value = await proceed(); entered.resolve(); await release.promise; return value; });
  const save = safe(f.workA.append(f.workRequest(), f.selection, "note", input)); let update: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, save);
    const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    update = safe(f.ownerDb.transaction(async tx => { await tx.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id)); return { committed: true }; }));
    await observeOwnerWait(f, ownerPid, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([save, update]); }
  expect(await save).toMatchObject({ ok: true, committedVersion: 1 }); expect(await update).toEqual({ committed: true });
  expect(await f.workB.recovery(f.workRequest(), { ...f.selection, assignmentRevision: 2 }, "note", 1, input, initial.authorityBinding)).toMatchObject({ ok: true, outcome: "committed", receipt: { committedVersion: 1, committed: { assignmentRevision: 1 } } });
  expect(await f.ownerDb.select().from(s.tutorNote)).toHaveLength(1);
});

for (const expire of [false, true]) test(`newer locked recovery fences a waiting old writer${expire ? " and rejects expiry after waking" : " before explicit absence"}`, async () => {
  const f = await fixture(), input = f.write(), initial = await f.workA.page(f.workRequest(), f.selection);
  if (!initial.ok) throw new Error("Synthetic work authority missing");
  const entered = deferred(), release = deferred(), expiresAt = Date.now() + 60_000;
  if (expire) await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.tutor.sessionId));
  const update = safe(f.ownerDb.transaction(async tx => { await tx.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id)); entered.resolve(); await release.promise; return { committed: true }; }));
  let oldSave: Promise<unknown> | undefined, recovery: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, update);
    const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    oldSave = safe(f.workA.append(f.workRequest(), f.selection, "note", input));
    recovery = safe(f.workB.recovery(f.workRequest(), { ...f.selection, assignmentRevision: 2 }, "note", 1, input, initial.authorityBinding));
    await f.waitForLock(f.pidA, ownerPid); await f.waitForLock(f.pidB, ownerPid);
    if (expire) { const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore(); }
  } finally { release.resolve(); await Promise.all([update, oldSave, recovery]); restore?.(); }
  expect(await update).toEqual({ committed: true });
  expect(await oldSave).toEqual(expire ? { denied: 401 } : { ok: false, code: "stale-revision" });
  expect(await recovery).toMatchObject(expire ? { denied: 401 } : { ok: true, outcome: "absent", receipt: null, mutationId: input.mutationId, originalRevision: 1, assignmentRevision: 2 });
  expect(await f.ownerDb.select().from(s.tutorNote)).toHaveLength(0);
});

test("fresh real PG migration enforces tenant RLS, grants, append-only guard and composite actor/student FKs", async () => {
  const f = await fixture(); await f.workA.append(f.workRequest(), f.selection, "note", f.write());
  const [row] = await f.ownerDb.select().from(s.tutorNote);
  const { id: _id, ...values } = row;
  expect(await sqlState(f.ownerDb.insert(s.tutorNote).values({ ...values, version: 2, baseVersion: 1, mutationId: randomUUID(), studentId: f.otherStudent.id }))).toBe("23503");
  expect(await sqlState(f.ownerDb.insert(s.tutorNote).values({ ...values, version: 2, baseVersion: 1, mutationId: randomUUID(), actorUserId: f.admin.id }))).toBe("23503");
  expect(await sqlState(f.ownerDb.update(s.tutorNote).set({ text: "forbidden" }))).toBe("23514");
  expect(await sqlState(f.ownerDb.delete(s.tutorNote))).toBe("23514");
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.tutorNote))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.insert(s.tutorNote).values({ ...values, mutationId: randomUUID(), version: 2, baseVersion: 1 })))).toBe("42501");
  const grants = await f.ownerDb.execute(sql`select has_table_privilege('portal_runtime','tutor_note','SELECT') as read, has_table_privilege('portal_runtime','tutor_note','INSERT') as append, has_table_privilege('portal_runtime','tutor_note','UPDATE') as update, has_table_privilege('portal_runtime','tutor_note','DELETE') as delete`);
  expect(grants.rows[0]).toEqual({ read: true, append: true, update: false, delete: false });
  const flags = await f.ownerDb.execute(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname in ('translation_draft','tutor_note')`);
  expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }, { relrowsecurity: true, relforcerowsecurity: true }]);

  const practice = await f.practice(), child = await practice.a.enter(practice.request(), { studentId: f.student.id });
  await f.workA.append(practice.request(child.handle), { ...f.selection, mode: "child-practice" }, "draft", f.write("Synthetic assisted draft"));
  const [assisted] = await f.ownerDb.select().from(s.translationDraft);
  const { id: _assistedId, ...assistedValues } = assisted;
  const [siblingGuardian] = await f.ownerDb.select().from(s.guardian).where(eq(s.guardian.studentId, practice.sibling.id));
  expect(await sqlState(f.ownerDb.insert(s.translationDraft).values({ ...assistedValues, version: 2, baseVersion: 1, mutationId: randomUUID(), guardianId: siblingGuardian.id }))).toBe("23503");
  const [adminMember] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [otherParentGrant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: adminMember.id, role: "parent" }).returning();
  expect(await sqlState(f.ownerDb.insert(s.translationDraft).values({ ...assistedValues, version: 2, baseVersion: 1, mutationId: randomUUID(), actorUserId: f.admin.id, actorMembershipId: adminMember.id, roleGrantId: otherParentGrant.id }))).toBe("23503");

  const [ownGrant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: adminMember.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: ownGrant.id });
  await f.workA.append(f.workRequest("admin"), { ...f.selection, mode: "student" }, "draft", f.write("Synthetic own draft", 1));
  const [own] = await f.ownerDb.select().from(s.translationDraft).where(eq(s.translationDraft.version, 2));
  const { id: _ownId, ...ownValues } = own;
  const [tutorMember] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.tutor.id));
  const [siblingGrant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: tutorMember.id, role: "student" }).returning();
  const [siblingIdentity] = await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: practice.sibling.id, roleGrantId: siblingGrant.id }).returning();
  expect(await sqlState(f.ownerDb.insert(s.translationDraft).values({ ...ownValues, version: 3, baseVersion: 2, mutationId: randomUUID(), studentIdentityId: siblingIdentity.id }))).toBe("23503");
  const receipt = await f.workB.receipt(f.workRequest(), f.selection, "note", row.verseRef, row.mutationId);
  if (!receipt.ok) throw new Error("Expected authorized receipt");
  expect(Object.keys(receipt.committed.author).sort()).toEqual(["assisted", "displayName", "membershipId", "mode"]);
  expect(receipt.committed.author).not.toHaveProperty("email");
});

test("child append commits before a context switch; old context cannot replay or read receipts afterwards", async () => {
  const f = await fixture(), practice = await f.practice();
  const child = await practice.a.enter(practice.request(), { studentId: f.student.id });
  const selection = { ...f.selection, mode: "child-practice" as const }, input = f.write("Synthetic child work");
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "translation_draft"'), async proceed => {
    const result = await proceed(); entered.resolve(); await release.promise; return result;
  });
  const save = safe(f.workA.append(practice.request(child.handle), selection, "draft", input));
  let switching: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, save);
    switching = safe(practice.b.switch(practice.request(child.handle), { studentId: practice.sibling.id }));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([save, switching]); }
  expect(await save).toMatchObject({ ok: true }); expect(await switching).toHaveProperty("handle");
  await expect(f.workA.append(practice.request(child.handle), selection, "draft", input)).rejects.toMatchObject({ status: 404 });
  await expect(f.workB.receipt(practice.request(child.handle), selection, "draft", input.verseRef, input.mutationId)).rejects.toMatchObject({ status: 404 });
});

for (const change of ["link", "context", "assignment"] as const) test(`reverse ${change} change wins before waiting work and leaves no version/audit`, async () => {
  const f = await fixture();
  const practice = change === "context" ? await f.practice() : null;
  const child = practice ? await practice.a.enter(practice.request(), { studentId: f.student.id }) : null;
  const entered = deferred(), release = deferred();
  const mutation = safe(f.ownerDb.transaction(async tx => {
    if (change === "link") await tx.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id));
    else if (change === "context") await tx.update(s.practiceContext).set({ revokedAt: new Date() }).where(eq(s.practiceContext.id, child!.context.id));
    else await tx.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id));
    entered.resolve(); await release.promise; return { committed: true };
  }));
  let operation: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, mutation);
    const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    operation = f.workA.append(practice && child ? practice.request(child.handle) : f.workRequest(), practice ? { ...f.selection, mode: "child-practice" } : f.selection, practice ? "draft" : "note", f.write())
      .then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));
    await f.waitForLock(f.pidA, ownerPid);
  } finally { release.resolve(); await Promise.all([mutation, operation]); }
  expect(await mutation).toEqual({ committed: true });
  expect(await operation).toEqual(change === "assignment" ? { ok: false, code: "stale-revision" } : { denied: 404 });
  expect(await f.ownerDb.select().from(s.tutorNote)).toHaveLength(0); expect(await f.ownerDb.select().from(s.translationDraft)).toHaveLength(0);
  expect(await f.ownerDb.select().from(s.auditEvent).where(sql`${s.auditEvent.action} in ('draft.append','note.append')`)).toHaveLength(0);
});

for (const expiry of ["session", "context"] as const) test(`${expiry} expiry after assignment wait wins over stale result`, async () => {
  const f = await fixture(), expiresAt = new Date(Date.now() + 1500);
  const practice = expiry === "context" ? await f.practice() : null;
  const child = practice ? await practice.a.enter(practice.request(), { studentId: f.student.id }) : null;
  if (child) {
    // Create a short-lived synthetic context; never update its immutable expiry.
    const [context] = await f.ownerDb.select().from(s.practiceContext).where(eq(s.practiceContext.id, child.context.id));
    await f.ownerDb.delete(s.practiceContext).where(eq(s.practiceContext.id, context.id));
    await f.ownerDb.insert(s.practiceContext).values({ ...context, expiresAt });
  } else await f.ownerDb.update(s.session).set({ expiresAt }).where(eq(s.session.id, f.tutor.sessionId));
  const entered = deferred(), release = deferred();
  const mutation = safe(f.ownerDb.transaction(async tx => {
    await tx.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id));
    entered.resolve(); await release.promise; return { committed: true };
  }));
  let operation: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, mutation);
    const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    operation = f.workA.page(practice && child ? practice.request(child.handle) : f.workRequest(), practice ? { ...f.selection, mode: "child-practice" } : f.selection)
      .then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));
    await f.waitForLock(f.pidA, ownerPid);
    await delay(Math.max(0, expiresAt.getTime() - Date.now() + 30));
  } finally { release.resolve(); await Promise.all([mutation, operation]); }
  expect(await mutation).toEqual({ committed: true });
  expect(await operation).toEqual({ denied: expiry === "session" ? 401 : 404 });
});
