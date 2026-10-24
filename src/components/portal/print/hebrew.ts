import { isHebrewLetter } from "../../../lib/hebrew/tikkun";
import type { SheetScript } from "../../../lib/print/sheet-format";

// The sheet's three Hebrew scripts. Code point ranges only, never literal combining characters in source.
// - full: the text as the edition gives it, vowels and cantillation.
// - vowels: cantillation (U+0591–U+05AF), meteg (U+05BD) and paseq (U+05C0) removed; vowels, dots, maqaf and sof pasuq stay.
// - letters: the scroll's rule (tikkun.ts): letters and word spaces only; a maqaf becomes a word space.
const MAQAF = 0x05be, METEG = 0x05bd, PASEQ = 0x05c0;
const isCantillation = (codePoint: number) => codePoint >= 0x0591 && codePoint <= 0x05af;

export function sheetHebrew(text: string, script: SheetScript): string {
  if (script === "full") return text;
  let out = "";
  for (const char of text.normalize("NFD")) {
    const codePoint = char.codePointAt(0)!;
    if (script === "vowels") { if (!isCantillation(codePoint) && codePoint !== METEG && codePoint !== PASEQ) out += char; }
    else if (isHebrewLetter(codePoint) || /\s/u.test(char)) out += char;
    else if (codePoint === MAQAF) out += " ";
  }
  // A removed paseq or maqaf leaves its spaces behind: one space, as between any two words.
  return out.normalize("NFC").replace(/[ \t ]{2,}/g, " ");
}
