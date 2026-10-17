import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createLessonLogService } from "../../src/server/lesson-log/service";
import { createPracticeService } from "../../src/server/practice/service";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
function safe(operation: PromiseLike<unknown>) { return Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 })); }
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; current && depth < 4; depth++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const practiceA = createPracticeService({ access: f.a }), practiceB = createPracticeService({ access: f.b });
  const lessonA = createLessonLogService({ access: f.a, practice: practiceA }), lessonB = createLessonLogService({ access: f.b, practice: practiceB });
  const selection = { mode: "tutor" as const, studentId: f.student.id };
  const request = (who: "admin" | "tutor" = "tutor", handle?: string) => { const value = f.request(who); value.headers.set("origin", "http://localhost:3000"); if (handle) value.headers.set("X-Practice-Context", handle); return { ...value, method: "POST" }; };
  return { ...f, practiceA, practiceB, lessonA, lessonB, selection, mutation: request };
}
const input = (entryId = randomUUID(), summary = "Synthetic original lesson") => ({ entryId, lessonDate: "2026-10-16", summary });
const conflict = { ok: false, code: "conflict" };

for (const contender of ["identical", "different-content", "different-creator"] as const) test(`actual unique-key wait permits only an exact original v1 create replay: ${contender}`, async () => {
  const f = await fixture(), value = input(), before = await f.ownerDb.select().from(s.auditEvent);
  const entered = deferred(), release = deferred(), stop = await f.intercept("a", text => text.startsWith('insert into "lesson_log"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.lessonA.create(f.mutation(), f.selection, value)); let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.lessonB.create(f.mutation(contender === "different-creator" ? "admin" : "tutor"), contender === "different-creator" ? { ...f.selection, mode: "admin" } : f.selection, contender === "different-content" ? { ...value, summary: "Synthetic conflicting lesson" } : value));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true, entry: { ...value, version: 1 } });
  expect(await b).toMatchObject(contender === "identical" ? { ok: true, entry: { ...value, version: 1 } } : conflict);
  expect(await f.ownerDb.select().from(s.lessonLog)).toMatchObject([{ ...value, version: 1, deleted: false }]);
  expect((await f.ownerDb.select().from(s.auditEvent)).length - before.length).toBe(1);
});

for (const actions of ["edit-edit", "edit-delete", "delete-edit"] as const) test(`a real entry lock serializes CAS without stale acknowledgement: ${actions}`, async () => {
  const f = await fixture(), value = input(); await f.lessonA.create(f.mutation(), f.selection, value);
  const entered = deferred(), release = deferred(), stop = await f.intercept("a", text => text.startsWith('update "lesson_log"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(actions === "delete-edit" ? f.lessonA.remove(f.mutation(), f.selection, { entryId: value.entryId, expectedVersion: 1 }) : f.lessonA.edit(f.mutation(), f.selection, { ...value, summary: "Synthetic winning correction", expectedVersion: 1 })); let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(actions === "edit-delete" ? f.lessonB.remove(f.mutation(), f.selection, { entryId: value.entryId, expectedVersion: 1 }) : f.lessonB.edit(f.mutation(), f.selection, { ...value, summary: "Synthetic stale correction", expectedVersion: 1 }));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject(actions === "delete-edit" ? { ok: true, version: 2 } : { ok: true, entry: { version: 2 } }); expect(await b).toEqual(conflict);
  expect(await f.ownerDb.select().from(s.lessonLog)).toMatchObject([{ version: 2, summary: actions === "delete-edit" ? "" : "Synthetic winning correction", deleted: actions === "delete-edit" }]);
});

for (const outcome of ["edit", "no-op", "stale", "delete", "other-author"] as const) test(`session expiry after a measured entry-row wait beats ${outcome} and leaves head/audit unchanged`, async () => {
  const f = await fixture(), value = input(), creator = outcome === "other-author" ? "admin" : "tutor";
  await f.lessonA.create(f.mutation(creator), creator === "admin" ? { ...f.selection, mode: "admin" } : f.selection, value);
  const before = await f.ownerDb.select().from(s.auditEvent), expiresAt = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.tutor.sessionId));
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select entry_id from lesson_log where entry_id=${value.entryId} for update`); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold);
    operation = safe(outcome === "delete" ? f.lessonA.remove(f.mutation(), f.selection, { entryId: value.entryId, expectedVersion: 1 }) : f.lessonA.edit(f.mutation(), f.selection, { ...value, summary: outcome === "no-op" ? value.summary : "Synthetic expired correction", expectedVersion: outcome === "stale" ? 2 : 1 }));
    await f.waitForLock(f.pidA, ownerPid); const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 401 });
  expect(await f.ownerDb.select().from(s.lessonLog)).toMatchObject([{ ...value, version: 1, deleted: false }]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
});

test("session expiry after actual uniqueness contention overrides another-creator conflict without rolling back the valid winner", async () => {
  const f = await fixture(), value = input(), expiresAt = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.tutor.sessionId));
  const entered = deferred(), release = deferred(), stop = await f.intercept("a", text => text.startsWith('insert into "lesson_log"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.lessonA.create(f.mutation("admin"), { ...f.selection, mode: "admin" }, value)); let b: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, a); b = safe(f.lessonB.create(f.mutation(), f.selection, value)); await f.waitForLock(f.pidB, f.pidA);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore();
  } finally { release.resolve(); stop(); await Promise.all([a, b]); restore?.(); }
  expect(await a).toMatchObject({ ok: true, entry: { version: 1 } }); expect(await b).toEqual({ denied: 401 });
  expect(await f.ownerDb.select().from(s.lessonLog)).toMatchObject([{ ...value, version: 1 }]);
});

test("expiry while a real audit-table lock blocks a new mutation rolls back both the inserted lesson and its audit", async () => {
  const f = await fixture(), value = input(), expiresAt = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.tutor.sessionId));
  const before = await f.ownerDb.select().from(s.auditEvent), ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table audit_event in share mode`); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold); operation = safe(f.lessonA.create(f.mutation(), f.selection, value)); await f.waitForLock(f.pidA, ownerPid);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 401 }); expect(await f.ownerDb.select().from(s.lessonLog)).toHaveLength(0); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
});

