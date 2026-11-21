import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createPracticeSweep } from "../../src/server/practice-calendar/scheduler";
import { prunePracticeBatch } from "../../src/server/practice-calendar/maintenance";
import { chicagoDate, RAW_RETENTION_MS } from "../../src/server/practice-calendar/policy";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";

const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

it("walks eligible students in bounded batches, retries an interrupted prune and preserves the date and detail cutoffs", async () => {
  const f = await portalRoutesFixture(); opened.push(f);
  const instant = Date.parse("2027-01-05T06:00:00Z"), now = () => instant;
  const cutoff = instant - RAW_RETENTION_MS, oldDay = chicagoDate(cutoff).date, today = chicagoDate(instant).date;
  const [retained, expired, additional, foreign] = f.students;
  const secret = "synthetic-practice-cron-test".repeat(2);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const failure = vi.fn(), attempts = new Map<string, number>();
  const sweep = createPracticeSweep({ db: f.db, cronSecret: secret, now, studentsPerRun: 1, prune: async (tx, tenant, ids, limit, clock) => {
    attempts.set(ids[0], (attempts.get(ids[0]) ?? 0) + 1);
    const result = await prunePracticeBatch(tx, tenant, ids, limit, clock);
    if (ids[0] === expired.id && !failure.mock.calls.length) { failure(); throw new Error("Synthetic interrupted prune"); }
    return result;
  } });
  Object.assign(f.runtime, { practiceSweep: sweep });
  const target = { type: "verse" as const, kind: "torah" as const, assignmentId: randomUUID(), assignmentRevision: 1, verseRef: "Genesis 1:1" };
  await f.owner(async () => {
    await f.db.update(s.student).set({ ceremonyDate: "2026-01-06" }).where(eq(s.student.id, retained.id));
    await f.db.update(s.student).set({ ceremonyDate: "2026-01-05" }).where(eq(s.student.id, expired.id));
    for (const person of [retained, expired, additional, foreign]) {
      await f.db.insert(s.practiceDay).values([{ tenantId: person.tenantId, studentId: person.id, practiceDay: oldDay },
        { tenantId: person.tenantId, studentId: person.id, practiceDay: today }]);
      await f.db.insert(s.practiceEvent).values({ tenantId: person.tenantId, studentId: person.id, practiceDay: oldDay,
        eventId: randomUUID(), receivedAt: new Date(cutoff), action: "visit", sourceMode: "student", target });
    }
    await f.db.insert(s.practiceEvent).values({ tenantId: retained.tenantId, studentId: retained.id, practiceDay: oldDay,
      eventId: randomUUID(), receivedAt: new Date(cutoff + 1), action: "visit", sourceMode: "student", target });
    await f.db.insert(s.practiceEvent).values({ tenantId: expired.tenantId, studentId: expired.id, practiceDay: today,
      eventId: randomUUID(), receivedAt: new Date(instant), action: "visit", sourceMode: "student", target });
  });
  const path = "/api/internal/practice-calendar/sweep", headers = { authorization: `Bearer ${secret}` };
  expect((await dispatch(f.request(path, { who: "anonymous" }))).status).toBe(401);
  expect((await dispatch(f.request(path, { who: "admin", headers }))).status).toBe(403);
  expect((await dispatch(f.request(path, { who: "anonymous", method: "POST", headers }))).status).toBe(405);
  expect((await dispatch(f.request(path + "?limit=1000", { who: "anonymous", headers }))).status).toBe(400);
  const run = async () => {
    const response = await dispatch(f.request(path, { who: "anonymous", headers }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.processed).toBeLessThanOrEqual(1);
    return result;
  };
  for (let i = 0; i < 8; i++) await run();
  expect([retained, expired, additional, foreign].map(person => attempts.has(person.id))).toEqual([true, true, true, true]);
  expect(failure).toHaveBeenCalledOnce();
  expect(attempts.get(expired.id)).toBe(2);
  const days = await f.owner(() => f.db.select().from(s.practiceDay)), events = await f.owner(() => f.db.select().from(s.practiceEvent));
  expect(days.filter(day => day.studentId === expired.id)).toEqual([]);
  expect(days.filter(day => day.studentId !== expired.id)).toHaveLength(6);
  expect(events.map(event => [event.studentId, event.receivedAt.getTime()])).toEqual([[retained.id, cutoff + 1]]);
  const hidden = await f.db.execute(sql`select count(*)::int as count from practice_sweep`);
  expect(hidden.rows).toEqual([{ count: 0 }]);
});
