import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { expandReadingRanges, TORAH_BOOKS } from "../../../lib/readings/ranges";
import { parseRange } from "../../../lib/readings/leyning.mjs";
import { NEVIIM_BOOKS } from "../../../lib/readings/commentary";
import type { ReadingKind } from "./reading-proposal";

export type Passage = { book: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number };
/** The books a passage of this kind may come from. `neviim` narrows a haftarah to the Prophets (the public "Any reading"); the default is unchanged. */
export const readingBooks = (kind: ReadingKind, options: { neviim?: boolean } = {}): readonly string[] =>
  kind === "torah" ? TORAH_BOOKS : options.neviim ? NEVIIM_BOOKS : Object.keys(TANAKH_VERSE_COUNTS);

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

/** Every line must be a valid single passage; otherwise the ranges stay manual. Empty is no passages. */
export function passagesFromCustom(custom: string, kind: ReadingKind): Passage[] | null {
  const refs = custom.split(/\r?\n/).map(ref => ref.trim()).filter(Boolean), passages: Passage[] = [];
  for (const ref of refs) { const passage = passageFromCustom(ref, kind); if (!passage) return null; passages.push(passage); }
  return passages;
}

/** "Add another passage" starts just after the previous one, in the same book when the book continues. */
export function followingPassage(previous: Passage): Passage {
  const counts = TANAKH_VERSE_COUNTS[previous.book];
  let chapter = previous.endChapter, verse = previous.endVerse + 1;
  if (verse > counts[chapter - 1]) { chapter++; verse = 1; }
  if (chapter > counts.length) { chapter = previous.endChapter; verse = previous.endVerse; }
  return { book: previous.book, startChapter: chapter, startVerse: verse, endChapter: chapter, endVerse: verse };
}

/** Aliyah starts presented as choices: each start must follow the previous one inside the selected verses. */
export function divisionChoices(verses: readonly string[], starts: readonly string[], index: number): string[] {
  const after = index === 0 ? 0 : verses.indexOf(starts[index - 1]) + 1, before = index + 1 < starts.length ? verses.indexOf(starts[index + 1]) : verses.length;
  return verses.slice(Math.max(1, after), before < 0 ? verses.length : before);
}

/** A new division splits the last aliyah roughly in half; null when it has no room for another. */
export function addedDivision(verses: readonly string[], starts: readonly string[]): string | null {
  const from = starts.length ? verses.indexOf(starts[starts.length - 1]) : 0;
  if (from < 0 || verses.length - from < 2) return null;
  return verses[from + Math.ceil((verses.length - from) / 2)] ?? null;
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
