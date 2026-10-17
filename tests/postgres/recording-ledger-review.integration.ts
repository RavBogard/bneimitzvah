import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentRecordingService } from "../../src/server/recordings/service";
import { createStudentRecordingRegistrar } from "../../src/server/recordings/registration";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened: Base[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.close(); });
function safe(operation: PromiseLike<unknown>) { return Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 })); }
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let i = 0; current && i < 4; i++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "a".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 2048, durationMs: 2000 } });
const conflict = { ok: false, code: "conflict" };
async function fixture() {
  const f = await postgresAccessFixture(); opened.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
  const practiceA = createPracticeService({ access: f.a }), practiceB = createPracticeService({ access: f.b });
  const mutation = (who: "admin" | "tutor" = "admin", handle?: string) => { const request = f.request(who); request.headers.set("origin", "http://localhost:3000"); if (handle) request.headers.set("X-Practice-Context", handle); return { ...request, method: "POST" }; };
  const context = await practiceB.enter(mutation("tutor"), { studentId: f.student.id });
  let clockA = Date.now(), clockB = clockA;
  const dependenciesA = { access: f.a, practice: practiceA, now: () => clockA }, dependenciesB = { access: f.b, practice: practiceB, now: () => clockB };
  return { ...f, mutation, practiceB, context, selected: { mode: "student" as const, studentId: f.student.id }, child: { mode: "child-practice" as const, studentId: f.student.id },
    serviceA: createStudentRecordingService(dependenciesA), serviceB: createStudentRecordingService(dependenciesB), registrarA: createStudentRecordingRegistrar(dependenciesA), registrarB: createStudentRecordingRegistrar(dependenciesB),
    clock: (value: number, which: "a" | "b" | "both" = "both") => { if (which !== "b") clockA = value; if (which !== "a") clockB = value; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function recording(f: Fixture, submitted = false) {
  const value = descriptor(), created = await f.registrarA.register(f.mutation(), f.selected, value);
  if (!created.ok) throw new Error("Synthetic recording registration failed");
  const id = created.recording.id;
  if (submitted) expect(await f.serviceA.submit(f.mutation(), f.selected, { recordingId: id, expectedRevision: 1 })).toMatchObject({ ok: true, recording: { revision: 2 } });
  return { id, value };
}

for (const contender of ["identical", "mismatch", "expired"] as const) test(`real asset uniqueness wait safely resolves ${contender} registration without duplicate creation`, async () => {
  const f = await fixture(), value = descriptor(), audits = await f.ownerDb.select().from(s.auditEvent);
  const entered = deferred(), release = deferred(), stop = await f.intercept("a", text => text.startsWith('insert into "student_recording"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.registrarA.register(f.mutation(), f.selected, value)); let b: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.registrarB.register(f.mutation("tutor", f.context.handle), f.child, contender === "mismatch" ? { ...value, contentSha256: "b".repeat(64) } : value));
    await f.waitForLock(f.pidB, f.pidA);
    if (contender === "expired") { const mock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.context.context.expiresAt) + 1); restore = () => mock.mockRestore(); }
  } finally { release.resolve(); stop(); await Promise.all([a, b]); restore?.(); }
  expect(await a).toMatchObject({ ok: true, recording: { state: "private", revision: 1 } });
  expect(await b).toMatchObject(contender === "identical" ? { ok: true, recording: { state: "private", revision: 1 } } : contender === "expired" ? { denied: 404 } : conflict);
  const rows = await f.ownerDb.select().from(s.studentRecording); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ assetId: value.assetId, contentSha256: value.contentSha256 });
  expect((await f.ownerDb.select().from(s.auditEvent)).length - audits.length).toBe(1);
});

for (const first of ["submit", "delete"] as const) test(`physical recording-row CAS makes ${first} the sole winner against a stale competing transition`, async () => {
  const f = await fixture(), { id } = await recording(f), before = await f.ownerDb.select().from(s.auditEvent);
  const entered = deferred(), release = deferred(), stop = await f.intercept("a", text => text.startsWith('update "student_recording"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const write = { recordingId: id, expectedRevision: 1 }, a = safe(first === "submit" ? f.serviceA.submit(f.mutation(), f.selected, write) : f.serviceA.remove(f.mutation(), f.selected, write)); let b: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, a); b = safe(first === "submit" ? f.serviceB.remove(f.mutation("tutor", f.context.handle), f.child, write) : f.serviceB.submit(f.mutation("tutor", f.context.handle), f.child, write)); await f.waitForLock(f.pidB, f.pidA); }
  finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true, recording: { state: first === "submit" ? "submitted" : "deleting", revision: 2 } }); expect(await b).toEqual(conflict);
  expect((await f.ownerDb.select().from(s.auditEvent)).length - before.length).toBe(1);
});

