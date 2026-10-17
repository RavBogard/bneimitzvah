import { afterEach, expect, test, vi } from "vitest";
import type { Assigned, Selection } from "../../src/components/portal/workspace/api";
import type { ServicePlan } from "../../src/components/portal/workspace/service-learning/api";
import { dayOrdinal, dayString, fetchPracticeCalendar, parsePracticeAck, parsePracticeDates, PracticeCalendarError, type PracticeAck, type PracticeDates, type PracticeOperation } from "../../src/components/portal/workspace/practice-calendar/api";
import { PracticeCalendar } from "../../src/components/portal/workspace/practice-calendar/store";
import { PortalRequestError } from "../../src/components/portal/api";

const studentId = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002";
const baseline = (mode: Assigned["mode"] = "student", contextId: string | null = null, revision = 3): Assigned => ({
  mode, context: contextId ? { id: contextId, authorityRevision: 1, studentId, studentRevision: 1, expiresAt: "2099-01-01T00:00:00.000Z" } : null,
  student: { id: studentId, firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", revision: 1 } as Assigned["student"],
  readings: [{ id: assignmentId, kind: "torah", revision, ranges: ["Genesis 1:1-2"], verses: ["Genesis 1:1", "Genesis 1:2"], needsReview: false, aliyahStarts: null, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "custom" }],
});
const plan: ServicePlan = { id: "10000000-0000-4000-8000-000000000004", revision: 2, needsReview: false, catalogId: "10000000-0000-4000-8000-000000000005", catalogIdentity: "a".repeat(64), catalogState: "active" };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
// The browser's date is deliberately a day away from the server's Chicago day.
const browserDay = dayOrdinal("2026-10-18");
function harness(serverDays: string[] = ["2026-10-17"], dates: string[] = ["2026-10-15"]) {
  const operations: PracticeOperation[] = [], onStale = vi.fn(); let reads = 0;
  const respond = vi.fn(async (_mode: string, _id: string, operation: PracticeOperation, _signal?: AbortSignal): Promise<PracticeDates | PracticeAck> => {
    operations.push(operation);
    if (operation.type === "visit") return { practiceDay: operation.expectedDay };
    const serverDay = serverDays[Math.min(reads++, serverDays.length - 1)];
    return { studentId, mode: "student", serverDay, fromDate: operation.fromDate, throughDate: operation.throughDate, dates };
  });
  const calendar = new PracticeCalendar((...args) => respond(...args), onStale, () => browserDay);
  return { calendar, operations, respond, onStale, visits: () => operations.filter(value => value.type === "visit") as Extract<PracticeOperation, { type: "visit" }>[] };
}
afterEach(() => { vi.unstubAllGlobals(); });

test("calendar dates are strict: closed keys, this student and mode, ordered unique valid days inside the window and not after the server's day", () => {
  const ok = { ok: true, studentId, mode: "parent", serverDay: "2026-10-17", dates: ["2026-10-01", "2026-10-17"] };
  expect(parsePracticeDates(ok, "parent", studentId, "2025-10-18", "2026-10-18").dates).toEqual(["2026-10-01", "2026-10-17"]);
  for (const bad of [
    { ...ok, extra: 1 }, { ...ok, ok: false }, { ...ok, studentId: assignmentId }, { ...ok, mode: "student" }, { ...ok, serverDay: "2026-02-29" },
    { ...ok, dates: ["2026-10-17", "2026-10-01"] }, { ...ok, dates: ["2026-10-01", "2026-10-01"] }, { ...ok, dates: ["2026-10-18"] }, { ...ok, dates: ["2025-10-17"] },
    { ...ok, dates: [20261001] }, { ...ok, dates: ["2026-13-01"] }, { ...ok, dates: Array.from({ length: 367 }, () => "2026-10-01") },
    { ok: true, studentId, mode: "parent", serverDay: "2026-10-17", dates: [{ date: "2026-10-01", action: "visit" }] },
  ]) expect(() => parsePracticeDates(bad, "parent", studentId, "2025-10-18", "2026-10-18")).toThrow(PracticeCalendarError);
  expect(parsePracticeAck({ ok: true, practiceDay: "2026-10-17" }, "2026-10-17")).toEqual({ practiceDay: "2026-10-17" });
  for (const bad of [{ ok: true, practiceDay: "2026-10-18" }, { ok: true, practiceDay: "2026-10-17", rawStored: true }, { ok: true }]) expect(() => parsePracticeAck(bad, "2026-10-17")).toThrow(PracticeCalendarError);
});

test("calendar day arithmetic is Gregorian across leap centuries and the 0001 and 9999 edges", () => {
  for (const day of ["0001-01-01", "0099-12-31", "1900-02-28", "2000-02-29", "2024-02-29", "9999-12-31"]) expect(dayString(dayOrdinal(day))).toBe(day);
  expect(dayOrdinal("1970-01-01")).toBe(0); expect(dayOrdinal("2000-03-01") - dayOrdinal("2000-02-28")).toBe(2); expect(dayOrdinal("1900-03-01") - dayOrdinal("1900-02-28")).toBe(1);
  for (const bad of ["0000-01-01", "1900-02-29", "2026-02-29", "2026-1-01", "2026-10-17T00:00", ""]) expect(() => dayOrdinal(bad)).toThrow(PracticeCalendarError);
});

test("the adapter reads dates only and posts a closed visit, with the practice context only for a selected child", async () => {
  const calls: { url: string; method: string; headers: Headers; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, headers: new Headers(init.headers), body: init.body as string | undefined });
    const json = init.method === "POST" ? { ok: true, practiceDay: "2026-10-17" } : { ok: true, studentId, mode: url.includes("child-practice") ? "child-practice" : "parent", serverDay: "2026-10-17", dates: [] };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }));
  const signal = new AbortController().signal, selection: Selection = { handle: "synthetic-handle", context: baseline("child-practice", "10000000-0000-4000-8000-000000000006").context! };
  await fetchPracticeCalendar("parent", studentId, { type: "calendar", fromDate: "2025-10-18", throughDate: "2026-10-18" }, signal);
  expect(calls[0].url).toBe(`/api/students/${studentId}/practice-calendar?mode=parent&fromDate=2025-10-18&throughDate=2026-10-18`);
  expect(calls[0].method).toBe("GET"); expect(calls[0].body).toBeUndefined(); expect(calls[0].headers.has("X-Practice-Context")).toBe(false);
  const target = { type: "verse", kind: "torah", assignmentId, assignmentRevision: 3, verseRef: "Genesis 1:1" } as const;
  await fetchPracticeCalendar("child-practice", studentId, { type: "visit", eventId: "10000000-0000-4000-8000-000000000007", expectedDay: "2026-10-17", target }, signal, selection);
  expect(calls[1].url).toBe(`/api/students/${studentId}/practice-events`); expect(calls[1].method).toBe("POST");
  expect(calls[1].headers.get("X-Practice-Context")).toBe("synthetic-handle");
  expect(JSON.parse(calls[1].body!)).toEqual({ mode: "child-practice", eventId: "10000000-0000-4000-8000-000000000007", expectedDay: "2026-10-17", action: "visit", target });
  // Only the student and a selected child report visits, and a child view needs its selection (and only that view has one).
  await expect(fetchPracticeCalendar("parent", studentId, { type: "visit", eventId: "10000000-0000-4000-8000-000000000007", expectedDay: "2026-10-17", target }, signal)).rejects.toBeInstanceOf(PracticeCalendarError);
  await expect(fetchPracticeCalendar("child-practice", studentId, { type: "calendar", fromDate: "2025-10-18", throughDate: "2026-10-18" }, signal)).rejects.toBeInstanceOf(PracticeCalendarError);
  await expect(fetchPracticeCalendar("student", studentId, { type: "calendar", fromDate: "2025-10-18", throughDate: "2026-10-18" }, signal, selection)).rejects.toBeInstanceOf(PracticeCalendarError);
  expect(calls).toHaveLength(2);
  expect(calls.some(call => call.url.includes("practice-events?"))).toBe(false);
});

