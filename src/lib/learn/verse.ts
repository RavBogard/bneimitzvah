import { colorStudyVerse } from "../hebrew/study-annotations";
import type { HebrewSource } from "../hebrew/study-tokens";
import type { FamilyId } from "../trope/chart-catalog";
import type { Example, Melody, TropeId } from "./course";

/**
 * One verse as the course sees it: the engine's units (a maqaf chain is one unit, as in lessons.json
 * `words`), each with the reading words it spans (the recording's word timeline counts every
 * maqaf-joined word separately, as the Lein player does), its phrase and family from colorStudyVerse,
 * and its accents. Pure; no fetch, no audio.
 */
export type VerseUnit = Readonly<{ index: number; text: string; words: readonly [number, number]; family: FamilyId; phrase: number;
  trope: TropeId | null; accents: readonly TropeId[]; legarmeh: boolean }>;
export type VersePhrase = Readonly<{ index: number; family: FamilyId; units: readonly [number, number] }>;
export type AnalysedVerse = Readonly<{ ref: string; kind: Melody; book: string; units: readonly VerseUnit[]; phrases: readonly VersePhrase[];
  /** Reading words (the timeline's count). */ wordCount: number;
  /** The last verse of a haftarah: its last phrase is the end-of-haftarah family. */ final: boolean;
  /** The last verse of its recording (an aliyah's or a haftarah's end); null when the course cannot tell. */ endsRecording: boolean | null;
  /** The recording has per-word timings, so any phrase can be cut. */ wordReady: boolean }>;

// trope/melody.mjs CP_TROPE, without meteg (a gaya is not a trope; the final word is silluq by position).
const CP_TROPE: Readonly<Record<string, TropeId>> = Object.freeze({
  "֑": "etnachta", "֒": "segol", "֓": "shalshelet", "֔": "zakef-katan", "֕": "zakef-gadol", "֖": "tipcha", "֗": "revia",
  "֘": "zarka", "֙": "pashta", "֚": "yetiv", "֛": "tevir", "֜": "geresh", "֝": "geresh", "֞": "gershayim",
  "֟": "karnei-farah", "֠": "telisha-gedola", "֡": "pazer", "֣": "munach", "֤": "mahpach", "֥": "mercha",
  "֦": "mercha-kefula", "֧": "darga", "֨": "kadma", "֩": "telisha-ketana", "֪": "yerach-ben-yomo", "֮": "zarka",
});
const DISJUNCTIVE: ReadonlySet<TropeId> = new Set<TropeId>(["etnachta", "segol", "shalshelet", "zakef-katan", "zakef-gadol", "tipcha", "revia", "zarka", "pashta",
  "yetiv", "tevir", "geresh", "gershayim", "karnei-farah", "telisha-gedola", "pazer"]);
export const isDisjunctive = (trope: TropeId) => DISJUNCTIVE.has(trope);
/** Signs that lead into the phrase after them rather than closing their own (trope chart wording). */
export const LEADS_ON: ReadonlySet<TropeId> = new Set<TropeId>(["tipcha", "pashta", "yetiv", "zarka", "telisha-gedola", "geresh", "gershayim", "kadma", "darga"]);

/** The passages a reader sings to their own melody (ACTIVITIES.md): never drawn for a drill. */
export function isSpecialMelody(ref: string): boolean {
  const match = /^(.+) ([1-9]\d*):([1-9]\d*)$/.exec(ref); if (!match) return true;
  const [book, chapter, verse] = [match[1], Number(match[2]), Number(match[3])];
  if (book === "Genesis") return chapter === 1 && [5, 8, 13, 19, 23, 31].includes(verse) || chapter === 35 && verse === 22;
  if (book === "Exodus") return chapter === 15 && verse <= 19 || chapter === 20;
  if (book === "Numbers") return chapter === 33 && verse >= 11 && verse <= 49;
  if (book === "Deuteronomy") return chapter === 5;
  return false;
}
const bookOf = (ref: string) => /^(.+) [1-9]\d*:[1-9]\d*$/.exec(ref)?.[1] ?? ref;
const clean = (value: string) => value.normalize("NFC").replace(/͏/g, "");