test("committing revocation ahead of a measured relationship-lock waiter denies a new lesson rather than using pre-wait access", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id)); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.lessonA.create(f.mutation(), f.selection, input())); await f.waitForLock(f.pidA, ownerPid); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ denied: 404 }); expect(await f.ownerDb.select().from(s.lessonLog)).toHaveLength(0);
});

test("an exact child-context read expires during an actual table wait without returning its private lesson DTO", async () => {
  const f = await fixture(), value = input(); await f.lessonA.create(f.mutation(), f.selection, value);
  const child = await f.practiceA.enter(f.mutation(), { studentId: f.student.id }), expiresAt = Date.now() + 60_000;
  // Owner-only fixture recreation preserves the context token/identity while
  // giving it a short expiry; no application expiry mutation is introduced.
  const [context] = await f.ownerDb.select().from(s.practiceContext).where(eq(s.practiceContext.id, child.context.id));
  await f.ownerDb.delete(s.practiceContext).where(eq(s.practiceContext.id, context.id)); await f.ownerDb.insert(s.practiceContext).values({ ...context, expiresAt: new Date(expiresAt) });
  const entered = deferred(), release = deferred(), ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table lesson_log in access exclusive mode`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold); operation = safe(f.lessonA.page(f.mutation("tutor", child.handle), { ...f.selection, mode: "child-practice" })); await f.waitForLock(f.pidA, ownerPid);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 404 }); expect(await f.ownerDb.select().from(s.lessonLog)).toMatchObject([{ ...value, version: 1 }]);
});

test("a real context switch committed ahead of a blocked old-handle read cannot restore the old selected child's log", async () => {
  const f = await fixture(), delegated = await f.practice(), child = await f.practiceA.enter(f.mutation(), { studentId: f.student.id });
  await f.lessonA.create(f.mutation(), f.selection, input());
  const entered = deferred(), release = deferred(), stop = await f.intercept("b", text => text.startsWith('update "practice_context"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const switched = safe(f.practiceB.switch(f.mutation("tutor", child.handle), { studentId: delegated.sibling.id })); let read: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, switched); read = safe(f.lessonA.page(f.mutation("tutor", child.handle), { ...f.selection, mode: "child-practice" })); await f.waitForLock(f.pidA, f.pidB); }
  finally { release.resolve(); stop(); await Promise.all([switched, read]); }
  expect(await read).toEqual({ denied: 404 });
});

test("restricted real SQL preserves tenant FKs, identity, consecutive versions and irreversible text-clearing tombstones", async () => {
  const f = await fixture(), value = input(); await f.lessonA.create(f.mutation(), f.selection, value);
  const [row] = await f.ownerDb.select().from(s.lessonLog), scope = { tenantId: "crc" }, other = { tenantId: "other" };
  expect(await f.bDb.select().from(s.lessonLog)).toHaveLength(0); expect(await withTenantTransaction(f.bDb, other, tx => tx.select().from(s.lessonLog))).toHaveLength(0);
  const key = { ...row, entryId: randomUUID() };
  expect(await sqlState(withTenantTransaction(f.bDb, other, tx => tx.insert(s.lessonLog).values(key)))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.bDb, other, tx => tx.insert(s.lessonLog).values({ ...key, tenantId: "other", studentId: f.otherStudent.id })))).toBe("23503");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.insert(s.lessonLog).values({ ...key, creatorUserId: f.admin.id })))).toBe("23503");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.insert(s.lessonLog).values({ ...key, summary: "x".repeat(4097) })))).toBe("23514");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.update(s.lessonLog).set({ creatorUserId: f.admin.id, version: 2 })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.update(s.lessonLog).set({ summary: "Synthetic jump", version: 3 })))).not.toBe("accepted");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.delete(s.lessonLog)))).toBe("42501");
  await f.lessonA.remove(f.mutation(), f.selection, { entryId: value.entryId, expectedVersion: 1 });
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.update(s.lessonLog).set({ summary: "Synthetic resurrection", deleted: false, version: 3 })))).not.toBe("accepted");
  expect(await f.ownerDb.select().from(s.lessonLog)).toMatchObject([{ entryId: value.entryId, version: 2, summary: "", deleted: true }]);
  const security = await query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(f.owner, "select relrowsecurity,relforcerowsecurity from pg_class where oid='lesson_log'::regclass");
  expect(security.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
});