test("the adapter maps only the three closed conflicts and never trusts other bodies", async () => {
  const reply = (status: number, json: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } })));
  const visit = () => fetchPracticeCalendar("student", studentId, { type: "visit", eventId: "10000000-0000-4000-8000-000000000007", expectedDay: "2026-10-17", target: { type: "verse", kind: "torah", assignmentId, assignmentRevision: 3, verseRef: "Genesis 1:1" } }, new AbortController().signal);
  for (const code of ["stale-day", "stale-material", "retention-expired"] as const) { reply(409, { ok: false, code }); await expect(visit()).rejects.toMatchObject({ status: 409, code }); }
  reply(409, { ok: false, code: "quota" }); await expect(visit()).rejects.toMatchObject({ status: 503, code: undefined });
  reply(403, { error: "forbidden" }); await expect(visit()).rejects.toMatchObject({ status: 403 });
  reply(500, { error: "x" }); await expect(visit()).rejects.toMatchObject({ status: 503 });
  reply(200, { ok: true, practiceDay: "2026-10-18" }); await expect(visit()).rejects.toMatchObject({ status: 503 });
});

test("reading the calendar never reports a visit; only an explicit open of an assigned verse or chosen part does, on the server's day", async () => {
  const { calendar, operations, visits } = harness();
  calendar.configure(baseline()); await calendar.load();
  expect(operations.map(value => value.type)).toEqual(["calendar"]);
  // The read window follows the browser's date; the write uses the server's day, which differs here.
  expect(operations[0]).toMatchObject({ fromDate: dayString(browserDay - 364), throughDate: dayString(browserDay + 1) });
  expect(calendar.snapshot()).toMatchObject({ status: "ready", serverDay: "2026-10-17" });
  calendar.visitVerse("torah", "Genesis 3:1"); calendar.visitVerse("haftarah", "Genesis 1:1"); await flush();
  expect(visits()).toHaveLength(0);
  calendar.visitVerse("torah", "Genesis 1:2"); calendar.visitUnit(plan, "synthetic-unit"); await flush();
  expect(visits().map(value => [value.expectedDay, value.target])).toEqual([
    ["2026-10-17", { type: "verse", kind: "torah", assignmentId, assignmentRevision: 3, verseRef: "Genesis 1:2" }],
    ["2026-10-17", { type: "service-unit", catalogId: plan.catalogId, catalogIdentity: plan.catalogIdentity, planId: plan.id, planRevision: 2, unitId: "synthetic-unit" }],
  ]);
  expect(new Set(visits().map(value => value.eventId)).size).toBe(2);
  // Opening the same verse again on the same day adds nothing.
  calendar.visitVerse("torah", "Genesis 1:2"); await flush(); expect(visits()).toHaveLength(2);
  const state = calendar.snapshot(); expect(state.status === "ready" && [...state.dates].sort()).toEqual(["2026-10-15", "2026-10-17"]);
});

