import type { Reading, Student } from "../../components/portal/workspace/api";
import type { StudyVerse } from "../../components/portal/workspace/study/api";
import type { StudyChapter } from "../../components/portal/workspace/study/credits";
import type { GuideLabel, GuideNote, StudentGuideView } from "../../components/portal/workspace/study/guide-api";
import type { ServiceUnitMaterial } from "../service-learning/types";
import type { Teaching } from "../service-course/course";
import { aliyahPosition } from "../readings/aliyah-starts";
import { HAFTARAH_BLESSINGS_PAGES, TORAH_BLESSINGS_PAGE } from "../siddur/pages";

/**
 * The student's study booklet (replacing the study-guide booklet, Track B): which sections print, in order, from what the viewer's own
 * reads returned. Pure, so the assembly is tested without a browser. A section with no data is left out silently: no guide yet, no
 * haftarah, no service parts, no rehearsal dates. Only the student's own verses print in full; the rest of the portion is the guide's
 * overview and its themes' titles and intros. No transliteration anywhere: the service parts print their Hebrew and English only.
 */
export type BookletKind = "torah" | "haftarah";
export type BookletText = Readonly<{ verses: readonly StudyVerse[]; chapters: readonly StudyChapter[] }>;
export type BookletReading = Readonly<{ reading: Reading; text: BookletText; guide: StudentGuideView | null }>;
/** One part on the student's service plan: its unit, the lesson that teaches it (if any), its approved text and Daniel's approved teaching. */
export type BookletPart = Readonly<{ unitId: string; name: string; lesson: string | null; material: ServiceUnitMaterial | null; teaching: Teaching | null }>;
export type BookletInput = Readonly<{ student: Student; tutor: string | null; torah: BookletReading | null; haftarah: BookletReading | null; parts: readonly BookletPart[] }>;

export type BookletNote = Readonly<{ verseRef: string; theme: string; note: GuideNote; label: GuideLabel }>;
export type BookletAliyah = Readonly<{ label: string | null; verses: readonly StudyVerse[]; notes: readonly BookletNote[] }>;
export type BlessingGroup = Readonly<{ kind: BookletKind; parts: readonly BookletPart[]; page: string }>;
export type CoverReading = Readonly<{ kind: BookletKind; name: string | null; ranges: readonly string[]; aliyot: readonly string[] }>;
type Edition = StudyChapter["editions"][number];

export type BookletSection =
  | Readonly<{ kind: "cover"; name: string; ceremonyDate: string; rehearsals: readonly string[]; tutor: string | null; readings: readonly CoverReading[] }>
  | Readonly<{ kind: "blessings"; groups: readonly BlessingGroup[] }>
  | Readonly<{ kind: "about"; reading: BookletKind; overview: string; label: GuideLabel }>
  | Readonly<{ kind: "reading"; reading: BookletKind; ranges: readonly string[]; aliyot: readonly BookletAliyah[] }>
  | Readonly<{ kind: "practice"; reading: BookletKind; ranges: readonly string[]; verses: readonly StudyVerse[] }>
  | Readonly<{ kind: "service"; parts: readonly BookletPart[] }>
  | Readonly<{ kind: "credits"; editions: readonly Edition[]; guideLabels: readonly GuideLabel[]; teaching: boolean; tikkun: boolean }>;

/** The service-course lessons that are the readings' blessings: they print with the blessings, not again among the service parts. */
export const BLESSING_LESSONS: Readonly<Record<BookletKind, readonly string[]>> = Object.freeze({
  torah: Object.freeze(["torah-before", "torah-after"]), haftarah: Object.freeze(["haftarah-before", "haftarah-after"]) });
/** Where the blessings are in the CRC siddur: the same pages the public reading names (siddur-blessings.tsx). */
const BLESSING_PAGES: Readonly<Record<BookletKind, string>> = Object.freeze({ torah: String(TORAH_BLESSINGS_PAGE), haftarah: `${HAFTARAH_BLESSINGS_PAGES.first}–${HAFTARAH_BLESSINGS_PAGES.last}` });

/** A run of verses as one range: "Genesis 37:1–22", or across chapters "Genesis 37:23–38:5". */
export function bookletRange(verses: readonly Pick<StudyVerse, "ref">[]): string {
  if (!verses.length) return "";
  const first = verses[0].ref, last = verses[verses.length - 1].ref;
  if (first === last) return first;
  const a = /^(.*) (\d+):(\d+)$/.exec(first), b = /^(.*) (\d+):(\d+)$/.exec(last);
  if (!a || !b || a[1] !== b[1]) return `${first}–${last}`;
  return a[2] === b[2] ? `${first}–${b[3]}` : `${first}–${b[2]}:${b[3]}`;
}

