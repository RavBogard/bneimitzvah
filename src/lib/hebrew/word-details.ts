import { wordAidRef } from "./word-aids";

export const WORD_DETAILS_SCHEMA = "study-word-details/v1" as const;
export const WORD_DETAILS_LIMITS = Object.freeze({ words: 512, entries: 16, morphemes: 16, glossBytes: 512, headwordBytes: 128, sourceBytes: 8192, bytes: 32 * 1024 });
export const WORD_DETAILS_ATTRIBUTION = Object.freeze({ name: "STEPBible / Tyndale House Cambridge", source: "STEPBible-Data", commit: "bd09545c7a44b39ace20f16c0359915f2aa23a62",
  license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", changes: "Normalized into selected-word facts; source-format and correspondence holds retained." });
export type WordGrammarFeature = Readonly<{ partOfSpeech: "verb" | "noun" | "adjective" | "pronoun" | "suffix" | "particle" | "preposition" | "conjunction" | "adverb";
  stem?: string; form?: string; person?: 1 | 2 | 3; gender?: "masculine" | "feminine" | "common" | "either"; number?: "singular" | "plural" | "dual"; state?: "absolute" | "construct" | "definite"; definite?: boolean }>;
export type WordGrammar = Readonly<{ status: "unavailable"; reason: "unrecognized-code" }> | Readonly<{ status: "ready"; language: "hebrew" | "aramaic"; morphemes: readonly WordGrammarFeature[] }>;
export type WordDictionaryEntry = Readonly<{ lemma: string; status: "ready"; headword: string; dictionaryGloss: string }>
  | Readonly<{ lemma: string; status: "unavailable"; reason: "missing" | "source-format" | "bounded" }>;
type Identity = Readonly<{ schema: typeof WORD_DETAILS_SCHEMA; ref: string; readingTextSha256: string; wordCount: number; wordIndex: number; attribution: typeof WORD_DETAILS_ATTRIBUTION }>;
export type StudyWordDetails = Readonly<{ schema: typeof WORD_DETAILS_SCHEMA; ref: string; wordIndex: number; status: "unavailable"; reason: "reconstruction" }>
  | (Identity & Readonly<{ status: "unavailable"; reason: "unsupported-book" | "source-unavailable" | "correspondence" }>)
  | (Identity & Readonly<{ status: "ready"; occurrence: Readonly<{ gloss: string | null; grammar: WordGrammar }>; dictionary: readonly WordDictionaryEntry[] }>);
/** Hash actual rendered NFC readingText independently, never echo a DTO hash. */
export type WordDetailsBinding = Readonly<{ ref: string; wordIndex: number; readingTextSha256?: string; words?: readonly string[] }>;
const encoded = (text: string) => new TextEncoder().encode(text).length;
const stems = new Set(["Qal", "Niphal", "Piel", "Pual", "Hiphil", "Hophal", "Hithpael", "Polel", "Polal", "Hithpolel", "Poel", "Poal", "Palel", "Pulal", "Qal passive", "Pilpel", "Polpal", "Hithpalpel", "Nithpael", "Pealal", "Pilel", "Hothpaal", "Tiphil", "Hishtaphel", "Nithpalel", "Nithpoel", "Hithpoel"]);
const forms = new Set(["perfect", "sequential-perfect", "imperfect", "conjunctive-imperfect", "wayyiqtol", "cohortative", "jussive", "imperative", "active-participle", "passive-participle", "infinitive-absolute", "infinitive-construct"]);
function row(value: unknown, keys: readonly string[], optional = false): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const actual = Reflect.ownKeys(value);
  if ((!optional && actual.length !== keys.length) || actual.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of actual as string[]) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !Object.hasOwn(d, "value")) return null; out[key] = d.value; }
  return out;
}
function list(value: unknown, cap: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > cap || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) return null; copy.push(d.value); }
  return copy;
}
export function wordDetailsPlainText(value: unknown, bound: number): value is string {
  return typeof value === "string" && value.length <= bound && value.isWellFormed() && value === value.normalize("NFC") && encoded(value) <= bound
    && !/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value);
}
export function wordDetailsHeadword(value: unknown): value is string {
  return wordDetailsPlainText(value, WORD_DETAILS_LIMITS.headwordBytes) && /[א-ת]/u.test(value) && !/[^א-ת\u0591-\u05c7\u034f\u200c\u200d/ \-]/u.test(value);
}
export function parseWordGrammar(value: unknown): WordGrammar | null {
  const outer = row(value, ["status", "reason", "language", "morphemes"], true); if (!outer) return null;
  if (outer.status === "unavailable") return row(value, ["status", "reason"]) && outer.reason === "unrecognized-code" ? Object.freeze({ status: "unavailable", reason: "unrecognized-code" }) : null;
  const parts = list(outer.morphemes, WORD_DETAILS_LIMITS.morphemes);
  if (outer.status !== "ready" || !row(value, ["status", "language", "morphemes"]) || !["hebrew", "aramaic"].includes(outer.language as string) || !parts?.length) return null;
  const result: WordGrammarFeature[] = [];
  for (const part of parts) {
    const p = row(part, ["partOfSpeech", "stem", "form", "person", "gender", "number", "state", "definite"], true);
    if (!p || Object.values(p).some(value => value === undefined) || !["verb", "noun", "adjective", "pronoun", "suffix", "particle", "preposition", "conjunction", "adverb"].includes(p.partOfSpeech as string)
      || (p.stem !== undefined && (typeof p.stem !== "string" || !stems.has(p.stem))) || (p.form !== undefined && (typeof p.form !== "string" || !forms.has(p.form)))
      || (p.partOfSpeech === "verb" ? p.stem === undefined || p.form === undefined : p.stem !== undefined || p.form !== undefined)
      || (p.person !== undefined && ![1, 2, 3].includes(p.person as number)) || (p.gender !== undefined && !["masculine", "feminine", "common", "either"].includes(p.gender as string))
      || (p.number !== undefined && !["singular", "plural", "dual"].includes(p.number as string)) || (p.state !== undefined && !["absolute", "construct", "definite"].includes(p.state as string))
      || (p.definite !== undefined && typeof p.definite !== "boolean")) return null;
    result.push(Object.freeze({ ...p }) as WordGrammarFeature);
  }
  return Object.freeze({ status: "ready", language: outer.language as "hebrew" | "aramaic", morphemes: Object.freeze(result) });
}
export function parseStudyWordDetails(value: unknown, expected: WordDetailsBinding): StudyWordDetails | null {
  try {
    const binding = row(expected, ["ref", "wordIndex", "readingTextSha256", "words"], true);
    if (!binding || !wordAidRef(binding.ref) || !Number.isSafeInteger(binding.wordIndex) || (binding.wordIndex as number) < 0 || (binding.wordIndex as number) >= WORD_DETAILS_LIMITS.words) return null;
    const outer = row(value, ["schema", "ref", "wordIndex", "status", "reason", "readingTextSha256", "wordCount", "attribution", "occurrence", "dictionary"], true);
    if (!outer || outer.schema !== WORD_DETAILS_SCHEMA || outer.ref !== binding.ref || outer.wordIndex !== binding.wordIndex) return null;
    if (outer.status === "unavailable" && outer.reason === "reconstruction") {
      return row(value, ["schema", "ref", "wordIndex", "status", "reason"]) ? Object.freeze({ schema: WORD_DETAILS_SCHEMA, ref: binding.ref, wordIndex: binding.wordIndex as number, status: "unavailable", reason: "reconstruction" }) : null;
    }
    if (typeof binding.readingTextSha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.readingTextSha256) || outer.readingTextSha256 !== binding.readingTextSha256) return null;
    const words = list(binding.words, WORD_DETAILS_LIMITS.words); let total = 0;
    if (!words?.length || outer.wordCount !== words.length || (binding.wordIndex as number) >= words.length) return null;
    for (const word of words) if (typeof word !== "string" || word.length > WORD_DETAILS_LIMITS.sourceBytes || !word.isWellFormed() || word !== word.normalize("NFC") || !/^[א-ת]/u.test(word)
      || /[^א-ת\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u034f\u200c\u200d]/u.test(word) || (total += encoded(word)) > WORD_DETAILS_LIMITS.sourceBytes) return null;
    const credit = row(outer.attribution, Object.keys(WORD_DETAILS_ATTRIBUTION));
    if (!credit || Object.entries(WORD_DETAILS_ATTRIBUTION).some(([key, entry]) => credit[key] !== entry)) return null;
    const identity: Identity = Object.freeze({ schema: WORD_DETAILS_SCHEMA, ref: binding.ref, wordIndex: binding.wordIndex as number, readingTextSha256: binding.readingTextSha256, wordCount: words.length, attribution: WORD_DETAILS_ATTRIBUTION });
    if (outer.status === "unavailable") {
      if (!row(value, ["schema", "ref", "wordIndex", "status", "reason", "readingTextSha256", "wordCount", "attribution"]) || !["unsupported-book", "source-unavailable", "correspondence"].includes(outer.reason as string)) return null;
      return Object.freeze({ ...identity, status: "unavailable", reason: outer.reason as "unsupported-book" | "source-unavailable" | "correspondence" });
    }
    if (outer.status !== "ready" || !row(value, ["schema", "ref", "wordIndex", "status", "readingTextSha256", "wordCount", "attribution", "occurrence", "dictionary"])) return null;
    const occurrence = row(outer.occurrence, ["gloss", "grammar"]), dictionary = list(outer.dictionary, WORD_DETAILS_LIMITS.entries);
    const grammar = occurrence && parseWordGrammar(occurrence.grammar);
    if (!occurrence || !grammar || (occurrence.gloss !== null && !wordDetailsPlainText(occurrence.gloss, WORD_DETAILS_LIMITS.glossBytes)) || !dictionary) return null;
    const entries: WordDictionaryEntry[] = [], identities = new Set<string>();
    for (const item of dictionary) {
      const entry = row(item, ["lemma", "status", "reason", "headword", "dictionaryGloss"], true);
      if (!entry || typeof entry.lemma !== "string" || !/^H[0-9]{4}[A-Za-z]?$/.test(entry.lemma) || identities.has(entry.lemma)) return null; identities.add(entry.lemma);
      if (entry.status === "unavailable") {
        if (!row(item, ["lemma", "status", "reason"]) || !["missing", "source-format", "bounded"].includes(entry.reason as string)) return null;
        entries.push(Object.freeze({ lemma: entry.lemma, status: "unavailable", reason: entry.reason as "missing" | "source-format" | "bounded" }));
      } else {
        if (entry.status !== "ready" || !row(item, ["lemma", "status", "headword", "dictionaryGloss"]) || !wordDetailsHeadword(entry.headword) || !wordDetailsPlainText(entry.dictionaryGloss, WORD_DETAILS_LIMITS.glossBytes)) return null;
        entries.push(Object.freeze({ lemma: entry.lemma, status: "ready", headword: entry.headword, dictionaryGloss: entry.dictionaryGloss }));
      }
    }
    const result: StudyWordDetails = Object.freeze({ ...identity, status: "ready", occurrence: Object.freeze({ gloss: occurrence.gloss as string | null, grammar }), dictionary: Object.freeze(entries) });
    return encoded(JSON.stringify(result)) <= WORD_DETAILS_LIMITS.bytes ? result : null;
  } catch { return null; }
}
