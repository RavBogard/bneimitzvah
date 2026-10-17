import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { AccessDenied } from "../../src/server/access/errors";
import { createPracticeService } from "../../src/server/practice/service";
import { createPracticeCalendarService } from "../../src/server/practice-calendar/service";
import { createPracticeCalendarMaintenance } from "../../src/server/practice-calendar/maintenance";
import { withTenantTransaction } from "../../src/server/db/runtime";
import type { PracticeEventWrite, PracticeTarget } from "../../src/lib/practice-calendar/types";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";
import * as s from "../../src/server/db/index";

type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
function safe(operation: PromiseLike<unknown>) { return Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 })); }
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let i = 0; current && i < 4; i++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
const initial = Date.parse("2026-10-16T18:00:00.000Z"), age = 90 * 86_400_000;
const dayOf = (time: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time)).map(p => [p.type, p.value])); return `${parts.year}-${parts.month}-${parts.day}`;
};
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f); let time = initial;
  const learner = await f.signIn("pg-calendar-student");
  const [member] = await f.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
  const [adminMember] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  await f.ownerDb.update(s.student).set({ serviceSlot: "morning" });
  const [assignment] = await f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: adminMember.id }).returning();
  await f.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal, verseRef: `Genesis 1:${ordinal}` })));
  const practiceA = createPracticeService({ access: f.a }), practiceB = createPracticeService({ access: f.b });
  const calendarA = createPracticeCalendarService({ access: f.a, practice: practiceA, now: () => time }), calendarB = createPracticeCalendarService({ access: f.b, practice: practiceB, now: () => time });
  const maintenanceA = createPracticeCalendarMaintenance({ db: f.aDb, now: () => time });
  const selection = { mode: "student" as const, studentId: f.student.id }, target: PracticeTarget = { type: "verse", kind: "torah", assignmentId: assignment.id, assignmentRevision: 1, verseRef: "Genesis 1:1" };
  const request = (who: "learner" | "tutor" | "admin" = "learner", handle?: string) => ({ url: "http://localhost:3000/practice", method: "POST", headers: new Headers({ cookie: (who === "learner" ? learner : who === "tutor" ? f.tutor : f.admin).cookie, origin: "http://localhost:3000", ...(handle ? { "X-Practice-Context": handle } : {}) }) });
  const event = (eventId: string = randomUUID(), overrides: Partial<PracticeEventWrite> = {}): PracticeEventWrite => ({ eventId, expectedDay: dayOf(time), action: "visit", target, ...overrides });
  async function seed(rows: { eventId: string; receivedAt: number }[]) {
    await f.ownerDb.insert(s.practiceDay).values([...new Set(rows.map(row => dayOf(row.receivedAt)))].map(practiceDay => ({ tenantId: "crc", studentId: f.student.id, practiceDay }))).onConflictDoNothing();
    if (rows.length) await f.ownerDb.insert(s.practiceEvent).values(rows.map(row => ({ tenantId: "crc", studentId: f.student.id, practiceDay: dayOf(row.receivedAt), eventId: row.eventId, receivedAt: new Date(row.receivedAt), action: "visit" as const, sourceMode: "student" as const, target })));
  }
  async function unit() {
    const content = syntheticServiceCatalog(), catalogId = randomUUID();
    await f.ownerDb.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await f.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    const [plan] = await f.ownerDb.insert(s.studentServicePlan).values({ tenantId: "crc", studentId: f.student.id, catalogId, catalogIdentity: content.identity, selectedIds: [content.first, content.second], reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: adminMember.id }).returning();
    const target: PracticeTarget = { type: "service-unit", catalogId, catalogIdentity: content.identity, planId: plan.id, planRevision: 1, unitId: content.first };
    return { content, catalogId, plan, target };
  }
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  return { ...f, learner, adminMember, assignment, calendarA, calendarB, practiceA, practiceB, maintenanceA, selection, target, requestCalendar: request, event, seed, unit, ownerPid, setTime: (value: number) => { time = value; } };
}

