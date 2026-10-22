import type { DisplayRun, HebrewSegment } from "./study-tokens";
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

/** The inverted nun (nun hafukha), which the scroll writes (Numbers 10:35-36). */
export const INVERTED_NUN = String.fromCodePoint(0x05c6);

/**
 * One run of tikkun text: a written word's letters, a single word space, or an inverted-nun sign.
 * `wordIndex` is the reading word whose phrase color the letters take; `words` is every reading word
 * the letters stand for (a ketiv stands for all the words of its qere), for the playing-word highlight.
 */
export type TikkunPiece = { text: string; wordIndex: number | null; words: readonly number[]; sign?: true };

/**
 * The tikkun of a projected verse, split so each written word keeps the reading words of the pointed
 * text it came from. Letters and spaces follow exactly the rules of tikkunText, so with the signs set
 * aside the pieces always spell tikkunText(verse text): text runs give each part's letters; a ketiv/qere
 * alternative writes the written form under its first read word (and stands for all of them); a
 * paragraph gap is a word space; an inverted nun is written where it stands, set off by word spaces.
 */
export function tikkunPieces(runs: readonly DisplayRun[]): TikkunPiece[] {
  const out: { text: string; wordIndex: number | null; words: number[]; sign?: true }[] = [];
  let space = false;
  const open = () => { if (space && out.length) out.push({ text: " ", wordIndex: null, words: [] }); space = false; };
  const add = (value: string, wordIndex: number | null, words: readonly number[]) => {
    for (const char of value.normalize("NFD")) {
      const codePoint = char.codePointAt(0)!;
      if (isHebrewLetter(codePoint)) {
        open();
        const last = out.at(-1);
        if (last && !last.sign && last.text !== " " && last.wordIndex === wordIndex) {
          last.text += char;
          for (const word of words) if (!last.words.includes(word)) last.words.push(word);
        } else out.push({ text: char, wordIndex, words: [...words] });
      } else if (codePoint === MAQAF || /\s/u.test(char)) space = true;
    }
  };
  for (const run of runs) {
    if (run.kind === "text") for (const part of run.parts) add(part.text, part.wordIndex, part.wordIndex === null ? [] : [part.wordIndex]);
    else if (run.kind === "alternative") {
      const read = [...new Set(run.read.flatMap(part => part.wordIndex === null ? [] : [part.wordIndex]))];
      add(run.written, read[0] ?? null, read);
    } else if (run.kind === "gap") space = true;
    else { space = true; open(); out.push({ text: INVERTED_NUN, wordIndex: null, words: [], sign: true }); space = true; }
  }
  return out;
}

/**
 * Where the uncolored tikkun (tikkunText, which has no positions) places inverted nuns: before the
 * letters when one stands before every written letter, after them when one stands after every written
 * letter. Paragraph gaps do not count, so Numbers 10:36's sign before its open-paragraph gap is kept.
 */
export function tikkunSigns(segments: readonly HebrewSegment[]) {
  const lettered = (segment: HebrewSegment) => segment.kind === "alternative"
    || segment.kind === "text" && [...segment.text.normalize("NFD")].some(char => isHebrewLetter(char.codePointAt(0)!));
  const first = segments.findIndex(lettered), last = segments.findLastIndex(lettered);
  const signs = segments.flatMap((segment, index) => segment.kind === "inverted-nun" ? [index] : []);
  return { before: signs.some(index => first < 0 || index < first), after: first >= 0 && signs.some(index => index > last) };
}
