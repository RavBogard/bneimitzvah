import { canonicalReadingRef } from "./reading-ref";
import type { PortionPick } from "../print/portions";

/**
 * The sections a reading is paged by (release 1.9 N3, review decision 2): the calendar's aliyot 1 to 7 and the maftir, or a
 * tutor's recorded aliyot. A section is a run of whole verses of the passage on screen, by position (`start` to `end`, the
 * end excluded). Sections may overlap (the maftir repeats the end of the seventh aliyah). Numbers and refs only; nothing here
 * reads a text.
 */
export type SectionRow = Readonly<{ n: string; ref: string }>;
export type Section = Readonly<{ n: string; label: string; start: number; end: number }>;
/** The labels print uses: "Aliyah 4" and "Maftir". */
export const sectionLabel = (n: string): string => n === "M" ? "Maftir" : `Aliyah ${n}`;

/**
 * The sections of `verses` (the passage's verses, in order) that `rows` name, in the order given. A row whose verses are not all in the
 * passage, or do not follow one another there, is left out. Fewer than two sections is no paging at all, so it is none.
 */
export function sectionsOf(rows: readonly SectionRow[], verses: readonly string[]): readonly Section[] {
  const at = new Map(verses.map((ref, index) => [ref, index] as const)), out: Section[] = [], seen = new Set<string>();
  for (const row of rows) {
    const canonical = canonicalReadingRef(row.ref, "torah");
    if (!canonical || seen.has(row.n)) continue;
    const places = canonical.verses.map(ref => at.get(ref));
    if (places.some((place, index) => place === undefined || index > 0 && place !== places[index - 1]! + 1)) continue;
    seen.add(row.n); out.push(Object.freeze({ n: row.n, label: sectionLabel(row.n), start: places[0]!, end: places.at(-1)! + 1 }));
  }
  return Object.freeze(out.length >= 2 ? out : []);
}

/** Sections from recorded aliyah starts (the workspace's): one per start, the first verse implicit, each ending where the next begins. */
export function sectionsFromStarts(verses: readonly string[], starts: readonly string[] | null): readonly Section[] {
  if (starts === null || starts.length === 0 || verses.length < 2) return Object.freeze([]);
  const cuts = [0, ...starts.map(ref => verses.indexOf(ref))];
  if (cuts.some((cut, index) => cut < 0 || index > 0 && cut <= cuts[index - 1])) return Object.freeze([]);
  return Object.freeze(cuts.map((start, index) => Object.freeze({ n: String(index + 1), label: sectionLabel(String(index + 1)), start, end: cuts[index + 1] ?? verses.length })));
}

/** The section that holds a verse position; the maftir, which repeats verses of another section, is only the answer when nothing else holds it. */
export function sectionIndexAt(sections: readonly Section[], position: number): number {
  const found = sections.findIndex(section => section.n !== "M" && section.start <= position && position < section.end);
  return found >= 0 ? found : sections.findIndex(section => section.start <= position && position < section.end);
}

/** Where each section begins inside the verses [start, end): relative verse index and label. The section being shown is named first where two begin on one verse. */
export function labelsIn(sections: readonly Section[], current: number, start: number, end: number): readonly { index: number; label: string }[] {
  const out = new Map<number, string>();
  const order = current >= 0 ? [sections[current], ...sections.filter((_, index) => index !== current)] : sections;
  for (const section of order) if (section.start >= start && section.start < end && !out.has(section.start - start)) out.set(section.start - start, section.label);
  return [...out].map(([index, label]) => ({ index, label })).sort((a, b) => a.index - b.index);
}

/** The pick that names a section: an aliyah or the maftir of the full calendar portion; every section of the triennial reading is the triennial pick. */
export function pickOfSection(division: "full" | "triennial", n: string): PortionPick {
  if (division === "triennial") return "triennial";
  return n === "M" ? "maftir" : `aliyah-${Number(n) as 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
}
/** The section a pick opens on (its `n`), or null when the pick names no single section (the whole portion, or the triennial reading). */
export function sectionOfPick(pick: PortionPick | null | undefined): string | null {
  if (!pick || pick === "full" || pick === "triennial") return null;
  return pick === "maftir" ? "M" : pick.slice(7);
}
