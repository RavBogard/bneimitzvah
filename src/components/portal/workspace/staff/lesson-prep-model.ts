// Project review 2026-11-16 (T1, T4/T7): what the tutor's lesson card shows before a lesson, as pure functions over reads the staff page
// already makes (the progress pages, the practice calendar, the lesson notes and, for the assigned tutor only, the practice-visibility read).
// Nothing here fetches or stores anything. Wording is the lead's call in the house voice (CLAUDE.md 2026-10-26) and is listed in the PR.
import type { Reading } from "../api";
import type { ProgressVerse } from "../../../../lib/progress/types";
import type { PracticeKind, TutorPractice } from "../../../../lib/practice-visibility/types";
import { dayLabel, verseRanges } from "../../../../lib/practice-visibility/lines";
import { readingRows, rowState, stateWord, type RowState } from "../today/model";

/** One row of the Aliyot block: an aliyah (or a whole reading with no aliyot), its state, and the verses "Mark … solid" would assess. */
export type AliyahRow = Readonly<{ key: string; kind: Reading["kind"]; label: string; ref: string; state: RowState; word: string; unsolid: readonly ProgressVerse[] }>;

/**
 * T1: the reading's rows (one per aliyah where the tutor recorded aliyot, else one per reading) with Not started / Working / Solid,
 * computed by the same rule as the student's own Today (`rowState`). A row whose marks are not all read yet is left out, so a state
 * is never guessed from part of the verses.
 */
export function aliyahRows(readings: readonly Reading[], marks: ReadonlyMap<Reading["kind"], readonly ProgressVerse[]>): AliyahRow[] {
  const rows: AliyahRow[] = [];
  for (const row of readingRows(readings)) {
    const verses = marks.get(row.kind), reading = readings.find(item => item.kind === row.kind);
    if (!verses || !reading || verses.length !== reading.verses.length) continue;
    const state = rowState(verses, row.start, row.end);
    rows.push(Object.freeze({ key: row.key, kind: row.kind, label: row.label, ref: row.ref, state, word: stateWord[state],
      unsolid: Object.freeze(verses.slice(row.start, row.end).filter(verse => verse.assessment.state !== "solid")) }));
  }
  return rows;
}
/** The row's action: "Mark Aliyah 2 solid", "Mark Haftarah solid". */
export const markSolidLabel = (row: Pick<AliyahRow, "label">) => `Mark ${row.label} solid`;
export const ALIYOT_HEADING = "Aliyot", READINGS_HEADING = "Readings";

const DAY_MS = 86_400_000;
const chapterVerse = (ref: string) => { const match = /(\d+):(\d+)$/.exec(ref); return match ? Number(match[1]) * 1000 + Number(match[2]) : 0; };
const byVerse = (a: string, b: string) => chapterVerse(a) - chapterVerse(b);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Days practiced after the lesson date, through today. Dates only: from the practice calendar staff already read. */
export function practicedSince(dates: Iterable<string>, lessonDate: string, today: string): number {
  let count = 0; for (const date of dates) if (date > lessonDate && date <= today) count++;
  return count;
}
/** "Practiced on 4 days since then", "Practiced on 1 day since then", or "No practice since then". */
export const practicedSinceLine = (days: number) => days > 0 ? `Practiced on ${days} ${days === 1 ? "day" : "days"} since then` : "No practice since then";
/** The block's heading: the assigned tutor's lesson is theirs; an admin reads it as the student's. */
export const sinceHeading = (tutor: boolean) => tutor ? "Since your last lesson" : "Since the last lesson";
/** "Last lesson Tue Nov 10". */
export const lastLessonLine = (lessonDate: string) => `Last lesson ${dayLabel(lessonDate)}`;

/**
 * T7, the assigned tutor only (decision 7): the verses whose current mark was made after the lesson, from the per-day lines' own read, as
 * counts and ranges: "Marked Got it: 3 verses (Torah 23:1–23:3)". The per-day read covers 14 days; when the lesson is older, `from` says
 * where the marks begin. Never called for an admin: admins never get that read.
 */
export function marksSince(view: Pick<TutorPractice, "days" | "from" | "today">, lessonDate: string): { lines: string[]; from: string | null } {
  const windowStart = [view.from, addDays(view.today, -13)].sort().at(-1)!;
  const kinds: PracticeKind[] = ["torah", "haftarah"], got = new Map<PracticeKind, string[]>(), working = new Map<PracticeKind, string[]>();
  for (const day of [...view.days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (day.day <= lessonDate) continue;
    for (const reading of day.readings) for (const mark of reading.marked) {
      const into = mark.state === "got-it" ? got : working;
      into.set(reading.kind, [...into.get(reading.kind) ?? [], mark.verseRef]);
    }
  }
  const KIND: Record<PracticeKind, string> = { torah: "Torah", haftarah: "Haftarah" };
  const line = (word: string, refs: Map<PracticeKind, string[]>) => {
    const total = kinds.reduce((sum, kind) => sum + (refs.get(kind)?.length ?? 0), 0);
    if (!total) return null;
    const where = kinds.filter(kind => refs.get(kind)?.length).map(kind => `${KIND[kind]} ${verseRanges([...refs.get(kind)!].sort(byVerse))}`.trim()).join("; ");
    return `Marked ${word}: ${total} ${total === 1 ? "verse" : "verses"} (${where})`;
  };
  const lines = [line("Got it", got), line("Still working", working)].filter((value): value is string => value !== null);
  return { lines: lines.length ? lines : ["No verses newly marked"], from: addDays(lessonDate, 1) < windowStart ? windowStart : null };
}
/** When the lesson is older than the per-day read: "Verse marks from Wed Nov 4 on." */
export const marksFromLine = (day: string) => `Verse marks from ${dayLabel(day)} on.`;
