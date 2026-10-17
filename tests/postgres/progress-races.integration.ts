import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createProgressService } from "../../src/server/progress/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentService } from "../../src/server/students/service";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";
import { withTenantTransaction } from "../../src/server/db/runtime";

type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
function safe<T>(operation: PromiseLike<T>) { return Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 })); }
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; current && depth < 4; depth++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  await f.ownerDb.update(s.student).set({ serviceSlot: "morning" });
  const [assignment] = await f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: member.id }).returning();
  await f.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
  const practiceA = createPracticeService({ access: f.a }), practiceB = createPracticeService({ access: f.b });
  const progressA = createProgressService({ access: f.a, practice: practiceA }), progressB = createProgressService({ access: f.b, practice: practiceB });
  const selection = { mode: "tutor" as const, studentId: f.student.id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1 };
  const request = (who: "admin" | "tutor" = "tutor", handle?: string) => { const value = f.request(who); value.headers.set("origin", "http://localhost:3000"); if (handle) value.headers.set("X-Practice-Context", handle); return { ...value, method: "POST" }; };
  const studentB = createStudentService({ access: f.b, signingSecret: "synthetic-independent-progress-reading-secret", loadReading: async (date, calendar) => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar, reading: null, haftarah: null, classification: "missing" } }) });
  async function reviewReplacement() { const review = await studentB.prepareReading(request(), { mode: "tutor", studentId: f.student.id, ranges: ["Genesis 1:2-4"] }); if (review.status !== "prepared") throw new Error("Expected synthetic replacement review"); return review; }
  return { ...f, assignment, progressA, progressB, practiceA, practiceB, selection, requestProgress: request, studentB, reviewReplacement };
}
const mark = (state: "not-started" | "working" | "solid", expectedVersion = 0) => ({ verseRef: "Genesis 1:1", state, expectedVersion });
const self = (state: "unmarked" | "working" | "got-it", expectedVersion = 0) => ({ verseRef: "Genesis 1:1", state, expectedVersion });

test("real unique-key and existing-row contention produce one stream CAS winner without same-state stale acknowledgement", async () => {
  const f = await fixture();
  for (const phase of ["create", "update"] as const) {
    const entered = deferred(), release = deferred(), prefix = phase === "create" ? 'insert into "verse_assessment"' : 'update "verse_assessment"';
    const stop = await f.intercept("a", text => text.startsWith(prefix), async proceed => { const value = await proceed(); entered.resolve(); await release.promise; return value; });
    const a = safe(f.progressA.setAssessment(f.requestProgress(), f.selection, mark(phase === "create" ? "solid" : "working", phase === "create" ? 0 : 1)));
    let b: Promise<unknown> | undefined;
    try { await waitForEntry(entered.promise, a); b = safe(f.progressB.setAssessment(f.requestProgress(), f.selection, mark(phase === "create" ? "solid" : "not-started", phase === "create" ? 0 : 1))); await f.waitForLock(f.pidB, f.pidA); }
    finally { release.resolve(); stop(); await Promise.all([a, b]); }
    expect(await a).toMatchObject({ ok: true, version: phase === "create" ? 1 : 2 }); expect(await b).toEqual({ ok: false, code: "conflict" });
  }
  expect(await f.ownerDb.select().from(s.verseAssessment)).toMatchObject([{ state: "working", version: 2 }]);
  expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action, "progress.assessment.set"))).toHaveLength(2);
});

