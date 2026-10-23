import type { HebrewSource } from "../../src/lib/hebrew/study-tokens";
import { analyseVerse, type AnalysedVerse } from "../../src/lib/learn/verse";
import type { Melody } from "../../src/lib/learn/course";

// Invented syllables carrying real cantillation codepoints; never a verse of scripture.
export const A = Object.freeze({
  mercha: "֥", munach: "֣", tipcha: "֖", etnachta: "֑", zakef: "֔", revia: "֗", tevir: "֛", darga: "֧",
  pashta: "֙", mahpach: "֤", segol: "֒", zarka: "֮", pazer: "֡", telisha: "֩", kadma: "֨", geresh: "֜", zakefGadol: "֕",
});
const SYLLABLES = ["בָּ", "גַ", "דָ", "הַ", "זָ", "חַ", "טָ", "כָּ", "לַ", "מָ", "נַ", "סָ"];
/** One invented word: two pointed letters with the accent on the first. */
export const w = (accent: string, n = 0) => `${SYLLABLES[n % SYLLABLES.length]}${accent}${SYLLABLES[(n + 3) % SYLLABLES.length]}`;
/** The verse's last word: meteg (silluq) and sof pasuq. */
export const end = (n = 0) => `${SYLLABLES[n % SYLLABLES.length]}ֽ${SYLLABLES[(n + 5) % SYLLABLES.length]}׃`;
export function source(words: readonly string[]): HebrewSource {
  const text = words.join(" ").normalize("NFC");
  return { text, readingText: text, segments: [{ kind: "text", text }], paragraphAfter: null };
}
export function verse(ref: string, words: readonly string[], kind: Melody = "torah", flags: { final?: boolean; endsRecording?: boolean | null; wordReady?: boolean } = {}): AnalysedVerse {
  const value = analyseVerse({ ref, kind, hebrew: source(words), final: flags.final, endsRecording: flags.endsRecording === undefined ? false : flags.endsRecording, wordReady: flags.wordReady ?? true });
  if (!value) throw Error("Synthetic verse refused");
  return value;
}
/** mercha tipcha mercha etnachta | munach zakef | mercha tipcha sof pasuk: three phrases, eight units. */
export const threePhrases = () => [w(A.mercha, 0), w(A.tipcha, 1), w(A.mercha, 2), w(A.etnachta, 3), w(A.munach, 4), w(A.zakef, 5), w(A.mercha, 6), w(A.tipcha, 7), end(8)];
/** The shape of Genesis 1:2's opening: unit 5 is a maqaf pair, so units [4, 6] are reading words [4, 7]. */
export const maqafShape = () => [w(A.mercha, 0), w(A.tipcha, 1), w(A.mercha, 2), w(A.zakef, 3), w(A.mercha, 4), `${w(A.munach, 5)}־${w(A.tipcha, 6)}`, w(A.etnachta, 7), w(A.tipcha, 8), end(9)];
