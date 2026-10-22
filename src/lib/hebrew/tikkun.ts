import type { DisplayRun } from "./study-tokens";
// The tikkun shows a verse as the scroll writes it: consonants and word
// spaces only. Vowels, cantillation, meteg, dots, rafe, paseq and sof pasuq
// are not written in a Torah scroll, and the maqaf is not either; words it
// joins are written as separate words. Callers pass the written (ketiv) text.
// Ranges are code points, never literal combining characters in source.
const ALEF = 0x05d0, TAV = 0x05ea, MAQAF = 0x05be;

/** True for the 27 Hebrew letter code points, final forms included. */
export function isHebrewLetter(codePoint: number) { return codePoint >= ALEF && codePoint <= TAV; }

/** Consonant-only scroll text: Hebrew letters, single spaces between words, nothing else. */
export function tikkunText(written: string): string {
  // NFD separates any precomposed presentation form into its letter and marks.
  let out = "", space = false;
  for (const char of written.normalize("NFD")) {
    const codePoint = char.codePointAt(0)!;
    if (isHebrewLetter(codePoint)) { if (space && out) out += " "; out += char; space = false; }
    else if (codePoint === MAQAF || /\s/u.test(char)) space = true;
    // Everything else, including U+0591–U+05C7 and any other punctuation, is not written.
  }
  return out;
}

/** One run of tikkun text: a word's letters (with its reading-word index) or a single word space. */
export type TikkunPiece = { text: string; wordIndex: number | null };

/**
 * The tikkun of a projected verse, split so each written word keeps the reading-word index of the
 * pointed word it came from. The letters and spaces apply exactly the rules of tikkunText, so the
 * pieces always join to tikkunText(verse text): text runs give each part's letters; a ketiv/qere
 * alternative writes the written form, under the first read word; a paragraph gap is a word space;
 * the inverted nun is not part of the written text (callers place it as TikkunVerse does).
 */
export function tikkunPieces(runs: readonly DisplayRun[]): TikkunPiece[] {
  const out: TikkunPiece[] = [];
  let space = false;
  const add = (value: string, wordIndex: number | null) => {
    for (const char of value.normalize("NFD")) {
      const codePoint = char.codePointAt(0)!;
      if (isHebrewLetter(codePoint)) {
        if (space && out.length) out.push({ text: " ", wordIndex: null });
        space = false;
        const last = out.at(-1);
        if (last && last.text !== " " && last.wordIndex === wordIndex) last.text += char; else out.push({ text: char, wordIndex });
      } else if (codePoint === MAQAF || /\s/u.test(char)) space = true;
    }
  };
  for (const run of runs) {
    if (run.kind === "text") for (const part of run.parts) add(part.text, part.wordIndex);
    else if (run.kind === "alternative") add(run.written, run.read.find(part => part.wordIndex !== null)?.wordIndex ?? null);
    else if (run.kind === "gap") space = true;
  }
  return out;
}