test("parent, tutor and admin views have no calendar here and send nothing", async () => {
  for (const mode of ["parent", "tutor", "admin"] as const) {
    const { calendar, operations } = harness(); calendar.configure(baseline(mode)); await calendar.load(); calendar.visitVerse("torah", "Genesis 1:1"); await flush();
    expect(calendar.snapshot().status).toBe("off"); expect(operations).toHaveLength(0);
  }
});

test("a stale day re-reads once and is not resent; the next explicit open uses the new day", async () => {
  const { calendar, respond, visits } = harness(["2026-10-17", "2026-10-18"]);
  calendar.configure(baseline()); await calendar.load();
  respond.mockImplementationOnce(async () => { throw new PracticeCalendarError(409, "stale-day"); });
  calendar.visitVerse("torah", "Genesis 1:1"); await flush();
  expect(calendar.snapshot()).toMatchObject({ status: "ready", serverDay: "2026-10-18" });
  expect(visits()).toHaveLength(0);
  calendar.visitVerse("torah", "Genesis 1:1"); await flush();
  expect(visits().map(value => value.expectedDay)).toEqual(["2026-10-18"]);
});

test("stale material asks for one reading reload; expiry ends the calendar; other failures are not retried", async () => {
  const { calendar, respond, onStale, visits } = harness();
  calendar.configure(baseline()); await calendar.load();
  respond.mockImplementation(async () => { throw new PracticeCalendarError(409, "stale-material"); });
  calendar.visitVerse("torah", "Genesis 1:1"); calendar.visitVerse("torah", "Genesis 1:2"); await flush();
  expect(onStale).toHaveBeenCalledTimes(1);
  respond.mockImplementation(async () => { throw new PracticeCalendarError(503); });
  const before = respond.mock.calls.length; calendar.visitVerse("torah", "Genesis 1:1"); await flush(); expect(respond.mock.calls.length).toBe(before + 1);
  respond.mockImplementation(async () => { throw new PracticeCalendarError(409, "retention-expired"); });
  calendar.visitVerse("torah", "Genesis 1:2"); await flush();
  expect(calendar.snapshot().status).toBe("ended");
  const after = respond.mock.calls.length; calendar.visitVerse("torah", "Genesis 1:1"); await flush(); expect(respond.mock.calls.length).toBe(after);
  expect(visits()).toHaveLength(0);
});

test("a late read or acknowledgement after a clear, a child switch or a new revision is dropped", async () => {
  const { calendar, respond } = harness();
  calendar.configure(baseline("child-practice", "10000000-0000-4000-8000-000000000008")); await calendar.load();
  const ack = deferred<PracticeAck>(); respond.mockImplementationOnce(() => ack.promise);
  calendar.visitVerse("torah", "Genesis 1:1");
  calendar.configure(baseline("child-practice", "10000000-0000-4000-8000-000000000009"));
  ack.resolve({ practiceDay: "2026-10-17" }); await flush();
  expect(calendar.snapshot().status).toBe("loading");
  const read = deferred<PracticeDates>(); respond.mockImplementationOnce(() => read.promise);
  const pending = calendar.load(); calendar.clear();
  read.resolve({ studentId, mode: "child-practice", serverDay: "2026-10-17", fromDate: "2025-10-19", throughDate: "2026-10-19", dates: ["2026-10-16"] }); await pending;
  expect(calendar.snapshot().status).toBe("loading");
  // An access check clears everything; a write before the next fresh read is refused locally.
  calendar.visitVerse("torah", "Genesis 1:1"); await flush();
  expect(respond.mock.calls.filter(call => call[2].type === "visit")).toHaveLength(1);
  calendar.configure(null); expect(calendar.snapshot().status).toBe("off");
});

