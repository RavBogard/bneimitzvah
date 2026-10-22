import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { createPracticeService } from "../../src/server/practice/service";
import { createPracticeCalendarService } from "../../src/server/practice-calendar/service";
import { createPracticeCalendarMaintenance } from "../../src/server/practice-calendar/maintenance";
import type { PracticeEventWrite, PracticeTarget } from "../../src/lib/practice-calendar/types";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
const instant = Date.parse("2026-10-16T18:00:00.000Z"), age = 90 * 24 * 60 * 60 * 1000;
const dayOf = (time: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
async function fixture() {
  const f = await accessFixture(); opened.push(f); let time = instant;
  const assignment = await f.owner(async () => {
    await f.db.update(s.student).set({ serviceSlot: "morning" });
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal, verseRef: `Genesis 1:${ordinal}` }))); return row;
  });
  const practice = createPracticeService({ access: f.service }), calendar = createPracticeCalendarService({ access: f.service, practice, now: () => time }), maintenance = createPracticeCalendarMaintenance({ db: f.db, now: () => time });
  const selection = { mode: "student" as const, studentId: f.students[0].id };
  const target: PracticeTarget = { type: "verse", kind: "torah", assignmentId: assignment.id, assignmentRevision: 1, verseRef: "Genesis 1:1" };
  const mutation = (who: "admin" | "multi" | "learner" = "learner", handle?: string) => ({ ...f.request(who, "http://localhost:3000", { origin: "http://localhost:3000", ...(handle ? { "X-Practice-Context": handle } : {}) }), method: "POST" });
  const event = (eventId: string = randomUUID(), overrides: Partial<PracticeEventWrite> = {}): PracticeEventWrite => ({ eventId, expectedDay: dayOf(time), action: "visit", target, ...overrides });
  async function seed(rows: { eventId: string; receivedAt: number }[]) {
    await f.owner(async () => {
      const dates = [...new Set(rows.map(row => dayOf(row.receivedAt)))];
      await f.db.insert(s.practiceDay).values(dates.map(practiceDay => ({ tenantId: "crc", studentId: selection.studentId, practiceDay }))).onConflictDoNothing();
      await f.db.insert(s.practiceEvent).values(rows.map(row => ({ tenantId: "crc", studentId: selection.studentId, practiceDay: dayOf(row.receivedAt), eventId: row.eventId, receivedAt: new Date(row.receivedAt), action: "visit" as const, sourceMode: "student" as const, target })));
    });
  }
  return { ...f, assignment, practice, calendar, maintenance, selection, target, mutation, event, seed, setTime: (value: number) => { time = value; } };
}

