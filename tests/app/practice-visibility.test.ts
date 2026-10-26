import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { withTenantTransaction } from "../../src/server/db/runtime";
import type { AccessTransaction } from "../../src/server/access/types";
import { createPracticeVisibilityService } from "../../src/server/practice-visibility/service";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { pathLessons } from "../../src/lib/learn/course";

// 1.9 N23 (decision 7): practice visibility. The assigned tutor reads per-day opened verses and marks, each mark's source, the
// roster line's numbers and Learn's lines; a parent reads counts only; everyone else, and everything before the release gate,
// reads nothing. Synthetic people only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient" | "anonymous";
const chicagoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const RANGE = "Exodus 23:1-9";

async function setup(options: { from?: string | null } = {}) {
  const f = await portalRoutesFixture(); opened.push(f);
  const today = chicagoToday(), from = options.from === undefined ? addDays(today, -30) : options.from;
  const runtime = { ...f.runtime, practiceVisibility: createPracticeVisibilityService({ access: f.service, from }) };
  const dispatch = createHttpDispatcher(async action => action(runtime));
  const [own, sibling, unrelated, foreign] = f.students;
  const refs = expandReadingRanges([RANGE], "torah", TANAKH_VERSE_COUNTS);
  const assign = (studentId: string) => f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: RANGE, status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values(refs.map((verseRef, index) => ({ tenantId: "crc", studentId, assignmentId: row.id, ordinal: index + 1, verseRef })));
    return row;
  });
  const assignment = await assign(own.id), siblingAssignment = await assign(sibling.id);
  const call = async (path: string, who: Who, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const h = new Headers(init.headers ?? {}); if (who !== "anonymous") h.set("cookie", f.identities[who].cookie);
    if (init.body !== undefined) { h.set("origin", ORIGIN); h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${ORIGIN}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: h, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
    if (response.status !== 405) expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    const text = await response.text();
    return { status: response.status, text, json: (text ? JSON.parse(text) : null) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const read = (who: Who, studentId: string, mode = "tutor", headers: Record<string, string> = {}) => call(`/api/students/${studentId}/practice-visibility?mode=${mode}`, who, { headers });
  /** The student marks a verse through the real progress API, as the student. */
  const mark = async (verseRef: string, state: "working" | "got-it" | "unmarked", expectedVersion = 0) => {
    const answer = await call(`/api/students/${own.id}/progress/self-check`, "learner", { body: { mode: "student", kind: "torah", assignmentId: assignment.id, assignmentRevision: 1, verseRef, state, expectedVersion } });
    expect(answer.status, `${verseRef} ${state}`).toBe(200);
  };
  /** A practice event the student's browser sent today (the server's clock and day). */
  const event = (studentId: string, assignmentId: string, verseRef: string, action = "visit") => f.owner(async () => {
    await f.db.execute(sql`insert into practice_day (tenant_id, student_id, practice_day) values ('crc', ${studentId}, (now() at time zone 'America/Chicago')::date) on conflict do nothing`);
    await f.db.execute(sql`insert into practice_event (tenant_id, student_id, practice_day, event_id, action, source_mode, target) values ('crc', ${studentId},
      (now() at time zone 'America/Chicago')::date, gen_random_uuid(), ${action}, 'student', ${JSON.stringify({ type: "verse", kind: "torah", assignmentId, assignmentRevision: 1, verseRef })}::jsonb)`);
  });
  return { f, today, from, runtime, dispatch, call, read, mark, event, refs, assignment, siblingAssignment, own, sibling, unrelated, foreign };
}

describe("marks record whether a parent was there, and the server's own instant", () => {
  it("a student's mark records student, a child-practice mark records child-practice, and an unchanged write keeps both", async () => {
    const t = await setup();
    await t.mark("Exodus 23:4", "got-it");
    const rows = () => t.f.owner(() => t.f.db.select({ verseRef: s.verseSelfCheck.verseRef, sourceMode: s.verseSelfCheck.sourceMode, markedAt: s.verseSelfCheck.markedAt }).from(s.verseSelfCheck));
    const [first] = await rows();
    expect(first.sourceMode).toBe("student"); expect(first.markedAt).toBeInstanceOf(Date);
    // A parent practising with the child writes child-practice; the database stamps the instant and refuses a forged one.
    const forged = new Date("2020-01-01T00:00:00.000Z");
    await t.f.owner(() => t.f.db.update(s.verseSelfCheck).set({ state: "working", version: 2, sourceMode: "child-practice", markedAt: forged }).where(eq(s.verseSelfCheck.verseRef, "Exodus 23:4")));
    const [second] = await rows();
    expect(second.sourceMode).toBe("child-practice"); expect(second.markedAt!.getTime()).not.toBe(forged.getTime()); expect(second.markedAt!.getTime()).toBeGreaterThanOrEqual(first.markedAt!.getTime());
    // A write that changes no state cannot move the source or the instant.
    await t.f.owner(() => t.f.db.update(s.verseSelfCheck).set({ version: 3, sourceMode: "student", markedAt: forged }).where(eq(s.verseSelfCheck.verseRef, "Exodus 23:4")));
    const [third] = await rows();
    expect(third.sourceMode).toBe("child-practice"); expect(third.markedAt!.getTime()).toBe(second.markedAt!.getTime());
  });
});

describe("the assigned tutor's view", () => {
  it("shows per day which verses were opened and which marks were made, each mark's source, the roster numbers and Learn's lines", async () => {
    const t = await setup();
    for (const verse of ["Exodus 23:1", "Exodus 23:2", "Exodus 23:3"]) await t.event(t.own.id, t.assignment.id, verse);
    await t.event(t.own.id, t.assignment.id, "Exodus 23:2"); // A second visit adds nothing: one row per day and verse.
    await t.event(t.own.id, t.assignment.id, "Exodus 23:8", "play"); // A play is not an opening, and is never counted or shown.
    await t.mark("Exodus 23:4", "got-it"); await t.mark("Exodus 23:6", "got-it");
    // The parent, practising with the child, changes 23:6 to Still working (child practice writes child-practice).
    await t.f.owner(() => t.f.db.update(s.verseSelfCheck).set({ sourceMode: "child-practice", state: "working", version: 2 }).where(eq(s.verseSelfCheck.verseRef, "Exodus 23:6")));
    // Learn: tevir and etnachta taught on the Torah path, each with a card dropped to box 0 or 1 by a miss.
    const lessons = pathLessons("torah").filter(lesson => lesson.family === "tevir" || lesson.family === "etnachta").map(lesson => lesson.id);
    await t.f.owner(() => t.f.db.insert(s.courseProgressTable).values({ tenantId: "crc", membershipId: t.f.learnerMember.id, userId: t.f.identities.learner.id,
      progress: { schema: "learn-progress/v1", lessons: Object.fromEntries(lessons.map(id => [id, { done: "2026-10-01T10:00:00.000Z" }])), cards: { "tevir:torah:name": { box: 0, due: "2026-10-02" }, "etnachta:torah:name": { box: 1, due: "2026-10-03" } } } }));
    await t.f.owner(() => t.f.db.insert(s.lessonLog).values({ tenantId: "crc", studentId: t.own.id, entryId: randomUUID(), creatorMembershipId: t.f.multiMember.id, creatorUserId: t.f.identities.multi.id, lessonDate: addDays(t.today, -2), summary: "Synthetic lesson", version: 1 }));

    const answer = await t.read("multi", t.own.id);
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      from: t.from, today: t.today,
      days: [{ day: t.today, readings: [{ kind: "torah", opened: ["Exodus 23:1", "Exodus 23:2", "Exodus 23:3", "Exodus 23:4", "Exodus 23:6"],
        marked: [{ verseRef: "Exodus 23:4", state: "got-it" }, { verseRef: "Exodus 23:6", state: "working" }] }] }],
      marks: [{ kind: "torah", verseRef: "Exodus 23:4", state: "got-it", withParent: false }, { kind: "torah", verseRef: "Exodus 23:6", state: "working", withParent: true }],
      practisedDays: 1, lastLesson: addDays(t.today, -2), stillWorking: 1,
      learn: { torah: { heard: 2, of: answer.json.learn.torah.of }, haftarah: { heard: 0, of: answer.json.learn.haftarah.of }, mixedUp: ["tevir", "etnachta"] },
    });
    // Dates only: no time of day, action, play, duration, raw source field or instant anywhere in the answer.
    for (const absent of [/T\d\d:/, /play/, /visit/, /action/, /received/i, /source_?mode/i, /duration/i, /marked_?at/i, /"due"/, /"box"/, /Exodus 23:8/]) expect(answer.text).not.toMatch(absent);
  });

  it("starts the per-day lines on the release date: nothing a student did before the gate opened is shown per day", async () => {
    const t = await setup({ from: addDays(chicagoToday(), 1) });
    await t.event(t.own.id, t.assignment.id, "Exodus 23:1"); await t.mark("Exodus 23:4", "got-it");
    const answer = await t.read("multi", t.own.id);
    expect(answer.status).toBe(200);
    expect(answer.json.days).toEqual([]);
    // The current mark itself was already the tutor's to see on the progress page; only the day and the source are new.
    expect(answer.json.marks).toEqual([{ kind: "torah", verseRef: "Exodus 23:4", state: "got-it", withParent: false }]);
  });

  it("a tutor without an active tutor_student row reads nothing: another student, a revoked row, a ceremony-done student, another congregation", async () => {
    const t = await setup();
    await t.event(t.sibling.id, t.siblingAssignment.id, "Exodus 23:1");
    // multi is the sibling's parent but not her tutor: no tutor_student row, so nothing.
    expect((await t.read("multi", t.sibling.id)).status).toBe(404);
    expect((await t.read("multi", t.unrelated.id)).status).toBe(404);
    expect((await t.read("multi", t.foreign.id)).status).toBe(404);
    expect((await t.read("admin", t.foreign.id, "tutor")).status).toBe(403);
    // Positive control, then the revocation.
    expect((await t.read("multi", t.own.id)).status).toBe(200);
    await t.f.owner(() => t.f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, t.f.tutorLink.id)));
    expect((await t.read("multi", t.own.id)).status).toBe(404);
  });

  it("reads nothing of a ceremony-done student", async () => {
    const t = await setup();
    expect((await t.read("multi", t.own.id)).status).toBe(200);
    await t.f.owner(() => t.f.db.insert(s.studentCeremonyDone).values({ tenantId: "crc", studentId: t.own.id, setByGrantId: t.f.adminGrant.id }));
    expect((await t.read("multi", t.own.id)).status).toBe(404);
  });

  it("refuses admins, students, child practice, a practice context, an extra query, anyone signed out and any method but GET", async () => {
    const t = await setup();
    for (const mode of ["admin", "student", "child-practice", "", "rabbi"]) expect((await t.read("admin", t.own.id, mode)).status, mode).toBe(400);
    expect((await t.call(`/api/students/${t.own.id}/practice-visibility`, "multi")).status).toBe(400);
    expect((await t.call(`/api/students/${t.own.id}/practice-visibility?mode=tutor&studentId=${t.sibling.id}`, "multi")).status).toBe(400);
    expect((await t.read("multi", t.own.id, "tutor", { "X-Practice-Context": "A".repeat(43) })).status).toBe(400);
    expect((await t.call("/api/students/not-a-student/practice-visibility?mode=tutor", "multi")).status).toBe(400);
    // The rabbi is an admin, not the assigned tutor: an admin's account asking as a tutor has no tutor grant.
    expect((await t.read("admin", t.own.id, "tutor")).status).toBe(403);
    expect((await t.read("learner", t.own.id, "tutor")).status).toBe(403);
    expect((await t.read("learner", t.own.id, "parent")).status).toBe(403);
    expect((await t.read("recipient", t.own.id, "tutor")).status).toBe(403);
    expect((await t.read("anonymous", t.own.id, "tutor")).status).toBe(401);
    expect((await t.call(`/api/students/${t.own.id}/practice-visibility?mode=tutor`, "multi", { method: "POST", body: {} })).status).toBe(405);
  });
});