test("independent stream writes finish while the other stream is held, and a page uses one coherent head snapshot for rows and counts", async () => {
  const f = await fixture(), child = await f.practiceA.enter(f.requestProgress(), { studentId: f.student.id }), childSelection = { ...f.selection, mode: "child-practice" as const };
  const inserted = deferred(), releaseInsert = deferred(), stopInsert = await f.intercept("a", text => text.startsWith('insert into "verse_assessment"'), async proceed => { const result = await proceed(); inserted.resolve(); await releaseInsert.promise; return result; });
  const a = safe(f.progressA.setAssessment(f.requestProgress(), f.selection, mark("solid"))); let b: Promise<unknown> | undefined;
  try { await waitForEntry(inserted.promise, a); b = safe(f.progressB.setSelfCheck(f.requestProgress("tutor", child.handle), childSelection, self("working"))); expect(await b).toMatchObject({ ok: true, version: 1 }); }
  finally { releaseInsert.resolve(); stopInsert(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true, version: 1 });
  const fetched = deferred(), releaseSnapshot = deferred();
  const stopSnapshot = await f.intercept("a", text => text.includes('from "assignment_verse"') && text.includes('"verse_self_check"') && text.includes('"verse_assessment"'), async proceed => { const result = await proceed(); fetched.resolve(); await releaseSnapshot.promise; return result; });
  const page = safe(f.progressA.page(f.requestProgress(), f.selection)); let changed: Promise<unknown> | undefined;
  try { await waitForEntry(fetched.promise, page); changed = safe(f.progressB.setSelfCheck(f.requestProgress("tutor", child.handle), childSelection, self("got-it", 1))); expect(await changed).toMatchObject({ ok: true, version: 2 }); }
  finally { releaseSnapshot.resolve(); stopSnapshot(); await Promise.all([page, changed]); }
  expect(await page).toMatchObject({ ok: true, verses: expect.arrayContaining([{ verseRef: "Genesis 1:1", selfCheck: { state: "working", version: 1 }, assessment: { state: "solid", version: 1 } }]), counts: { selfCheck: { unmarked: 2, working: 1, "got-it": 0 }, assessment: { "not-started": 2, working: 0, solid: 1 } } });
  expect(await f.progressA.page(f.requestProgress(), f.selection)).toMatchObject({ ok: true, counts: { selfCheck: { unmarked: 2, working: 0, "got-it": 1 } } });
});

for (const order of ["progress-first", "confirmation-first"] as const) test(`actual assignment locks serialize removal and progress ${order}`, async () => {
  const f = await fixture(), review = await f.reviewReplacement(), entered = deferred(), release = deferred();
  const confirm = () => f.studentB.confirmReading(f.requestProgress(), { mode: "tutor", studentId: f.student.id, binding: review.binding });
  const stop = await f.intercept(order === "progress-first" ? "a" : "b", text => text.startsWith(order === "progress-first" ? 'insert into "verse_assessment"' : 'update "assignment"'), async proceed => { const value = await proceed(); entered.resolve(); await release.promise; return value; });
  const first = order === "progress-first" ? safe(f.progressA.setAssessment(f.requestProgress(), f.selection, mark("solid"))) : safe(confirm());
  let second: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, first); second = order === "progress-first" ? safe(confirm()) : safe(f.progressA.setAssessment(f.requestProgress(), f.selection, mark("solid"))); await f.waitForLock(order === "progress-first" ? f.pidB : f.pidA, order === "progress-first" ? f.pidA : f.pidB); }
  finally { release.resolve(); stop(); await Promise.all([first, second]); }
  expect(order === "progress-first" ? await first : await second).toMatchObject(order === "progress-first" ? { ok: true, state: "solid", version: 1 } : { ok: false, code: "stale-assignment" });
  expect(order === "progress-first" ? await second : await first).toMatchObject({ ok: true, revision: 2 });
  expect(await f.ownerDb.select().from(s.verseAssessment)).toHaveLength(0);
  expect(await f.progressA.page(f.requestProgress(), { ...f.selection, assignmentRevision: 2 })).toMatchObject({ ok: true, counts: { assessment: { "not-started": 3, working: 0, solid: 0 } } });
});

for (const stale of [false, true]) test(`session expiry beats ${stale ? "stale-assignment" : "write"} after a real assignment lock wait`, async () => {
  const f = await fixture(), expiresAt = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.tutor.sessionId));
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from assignment where id=${f.assignment.id} for update`); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.progressA.setAssessment(f.requestProgress(), { ...f.selection, assignmentRevision: stale ? 2 : 1 }, mark("solid"))); await f.waitForLock(f.pidA, ownerPid); const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore(); }
  finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 401 }); expect(await f.ownerDb.select().from(s.verseAssessment)).toHaveLength(0);
});

for (const expectedVersion of [0, 1]) test(`child-context expiry beats ${expectedVersion === 1 ? "same-state no-op" : "CAS conflict"} after its real head lock wait`, async () => {
  const f = await fixture(), child = await f.practiceA.enter(f.requestProgress(), { studentId: f.student.id }), selection = { ...f.selection, mode: "child-practice" as const };
  await f.progressA.setSelfCheck(f.requestProgress("tutor", child.handle), selection, self("got-it"));
  const before = await f.ownerDb.select().from(s.auditEvent), expiresAt = Date.now() + 60_000;
  // Fixture-only recreation preserves immutable context identity and handle;
  // the application's immutable expiry column is never updated.
  const [context] = await f.ownerDb.select().from(s.practiceContext).where(eq(s.practiceContext.id, child.context.id));
  await f.ownerDb.delete(s.practiceContext).where(eq(s.practiceContext.id, context.id));
  await f.ownerDb.insert(s.practiceContext).values({ ...context, expiresAt: new Date(expiresAt) });
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from verse_self_check where assignment_id=${f.assignment.id} for update`); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.progressA.setSelfCheck(f.requestProgress("tutor", child.handle), selection, self("got-it", expectedVersion))); await f.waitForLock(f.pidA, ownerPid); const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore(); }
  finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 404 }); expect(await f.ownerDb.select().from(s.verseSelfCheck)).toMatchObject([{ state: "got-it", version: 1 }]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
});