test("a tutor reads practice days only for an assigned, live student; revoked links, revoked grants, disabled members or students, and raw reports are refused", async () => {
  const f = await fixture(), window = { fromDate: "2026-10-01", throughDate: "2026-10-31" };
  expect(await f.calendar.record(f.mutation(), f.selection, f.event())).toEqual({ ok: true, practiceDay: "2026-10-16" });
  await f.owner(async () => { await f.db.insert(s.practiceDay).values({ tenantId: "crc", studentId: f.students[1].id, practiceDay: "2026-10-15" }); });
  const tutor = { ...f.selection, mode: "tutor" as const }, before = await f.owner(() => f.db.select().from(s.auditEvent));
  const days = await f.calendar.calendar(f.mutation("multi"), tutor, window);
  expect(days).toEqual({ ok: true, studentId: f.selection.studentId, mode: "tutor", serverDay: "2026-10-16", dates: ["2026-10-16"] });
  // Dates only: no event, count, time, target or actor in the tutor's page.
  expect(Object.keys(days).sort()).toEqual(["dates", "mode", "ok", "serverDay", "studentId"]);
  expect(JSON.stringify(days)).not.toMatch(/eventId|receivedAt|target|action|count|sourceMode|membership|identity/);
  // The same person is a parent of the sibling but not its tutor: the tutor mode cannot reach it, and another student's dates never mix in.
  await expect(f.calendar.calendar(f.mutation("multi"), { mode: "tutor", studentId: f.students[1].id }, window)).rejects.toMatchObject({ status: 404 });
  await expect(f.calendar.calendar(f.mutation("multi"), { mode: "tutor", studentId: f.students[2].id }, window)).rejects.toMatchObject({ status: 404 });
  await expect(f.calendar.calendar(f.mutation("multi"), { mode: "tutor", studentId: f.students[3].id }, window)).rejects.toMatchObject({ status: 404 });
  await expect(f.calendar.events(f.mutation("multi"), tutor)).rejects.toMatchObject({ status: 403 });
  await expect(f.calendar.record(f.mutation("multi"), tutor, f.event())).rejects.toMatchObject({ status: 403 });
  // An admin reads any student in the congregation, still dates only.
  expect(await f.calendar.calendar(f.mutation("admin"), { mode: "admin", studentId: f.students[1].id }, window)).toEqual({ ok: true, studentId: f.students[1].id, mode: "admin", serverDay: "2026-10-16", dates: ["2026-10-15"] });
  // A disabled student is unavailable to the tutor.
  await f.owner(async () => { await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.selection.studentId)); });
  await expect(f.calendar.calendar(f.mutation("multi"), tutor, window)).rejects.toMatchObject({ status: 404 });
  await f.owner(async () => { await f.db.update(s.student).set({ disabledAt: null }).where(eq(s.student.id, f.selection.studentId)); });
  expect(await f.calendar.calendar(f.mutation("multi"), tutor, window)).toMatchObject({ dates: ["2026-10-16"] });
  // A revoked tutor assignment ends access at once.
  await f.owner(async () => { await f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id)); });
  await expect(f.calendar.calendar(f.mutation("multi"), tutor, window)).rejects.toMatchObject({ status: 404 });
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
});

test("a revoked tutor grant or a disabled membership cannot read practice days", async () => {
  for (const change of ["grant", "member"] as const) {
    const f = await fixture(), window = { fromDate: "2026-10-01", throughDate: "2026-10-31" }, tutor = { ...f.selection, mode: "tutor" as const };
    await f.calendar.record(f.mutation(), f.selection, f.event());
    await f.owner(async () => {
      if (change === "grant") await f.db.update(s.roleGrant).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.roleGrant.id, f.tutorGrant.id));
      else await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.multiMember.id));
    });
    await expect(f.calendar.calendar(f.mutation("multi"), tutor, window)).rejects.toMatchObject({ status: 403 });
  }
});

