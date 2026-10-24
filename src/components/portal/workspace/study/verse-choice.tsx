"use client";

/**
 * How the text shows "Choose verses" (release 1.7, M2b): while choosing, each verse's number becomes a toggle (a pressed
 * state and a check mark, never colour alone) and a tap on a word does nothing, so the Study word card and Lein playback
 * are exactly as they were once choosing ends. Outside choosing, the verses of a whole portion that belong to the
 * selection are marked with the same check. The selection itself lives in public-reading/choose-verses.tsx.
 */
export type VerseChoiceView = Readonly<{
  choosing: boolean;
  /** The verses chosen so far (choosing). */
  selected: ReadonlySet<string>;
  /** The verses of the selection a whole portion is showing, marked while not choosing. */
  marked: ReadonlySet<string>;
  onToggle(ref: string, shift: boolean): void;
}>;

export const ChoiceCheck = () => <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" data-verse-check="">
  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** What a verse says about itself to the text around it: chosen now, or marked as part of the selection. */
export function verseState(choice: VerseChoiceView | undefined, ref: string): { choosing: boolean; picked: boolean; marked: boolean } {
  if (!choice) return { choosing: false, picked: false, marked: false };
  return { choosing: choice.choosing, picked: choice.choosing && choice.selected.has(ref), marked: !choice.choosing && choice.marked.has(ref) };
}
