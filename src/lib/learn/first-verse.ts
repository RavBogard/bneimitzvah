import type { FamilyId } from "../trope/chart-catalog";
import { isSpecialMelody, type AnalysedVerse } from "./verse";

/** The families every beginner meets first; a verse made only of these is preferred. */
const COMMON: ReadonlySet<FamilyId> = new Set<FamilyId>(["sof-pasuk", "etnachta", "zakef", "revia", "tevir", "sof-haftarah"]);
/** Shortest word-ready verse of the week first, common families first; ties keep reading order. */
export function firstVerseCandidates(verses: readonly AnalysedVerse[], maxWords: number): AnalysedVerse[] {
  const fits = verses.filter(verse => verse.wordReady && !isSpecialMelody(verse.ref) && verse.units.length <= maxWords && verse.units.length >= 2);
  // A verse of two or more phrases (a rest and an ending) teaches more than a one-phrase list.
  const rank = (verse: AnalysedVerse) => (verse.phrases.every(phrase => COMMON.has(phrase.family)) ? 0 : 2) + (verse.phrases.length >= 2 ? 0 : 1);
  return fits.map((verse, order) => ({ verse, order })).sort((a, b) => rank(a.verse) - rank(b.verse) || a.verse.units.length - b.verse.units.length || a.order - b.order).map(row => row.verse);
}

/**
 * A student's own verses for the first-verse lesson (1.9 N17): the verses of their assigned reading that have word-level
 * recordings, in reading order, so the lesson starts where their reading starts and "Another verse" walks on through it.
 * No length cap (it is their verse); a verse with a rare melody goes after the plain ones, and a one-word verse has no phrase to prepare.
 */
export function ownVerseCandidates(verses: readonly AnalysedVerse[]): AnalysedVerse[] {
  const ready = verses.filter(verse => verse.wordReady && verse.units.length >= 2);
  return [...ready.filter(verse => !isSpecialMelody(verse.ref)), ...ready.filter(verse => isSpecialMelody(verse.ref))];
}