for (const operation of ["submit", "no-op", "stale", "delete", "context"] as const) test(`fresh authority after an observed recording-row wait overrides ${operation}`, async () => {
  const f = await fixture(), { id } = await recording(f, operation === "no-op"), before = await f.ownerDb.select().from(s.auditEvent), expires = Date.now() + 60_000;
  if (operation !== "context") await f.ownerDb.update(s.session).set({ expiresAt: new Date(expires) }).where(eq(s.session.id, f.admin.sessionId));
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from student_recording where id=${id} for update`); entered.resolve(); await release.promise; }));
  let result: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold);
    const write = { recordingId: id, expectedRevision: operation === "stale" ? 3 : operation === "no-op" ? 2 : 1 };
    result = safe(operation === "context" ? f.serviceA.submit(f.mutation("tutor", f.context.handle), f.child, write) : operation === "delete" ? f.serviceA.remove(f.mutation(), f.selected, write) : f.serviceA.submit(f.mutation(), f.selected, write));
    await f.waitForLock(f.pidA, ownerPid);
    const mock = vi.spyOn(Date, "now").mockReturnValue(operation === "context" ? Date.parse(f.context.context.expiresAt) + 1 : expires + 1); restore = () => mock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, result]); restore?.(); }
  expect(await result).toEqual({ denied: operation === "context" ? 404 : 401 });
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: operation === "no-op" ? "submitted" : "private", revision: operation === "no-op" ? 2 : 1 }]);
  expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
});

for (const operation of ["register", "submit"] as const) test(`anniversary crossing during an actual audit-table wait rolls back ${operation} and its audit`, async () => {
  const f = await fixture(), date = "2025-03-01", beforeDeadline = Date.parse("2026-03-01T05:59:59Z");
  await f.ownerDb.update(s.student).set({ ceremonyDate: date }).where(eq(s.student.id, f.student.id)); f.clock(beforeDeadline);
  const existing = operation === "submit" ? await recording(f) : null, before = await f.ownerDb.select().from(s.auditEvent);
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table audit_event in share mode`); entered.resolve(); await release.promise; }));
  let result: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); result = safe(operation === "register" ? f.registrarA.register(f.mutation(), f.selected, descriptor()) : f.serviceA.submit(f.mutation(), f.selected, { recordingId: existing!.id, expectedRevision: 1 })); await f.waitForLock(f.pidA, ownerPid); f.clock(beforeDeadline + 1000); }
  finally { release.resolve(); await Promise.all([hold, result]); }
  expect(await result).toEqual({ denied: 404 }); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject(existing ? [{ id: existing.id, state: "private", revision: 1 }] : []);
});

test("native restricted SQL preserves private insertion, tenant FK/RLS, immutability and irreversible lifecycle", async () => {
  const f = await fixture(), { id } = await recording(f), [row] = await f.ownerDb.select().from(s.studentRecording);
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.studentRecording))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID() })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), studentId: f.otherStudent.id })))).toBe("23503");
  for (const patch of [{ state: "submitted", revision: 2, submittedAt: new Date() }, { state: "deleting", revision: 2, deletionRequestedAt: new Date() }]) expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), ...patch })))).toBe("23514");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.delete(s.studentRecording)))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ contentSha256: "f".repeat(64) })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ revision: 2 })))).toBe("23514");
  await f.serviceA.remove(f.mutation(), f.selected, { recordingId: id, expectedRevision: 1 });
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.studentRecording).set({ state: "private", revision: 1, deletionRequestedAt: null })))).toBe("23514");
});