describe("a parent reads counts and nothing per day", () => {
  it("answers how many verses are marked Got it and Still working, and nothing else", async () => {
    const t = await setup();
    await t.event(t.own.id, t.assignment.id, "Exodus 23:1");
    await t.mark("Exodus 23:4", "got-it"); await t.mark("Exodus 23:5", "got-it"); await t.mark("Exodus 23:6", "working"); await t.mark("Exodus 23:7", "working"); await t.mark("Exodus 23:7", "unmarked", 1);
    const answer = await t.read("multi", t.own.id, "parent");
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ gotIt: 2, working: 1 });
    for (const absent of ["Exodus", "23:", "day", "withParent", "learn", t.today]) expect(answer.text).not.toContain(absent);
    // A parent of another child, and a tutor asking as a parent, read nothing.
    expect((await t.read("multi", t.unrelated.id, "parent")).status).toBe(404);
    expect((await t.read("admin", t.own.id, "parent")).status).toBe(403);
  });
});

describe("the release gate", () => {
  it("refuses every read while it is closed, for the tutor and the parent alike", async () => {
    const t = await setup({ from: null });
    await t.mark("Exodus 23:4", "got-it");
    expect((await t.read("multi", t.own.id, "tutor")).status).toBe(404);
    expect((await t.read("multi", t.own.id, "parent")).status).toBe(404);
    // The production composition's own gate is closed until the review passes and Daniel approves the disclosure.
    const shipped = createHttpDispatcher(async action => action(t.f.runtime));
    const response = await shipped(new Request(`${ORIGIN}/api/students/${t.own.id}/practice-visibility?mode=tutor`, { headers: { cookie: t.f.identities.multi.cookie } }));
    expect(response.status).toBe(404);
  });
});