/** The unit's own trope, as unitTrope picks it: its last disjunctive, else its last accent; munach before a
 * paseq is munach legarmeh; the verse's last unit is silluq. */
function unitTrope(accents: readonly TropeId[], legarmeh: boolean, last: boolean): TropeId | null {
  if (last) return "silluq";
  const main = accents.filter(isDisjunctive).at(-1) ?? accents.at(-1) ?? null;
  return main === "munach" && legarmeh ? "munach-legarmeh" : main;
}

export function analyseVerse(input: { ref: string; kind: Melody; hebrew: HebrewSource; final?: boolean; endsRecording?: boolean | null; wordReady?: boolean }): AnalysedVerse | null {
  const final = input.kind === "haftarah" && input.final === true;
  const colors = colorStudyVerse(input.ref, input.hebrew, { kind: input.kind, confirmed: final, verses: final ? [input.ref] : [] });
  if (colors.status !== "ready") return null;
  const tokens = colors.tokens, units: VerseUnit[] = [];
  const reading = tokens.flatMap((token, k) => token.words.length ? [k] : []);
  for (const [index, k] of reading.entries()) {
    const token = tokens[k];
    if (token.family === null || token.phrase === null) return null;
    const legarmeh = tokens[k + 1]?.kind === "text" && tokens[k + 1].text.trim() === "׀";
    const accents = [...token.text].flatMap(ch => CP_TROPE[ch] ? [CP_TROPE[ch]] : []);
    units.push(Object.freeze({ index, text: token.text, words: Object.freeze([token.words[0], token.words.at(-1)!] as const), family: token.family, phrase: token.phrase,
      trope: unitTrope(accents, legarmeh, index === reading.length - 1), accents: Object.freeze(accents), legarmeh }));
  }
  if (!units.length) return null;
  const phrases: VersePhrase[] = [];
  for (const unit of units) {
    const open = phrases.at(-1);
    if (open && open.index === unit.phrase) phrases[phrases.length - 1] = Object.freeze({ ...open, units: Object.freeze([open.units[0], unit.index] as const) });
    else phrases.push(Object.freeze({ index: unit.phrase, family: unit.family, units: Object.freeze([unit.index, unit.index] as const) }));
  }
  return Object.freeze({ ref: input.ref, kind: input.kind, book: bookOf(input.ref), units: Object.freeze(units), phrases: Object.freeze(phrases),
    wordCount: colors.projection.words.length, final, endsRecording: input.endsRecording ?? null, wordReady: input.wordReady ?? false });
}

/** Does a lessons.json example still describe this verse? Its edge words must be the engine's units there,
 * and its range exactly one phrase of the lesson's family (or, for a whole-verse example, the whole verse
 * with the listed phrases). An example whose text has drifted is dropped, never played. */
export function exampleMatches(verse: AnalysedVerse, example: Example, family: FamilyId | null): boolean {
  const [first, last] = example.words, units = verse.units;
  if (last >= units.length || clean(units[first].text) !== clean(example.firstWord) || clean(units[last].text) !== clean(example.lastWord)) return false;
  if (family) {
    const phrase = verse.phrases.find(row => row.units[0] === first && row.units[1] === last);
    return !!phrase && phrase.family === family;
  }
  if (first !== 0 || last !== units.length - 1 || !example.phrases) return false;
  return example.phrases.length === verse.phrases.length && example.phrases.every((row, i) => row.family === verse.phrases[i].family
    && row.words[0] === verse.phrases[i].units[0] && row.words[1] === verse.phrases[i].units[1]);
}
/** The reading-word span of units [first, last], for the recording's timeline. */
export function unitWords(verse: AnalysedVerse, units: readonly [number, number]): readonly [number, number] | null {
  const a = verse.units[units[0]], b = verse.units[units[1]];
  return a && b && units[0] <= units[1] ? [a.words[0], b.words[1]] : null;
}
