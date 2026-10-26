// 1.9 N11: what the student's Today screen shows, as pure functions over data the student's own workspace reads already return
// (the assigned reading, the verse marks, the practice calendar dates, the lesson notes). Nothing here fetches or stores anything.
import type { Reading, Student } from "../api";
import { NAMED_READINGS } from "../../../../lib/readings/named-readings";
import { refFromVerses } from "../../../../lib/print/print-address";
import { sectionsFromStarts, sectionLabel } from "../../../../lib/readings/sections";
import type { ProgressVerse } from "../../../../lib/progress/types";
import { dayOrdinal, dayString } from "../practice-calendar/api";

const dateParts = (date: string) => date.split("-").map(Number) as [number, number, number];
const shortDay = (date: string) => { const [year, month, day] = dateParts(date); return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day)); };

/** The device's calendar date as YYYY-MM-DD. The tests pin the browser clock, so this never depends on the day they run. */
export function deviceDate(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The parashah the Torah reading is for, by the week's own key; null for a reading that is not one parashah (or has no key). */
export function parashahName(torah: Pick<Reading, "readingKey"> | undefined): string | null {
  const key = torah?.readingKey; if (!key) return null;
  return NAMED_READINGS.find(row => row.group === "parashah" && row.slug === key)?.name ?? null;
}

/** "Rehearsal today", or "Next rehearsal: Sat, Oct 31" for the first one still to come; nothing once both have passed or none is set. */
export function rehearsalLine(student: Pick<Student, "rehearsal1" | "rehearsal2">, today: string): string | null {
  const dates = [student.rehearsal1, student.rehearsal2].filter((value): value is string => !!value).sort();
  if (dates.includes(today)) return "Rehearsal today";
  const next = dates.find(date => date > today);
  return next ? `Next rehearsal: ${shortDay(next)}` : null;
}

/** A reference as it is read aloud on screen: ranges joined by "; ", numbers joined by an en dash. */
export const displayRef = (ref: string) => ref.replace(/(\d)-(\d)/g, "$1–$2");
/** The segments of a reading's ranges, each one a reference that must stay on one line. */
export const refSegments = (ranges: readonly string[]) => ranges.map(displayRef);

export type RowState = "not-started" | "working" | "solid";
export type TodayRow = Readonly<{ key: string; kind: Reading["kind"]; label: string; ref: string; start: number; end: number }>;

/** The reading's rows: a Torah reading with recorded or calendar aliyot is one row per aliyah; any other reading is one row. */
export function readingRows(readings: readonly Reading[]): readonly TodayRow[] {
  const rows: TodayRow[] = [];
  for (const reading of readings) {
    const sections = reading.kind === "torah" ? sectionsFromStarts(reading.verses, reading.aliyahStarts) : [];
    if (sections.length) {
      for (const section of sections) {
        const ref = refFromVerses(reading.verses.slice(section.start, section.end), "torah");
        rows.push({ key: `torah:${section.n}`, kind: "torah", label: sectionLabel(section.n), ref: displayRef(ref ?? reading.verses[section.start]), start: section.start, end: section.end });
      }
    } else rows.push({ key: reading.kind, kind: reading.kind, label: reading.kind === "torah" ? "Torah" : "Haftarah", ref: reading.ranges.map(displayRef).join("; "), start: 0, end: reading.verses.length });
  }
  return rows;
}

/**
 * How a stretch of verses stands, in the words the app already uses (not started, working, solid). Solid is the tutor's word and
 * only when the tutor has assessed every verse of it as solid; any assessment or a student's own mark beyond "not marked" makes it
 * working, so a student's "Got it" never reads as the tutor's "Solid".
 */
export function rowState(verses: readonly ProgressVerse[], start: number, end: number): RowState {
  const part = verses.slice(start, end);
  if (!part.length) return "not-started";
  if (part.every(verse => verse.assessment.state === "solid")) return "solid";
  return part.some(verse => verse.assessment.state !== "not-started" || verse.selfCheck.state !== "unmarked") ? "working" : "not-started";
}
export const stateWord: Record<RowState, string> = { "not-started": "Not started", working: "Working", solid: "Solid" };

/** The seven days ending on the server's day, oldest first, each with whether the student practised. Dates only: no count, ever. */
export function lastSevenDays(serverDay: string, dates: ReadonlySet<string>): readonly { date: string; practised: boolean; today: boolean; weekday: number }[] {
  const end = dayOrdinal(serverDay);
  return Array.from({ length: 7 }, (_, index) => {
    const ordinal = end - 6 + index, date = dayString(ordinal);
    return { date, practised: dates.has(date), today: ordinal === end, weekday: ((ordinal + 4) % 7 + 7) % 7 };
  });
}

export type DayMark = "rehearsal" | "ceremony";
/** The days the calendar marks: the ceremony, and a rehearsal (the ceremony wins if one falls on it). */
export function calendarMarks(student: Pick<Student, "ceremonyDate" | "rehearsal1" | "rehearsal2">): ReadonlyMap<string, DayMark> {
  const marks = new Map<string, DayMark>();
  for (const date of [student.rehearsal1, student.rehearsal2]) if (date) marks.set(date, "rehearsal");
  marks.set(student.ceremonyDate, "ceremony");
  return marks;
}