describe("the database shows the views to the reader alone", () => {
  it("returns no row of any view, nor anyone's course progress, without the reader, or with a parent's, an admin's or another tutor's grant", async () => {
    const t = await setup();
    await t.event(t.own.id, t.assignment.id, "Exodus 23:1"); await t.mark("Exodus 23:4", "got-it");
    await t.f.owner(() => t.f.db.insert(s.courseProgressTable).values({ tenantId: "crc", membershipId: t.f.learnerMember.id, userId: t.f.identities.learner.id, progress: { schema: "learn-progress/v1", lessons: {}, cards: {} } }));
    const counts = (tenantId: string, reader: string | null) => withTenantTransaction(t.f.db, { tenantId }, async (tx: AccessTransaction<PgliteQueryResultHKT>) => {
      if (reader !== null) await tx.execute(sql`select set_config('app.practice_reader', ${reader}, true)`);
      const n = async (table: string) => Number(((await tx.execute(sql.raw(`select count(*)::int as n from ${table}`))) as unknown as { rows: { n: number }[] }).rows[0].n);
      return [await n("practice_visibility_opened"), await n("practice_visibility_marks"), await n("practice_visibility_learn"), await n("course_progress")];
    });
    expect(await counts("crc", t.f.tutorGrant.id)).toEqual([1, 1, 1, 1]);
    expect(await counts("crc", null)).toEqual([0, 0, 0, 0]);
    expect(await counts("crc", "")).toEqual([0, 0, 0, 0]);
    for (const grant of [t.f.parentGrant.id, t.f.adminGrant.id, t.f.learnerGrant.id]) expect(await counts("crc", grant), grant).toEqual([0, 0, 0, 0]);
    expect(await counts("other", t.f.tutorGrant.id)).toEqual([0, 0, 0, 0]);
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(and(eq(s.roleGrant.id, t.f.tutorGrant.id))));
    expect(await counts("crc", t.f.tutorGrant.id)).toEqual([0, 0, 0, 0]);
  });
});
