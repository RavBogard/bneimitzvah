/**
 * The comment-to-word link (spec 2026-10-22 §3.2): a commentary's quoted words
 * (the dibbur hamatchil) are found in its verse by letters alone. Vowels,
 * cantillation, punctuation and the maqaf are ignored and final letters compare
 * equal to their ordinary forms. A link is offered only when the quoted words
 * occur exactly once, as consecutive whole words of the verse; anything else
 * (no match, two matches, an abbreviation we do not know) is no link. Never guess.
 */
const FINALS: Readonly<Record<string, string>> = Object.freeze({ "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" });
/** What separates words: space, maqaf, paseq, sof pasuq, slashes, dashes and punctuation. */
const BREAK = /[\s־׀׃|/\\\-‐-—.,:;!?()[\]{}]/u;
const BREAKS = new RegExp(`${BREAK.source}+`, "u");
// Geresh and gershayim (Hebrew and ASCII stand-ins) mark abbreviations in the quoted words.
const ABBREVIATION = /[׳״'"’”]/;
const ABBREVIATION_MARKS = /[׳״'"’”]/g;
/** Rashi's "etc." after the quoted words: the quotation is the words before it. */
const ETCETERA = new Set(["וגו", "וגומר", "וכו", "כו", "וגומ"]);
/** The one abbreviation that names a single word for certain: the Tetragrammaton. */
const DIVINE_NAME = "יהוה";
/** Whole-word written substitutes for the Tetragrammaton that commentaries print in place of it. */
const NAME_SUBSTITUTES = new Set(["יי", "יקוק", "ידוד"]);
/**
 * The written euphemism for Elohim and its forms (אלקים, אלקיך, לאלקי, אלוקים): a quoted word matches a
 * verse word when it is the same, or the same once ק (after אל, with or without ו) is read as ה.
 * Applied to the quotation only and compared exactly, so it can only find the verse's own spelling.
 */
const euphemism = (word: string) => word.replace(/אלו?ק/g, "אלה");
const sameWord = (quoted: string, verse: string) => quoted === verse || euphemism(quoted) === verse;

/** Letters only, final forms folded; maqaf, paseq, sof pasuq and every other mark or sign become nothing or a word break. */
export function hebrewLetters(text: string): string {
  let out = "";
  for (const char of text.normalize("NFD")) {
    if (char >= "א" && char <= "ת") out += FINALS[char] ?? char;
    else if (BREAK.test(char)) out += " ";
    // Points, cantillation, meteg, rafe, CGJ, direction marks and the like: no letter, no break.
  }
  return out.replace(/ +/g, " ").trim();
}

/** The quoted words as letter-only words, or null when they cannot be read without guessing. */
export function dibburWords(dibbur: string): readonly string[] | null {
  // Bracketed and parenthesized insertions are an editor's, not the verse's.
  const cleaned = dibbur.replace(/\[[^\]]*\]|\([^)]*\)/g, " ");
  const words: string[] = [];
  // Split first, so an abbreviation mark always belongs to the one word it is written on.
  for (const raw of cleaned.split(BREAKS)) {
    if (!raw) continue;
    const abbreviated = ABBREVIATION.test(raw), letters = hebrewLetters(raw.replace(ABBREVIATION_MARKS, ""));
    if (!letters) continue;
    if (letters.includes(" ")) return null; // Unreachable after the split; kept so no mark can ever join two words.
    if (abbreviated) {
      if (letters === "ה") { words.push(DIVINE_NAME); continue; }
      if (ETCETERA.has(letters)) break;
      return null;
    }
    if (ETCETERA.has(letters) && words.length) break;
    words.push(NAME_SUBSTITUTES.has(letters) ? DIVINE_NAME : letters);
  }
  return words.length ? Object.freeze(words) : null;
}

export type DibburMatch = Readonly<{ first: number; last: number }>;
/**
 * The verse's word range quoted by `dibbur`, when it occurs exactly once; otherwise null.
 * A verse word may be several letter-words joined by a maqaf (אֶל־אַבְרָם is one word of the
 * verse); a quotation must begin at the start of a verse word and end at the end of one, so
 * half of a joined word is never taken for the whole.
 */
export function matchDibbur(dibbur: string | null | undefined, verseWords: readonly string[]): DibburMatch | null {
  if (!dibbur) return null;
  const quoted = dibburWords(dibbur);
  if (!quoted) return null;
  const parts: { word: number; letters: string; first: boolean; last: boolean }[] = [];
  verseWords.forEach((word, index) => {
    const pieces = hebrewLetters(word).split(" ").filter(Boolean);
    pieces.forEach((letters, piece) => parts.push({ word: index, letters, first: piece === 0, last: piece === pieces.length - 1 }));
  });
  let found: DibburMatch | null = null;
  for (let start = 0; start + quoted.length <= parts.length; start++) {
    const end = start + quoted.length - 1;
    if (!parts[start].first || !parts[end].last || !quoted.every((word, offset) => sameWord(word, parts[start + offset].letters))) continue;
    if (found) return null; // Twice in the verse: which one is meant is a guess.
    found = Object.freeze({ first: parts[start].word, last: parts[end].word });
  }
  return found;
}
