/**
 * Two pure splits of a string, shared by the screen and the print sheet:
 * - `hebrewRuns`: Hebrew inside English (Rashi's English quotes the word it translates), so the Hebrew can be set in the Hebrew face
 *   with `lang="he"` instead of the English face, which has no Hebrew glyphs.
 * - `maqafChains`: the words a maqaf joins, so a line never ends on the maqaf.
 * Code point ranges only, never literal combining characters.
 */
const HEBREW = "\\u0590-\\u05FF\\uFB1D-\\uFB4F";
// A Hebrew run: Hebrew letters and marks, continued across a space or a straight quote only when more Hebrew follows (a phrase, or a quoted abbreviation).
const HEBREW_RUN = new RegExp(`[${HEBREW}]+(?:(?:[ \\u00A0]+|["'](?=[${HEBREW}]))[${HEBREW}]+)*`, "gu");

export type TextRun = Readonly<{ text: string; hebrew: boolean }>;
/** The text in order, each stretch marked Hebrew or not. Concatenating the runs gives the text back. */
export function hebrewRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(HEBREW_RUN)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), hebrew: false });
    runs.push({ text: match[0], hebrew: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), hebrew: false });
  return runs;
}

export type ChainRun = Readonly<{ text: string; chain: boolean }>;
/** The text in order, each space-free stretch that holds a maqaf (U+05BE) marked as a chain. Concatenating the runs gives the text back. */
export function maqafChains(text: string): ChainRun[] {
  const runs: ChainRun[] = [];
  for (const piece of text.split(/(\s+)/u)) {
    if (!piece) continue;
    const chain = !/^\s/u.test(piece) && piece.includes("־");
    const previous = runs.at(-1);
    if (previous && previous.chain === chain && !chain) runs[runs.length - 1] = { text: previous.text + piece, chain };
    else runs.push({ text: piece, chain });
  }
  return runs;
}
