import type { AnalysedVerse, VersePassage, VerseUnit } from "./verse";

/**
 * Where a tap on a Learn word goes (ruling 2026-10-23: a tapped word opens its card, never trope). While a
 * question is open and the tap is its answer, the tap answers; anywhere else it opens the word's card.
 * Nothing here plays: audio stays on the play tiles. Pure; no DOM, no fetch.
 */
export type WordCardTarget = Readonly<{ verse: AnalysedVerse; unit: number; word: number }>;
export type UnitTapRoute = "answer" | "card" | "none";

const MAQAF = /(?<=־)/u;
/** A maqaf unit's words as written, each with its reading-word index; null for a one-word unit or when the
 * written parts do not line up with the unit's reading words. */
export function unitWordParts(unit: VerseUnit): readonly Readonly<{ text: string; word: number }>[] | null {
  const [first, last] = unit.words;
  if (last <= first) return null;
  const parts = unit.text.split(MAQAF);
  if (parts.length !== last - first + 1 || parts.some(part => !part.replace("־", "").trim())) return null;
  return Object.freeze(parts.map((text, k) => Object.freeze({ text, word: first + k })));
}
/** The reading word the card opens on: the maqaf part tapped when it is known, else the unit's first word. */
export function unitCardWord(unit: VerseUnit, part: number | null = null): number {
  const parts = part === null ? null : unitWordParts(unit);
  return parts && Number.isSafeInteger(part) && part! >= 0 && part! < parts.length ? parts[part!].word : unit.words[0];
}
/** The ref-keyed public passage the card asks: this week's reading as loaded, or the verse's own ref. */
export function wordCardPassage(verse: Pick<AnalysedVerse, "ref" | "passage">): VersePassage {
  return verse.passage ?? Object.freeze({ ref: verse.ref, index: 0, count: 1 });
}

/** An answer handler wins while the question is open; with none, a card opener makes the word a card target. */
export function unitTapRoute(input: { answering: boolean; card: boolean }): UnitTapRoute {
  return input.answering ? "answer" : input.card ? "card" : "none";
}
/** The tap on unit `unit` (and, for a maqaf unit, its part), routed. Returns what it did. */
export function routeUnitTap<T>(input: { verse: AnalysedVerse; onAnswer?: (unit: number) => void; openCard?: (target: WordCardTarget, trigger: T) => void },
  unit: number, part: number | null, trigger: T): UnitTapRoute {
  const route = unitTapRoute({ answering: !!input.onAnswer, card: !!input.openCard }), row = input.verse.units[unit];
  if (!row) return "none";
  if (route === "answer") input.onAnswer!(unit);
  else if (route === "card") input.openCard!(Object.freeze({ verse: input.verse, unit, word: unitCardWord(row, part) }), trigger);
  return route;
}