test("only own student mode reads raw reports; overlapping staff/parent and exact child practice see dates and receive no actor/count/audit receipt", async () => {
  const f = await fixture(), child = await f.practice.enter(f.mutation("multi"), { studentId: f.selection.studentId }), before = await f.owner(() => f.db.select().from(s.auditEvent));
  expect(await f.calendar.record(f.mutation(), f.selection, f.event())).toEqual({ ok: true, practiceDay: "2026-10-16" });
  const childSelection = { ...f.selection, mode: "child-practice" as const };
  expect(await f.calendar.record(f.mutation("multi", child.handle), childSelection, f.event())).toEqual({ ok: true, practiceDay: "2026-10-16" });
  for (const [mode, who] of [["parent", "multi"], ["tutor", "multi"], ["admin", "admin"]] as const) {
    await expect(f.calendar.events(f.mutation(who), { ...f.selection, mode })).rejects.toMatchObject({ status: 403 });
    await expect(f.calendar.record(f.mutation(who), { ...f.selection, mode }, f.event())).rejects.toMatchObject({ status: 403 });
    const days = await f.calendar.calendar(f.mutation(who), { ...f.selection, mode }, { fromDate: "2026-10-01", throughDate: "2026-10-31" });
    expect(days).toEqual({ ok: true, studentId: f.selection.studentId, mode, serverDay: "2026-10-16", dates: ["2026-10-16"] });
  }
  await expect(f.calendar.events(f.mutation("multi", child.handle), childSelection)).rejects.toMatchObject({ status: 403 });
  expect(await f.calendar.calendar(f.mutation("multi", child.handle), childSelection, { fromDate: "2026-10-16", throughDate: "2026-10-16" })).toMatchObject({ dates: ["2026-10-16"] });
  const raw = await f.calendar.events(f.mutation(), f.selection);
  expect(raw.events).toHaveLength(2); expect(raw.events.map(row => row.sourceMode).sort()).toEqual(["child-practice", "student"]);
  for (const row of raw.events) expect(Object.keys(row).sort()).toEqual(["action", "eventId", "practiceDay", "receivedAtISO", "sourceMode", "target"]);
  for (const identity of [f.identities.learner.id, f.identities.multi.id, f.multiMember.id, child.context.id]) expect(JSON.stringify(raw)).not.toContain(identity);
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
  await f.practice.switch(f.mutation("multi", child.handle), { studentId: f.students[1].id });
  await expect(f.calendar.record(f.mutation("multi", child.handle), childSelection, f.event())).rejects.toMatchObject({ status: 404 });
  await expect(f.calendar.events(f.mutation(), { ...f.selection, studentId: f.students[1].id })).rejects.toMatchObject({ status: 404 });
});

test("511 to 512 detail rows saturates without a quota or UUID-existence flag, preserves first reports and still checks current material", async () => {
  const f = await fixture(); await f.seed(Array.from({ length: 511 }, () => ({ eventId: randomUUID(), receivedAt: instant })));
  const child = await f.practice.enter(f.mutation("multi"), { studentId: f.selection.studentId }), value = f.event(), ack = { ok: true, practiceDay: "2026-10-16" };
  const beforeAudit = await f.owner(() => f.db.select().from(s.auditEvent));
  expect(await f.calendar.record(f.mutation(), f.selection, value)).toEqual(ack);
  const before = await f.owner(() => f.db.select().from(s.practiceEvent)); expect(before).toHaveLength(512);
  const childSelection = { ...f.selection, mode: "child-practice" as const };
  expect(await f.calendar.record(f.mutation("multi", child.handle), childSelection, f.event())).toEqual(ack);
  expect(await f.calendar.record(f.mutation("multi", child.handle), childSelection, { ...value, action: "record", target: { ...f.target, verseRef: "Genesis 1:2" } } )).toEqual(ack);
  expect(await f.calendar.record(f.mutation(), f.selection, value)).toEqual(ack);
  expect(await f.owner(() => f.db.select().from(s.practiceEvent))).toEqual(before);
  expect(await f.calendar.record(f.mutation(), f.selection, { ...value, target: { ...f.target, assignmentRevision: 2 } })).toEqual({ ok: false, code: "stale-material" });
  expect(Object.keys((await f.owner(() => f.db.select().from(s.practiceDay)))[0]).sort()).toEqual(["practiceDay", "studentId", "tenantId"]);
  expect(Object.keys(before[0]).sort()).toEqual(["action", "eventId", "practiceDay", "receivedAt", "sourceMode", "studentId", "target", "tenantId"]);
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(beforeAudit);
});