test("native old-expired ceremony postponement irreversibly deletes submitted heads atomically without inventing recording audits", async () => {
  const f = await fixture(); await f.ownerDb.update(s.student).set({ ceremonyDate: "2000-01-01" }).where(eq(s.student.id, f.student.id)); f.clock(Date.parse("2000-01-01T12:00:00Z"));
  const { id } = await recording(f, true), audits = await f.ownerDb.select().from(s.auditEvent);
  await expect(f.ownerDb.transaction(async tx => { await tx.update(s.student).set({ ceremonyDate: "2099-01-01" }).where(eq(s.student.id, f.student.id)); throw new Error("Synthetic rollback"); })).rejects.toThrow("Synthetic rollback");
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "submitted", revision: 2 }]);
  await f.ownerDb.update(s.student).set({ ceremonyDate: "2099-01-01" }).where(eq(s.student.id, f.student.id));
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "deleting", revision: 3 }]);
  await f.ownerDb.update(s.student).set({ ceremonyDate: "2100-01-01" }).where(eq(s.student.id, f.student.id));
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "deleting", revision: 3 }]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(audits);
});

for (const mode of ["student", "child-practice"] as const) test(`private metadata expiry after an observed row wait hides the ${mode} ${mode === "student" ? "page" : "cursor"}`, async () => {
  const f = await fixture(), deadline = Date.parse("2026-03-01T06:00:00Z");
  await f.ownerDb.update(s.student).set({ ceremonyDate: "2025-03-01" }).where(eq(s.student.id, f.student.id)); f.clock(deadline - 1);
  const { id } = await recording(f), audits = await f.ownerDb.select().from(s.auditEvent);
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from student_recording where id=${id} for update`); entered.resolve(); await release.promise; }));
  let result: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, hold);
    result = safe(f.serviceA.page(mode === "student" ? f.mutation() : f.mutation("tutor", f.context.handle), mode === "student" ? f.selected : f.child, mode === "student" ? undefined : id));
    await f.waitForLock(f.pidA, ownerPid); f.clock(deadline);
  } finally { release.resolve(); await Promise.all([hold, result]); }
  expect(await result).toMatchObject(mode === "student" ? { ok: true, entries: [], nextCursor: null } : { denied: 404 });
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "private", revision: 1, submittedAt: null }]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(audits);
  expect(await f.serviceA.remove(f.mutation(), f.selected, { recordingId: id, expectedRevision: 1 })).toMatchObject({ ok: true, recording: { state: "deleting", revision: 2 } });
});

for (const expired of ["old", "new"] as const) test(`restricted ceremony edit with ${expired} expired date irreversibly stages private recordings with rollback and NULL submission`, async () => {
  const f = await fixture(), initial = expired === "old" ? "2000-01-01" : "2099-01-01", replacement = expired === "old" ? "2099-01-01" : "2000-01-01";
  await f.ownerDb.update(s.student).set({ ceremonyDate: initial }).where(eq(s.student.id, f.student.id)); f.clock(expired === "old" ? Date.parse("2000-01-01T12:00:00Z") : Date.now());
  const { id } = await recording(f), audits = await f.ownerDb.select().from(s.auditEvent);
  await expect(withTenantTransaction(f.aDb, { tenantId: "crc" }, async tx => { await tx.update(s.student).set({ ceremonyDate: replacement }).where(eq(s.student.id, f.student.id)); throw new Error("Synthetic private rollback"); })).rejects.toThrow("Synthetic private rollback");
  expect(await f.ownerDb.select().from(s.student).where(eq(s.student.id, f.student.id))).toMatchObject([{ ceremonyDate: initial }]);
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "private", revision: 1, submittedAt: null, deletionRequestedAt: null }]);
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.student).set({ ceremonyDate: replacement }).where(eq(s.student.id, f.student.id)));
  const rows = await f.ownerDb.select().from(s.studentRecording); expect(rows).toMatchObject([{ id, state: "deleting", revision: 2, submittedAt: null, deletionRequestedAt: expect.any(Date) }]);
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.student).set({ ceremonyDate: "2100-01-01" }).where(eq(s.student.id, f.student.id)));
  expect(await f.ownerDb.select().from(s.studentRecording)).toEqual(rows); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(audits);
  expect(await f.registrarA.register(f.mutation(), f.selected, { ...descriptor(), assetId: rows[0].assetId, contentSha256: rows[0].contentSha256, media: { mediaType: "audio/webm;codecs=opus", byteLength: rows[0].byteLength, durationMs: rows[0].durationMs } })).toEqual(conflict);
});
