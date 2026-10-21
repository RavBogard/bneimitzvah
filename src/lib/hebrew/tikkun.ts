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