test("real first-day uniqueness wait gives one immutable raw UUID report and identical acknowledgements to a different authorized writer/payload", async () => {
  const f = await fixture(), child = await f.practiceB.enter(f.requestCalendar("tutor"), { studentId: f.student.id }), value = f.event();
  const beforeAudit = await f.ownerDb.select().from(s.auditEvent), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "practice_day"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.calendarA.record(f.requestCalendar(), f.selection, value)); let b: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, a); b = safe(f.calendarB.record(f.requestCalendar("tutor", child.handle), { ...f.selection, mode: "child-practice" }, { ...value, action: "record", target: { ...f.target, verseRef: "Genesis 1:2" } })); await f.waitForLock(f.pidB, f.pidA); }
  finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toEqual({ ok: true, practiceDay: "2026-10-16" }); expect(await b).toEqual(await a);
  expect(await f.ownerDb.select().from(s.practiceEvent)).toMatchObject([{ eventId: value.eventId, action: "visit", sourceMode: "student", target: f.target }]);
  expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(beforeAudit);
});

test("actual daily-row serialization gives the 512th slot once while both competing writers receive the same dates-only acknowledgement", async () => {
  const f = await fixture(); await f.seed(Array.from({ length: 511 }, () => ({ eventId: randomUUID(), receivedAt: initial })));
  const child = await f.practiceB.enter(f.requestCalendar("tutor"), { studentId: f.student.id }), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "practice_event"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.calendarA.record(f.requestCalendar(), f.selection, f.event())); let b: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, a); b = safe(f.calendarB.record(f.requestCalendar("tutor", child.handle), { ...f.selection, mode: "child-practice" }, f.event())); await f.waitForLock(f.pidB, f.pidA); }
  finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toEqual({ ok: true, practiceDay: "2026-10-16" }); expect(await b).toEqual(await a);
  expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(512); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(1);
});

for (const path of ["below-cap", "at-cap", "mismatched-id"] as const) test(`session expiry after an actual day-row wait overrides the ${path} acknowledgement`, async () => {
  const f = await fixture(), value = f.event(); await f.seed(Array.from({ length: path === "at-cap" ? 512 : 1 }, (_, i) => ({ eventId: i === 0 ? value.eventId : randomUUID(), receivedAt: initial })));
  const expiresAt = Date.now() + 60_000; await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.learner.sessionId));
  const before = await f.ownerDb.select().from(s.practiceEvent), entered = deferred(), release = deferred();
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select practice_day from practice_day where student_id=${f.student.id} for update`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.record(f.requestCalendar(), f.selection, path === "mismatched-id" ? { ...value, action: "record" } : f.event())); await f.waitForLock(f.pidA, f.ownerPid);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 401 }); expect(await f.ownerDb.select().from(s.practiceEvent)).toEqual(before);
});

for (const fence of ["session", "midnight"] as const) test(`a real raw INSERT wait crossing ${fence} rolls back the provisional day and raw row together`, async () => {
  const f = await fixture(), expiresAt = Date.now() + 60_000; await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.learner.sessionId));
  f.setTime(Date.parse("2026-10-17T04:59:59.999Z")); const value = f.event();
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table practice_event in share mode`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.record(f.requestCalendar(), f.selection, value)); await f.waitForLock(f.pidA, f.ownerPid);
    if (fence === "midnight") f.setTime(Date.parse("2026-10-17T05:00:00.000Z")); else { const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore(); }
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual(fence === "midnight" ? { ok: false, code: "stale-day" } : { denied: 401 });
  expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(0); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(0);
});

test("a full day cannot acknowledge an old-day request after a measured daily lock wait crosses Chicago midnight", async () => {
  const f = await fixture(); await f.seed(Array.from({ length: 512 }, () => ({ eventId: randomUUID(), receivedAt: initial })));
  f.setTime(Date.parse("2026-10-17T04:59:59.999Z")); const value = f.event(), entered = deferred(), release = deferred();
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select practice_day from practice_day where student_id=${f.student.id} for update`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.record(f.requestCalendar(), f.selection, value)); await f.waitForLock(f.pidA, f.ownerPid); f.setTime(Date.parse("2026-10-17T05:00:00.000Z")); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ ok: false, code: "stale-day" }); expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(512);
});

test("overall anniversary expiry after a real daily lock wait wins over an otherwise valid day acknowledgement", async () => {
  const f = await fixture(); await f.ownerDb.update(s.student).set({ ceremonyDate: "2025-10-16" }).where(eq(s.student.id, f.student.id));
  const beforeMidnight = Date.parse("2026-10-16T04:59:59.999Z"); f.setTime(beforeMidnight); await f.seed([{ eventId: randomUUID(), receivedAt: beforeMidnight }]);
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select practice_day from practice_day where student_id=${f.student.id} for update`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.record(f.requestCalendar(), f.selection, f.event())); await f.waitForLock(f.pidA, f.ownerPid); f.setTime(Date.parse("2026-10-16T05:00:00.000Z")); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ ok: false, code: "retention-expired" }); expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(1);
});

