import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import { AccessDenied } from "../access/errors";
import { confirmedReadings } from "../data/portal";
import * as data from "../data/practice-visibility";
import { chicagoDate } from "../practice-calendar/policy";
import { practiceVisibilityFrom } from "../../lib/practice-visibility/release";
import { learnSummary } from "../../lib/practice-visibility/learn";
import type { ParentPractice, PracticeDay, PracticeDayReading, PracticeKind, PracticeMark, PracticeMarkState, TutorPractice } from "../../lib/practice-visibility/types";

/**
 * THE READ PATH of 1.9 N23 (decision 7, widening ruling 45). Two reads, nothing else:
 *
 * - `tutor`: the student's ASSIGNED tutor only. withStudentCapability checks the live tutor grant, the live tutor_student row and
 *   that the student is not ceremony-done (N21), and only then is app.practice_reader named, for 0052's views and course-progress
 *   reader policy, which check all of that again in the database. Admins (rabbis), parents, students, child practice, other tutors, MCP,
 *   cron, the roster Sheet, exports and notifications never come through here. The answer: per day for the last 14 days (never
 *   before the release date), which verses were opened and which marks were made; each verse's current mark and whether a parent
 *   was there; the days practised of the last 7 and the last lesson date; Learn's "Can hear" counts and the pair most often
 *   mixed up. Dates only: no time of day, duration, action, play count or score is read or returned.
 * - `parent`: a linked parent, in parent view: how many verses are marked Got it and Still working. Nothing per day, no source.
 *
 * Both refuse everything (404) until the release gate (src/lib/practice-visibility/release.ts) is set, the same gate behind the
 * student's disclosures on Account and in Learn, so no line reaches a tutor or parent before the student is told.
 */
type Access<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createAccessService<Q>>, "withStudentCapability">;
const DAY_MS = 86_400_000, WINDOW_DAYS = 14, PRACTISED_DAYS = 7;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const KINDS: readonly PracticeKind[] = ["torah", "haftarah"];
const isState = (value: string): value is PracticeMarkState => value === "working" || value === "got-it";

export function createPracticeVisibilityService<Q extends PgQueryResultHKT>(input: { access: Access<Q>; from?: string | null; now?: () => number }) {
  const gate = () => practiceVisibilityFrom(input.from === undefined ? undefined : input.from);
  const now = input.now ?? Date.now;
  return Object.freeze({
    async tutor(request: AccessRequest, selection: { mode: "tutor"; studentId: string }): Promise<TutorPractice> {
      const from = gate();
      if (!from) throw new AccessDenied(404);
      if (selection.mode !== "tutor") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: "tutor", studentId: selection.studentId, capability: "read" }, async (tx, actor, student) => {
        if (actor.mode !== "tutor") throw new AccessDenied(403);
        const today = chicagoDate(now()).date, since = [from, addDays(today, 1 - WINDOW_DAYS)].sort().at(-1)!;
        const readings = (await confirmedReadings(tx, actor.tenantId, student.id)).filter(row => row.kind === "torah" || row.kind === "haftarah");
        const byId = new Map(readings.map(row => [row.id, { kind: row.kind as PracticeKind, order: new Map(row.verses.map((ref, index) => [ref, index])) }]));
        await data.setReader(tx, actor.roleGrantId);
        const openedRows = since <= today ? await data.opened(tx, actor.tenantId, student.id, since, today) : [];
        const markRows = await data.marks(tx, actor.tenantId, student.id);
        const learnRow = await data.learn(tx, actor.tenantId, student.id);
        await data.clearReader(tx);
        const practised = await data.practisedDays(tx, actor.tenantId, student.id, addDays(today, 1 - PRACTISED_DAYS), today);
        const lastLesson = await data.lastLesson(tx, actor.tenantId, student.id, today);
        if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);

        // Only the student's current confirmed readings, and only verses still in them.
        const inReading = (assignmentId: string, verseRef: string) => byId.get(assignmentId)?.order.has(verseRef) ?? false;
        const current = markRows.filter(row => isState(row.state) && inReading(row.assignment_id, row.verse_ref));
        const sortKey = (assignmentId: string, verseRef: string) => (byId.get(assignmentId)!.kind === "torah" ? 0 : 1) * 10_000 + byId.get(assignmentId)!.order.get(verseRef)!;
        const marks: PracticeMark[] = current.sort((a, b) => sortKey(a.assignment_id, a.verse_ref) - sortKey(b.assignment_id, b.verse_ref))
          .map(row => Object.freeze({ kind: byId.get(row.assignment_id)!.kind, verseRef: row.verse_ref, state: row.state as PracticeMarkState,
            withParent: row.source_mode === null ? null : row.source_mode === "child-practice" }));

        const days: PracticeDay[] = [];
        for (let day = today; day >= since; day = addDays(day, -1)) {
          const dayReadings: PracticeDayReading[] = [];
          for (const kind of KINDS) {
            const reading = readings.find(row => row.kind === kind);
            if (!reading) continue;
            const order = byId.get(reading.id)!.order, byOrder = (a: string, b: string) => order.get(a)! - order.get(b)!;
            const marked = current.filter(row => row.assignment_id === reading.id && row.day === day && day >= from)
              .sort((a, b) => byOrder(a.verse_ref, b.verse_ref)).map(row => Object.freeze({ verseRef: row.verse_ref, state: row.state as PracticeMarkState }));
            const opened = new Set(openedRows.filter(row => row.day === day && row.kind === kind && row.assignment_id === reading.id && order.has(row.verse_ref)).map(row => row.verse_ref));
            for (const mark of marked) opened.add(mark.verseRef);
            if (opened.size) dayReadings.push(Object.freeze({ kind, opened: Object.freeze([...opened].sort(byOrder)), marked: Object.freeze(marked) }));
          }
          if (dayReadings.length) days.push(Object.freeze({ day, readings: Object.freeze(dayReadings) }));
        }
        const learn = learnRow ? learnSummary(Array.isArray(learnRow.lessons) ? learnRow.lessons.filter(id => typeof id === "string") : [],
          learnRow.boxes && typeof learnRow.boxes === "object" && !Array.isArray(learnRow.boxes) ? learnRow.boxes : {}) : null;
        return Object.freeze({ from, today, days: Object.freeze(days), marks: Object.freeze(marks), practisedDays: practised, lastLesson,
          stillWorking: marks.filter(mark => mark.state === "working").length, learn });
      });
    },
    async parent(request: AccessRequest, selection: { mode: "parent"; studentId: string }): Promise<ParentPractice> {
      if (!gate()) throw new AccessDenied(404);
      if (selection.mode !== "parent") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: "parent", studentId: selection.studentId, capability: "read" }, async (tx, actor, student) => {
        if (actor.mode !== "parent") throw new AccessDenied(403);
        const readings = (await confirmedReadings(tx, actor.tenantId, student.id)).filter(row => row.kind === "torah" || row.kind === "haftarah");
        const verses = new Map(readings.map(row => [row.id, new Set(row.verses)]));
        const rows = await data.markStates(tx, actor.tenantId, student.id, readings.map(row => row.id));
        if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
        const live = rows.filter(row => verses.get(row.assignmentId)?.has(row.verseRef));
        return Object.freeze({ gotIt: live.filter(row => row.state === "got-it").length, working: live.filter(row => row.state === "working").length });
      });
    },
  });
}
export type PracticeVisibilityService = ReturnType<typeof createPracticeVisibilityService>;
