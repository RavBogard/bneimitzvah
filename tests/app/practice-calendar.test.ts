import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createPracticeCalendarService } from "../../src/server/practice-calendar/service";
import { createPracticeCalendarMaintenance } from "../../src/server/practice-calendar/maintenance";
import { handlePracticeCalendarRequest } from "../../src/server/http/practice-calendar";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); opened.push(f); let now = Date.parse("2026-10-16T17:00:00.123Z");
  const runtime = { ...f.runtime, practiceCalendar: createPracticeCalendarService({ access: f.service, practice: f.runtime.practice, now: () => now }) };
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1", status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: 1, verseRef: "Genesis 1:1" }); return row;
  });
  const path = `/api/students/${f.students[0].id}`, target = { type: "verse", kind: "torah", assignmentId: assignment.id, assignmentRevision: 1, verseRef: "Genesis 1:1" } as const;
  const body = { mode: "student", eventId: randomUUID(), expectedDay: "2026-10-16", action: "visit", target };
  const call = (suffix: string, options: Parameters<typeof f.request>[1] = { who: "learner" }) => handlePracticeCalendarRequest(f.request(path + suffix, options), runtime);
  return { ...f, runtime, path, target, body, calendarCall: call, setNow: (value: string) => { now = Date.parse(value); } };
}
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("practice HTTP reads are write-free and private, reports acknowledge only a date and raw details remain own-student only", async () => {
  const f = await fixture(), dispatch = createHttpDispatcher(async action => action(f.runtime)), window = "fromDate=2026-10-01&throughDate=2026-10-31";
  const before = await f.owner(() => f.db.select().from(s.auditEvent));
  const empty = (await f.calendarCall(`/practice-calendar?mode=student&${window}`))!;
  expect(empty.status).toBe(200); expect(empty.headers.get("cache-control")).toBe("private, no-store"); expect(empty.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await empty.json()).toEqual({ ok: true, studentId: f.students[0].id, mode: "student", serverDay: "2026-10-16", dates: [] });
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(0);
  for (const action of ["visit", "play", "record"]) {
    const response = await dispatch(f.request(f.path + "/practice-events", { who: "learner", body: { ...f.body, action } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, practiceDay: "2026-10-16" });
  }
  const raw = (await f.calendarCall("/practice-events?mode=student"))!; const page = await raw.json();
  expect(page.events).toEqual([{ eventId: f.body.eventId, practiceDay: "2026-10-16", receivedAtISO: "2026-10-16T17:00:00.123Z", action: "visit", sourceMode: "student", target: f.target }]);
  expect(page.nextCursor).toBeNull(); expect(JSON.stringify(page)).not.toMatch(/email|membership|session|actor|context|count|duration|score/);
  for (const [who, mode] of [["multi", "parent"], ["multi", "tutor"], ["admin", "admin"]] as const) {
    const dates = (await f.calendarCall(`/practice-calendar?mode=${mode}&${window}`, { who }))!;
    expect(dates.status).toBe(200); expect((await dates.json()).dates).toEqual(["2026-10-16"]);
    expect((await f.calendarCall(`/practice-events?mode=${mode}`, { who }))!.status).toBe(403);
    expect((await f.calendarCall("/practice-events", { who, body: { ...f.body, mode } }))!.status).toBe(403);
  }
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
});

test("practice HTTP rejects provenance, stale bindings and malformed boundaries without new markers", async () => {
  const f = await fixture();
  for (const change of [{ actorId: "untrusted" }, { receivedAt: "2026-10-16T00:00:00Z" }, { duration: 3 }, { action: "upload" }, { expectedDay: "2026-02-30" }, { eventId: "untrusted" }, { target: { ...f.target, text: "Synthetic rejected text" } }]) expect((await f.calendarCall("/practice-events", { who: "learner", body: { ...f.body, ...change } }))!.status).toBe(400);
  for (const suffix of ["/practice-events?mode=student&mode=parent", "/practice-events?mode=student&beforeId=" + f.body.eventId, "/practice-events?mode=student&token=untrusted", "/practice-calendar?mode=student&fromDate=2024-01-01&throughDate=2025-01-01"]) expect((await f.calendarCall(suffix))!.status).toBe(400);
  expect((await f.calendarCall("/practice-events?mode=student", { who: "learner", body: f.body }))!.status).toBe(400);
  expect((await f.calendarCall("/practice-events", { who: "learner", body: f.body, headers: { origin: "https://foreign.example.test" } }))!.status).toBe(403);
  expect((await f.calendarCall("/practice-events", { who: "learner", body: f.body, headers: { "content-type": "text/plain" } }))!.status).toBe(415);
  for (const change of [{ expectedDay: "2026-10-15" }, { target: { ...f.target, assignmentRevision: 2 } }, { target: { ...f.target, verseRef: "Genesis 1:2" } }]) expect((await f.calendarCall("/practice-events", { who: "learner", body: { ...f.body, ...change } }))!.status).toBe(409);
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(0);
  let starts = 0; const dispatch = createHttpDispatcher(async () => { starts++; throw new Error("Synthetic private diagnostic"); });
  expect((await dispatch(new Request("http://localhost:3000" + f.path + "/practice-calendar", { method: "POST" }))).status).toBe(405); expect(starts).toBe(0);
  const failure = await dispatch(new Request("http://localhost:3000" + f.path + "/practice-calendar")); expect(failure.status).toBe(503); expect(await failure.json()).toEqual({ error: "unavailable" });
});

test("internal maintenance deletes only bounded expired detail, retains dates, and ceremony postponement cannot revive overdue history", async () => {
  const f = await fixture();
  await f.calendarCall("/practice-events", { who: "learner", body: f.body });
  f.setNow("2027-01-14T17:00:00.123Z");
  expect((await (await f.calendarCall("/practice-events?mode=student"))!.json()).events).toEqual([]);
  const maintenance = createPracticeCalendarMaintenance({ db: f.db, now: () => Date.parse("2027-01-14T17:00:00.123Z") });
  expect(await maintenance.run({ tenantId: "crc", studentIds: [f.students[0].id], limit: 1 })).toEqual({ more: false });
  expect(await f.owner(() => f.db.select().from(s.practiceEvent))).toHaveLength(0); expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(1);
  await expect(maintenance.run({ tenantId: "crc", studentIds: [f.students[0].id], limit: 1001 })).rejects.toThrow();
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2020-02-29" }).where(eq(s.student.id, f.students[0].id)));
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(0);
  // Represent old, unpurged history before postponement. OLD being overdue
  // must prune even though NEW is a valid far-future date.
  await f.owner(() => f.db.insert(s.practiceDay).values({ tenantId: "crc", studentId: f.students[0].id, practiceDay: "2026-10-16" }));
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "9999-12-31" }).where(eq(s.student.id, f.students[0].id)));
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(0);
});

