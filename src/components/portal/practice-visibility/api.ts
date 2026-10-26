import { PortalRequestError } from "../api";
import { call, identifier } from "../workspace/api";
import { PRACTICE_VISIBILITY_FROM, practiceVisibilityFrom } from "../../../lib/practice-visibility/release";
import type { LearnHeard, ParentPractice, PracticeDay, PracticeDayReading, PracticeKind, PracticeLearn, PracticeMark, PracticeMarkState, TutorPractice } from "../../../lib/practice-visibility/types";

/**
 * 1.9 N23 display (decision 7): the client of `GET /api/students/{id}/practice-visibility`, the assigned tutor's read and a parent's
 * counts. Nothing is asked while the release gate is closed (both return null without a request), so no tutor or parent line can
 * render before the student's disclosure does. Closed parsers: an unexpected key, a time of day, a duration or a malformed value
 * refuses the whole answer.
 */
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : bad();
const count = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : bad();
const day = (value: unknown) => typeof value === "string" && practiceVisibilityFrom(value) === value ? value : bad();
const kind = (value: unknown): PracticeKind => value === "torah" || value === "haftarah" ? value : bad();
const state = (value: unknown): PracticeMarkState => value === "working" || value === "got-it" ? value : bad();
const verseRef = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9' ]{1,40} [1-9][0-9]{0,2}:[1-9][0-9]{0,2}$/.test(value) ? value : bad();
const family = (value: unknown) => typeof value === "string" && /^[A-Za-z' -]{1,40}$/.test(value) ? value : bad();
const heard = (value: unknown): LearnHeard => { const row = object(value, ["heard", "of"]), of = count(row.of, 100), n = count(row.heard, 100); return n <= of ? { heard: n, of } : bad(); };

export function parseTutorPractice(value: unknown): TutorPractice {
  const row = object(value, ["from", "today", "days", "marks", "practisedDays", "lastLesson", "stillWorking", "learn"]);
  const from = day(row.from), today = day(row.today);
  const days: PracticeDay[] = list(row.days, 14).map(item => {
    const entry = object(item, ["day", "readings"]), date = day(entry.day);
    // Never a day before the release date, and never a day after the server's today.
    if (date < from || date > today) return bad();
    const readings: PracticeDayReading[] = list(entry.readings, 2).map(reading => {
      const r = object(reading, ["kind", "opened", "marked"]);
      return { kind: kind(r.kind), opened: list(r.opened, 2000).map(verseRef), marked: list(r.marked, 2000).map(mark => { const m = object(mark, ["verseRef", "state"]); return { verseRef: verseRef(m.verseRef), state: state(m.state) }; }) };
    });
    return { day: date, readings };
  });
  if (new Set(days.map(entry => entry.day)).size !== days.length) return bad();
  const marks: PracticeMark[] = list(row.marks, 4000).map(item => {
    const m = object(item, ["kind", "verseRef", "state", "withParent"]);
    if (m.withParent !== null && typeof m.withParent !== "boolean") return bad();
    return { kind: kind(m.kind), verseRef: verseRef(m.verseRef), state: state(m.state), withParent: m.withParent as boolean | null };
  });
  let learn: PracticeLearn | null = null;
  if (row.learn !== null) {
    const l = object(row.learn, ["torah", "haftarah", "mixedUp"]);
    const mixedUp = l.mixedUp === null ? null : (() => { const pair = list(l.mixedUp, 2).map(family); return pair.length === 2 ? [pair[0], pair[1]] as const : bad(); })();
    learn = { torah: heard(l.torah), haftarah: heard(l.haftarah), mixedUp };
  }
  return { from, today, days, marks, practisedDays: count(row.practisedDays, 7), lastLesson: row.lastLesson === null ? null : day(row.lastLesson), stillWorking: count(row.stillWorking, 4000), learn };
}
export function parseParentPractice(value: unknown): ParentPractice {
  const row = object(value, ["gotIt", "working"]);
  return { gotIt: count(row.gotIt, 4000), working: count(row.working, 4000) };
}

const path = (studentId: string, mode: "tutor" | "parent") => `/api/students/${identifier(studentId)}/practice-visibility?mode=${mode}`;
export const practiceVisibilityApi = {
  /** The assigned tutor's view; null, with no request, while the gate is closed. `from` is the gate, injectable for tests only. */
  async tutor(studentId: string, signal?: AbortSignal, from: string | null = PRACTICE_VISIBILITY_FROM): Promise<TutorPractice | null> {
    if (!practiceVisibilityFrom(from)) return null;
    return parseTutorPractice(await call(path(studentId, "tutor"), undefined, undefined, signal, 1024 * 1024));
  },
  /** A linked parent's counts; null, with no request, while the gate is closed. */
  async parent(studentId: string, signal?: AbortSignal, from: string | null = PRACTICE_VISIBILITY_FROM): Promise<ParentPractice | null> {
    if (!practiceVisibilityFrom(from)) return null;
    return parseParentPractice(await call(path(studentId, "parent"), undefined, undefined, signal));
  },
};