test("old-day bodies stay stale after raw purge while the same UUID on a new current day is a new intent without a retained receipt", async () => {
  const f = await fixture(), value = f.event(); await f.calendar.record(f.mutation(), f.selection, value);
  const beforeAudit = await f.owner(() => f.db.select().from(s.auditEvent));
  f.setTime(instant + 91 * 86_400_000);
  expect(await f.maintenance.run({ tenantId: "crc", studentIds: [f.selection.studentId], limit: 1 })).toEqual({ more: false });
  expect(await f.owner(() => f.db.select().from(s.practiceEvent))).toHaveLength(0);
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(1);
  expect(await f.calendar.record(f.mutation(), f.selection, value)).toEqual({ ok: false, code: "stale-day" });
  const next = f.event(value.eventId); expect(await f.calendar.record(f.mutation(), f.selection, next)).toEqual({ ok: true, practiceDay: next.expectedDay });
  expect(await f.calendar.events(f.mutation(), f.selection)).toMatchObject({ events: [{ eventId: value.eventId, practiceDay: next.expectedDay }] });
  expect(await f.calendar.calendar(f.mutation(), f.selection, { fromDate: "2026-10-16", throughDate: next.expectedDay })).toMatchObject({ dates: ["2026-10-16", next.expectedDay] });
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(beforeAudit);
});

test("exact verse and selected service-unit bindings gate even day-only acknowledgements, and raw history never carries licensed material", async () => {
  const f = await fixture(), content = syntheticServiceCatalog(), catalogId = randomUUID();
  const plan = await f.owner(async () => {
    await f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    const [row] = await f.db.insert(s.studentServicePlan).values({ tenantId: "crc", studentId: f.selection.studentId, catalogId, catalogIdentity: content.identity, selectedIds: [content.first, content.second], reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: f.adminMember.id }).returning(); return row;
  });
  const target: PracticeTarget = { type: "service-unit", catalogId, catalogIdentity: content.identity, planId: plan.id, planRevision: 1, unitId: content.first };
  expect(await f.calendar.record(f.mutation(), f.selection, f.event(undefined, { target }))).toMatchObject({ ok: true });
  for (const changed of [{ ...target, unitId: content.hidden }, { ...target, planRevision: 2 }, { ...target, catalogIdentity: "a".repeat(64) }]) expect(await f.calendar.record(f.mutation(), f.selection, f.event(undefined, { target: changed }))).toEqual({ ok: false, code: "stale-material" });
  for (const changed of [{ ...f.target, verseRef: "Genesis 1:4" }, { ...f.target, assignmentId: randomUUID() }]) expect(await f.calendar.record(f.mutation(), f.selection, f.event(undefined, { target: changed }))).toEqual({ ok: false, code: "stale-material" });
  await f.owner(() => f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }).where(eq(s.serviceCatalogLifecycle.catalogId, catalogId)));
  expect(await f.calendar.record(f.mutation(), f.selection, f.event(undefined, { target }))).toEqual({ ok: false, code: "stale-material" });
  const raw = await f.calendar.events(f.mutation(), f.selection); expect(raw.events).toHaveLength(1); expect(raw.events[0].target).toEqual(target);
  for (const text of ["Synthetic CRC-only credit", "Synthetic translation", "sourceGitSha", "blocks", "http"]) expect(JSON.stringify(raw)).not.toContain(text);
});

test("receipt-time and UUID ties page exactly across millisecond boundaries and UUID reuse on another day without skipping reports", async () => {
  const f = await fixture(), ids = Array.from({ length: 55 }, (_, i) => `20000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`);
  await f.seed(ids.map((eventId, i) => ({ eventId, receivedAt: i === 0 ? instant - 1 : i === 54 ? instant + 1 : instant })));
  await f.seed([{ eventId: ids[54], receivedAt: instant - 86_400_000 }]); f.setTime(instant + 1);
  const first = await f.calendar.events(f.mutation(), f.selection); expect(first.events).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
  const second = await f.calendar.events(f.mutation(), f.selection, first.nextCursor!);
  const expected = [ids[54], ...ids.slice(1, 54).reverse(), ids[0], ids[54]];
  expect([...first.events, ...second.events].map(row => row.eventId)).toEqual(expected); expect(second.nextCursor).toBeNull();
  expect(first.events[0].receivedAtISO).toBe("2026-10-16T18:00:00.001Z");
  expect(second.events.at(-2)?.receivedAtISO).toBe("2026-10-16T17:59:59.999Z");
  expect(new Set([...first.events, ...second.events].map(row => `${row.practiceDay}:${row.eventId}`)).size).toBe(56);
});

