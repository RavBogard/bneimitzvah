import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { expandReadingRanges, TORAH_BOOKS } from "../../../lib/readings/ranges";
import { parseRange } from "../../../lib/readings/leyning.mjs";
import type { ReadingKind } from "./reading-proposal";

export type Passage = { book: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number };
export const readingBooks = (kind: ReadingKind): readonly string[] => kind === "torah" ? TORAH_BOOKS : Object.keys(TANAKH_VERSE_COUNTS);

/** Never flatten multiple manual ranges or silently repair an invalid reference. */
export function passageFromCustom(custom: string, kind: ReadingKind): Passage | null {
  const refs = custom.split(/\r?\n/).map(ref => ref.trim()).filter(Boolean);
  if (refs.length !== 1) return null;
  try {
    expandReadingRanges(refs, kind, TANAKH_VERSE_COUNTS);
    const range = parseRange(refs[0])!;
    return { book: range.book, startChapter: range.from[0], startVerse: range.from[1], endChapter: range.to[0], endVerse: range.to[1] };
  } catch { return null; }
}

export function passageReference(passage: Passage): string {
  const { book, startChapter, startVerse, endChapter, endVerse } = passage;
  const first = `${book} ${startChapter}:${startVerse}`;
  return startChapter === endChapter && startVerse === endVerse ? first : `${first}-${startChapter === endChapter ? "" : `${endChapter}:`}${endVerse}`;
}

/** Dependent dropdowns keep endpoints in canonical chapter/verse bounds. */
export function changePassage(passage: Passage, field: keyof Passage, value: string): Passage {
  if (field === "book") return { book: value, startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 };
  const next = { ...passage, [field]: Number(value) };
  const counts = TANAKH_VERSE_COUNTS[next.book];
  next.startVerse = Math.min(next.startVerse, counts[next.startChapter - 1]);
  next.endChapter = Math.max(next.startChapter, next.endChapter);
  next.endVerse = Math.min(next.endVerse, counts[next.endChapter - 1]);
  if (next.startChapter === next.endChapter) next.endVerse = Math.max(next.startVerse, next.endVerse);
  return next;
}