test("expiry after actual uniqueness contention rejects a stale same-state result while preserving the other authorized winner", async () => {
  const f = await fixture(), expiresAt = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.tutor.sessionId));
  const entered = deferred(), release = deferred(), stop = await f.intercept("a", text => text.startsWith('insert into "verse_assessment"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.progressA.setAssessment(f.requestProgress("admin"), { ...f.selection, mode: "admin" }, mark("solid"))); let b: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try { await waitForEntry(entered.promise, a); b = safe(f.progressB.setAssessment(f.requestProgress(), f.selection, mark("solid"))); await f.waitForLock(f.pidB, f.pidA); const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore(); }
  finally { release.resolve(); stop(); await Promise.all([a, b]); restore?.(); }
  expect(await a).toMatchObject({ ok: true, state: "solid", version: 1 }); expect(await b).toEqual({ denied: 401 });
  expect(await f.ownerDb.select().from(s.verseAssessment)).toMatchObject([{ state: "solid", version: 1 }]);
});

test("a completed context switch and tutor-link revocation win over later progress calls even when the requested state already matches", async () => {
  const f = await fixture(), delegated = await f.practice(), child = await f.practiceA.enter(f.requestProgress(), { studentId: f.student.id }), selection = { ...f.selection, mode: "child-practice" as const };
  await f.progressA.setSelfCheck(f.requestProgress("tutor", child.handle), selection, self("got-it"));
  await f.progressA.setAssessment(f.requestProgress(), f.selection, mark("solid"));
  await f.practiceB.switch(f.requestProgress("tutor", child.handle), { studentId: delegated.sibling.id });
  expect(await safe(f.progressA.setSelfCheck(f.requestProgress("tutor", child.handle), selection, self("got-it", 1)))).toEqual({ denied: 404 });
  await f.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id));
  expect(await safe(f.progressB.setAssessment(f.requestProgress(), f.selection, mark("solid", 1)))).toEqual({ denied: 404 });
  expect(await f.ownerDb.select().from(s.verseSelfCheck)).toMatchObject([{ version: 1 }]); expect(await f.ownerDb.select().from(s.verseAssessment)).toMatchObject([{ version: 1 }]);
});

test("real restricted SQL enforces tenant visibility, tenant-qualified FKs, state constraints, immutable identity and monotonic versions", async () => {
  const f = await fixture(); await f.progressA.setAssessment(f.requestProgress(), f.selection, mark("solid"));
  const scope = { tenantId: "crc" }, other = { tenantId: "other" };
  expect(await f.bDb.select().from(s.verseAssessment)).toHaveLength(0);
  expect(await withTenantTransaction(f.bDb, other, tx => tx.select().from(s.verseAssessment))).toHaveLength(0);
  const key = { tenantId: "crc", studentId: f.student.id, assignmentId: f.assignment.id, verseRef: "Genesis 1:2", state: "solid", version: 1 };
  expect(await sqlState(withTenantTransaction(f.bDb, other, tx => tx.insert(s.verseAssessment).values(key)))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.bDb, other, tx => tx.insert(s.verseAssessment).values({ ...key, tenantId: "other", studentId: f.otherStudent.id })))).toBe("23503");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.insert(s.verseSelfCheck).values(key)))).toBe("23514");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.update(s.verseAssessment).set({ verseRef: "Genesis 1:2", version: 2 })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.update(s.verseAssessment).set({ state: "working", version: 3 })))).not.toBe("accepted");
  expect(await f.ownerDb.select().from(s.verseAssessment)).toMatchObject([{ verseRef: "Genesis 1:1", state: "solid", version: 1 }]);
  const security = await query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(f.owner, "select relrowsecurity,relforcerowsecurity from pg_class where oid in ('verse_self_check'::regclass,'verse_assessment'::regclass)");
  expect(security.rows).toHaveLength(2); expect(security.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
});