test("raw 90-day equality is expired while dates survive; maintenance budget is total across rows and overall anniversary expires every view", async () => {
  const f = await fixture(), rows = [-1, 0, 1].map(delta => ({ eventId: randomUUID(), receivedAt: instant - age + delta })); await f.seed(rows);
  expect(await f.calendar.events(f.mutation(), f.selection)).toMatchObject({ events: [{ eventId: rows[2].eventId }] });
  expect(await f.maintenance.run({ tenantId: "crc", studentIds: [f.selection.studentId], limit: 1 })).toEqual({ more: true });
  expect(await f.owner(() => f.db.select().from(s.practiceEvent))).toHaveLength(2);
  expect(await f.maintenance.run({ tenantId: "crc", studentIds: [f.selection.studentId], limit: 1 })).toEqual({ more: false });
  expect(await f.owner(() => f.db.select().from(s.practiceEvent))).toHaveLength(1); expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(1);
  f.setTime(Date.parse("2028-01-02T06:00:00.000Z"));
  expect(await f.calendar.calendar(f.mutation(), f.selection, { fromDate: "2026-07-01", throughDate: "2026-07-31" })).toMatchObject({ dates: [] });
  expect(await f.calendar.events(f.mutation(), f.selection)).toMatchObject({ events: [], nextCursor: null });
  expect(await f.calendar.record(f.mutation(), f.selection, f.event())).toEqual({ ok: false, code: "retention-expired" });
  expect(await f.maintenance.run({ tenantId: "crc", studentIds: [f.selection.studentId], limit: 1 })).toEqual({ more: true });
  expect((await f.owner(() => f.db.select().from(s.practiceEvent))).length + (await f.owner(() => f.db.select().from(s.practiceDay))).length).toBe(1);
  expect(await f.maintenance.run({ tenantId: "crc", studentIds: [f.selection.studentId], limit: 1 })).toEqual({ more: false });
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(0);
});

test("service-visible days follow Chicago spring/fall transitions, leap anniversary midnight and a valid year-9999 ceremony", async () => {
  const f = await fixture();
  for (const [value, expectedDay] of [["2026-03-08T07:59:59.999Z", "2026-03-08"], ["2026-03-08T08:00:00.000Z", "2026-03-08"], ["2026-11-01T06:59:59.999Z", "2026-11-01"], ["2026-11-01T07:00:00.000Z", "2026-11-01"]]) {
    f.setTime(Date.parse(value)); expect(await f.calendar.record(f.mutation(), f.selection, f.event(undefined, { expectedDay }))).toEqual({ ok: true, practiceDay: expectedDay });
  }
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2024-02-29" }).where(eq(s.student.id, f.selection.studentId)));
  f.setTime(Date.parse("2025-02-28T05:59:59.999Z")); expect(await f.calendar.record(f.mutation(), f.selection, f.event(undefined, { expectedDay: "2025-02-27" }))).toMatchObject({ ok: true });
  f.setTime(Date.parse("2025-02-28T06:00:00.000Z")); expect(await f.calendar.record(f.mutation(), f.selection, f.event())).toEqual({ ok: false, code: "retention-expired" });
  expect(await f.calendar.calendar(f.mutation(), f.selection, { fromDate: "2025-02-01", throughDate: "2025-02-28" })).toMatchObject({ dates: [] });
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "9999-12-31" }).where(eq(s.student.id, f.selection.studentId)));
  f.setTime(Date.parse("9999-12-31T18:00:00.000Z")); expect(await f.calendar.record(f.mutation(), f.selection, f.event(undefined, { expectedDay: "9999-12-31" }))).toEqual({ ok: true, practiceDay: "9999-12-31" });
});