test("practice SQL enforces tenant-qualified foreign keys, immutable days, closed targets and cursor-exact receipts", async () => {
  const f = await fixture();
  // Use actual restricted transactions; owner is only used to inspect metadata.
  const row = { tenantId: "crc", studentId: f.students[0].id, practiceDay: "2026-10-16" };
  await withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.practiceDay).values(row));
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.select().from(s.practiceDay))).toHaveLength(0);
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.insert(s.practiceDay).values(row)))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.practiceDay).values({ ...row, studentId: f.students[3].id })))).toBe("23503");
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.update(s.practiceDay).set({ practiceDay: "2026-10-17" })))).toBe("23514");
  const event = { ...row, eventId: randomUUID(), action: "visit" as const, sourceMode: "student" as const, receivedAt: new Date("2026-10-16T17:00:00.123Z"), target: f.target };
  for (const changed of [{ action: "upload" }, { sourceMode: "parent" }, { practiceDay: "2026-10-15" }, { target: { ...f.target, extra: "untrusted" } }, { target: { type: "service-unit", catalogId: randomUUID(), catalogIdentity: 1e63, planId: randomUUID(), planRevision: 1, unitId: "synthetic" } }]) expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.practiceEvent).values({ ...event, ...changed } as typeof event)))).toBe("23514");
  await withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.practiceEvent).values(event));
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.update(s.practiceEvent).set({ action: "play" })))).toBe("42501");
  const metadata = await f.owner(() => f.db.execute(sql`select relrowsecurity,relforcerowsecurity from pg_class where relname in ('practice_event','practice_day')`)); expect(metadata.rows).toHaveLength(2); expect(metadata.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  const stored = await f.owner(() => f.db.execute(sql`select received_at=date_trunc('milliseconds',received_at) as exact from practice_event`)); expect(stored.rows).toEqual([{ exact: true }]);
});
