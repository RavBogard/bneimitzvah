import { TANAKH_VERSE_COUNTS } from "../readings/catalog";
import type { PracticeDay, PracticeKind, PracticeLearn, PracticeMarkState } from "./types";

/**
 * 1.9 N23: the words of practice visibility. The approved lines (PLAN, tier A strings) are built here and only here:
 * - TP-02, the tutor's per-day line: "Tue Oct 20 · Torah 23:1–23:9 · marked 23:4 Got it"
 * - LD-10, Learn for the tutor: "Often mixed up: tevir and etnachta"; for the student: "Your tutor sees which phrases you can hear."
 * - TP-11, the roster card line: "Practiced 3 of last 7 days · Last lesson Oct 17 · 2 verses still working"
 * - TP-20, a verse's mark for the tutor: "Student (with parent): got it"
 * Small wording decided here in the house voice (listed in the PR): the "Can hear" line, one verse, and leaving out an empty part.
 */
const KIND: Record<PracticeKind, string> = { torah: "Torah", haftarah: "Haftarah" };
const MARK: Record<PracticeMarkState, string> = { working: "Still working", "got-it": "Got it" };
const MARK_LOWER: Record<PracticeMarkState, string> = { working: "still working", "got-it": "got it" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const at = (day: string) => new Date(`${day}T00:00:00Z`);
/** "Tue Oct 20" for 2026-10-20. */
export const dayLabel = (day: string) => { const date = at(day); return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`; };
/** "Oct 17" for 2026-10-17. */
export const shortDate = (day: string) => { const date = at(day); return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`; };

type Ref = { book: string; chapter: number; verse: number };
const parse = (ref: string): Ref | null => {
  const match = /^(.+) ([1-9][0-9]*):([1-9][0-9]*)$/.exec(ref);
  return match ? { book: match[1], chapter: Number(match[2]), verse: Number(match[3]) } : null;
};
const cv = (ref: Ref) => `${ref.chapter}:${ref.verse}`;
const follows = (previous: Ref, next: Ref) => previous.book === next.book && (
  next.chapter === previous.chapter && next.verse === previous.verse + 1
  || next.chapter === previous.chapter + 1 && next.verse === 1 && TANAKH_VERSE_COUNTS[previous.book]?.[previous.chapter - 1] === previous.verse);
/** Verses in reading order as chapter:verse ranges: "23:1–23:9", "23:4", "22:30–23:2". */
export function verseRanges(refs: readonly string[]): string {
  const out: string[] = [];
  let start: Ref | null = null, last: Ref | null = null;
  for (const ref of refs.map(parse)) {
    if (!ref) continue;
    if (start && last && follows(last, ref)) { last = ref; continue; }
    if (start && last) out.push(start === last ? cv(start) : `${cv(start)}–${cv(last)}`);
    start = last = ref;
  }
  if (start && last) out.push(start === last ? cv(start) : `${cv(start)}–${cv(last)}`);
  return out.join(", ");
}
const chapterVerse = (ref: string) => { const parsed = parse(ref); return parsed ? cv(parsed) : ref; };

/** TP-02: "Tue Oct 20 · Torah 23:1–23:9 · marked 23:4 Got it", each reading of the day in turn. */
export function dayLine(day: PracticeDay): string {
  const parts = [dayLabel(day.day)];
  for (const reading of day.readings) {
    parts.push(`${KIND[reading.kind]} ${verseRanges(reading.opened)}`.trim());
    if (reading.marked.length) parts.push(`marked ${reading.marked.map(mark => `${chapterVerse(mark.verseRef)} ${MARK[mark.state]}`).join(", ")}`);
  }
  return parts.join(" · ");
}

/** TP-20: "Student (with parent): got it". A mark made before the source was recorded reads as the student's own. */
export const markLine = (state: PracticeMarkState, withParent: boolean | null) => `Student${withParent ? " (with parent)" : ""}: ${MARK_LOWER[state]}`;

/** TP-11: "Practiced 3 of last 7 days · Last lesson Oct 17 · 2 verses still working". No lesson, or nothing still working, leaves its part out. */
export function rosterLine(input: { practisedDays: number; lastLesson: string | null; stillWorking: number }): string {
  const parts = [`Practiced ${input.practisedDays} of last 7 days`];
  if (input.lastLesson) parts.push(`Last lesson ${shortDate(input.lastLesson)}`);
  if (input.stillWorking > 0) parts.push(`${input.stillWorking} ${input.stillWorking === 1 ? "verse" : "verses"} still working`);
  return parts.join(" · ");
}

/** "Can hear: 6 of 10 Torah phrases" (the learner's own count, REPORT RC2), one line per path the student has begun; Torah alone before either. */
export function canHearLines(learn: PracticeLearn): string[] {
  const lines = (["torah", "haftarah"] as const).filter(melody => learn[melody].heard > 0)
    .map(melody => `Can hear: ${learn[melody].heard} of ${learn[melody].of} ${melody === "torah" ? "Torah" : "haftarah"} phrases`);
  return lines.length ? lines : [`Can hear: 0 of ${learn.torah.of} Torah phrases`];
}
/** LD-10: "Often mixed up: tevir and etnachta", or null with no pair. */
export const mixedUpLine = (learn: PracticeLearn) => learn.mixedUp ? `Often mixed up: ${learn.mixedUp[0]} and ${learn.mixedUp[1]}` : null;

/**
 * The parent's count line (decided in the house voice; the child's name, never a pronoun): "Noa has marked 12 verses Got it and
 * 3 Still working." A part with nothing in it is left out; with no marks at all, "Noa has not marked any verses yet."
 */
export function parentCountLine(name: string, counts: { gotIt: number; working: number }): string {
  const verses = (n: number) => `${n} ${n === 1 ? "verse" : "verses"}`;
  if (counts.gotIt > 0 && counts.working > 0) return `${name} has marked ${verses(counts.gotIt)} Got it and ${counts.working} Still working.`;
  if (counts.gotIt > 0) return `${name} has marked ${verses(counts.gotIt)} Got it.`;
  if (counts.working > 0) return `${name} has marked ${verses(counts.working)} Still working.`;
  return `${name} has not marked any verses yet.`;
}