test("a definite visit denial aborts a concurrent acknowledgement, forgets dates and disables later local loads/visits", async () => {
  const { calendar, respond, onStale } = harness(), late = deferred<PracticeAck>(), denied = deferred<PracticeAck>();
  calendar.configure(baseline()); await calendar.load();
  const signal = respond.mock.calls[0][3]!;
  respond.mockImplementationOnce(() => late.promise); calendar.visitVerse("torah", "Genesis 1:1");
  respond.mockImplementationOnce(() => denied.promise); calendar.visitVerse("torah", "Genesis 1:2");
  denied.reject(new PracticeCalendarError(403)); await flush();
  expect(calendar.snapshot()).toEqual({ status: "off" }); expect(signal.aborted).toBe(true);
  late.resolve({ practiceDay: "2026-10-17" }); await flush();
  await calendar.load(); calendar.visitVerse("torah", "Genesis 1:1"); calendar.visitUnit(plan, "synthetic-unit"); await flush();
  expect(calendar.snapshot()).toEqual({ status: "off" }); expect(respond).toHaveBeenCalledTimes(3); expect(onStale).not.toHaveBeenCalled();
});

test.each([401, 403, 404])("plain provider refusal %s also clears and aborts calendar dates without retry", async status => {
  const { calendar, respond, onStale } = harness(); calendar.configure(baseline()); await calendar.load();
  const signal = respond.mock.calls[0][3]!;
  respond.mockImplementationOnce(async () => { throw new PortalRequestError(status); });
  calendar.visitVerse("torah", "Genesis 1:1"); await flush();
  expect(calendar.snapshot()).toEqual({ status: "off" }); expect(signal.aborted).toBe(true);
  await calendar.load(); calendar.visitVerse("torah", "Genesis 1:1"); await flush();
  expect(respond).toHaveBeenCalledTimes(2); expect(onStale).not.toHaveBeenCalled();
});

test("stale reloads are bounded by material version independently for service and verse targets across refreshes", async () => {
  const { calendar, respond, onStale } = harness(); calendar.configure(baseline()); await calendar.load();
  async function stale(servicePlan: ServicePlan, unit = "synthetic-unit") {
    respond.mockImplementationOnce(async () => { throw new PracticeCalendarError(409, "stale-material"); });
    calendar.visitUnit(servicePlan, unit); await flush();
  }
  await stale(plan); expect(onStale).toHaveBeenCalledTimes(1);
  calendar.configure(baseline()); await calendar.load(); await stale(plan, "another-unit"); expect(onStale).toHaveBeenCalledTimes(1);
  // A successful unrelated visit cannot renew the same stale-plan allowance.
  calendar.visitVerse("torah", "Genesis 1:1"); await flush(); await stale(plan); expect(onStale).toHaveBeenCalledTimes(1);
  await stale({ ...plan, revision: plan.revision + 1 }); expect(onStale).toHaveBeenCalledTimes(2);
  await stale({ ...plan, catalogIdentity: "b".repeat(64) }); expect(onStale).toHaveBeenCalledTimes(3);
  calendar.configure(baseline("student", null, 4)); await calendar.load(); await stale(plan); expect(onStale).toHaveBeenCalledTimes(3);
  respond.mockImplementationOnce(async () => { throw new PracticeCalendarError(409, "stale-material"); }); calendar.visitVerse("torah", "Genesis 1:1"); await flush(); expect(onStale).toHaveBeenCalledTimes(4);
  calendar.configure(baseline("student", null, 5)); await calendar.load();
  respond.mockImplementationOnce(async () => { throw new PracticeCalendarError(409, "stale-material"); }); calendar.visitVerse("torah", "Genesis 1:2"); await flush(); expect(onStale).toHaveBeenCalledTimes(5);
  expect(respond.mock.calls.filter(call => call[2].type === "visit")).toHaveLength(9);
});

test("a server day outside the browser's window gets one more read around the server's day", async () => {
  const { calendar, operations } = harness(["2027-03-01", "2027-03-01"], []);
  calendar.configure(baseline()); await calendar.load();
  expect(operations.slice(1)).toEqual([{ type: "calendar", fromDate: dayString(dayOrdinal("2027-03-01") - 365), throughDate: "2027-03-01" }]);
  expect(calendar.snapshot()).toMatchObject({ status: "ready", serverDay: "2027-03-01" });
});