test("a raw query blocked past its strict 90-day boundary filters the fetched report using response-time retention", async () => {
  const f = await fixture(); await f.seed([{ eventId: randomUUID(), receivedAt: initial - age + 1 }]);
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table practice_event in access exclusive mode`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.events(f.requestCalendar(), f.selection)); await f.waitForLock(f.pidA, f.ownerPid); f.setTime(initial + 2); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toMatchObject({ ok: true, events: [], nextCursor: null }); expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(1);
});

test("calendar rows fetched after an overall-cutoff table wait cannot reveal overdue days before physical maintenance", async () => {
  const f = await fixture(); await f.ownerDb.update(s.student).set({ ceremonyDate: "2025-10-16" }).where(eq(s.student.id, f.student.id));
  const before = Date.parse("2026-10-16T04:59:59.999Z"); f.setTime(before); await f.seed([{ eventId: randomUUID(), receivedAt: before }]);
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table practice_day in access exclusive mode`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.calendar(f.requestCalendar(), f.selection, { fromDate: "2026-10-01", throughDate: "2026-10-31" })); await f.waitForLock(f.pidA, f.ownerPid); f.setTime(Date.parse("2026-10-16T05:00:00.000Z")); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toMatchObject({ ok: true, dates: [], serverDay: "2026-10-16" }); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(1);
});

test("an assignment revision committed ahead of a real material lock waiter cannot acknowledge the old target", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id)); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.record(f.requestCalendar(), f.selection, f.event())); await f.waitForLock(f.pidA, f.ownerPid); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ ok: false, code: "stale-material" }); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(0);
});

for (const change of ["withdrawal", "plan-replacement"] as const) test(`a real ${change} lock wait revalidates service-unit eligibility before creating a date marker`, async () => {
  const f = await fixture(), unit = await f.unit(), entered = deferred(), release = deferred();
  const hold = safe(f.ownerDb.transaction(async tx => {
    if (change === "withdrawal") await tx.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }).where(eq(s.serviceCatalogLifecycle.catalogId, unit.catalogId));
    else await tx.update(s.studentServicePlan).set({ revision: 2, selectedIds: [unit.content.second] }).where(eq(s.studentServicePlan.id, unit.plan.id));
    entered.resolve(); await release.promise;
  })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.record(f.requestCalendar(), f.selection, f.event(undefined, { target: unit.target }))); await f.waitForLock(f.pidA, f.ownerPid); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ ok: false, code: "stale-material" }); expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(0); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(0);
});

test("child-calendar expiry during an actual table wait denies even the dates-only result", async () => {
  const f = await fixture(); await f.seed([{ eventId: randomUUID(), receivedAt: initial }]);
  const child = await f.practiceA.enter(f.requestCalendar("tutor"), { studentId: f.student.id }), expiresAt = Date.now() + 60_000;
  const [context] = await f.ownerDb.select().from(s.practiceContext).where(eq(s.practiceContext.id, child.context.id));
  // Fixture-only recreation gives the existing immutable identity a short
  // expiry; production code has no expiry-update path.
  await f.ownerDb.delete(s.practiceContext).where(eq(s.practiceContext.id, context.id)); await f.ownerDb.insert(s.practiceContext).values({ ...context, expiresAt: new Date(expiresAt) });
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table practice_day in access exclusive mode`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.calendar(f.requestCalendar("tutor", child.handle), { ...f.selection, mode: "child-practice" }, { fromDate: "2026-10-01", throughDate: "2026-10-31" })); await f.waitForLock(f.pidA, f.ownerPid);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 404 });
});

test("a committed context switch ahead of a blocked old-handle action cannot turn it into practice for either child", async () => {
  const f = await fixture(), delegated = await f.practice(), child = await f.practiceA.enter(f.requestCalendar("tutor"), { studentId: f.student.id }), entered = deferred(), release = deferred();
  const stop = await f.intercept("b", text => text.startsWith('update "practice_context"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const switched = safe(f.practiceB.switch(f.requestCalendar("tutor", child.handle), { studentId: delegated.sibling.id })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, switched); operation = safe(f.calendarA.record(f.requestCalendar("tutor", child.handle), { ...f.selection, mode: "child-practice" }, f.event())); await f.waitForLock(f.pidA, f.pidB); }
  finally { release.resolve(); stop(); await Promise.all([switched, operation]); }
  expect(await operation).toEqual({ denied: 404 }); expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(0); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(0);
});

test("student-identity revocation committed ahead of a measured capability waiter denies a new raw report and marker", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.studentId, f.student.id)); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.record(f.requestCalendar(), f.selection, f.event())); await f.waitForLock(f.pidA, f.ownerPid); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ denied: 404 }); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(0);
});

test("raw read session expiry after a real query table wait returns no previously eligible detail", async () => {
  const f = await fixture(); await f.seed([{ eventId: randomUUID(), receivedAt: initial }]);
  const expiresAt = Date.now() + 60_000; await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.learner.sessionId));
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table practice_event in access exclusive mode`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold); operation = safe(f.calendarA.events(f.requestCalendar(), f.selection)); await f.waitForLock(f.pidA, f.ownerPid);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ denied: 401 });
});