/** The verses split aliyah by aliyah, as the student's own reading numbers them; a reading with no aliyot is one run with no label. */
export function aliyahRuns(reading: Pick<Reading, "kind" | "aliyahStarts" | "verses">, verses: readonly StudyVerse[]): { label: string | null; verses: StudyVerse[] }[] {
  const runs: { label: string | null; verses: StudyVerse[] }[] = [];
  verses.forEach((verse, index) => {
    const position = aliyahPosition(reading.kind, reading.aliyahStarts, reading.verses, verse.ref);
    if (index === 0 || position?.startsHere) runs.push({ label: position ? `Aliyah ${position.number}` : null, verses: [] });
    runs[runs.length - 1].verses.push(verse);
  });
  return runs;
}

/** The notes on these verses in verse order: only the rabbi-written additions for this student, each with its theme's title and review label. The Claude-written base guide's verse notes never print (Study v6, Daniel 2026-10-28). */
export function notesOn(guide: StudentGuideView | null, verses: readonly StudyVerse[]): BookletNote[] {
  if (!guide) return [];
  const order = new Map(verses.map((verse, index) => [verse.ref, index])), out: BookletNote[] = [];
  for (const part of [guide.additions]) {
    if (!part) continue;
    for (const theme of part.themes) for (const note of theme.notes) if (order.has(note.verseRef)) out.push({ verseRef: note.verseRef, theme: theme.title, note, label: part.label });
  }
  return out.map((note, index) => ({ note, index })).sort((a, b) => order.get(a.note.verseRef)! - order.get(b.note.verseRef)! || a.index - b.index).map(row => row.note);
}

export function bookletSections(input: BookletInput, portionName: (reading: Reading) => string | null = () => null): BookletSection[] {
  const { student } = input, sections: BookletSection[] = [];
  const readings = ([["torah", input.torah], ["haftarah", input.haftarah]] as const)
    .filter((row): row is readonly [BookletKind, BookletReading] => row[1] !== null && row[1].text.verses.length > 0);
  const rehearsals = [student.rehearsal1, student.rehearsal2].filter((value): value is string => typeof value === "string" && value.length > 0).sort();
  sections.push({ kind: "cover", name: `${student.firstName} ${student.lastName}`, ceremonyDate: student.ceremonyDate, rehearsals, tutor: input.tutor,
    readings: readings.map(([kind, row]) => ({ kind, name: kind === "torah" ? portionName(row.reading) : null, ranges: row.reading.ranges,
      aliyot: aliyahRuns(row.reading, row.text.verses).flatMap(run => run.label ? [`${run.label}: ${bookletRange(run.verses)}`] : []) })) });
  if (readings.length) sections.push({ kind: "blessings", groups: readings.map(([kind]) => ({ kind, page: BLESSING_PAGES[kind],
    parts: BLESSING_LESSONS[kind].flatMap(lesson => input.parts.filter(part => part.lesson === lesson && part.material !== null)) })) });
  for (const [kind, row] of readings) {
    const base = row.guide?.base;
    if (base && base.overview.trim()) sections.push({ kind: "about", reading: kind, overview: base.overview, label: base.label });
    sections.push({ kind: "reading", reading: kind, ranges: row.reading.ranges, aliyot: aliyahRuns(row.reading, row.text.verses).map(run => ({ ...run, notes: notesOn(row.guide, run.verses) })) });
    sections.push({ kind: "practice", reading: kind, ranges: row.reading.ranges, verses: row.text.verses });
  }
  const blessingLessons = new Set(Object.values(BLESSING_LESSONS).flat());
  const parts = input.parts.filter(part => part.material !== null && !(part.lesson && blessingLessons.has(part.lesson)));
  if (parts.length) sections.push({ kind: "service", parts });
  const editions = [...new Map(readings.flatMap(([, row]) => row.text.chapters.flatMap(chapter => chapter.editions)).map(edition => [edition.key, edition] as const)).values()];
  const guideLabels = readings.flatMap(([, row]) => [row.guide?.base?.label, row.guide?.additions?.label]).filter((label): label is GuideLabel => Boolean(label));
  const teaching = input.parts.some(part => part.teaching !== null && part.material !== null);
  if (editions.length || guideLabels.length || teaching) sections.push({ kind: "credits", editions, guideLabels, teaching, tikkun: readings.length > 0 });
  return sections;
}
