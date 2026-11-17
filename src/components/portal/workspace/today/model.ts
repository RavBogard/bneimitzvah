// 1.9 N11: what the student's Today screen shows, as pure functions over data the student's own workspace reads already return
// (the assigned reading, the verse marks, the practice calendar dates, the lesson notes). Nothing here fetches or stores anything.
import type { Reading, Student } from "../api";
import { NAMED_READINGS } from "../../../../lib/readings/named-readings";
import { refFromVerses } from "../../../../lib/print/print-address";
import { sectionsFromStarts, sectionLabel } from "../../../../lib/readings/sections";
import type { ProgressVerse } from "../../../../lib/progress/types";
import { dayOrdinal, dayString } from "../practice-calendar/api";

const dateParts = (date: string) => date.split("-").map(Number) as [number, number, number];
export const shortDay = (date: string) => { const [year, month, day] = dateParts(date); return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day)); };

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

/** The one "what is next" line on the pinned card: "Rehearsal today", "Next: Rehearsal Sat, Dec 12", then "Next: Beit Mitzvah Sat, Dec 26" once rehearsals are past; nothing after the ceremony day. */
export function nextDateLine(student: Pick<Student, "rehearsal1" | "rehearsal2" | "ceremonyDate">, today: string): string | null {
  const dates = [student.rehearsal1, student.rehearsal2].filter((value): value is string => !!value).sort();
  if (dates.includes(today)) return "Rehearsal today";
  const rehearsal = dates.find(date => date > today);
  if (rehearsal) return `Next: Rehearsal ${shortDay(rehearsal)}`;
  return student.ceremonyDate > today ? `Next: Beit Mitzvah ${shortDay(student.ceremonyDate)}` : null;
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

/** The student's reading page with Up close open (student gaps A3). `upCloseHref` names the verse; the bare address opens at the first verse on the page not marked Got it. */
export const UP_CLOSE_HREF = "/mine/reading#up-close";
export const upCloseHref = (kind: Reading["kind"], ref: string) => `${UP_CLOSE_HREF}:${kind}:${encodeURIComponent(ref)}`;
/** What an Up close address asks for: one verse, the first unmarked verse ("first"), or nothing. */
export function upCloseTarget(hash: string): { kind: Reading["kind"]; ref: string } | "first" | null {
  const value = hash.replace(/^#/, "");
  if (value === "up-close") return "first";
  const match = /^up-close:(torah|haftarah):(.+)$/.exec(value); if (!match) return null;
  try { return { kind: match[1] as Reading["kind"], ref: decodeURIComponent(match[2]) }; } catch { return null; }
}
/** The Run-through of the student's own reading (1.9 N19): the Torah when there is one, else the haftarah. */
export const runThroughHref = (readings: readonly Pick<Reading, "kind">[]) => readings.some(row => row.kind === "torah") || !readings.length ? "/learn/run-through" : "/learn/run-through?kind=haftarah";
export const NEXT_STEP = Object.freeze({ upClose: "Practise up close", runThrough: "Run-through", open: "Open my reading", practise: (where: string) => `Practise ${where}` });

/** A student session whose own reading is not linked yet (student gaps A8: was "No student is currently linked to this role."). */
export const UNLINKED_LINE = "Your reading is not linked to this account yet. Ask your tutor or rabbi for help.";

export type NextStep = Readonly<{ kind: "verse"; reading: Reading["kind"]; ref: string; label: string; href: string } | { kind: "run-through"; label: string; href: string }>;
/**
 * The one next step on the student's own reading (student gaps A3, restoring 1.9 N11's Next card): Up close at the first verse not yet marked Got it, named by
 * its verse and, where the tutor recorded aliyot, its aliyah; once every verse is marked Got it, the Run-through. Null when no verse is assigned.
 */
export function nextStep(readings: readonly Reading[], marks: ReadonlyMap<Reading["kind"], readonly Pick<ProgressVerse, "verseRef" | "selfCheck">[]>): NextStep | null {
  if (!readings.some(reading => reading.verses.length)) return null;
  const rows = readingRows(readings);
  for (const reading of readings) {
    const got = new Set((marks.get(reading.kind) ?? []).filter(verse => verse.selfCheck.state === "got-it").map(verse => verse.verseRef));
    const index = reading.verses.findIndex(ref => !got.has(ref)); if (index < 0) continue;
    const ref = reading.verses[index], row = rows.find(item => item.kind === reading.kind && item.key !== reading.kind && index >= item.start && index < item.end);
    return { kind: "verse", reading: reading.kind, ref, label: NEXT_STEP.practise(`${row ? `${row.label} · ` : ""}${displayRef(ref)}`), href: upCloseHref(reading.kind, ref) };
  }
  return { kind: "run-through", label: NEXT_STEP.runThrough, href: runThroughHref(readings) };
}

/** The seven days ending on the server's day, oldest first, each with whether the student practiced. Dates only: no count, ever. */
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