test("maintenance samples its trusted clock after the actual student UPDATE lock wait and preserves still-eligible date markers", async () => {
  const f = await fixture(); await f.seed([{ eventId: randomUUID(), receivedAt: initial - age + 1 }]);
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from student where id=${f.student.id} for update`); entered.resolve(); await release.promise; })); let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); operation = safe(f.maintenanceA.run({ tenantId: "crc", studentIds: [f.student.id], limit: 1 })); await f.waitForLock(f.pidA, f.ownerPid); f.setTime(initial + 2); }
  finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ more: false }); expect(await f.ownerDb.select().from(s.practiceEvent)).toHaveLength(0); expect(await f.ownerDb.select().from(s.practiceDay)).toHaveLength(1);
});

for (const direction of ["new-expired", "old-expired", "neither-expired"] as const) test(`restricted ceremony UPDATE trigger handles ${direction} without purging another tenant`, async () => {
  const f = await fixture();
  if (direction === "old-expired") await f.ownerDb.update(s.student).set({ ceremonyDate: "1900-01-01" }).where(eq(s.student.id, f.student.id));
  await f.seed([{ eventId: randomUUID(), receivedAt: initial }]);
  await f.ownerDb.insert(s.practiceDay).values({ tenantId: "other", studentId: f.otherStudent.id, practiceDay: "2026-10-16" });
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.update(s.student).set({ ceremonyDate: direction === "new-expired" ? "1900-01-01" : "9999-12-31" }).where(eq(s.student.id, f.student.id)));
  const own = await f.ownerDb.select().from(s.practiceEvent).where(eq(s.practiceEvent.studentId, f.student.id));
  expect(own).toHaveLength(direction === "neither-expired" ? 1 : 0);
  expect(await f.ownerDb.select().from(s.practiceDay).where(eq(s.practiceDay.studentId, f.student.id))).toHaveLength(direction === "neither-expired" ? 1 : 0);
  expect(await f.ownerDb.select().from(s.practiceDay).where(eq(s.practiceDay.studentId, f.otherStudent.id))).toHaveLength(1);
});

test("ceremony-trigger purge, roster date and audit all roll back together after the restricted transaction fails", async () => {
  const f = await fixture(); await f.seed([{ eventId: randomUUID(), receivedAt: initial }]);
  const [adminGrant] = await f.ownerDb.select().from(s.roleGrant).where(and(eq(s.roleGrant.membershipId, f.adminMember.id), eq(s.roleGrant.role, "admin")));
  const beforeRaw = await f.ownerDb.select().from(s.practiceEvent), beforeDays = await f.ownerDb.select().from(s.practiceDay), beforeAudit = await f.ownerDb.select().from(s.auditEvent); let observed = false;
  const operation = withTenantTransaction(f.aDb, { tenantId: "crc" }, async tx => {
    await tx.update(s.student).set({ ceremonyDate: "1900-01-01" }).where(eq(s.student.id, f.student.id));
    expect(await tx.select().from(s.practiceEvent)).toHaveLength(0); expect(await tx.select().from(s.practiceDay)).toHaveLength(0);
    await tx.insert(s.auditEvent).values({ tenantId: "crc", actorUserId: f.admin.id, actorMembershipId: f.adminMember.id, roleGrantId: adminGrant.id, mode: "admin", actingStudentId: f.student.id, action: "student.update", targetType: "student", targetId: f.student.id, requestId: randomUUID() });
    observed = true; throw new Error("Synthetic retention rollback");
  });
  expect(await safe(operation)).toEqual({ denied: 503 }); expect(observed).toBe(true);
  expect(await f.ownerDb.select().from(s.practiceEvent)).toEqual(beforeRaw); expect(await f.ownerDb.select().from(s.practiceDay)).toEqual(beforeDays); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(beforeAudit);
  expect(await f.ownerDb.select().from(s.student).where(eq(s.student.id, f.student.id))).toMatchObject([{ ceremonyDate: "2027-01-02" }]);
});

test("restricted SQL enforces tenant/day FKs, Chicago receipt consistency, closed targets, source modes and immutable report/day contents", async () => {
  const f = await fixture(); await f.calendarA.record(f.requestCalendar(), f.selection, f.event());
  const [row] = await f.ownerDb.select().from(s.practiceEvent), scope = { tenantId: "crc" }, other = { tenantId: "other" };
  expect(await f.bDb.select().from(s.practiceEvent)).toHaveLength(0); expect(await withTenantTransaction(f.bDb, other, tx => tx.select().from(s.practiceDay))).toHaveLength(0);
  const key = { ...row, eventId: randomUUID() };
  expect(await sqlState(withTenantTransaction(f.bDb, other, tx => tx.insert(s.practiceEvent).values(key)))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.bDb, other, tx => tx.insert(s.practiceDay).values({ tenantId: "other", studentId: f.student.id, practiceDay: row.practiceDay })))).toBe("23503");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.insert(s.practiceEvent).values({ ...key, practiceDay: "2026-10-15", receivedAt: new Date(initial - 86_400_000) })))).toBe("23503");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.insert(s.practiceEvent).values({ ...key, receivedAt: new Date(initial + 86_400_000) })))).toBe("23514");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.insert(s.practiceEvent).values({ ...key, target: { ...f.target, actor: "synthetic" } as unknown as PracticeTarget })))).toBe("23514");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.insert(s.practiceEvent).values({ ...key, sourceMode: "parent" as "student" })))).toBe("23514");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.update(s.practiceEvent).set({ action: "record" })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.bDb, scope, tx => tx.update(s.practiceDay).set({ practiceDay: "2026-10-17" })))).not.toBe("accepted");
  expect(await f.ownerDb.select().from(s.practiceEvent)).toEqual([row]);
  const security = await query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(f.owner, "select relrowsecurity,relforcerowsecurity from pg_class where oid in ('practice_day'::regclass,'practice_event'::regclass)");
  expect(security.rows).toHaveLength(2); expect(security.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
});

test("native SQL submillisecond receipts store cursor-exact precision and complete paging follows actual database ordering", async () => {
  const f = await fixture();
  await f.seed(Array.from({ length: 49 }, () => ({ eventId: randomUUID(), receivedAt: initial + 1000 })));
  const low = "30000000-0000-4000-8000-000000000001", high = "30000000-0000-4000-8000-000000000002";
  for (const [eventId, received] of [[low, "2026-10-16T18:00:00.123400Z"], [high, "2026-10-16T18:00:00.123300Z"]]) await query(f.owner, "insert into practice_event(tenant_id,student_id,practice_day,event_id,received_at,action,source_mode,target) values ('crc',$1,'2026-10-16',$2,$3,'visit','student',$4::jsonb)", [f.student.id, eventId, received, JSON.stringify(f.target)]);
  await f.seed([{ eventId: low, receivedAt: initial - 86_400_000 }, { eventId: randomUUID(), receivedAt: initial - 1 }]); f.setTime(initial + 1000);
  const precision = await query<{ exact: boolean }>(f.owner, "select bool_and(mod(extract(microseconds from received_at)::bigint,1000)=0) as exact from practice_event"); expect(precision.rows).toEqual([{ exact: true }]);
  const expected = await query<{ key: string }>(f.owner, "select practice_day::text||':'||event_id::text as key from practice_event order by received_at desc,event_id desc");
  const first = await f.calendarA.events(f.requestCalendar(), f.selection); expect(first.events).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
  const second = await f.calendarA.events(f.requestCalendar(), f.selection, first.nextCursor!);
  expect([...first.events, ...second.events].map(row => `${row.practiceDay}:${row.eventId}`)).toEqual(expected.rows.map(row => row.key)); expect(second.nextCursor).toBeNull();
});
