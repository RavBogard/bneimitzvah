import { expect, test, vi } from "vitest";
import type { Assigned } from "../../src/components/portal/workspace/api";
import type { ServicePlan } from "../../src/components/portal/workspace/service-learning/api";
import { PracticeCalendar } from "../../src/components/portal/workspace/practice-calendar/store";
import { PracticeCalendarError, dayOrdinal, type PracticeOperation, type PracticeDates, type PracticeAck } from "../../src/components/portal/workspace/practice-calendar/api";

const studentId = "10000000-0000-4000-8000-000000000001", assignmentId = "10000000-0000-4000-8000-000000000002";
function baseline(context = "10000000-0000-4000-8000-000000000003"): Assigned {
  return { mode: "child-practice", student: { id: studentId, firstName: "Synthetic", lastName: "Calendar", ceremonyDate: "2027-01-02", revision: 1 }, context: { id: context, authorityRevision: 1, studentId, studentRevision: 1, expiresAt: "2099-01-01T00:00:00.000Z" },
    readings: [{ id: assignmentId, kind: "torah", revision: 1, ranges: ["Genesis 1:1"], verses: ["Genesis 1:1"], aliyahStarts: null, needsReview: false, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "custom" }] };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup() {
  const calls: { operation: PracticeOperation; signal: AbortSignal; id: string }[] = [], stale = vi.fn();
  const request = vi.fn(async (mode: Assigned["mode"], id: string, operation: PracticeOperation, signal: AbortSignal): Promise<PracticeDates | PracticeAck> => {
    calls.push({ operation, signal, id });
    return operation.type === "visit" ? { practiceDay: operation.expectedDay } : { studentId: id, mode, serverDay: "2026-10-17", fromDate: operation.fromDate, throughDate: operation.throughDate, dates: ["2026-10-16"] };
  });
  return { calendar: new PracticeCalendar(request, stale, () => dayOrdinal("2026-10-17")), request, calls, stale };
}

for (const status of [401, 403, 404]) test(`definite calendar visit denial ${status} clears dates and aborts other pending details without retrying`, async () => {
  const { calendar, request, calls } = setup(); calendar.configure({ ...baseline(), mode: "student", context: null }); await calendar.load();
  const signal = calls[0].signal; request.mockImplementationOnce(async () => { throw new PracticeCalendarError(status); });
  calendar.visitVerse("torah", "Genesis 1:1"); await flush();
  expect(calendar.snapshot().status).not.toBe("ready"); expect("dates" in calendar.snapshot()).toBe(false); expect(signal.aborted).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});

test("a new service plan revision gets its own stale-material reload even when verse assignments are unchanged", async () => {
  const { calendar, request, stale } = setup(), assigned = baseline(); calendar.configure(assigned); await calendar.load();
  const plan: ServicePlan = { id: "10000000-0000-4000-8000-000000000004", revision: 1, catalogId: "10000000-0000-4000-8000-000000000005", catalogIdentity: "a".repeat(64), catalogState: "active", needsReview: false };
  request.mockImplementationOnce(async () => { throw new PracticeCalendarError(409, "stale-material"); }); calendar.visitUnit(plan, "synthetic-part"); await flush(); expect(stale).toHaveBeenCalledTimes(1);
  // The server's material reload changes only the service plan, not Torah/haftarah.
  calendar.configure(assigned); await calendar.load();
  request.mockImplementationOnce(async () => { throw new PracticeCalendarError(409, "stale-material"); }); calendar.visitUnit({ ...plan, revision: 2 }, "synthetic-part"); await flush();
  expect(stale).toHaveBeenCalledTimes(2);
});

test("late visit acknowledgement cannot mark a newly selected sibling/context or revive a concealed calendar", async () => {
  const { calendar, request, calls } = setup(), ack = deferred<PracticeAck>(); calendar.configure(baseline()); await calendar.load();
  request.mockImplementationOnce(() => ack.promise); calendar.visitVerse("torah", "Genesis 1:1"); await flush();
  const oldSignal = calls[0].signal; calendar.configure({ ...baseline("10000000-0000-4000-8000-000000000006"), student: { ...baseline().student, id: "10000000-0000-4000-8000-000000000007" }, context: { ...baseline().context!, id: "10000000-0000-4000-8000-000000000006", studentId: "10000000-0000-4000-8000-000000000007" } });
  await calendar.load(); expect(oldSignal.aborted).toBe(true); ack.resolve({ practiceDay: "2026-10-17" }); await flush();
  const state = calendar.snapshot(); expect(state.status).toBe("ready"); if (state.status === "ready") expect([...state.dates]).toEqual(["2026-10-16"]);
  calendar.clear(); await flush(); expect("dates" in calendar.snapshot()).toBe(false);
  expect(request.mock.calls.filter(call => call[2].type === "visit")).toHaveLength(1);
});
