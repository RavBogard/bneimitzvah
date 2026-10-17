import "server-only";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { decodeStepMorphology, type Morphology } from "./morphology";

/** STEP TAHOT/TBESH (bd09545c), CC BY 4.0, STEPBible/Tyndale House Cambridge.
 * Adapted from haftarah words.mjs33c04bcb: stricter identities/bounds, immutable
 * internal records, no transliteration, I/O, OSHB fallback or arbitrary LCS. */
export const STEP_LIMITS = Object.freeze({ fileBytes: 32 * 1024 * 1024, lineBytes: 16 * 1024, rows: 200000, verseRows: 512, morphemes: 16, fieldBytes: 2048, glossBytes: 512, codeBytes: 256 });
export class StepSourceUnavailable extends Error { constructor() { super("Lexical source unavailable"); this.name = "StepSourceUnavailable"; } }
const fail = (): never => { throw new StepSourceUnavailable(); };
const size = (text: string) => new TextEncoder().encode(text).length;
const books: Record<string, string> = { Gen: "Genesis", Exo: "Exodus", Lev: "Leviticus", Num: "Numbers", Deu: "Deuteronomy", Jos: "Joshua", Jdg: "Judges", "1Sa": "I Samuel", "2Sa": "II Samuel", "1Ki": "I Kings", "2Ki": "II Kings", Isa: "Isaiah", Jer: "Jeremiah", Ezk: "Ezekiel", Hos: "Hosea", Jol: "Joel", Amo: "Amos", Oba: "Obadiah", Jon: "Jonah", Mic: "Micah", Nam: "Nahum", Hab: "Habakkuk", Zep: "Zephaniah", Hag: "Haggai", Zec: "Zechariah", Mal: "Malachi" };
export type StepLemma = Readonly<{ id: string; lexical: boolean }>;
export type StepWord = Readonly<{ number: number; hebrew: string; sourceGloss: string; lemmas: readonly StepLemma[]; morphology: Morphology; qere: boolean; ketiv: string | null }>;
export type StepReadyVerse = Readonly<{ ref: string; status: "ready"; words: readonly StepWord[] }>;
export type StepVerse = StepReadyVerse | Readonly<{ ref: string; status: "unavailable"; reason: "source-format" }>;
export type StepLexiconEntry = Readonly<{ lemma: string; status: "ready"; hebrew: string; dictionaryGloss: string; morphology: Morphology }> | Readonly<{ lemma: string; status: "unavailable"; reason: "source-format" }>;
// Exact annotation forms present in pinned Torah/Prophets TAHOT; not arbitrary suffixes.
const readingTypes = new Set(["L", "L(AH+B)", "L(E)", "L(F)", "L(P)", "L(S)", "L(V)", "L(a+bh)", "L(abh)", "L(ah+b)", "L(b+p)", "L(p)", "LA(BH)", "LA(bh)", "LAB(H)", "LAB(h)", "LAH(b)", "LB(AH)", "LB(ah)", "LB(ha)", "LBH(A)", "LBH(a)", "LBH(a+C)", "LH(ab)", "Q(K)", "Q(k)", "Q"]);
function field(text: string, bound: number): string {
  if (typeof text !== "string" || text.length > bound || !text.isWellFormed() || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(text) || size(text) > bound) return fail();
  const normalized = text.normalize("NFC"); if (normalized.length > bound || size(normalized) > bound) return fail(); return normalized;
}
function lines(input: string): string[] {
  if (typeof input !== "string" || input.length > STEP_LIMITS.fileBytes || !input.isWellFormed() || size(input) > STEP_LIMITS.fileBytes) return fail();
  const result = input.replace(/^\ufeff/, "").split(/\r?\n/);
  if (result.length > STEP_LIMITS.rows + 10000) return fail();
  for (const line of result) if (line.length > STEP_LIMITS.lineBytes || size(line) > STEP_LIMITS.lineBytes || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(line)) return fail();
  return result;
}
function hebrew(value: string, empty = false): string {
  const text = field(value, STEP_LIMITS.fieldBytes).trim();
  if ((!empty && !/[א-ת]/u.test(text)) || /[^א-ת\u0591-\u05c7\u034f\u200c\u200d/ \-]/u.test(text)) return fail();
  if (text.split("/").length > STEP_LIMITS.morphemes || text && text.split("/").some(p => !/[א-ת]/u.test(p))) return fail(); return text;
}
function ref(book: string, ch: string, v: string): string {
  if (!/^[0-9]{1,3}$/.test(ch) || !/^[0-9]{1,3}$/.test(v) || Number(ch) < 1 || Number(v) < 1 || !books[book] || !TANAKH_VERSE_COUNTS[books[book]]?.[Number(ch) - 1] || Number(v) > TANAKH_VERSE_COUNTS[books[book]][Number(ch) - 1]) return fail();
  return `${books[book]} ${Number(ch)}:${Number(v)}`;
}
function lemmas(value: string): readonly StepLemma[] {
  const text = field(value, STEP_LIMITS.codeBytes).split("\\")[0], parts = text.split("/");
  if (!parts.length || parts.length > STEP_LIMITS.morphemes) return fail(); let lexical = 0;
  return Object.freeze(parts.map(part => { const m = /^(\{)?(H[0-9]{4}[A-Za-z]?)(\})?\+?$/.exec(part); if (!m || Boolean(m[1]) !== Boolean(m[3]) || m[1] && ++lexical > 1) return fail(); return Object.freeze({ id: m[2], lexical: Boolean(m[1]) }); }));
}
function ketiv(meaning: string, spelling: string): string | null {
  const variants = [...meaning.matchAll(/K=\s*\S+\s*\(([^)]*)\)/g)].map(m => m[1]);
  const spellings = [...spelling.matchAll(/K=\s*([^¦;\t]+)/g)].map(m => m[1]);
  const all = [...variants, ...spellings].map(v => hebrew(v.split("\\")[0]));
  if (all.length > 1 && all.some(v => v !== all[0])) return fail(); return all[0] ?? null;
}
export function parseTahot(input: string, bookCode: string): readonly StepVerse[] {
  try {
    if (typeof bookCode !== "string" || bookCode.length > 8 || !Object.hasOwn(books, bookCode)) return fail();
    const groups = new Map<string, StepWord[]>(), held = new Set<string>(), identities = new Set<string>(); let rows = 0;
    for (const line of lines(input)) {
      if (!/^[A-Za-z0-9]+\./.test(line)) continue;
      if (++rows > STEP_LIMITS.rows) return fail();
      const f = line.split("\t"), m = /^([A-Za-z0-9]+)\.([0-9]+)\.([0-9]+)(?:\(([0-9]+)\.([0-9]+)\))?#([0-9]+)=(\S+)$/.exec(f[0]);
      if (!m) return fail();
      if ([m[2], m[3], ...(m[4] === undefined ? [] : [m[4], m[5]])].some(n => !/^[0-9]{1,3}$/.test(n) || Number(n) < 1) || !/^[0-9]{1,4}$/.test(m[6]) || Number(m[6]) < 1) return fail();
      // Excluded LXX rows use their own four-digit ordering namespace, never a read-word index.
      if (m[1] !== bookCode || m[7].startsWith("X")) continue;
      if (m[6].length > 3 || Number(m[6]) > STEP_LIMITS.verseRows) return fail();
      const key = ref(m[1], m[4] ?? m[2], m[5] ?? m[3]);
      if (!groups.has(key)) groups.set(key, []);
      const identity = `${key}#${Number(m[6])}`;
      if (identities.has(identity)) { held.add(key); continue; } identities.add(identity);
      if (held.has(key)) continue;
      try {
        if (f.length < 7 || f.length > 20 || !readingTypes.has(m[7])) return fail();
        const he = hebrew(f[1].split("\\")[0]);
        const grammar = field(f[5], STEP_LIMITS.codeBytes), qere = m[7].startsWith("Q");
        const word = Object.freeze({ number: Number(m[6]), hebrew: he, sourceGloss: field(f[3], STEP_LIMITS.glossBytes), lemmas: lemmas(f[4]), morphology: decodeStepMorphology(grammar), qere,
          ketiv: qere ? ketiv(field(f[6], STEP_LIMITS.fieldBytes), field(f[7] ?? "", STEP_LIMITS.fieldBytes)) : null });
        const group = groups.get(key)!; group.push(word); if (group.length > STEP_LIMITS.verseRows) return fail();
      } catch { held.add(key); }
    }
    return Object.freeze([...groups].map(([ref, words]): StepVerse => {
      words.sort((a, b) => a.number - b.number);
      if (held.has(ref) || !words.length || words.some((w, i) => w.number !== i + 1)) return Object.freeze({ ref, status: "unavailable", reason: "source-format" });
      return Object.freeze({ ref, status: "ready", words: Object.freeze(words) });
    }));
  } catch { return fail(); }
}
const relationships = new Set(["", "a Part of", "in Aramaic of", "a Name of", "combination of", "a group of", "a Spelling of", "a Meaning of", "a form of", "in Hebrew of"]);
export function parseTbesh(input: string): readonly StepLexiconEntry[] {
  try {
    const entries = new Map<string, StepLexiconEntry>(); let rows = 0;
    for (const line of lines(input)) {
      if (!/^H[0-9]/.test(line)) continue; const f = line.split("\t");
      if (++rows > STEP_LIMITS.rows || !/^H[0-9]{4}[A-Za-z]?(?:[A-Za-z0-9#]*)$/.test(f[0])) return fail();
      const raw = field(f[1], 128).trim(), identity = /^(H[0-9]{4}[A-Za-z]?)(?:\s+=\s*(.*))?$/.exec(raw);
      if (!identity) return fail(); const id = identity[1];
      const unavailable: StepLexiconEntry = Object.freeze({ lemma: id, status: "unavailable", reason: "source-format" });
      if (entries.has(id)) { entries.set(id, unavailable); continue; }
      try {
        if (f.length < 7 || f.length > 16 || identity[2] !== undefined && !relationships.has(identity[2])) return fail();
        entries.set(id, Object.freeze({ lemma: id, status: "ready", hebrew: hebrew(f[3]), dictionaryGloss: field(f[6], STEP_LIMITS.glossBytes).trim(), morphology: decodeStepMorphology(field(f[5], STEP_LIMITS.codeBytes)) }));
      } catch { entries.set(id, unavailable); }
    }
    return Object.freeze([...entries.values()]);
  } catch { return fail(); }
}
/** Full ordered correspondence only. No LCS traceback or divine-name rewriting. */
export function alignStepVerse(source: StepVerse | undefined, expected: Readonly<{ ref: string; words: readonly string[] }>): Readonly<{ status: "ready"; ref: string; matches: readonly Readonly<{ index: number; source: StepWord }>[] }> | Readonly<{ status: "unavailable"; reason: "correspondence" }> {
  const unavailable = Object.freeze({ status: "unavailable" as const, reason: "correspondence" as const });
  try {
    if (typeof expected.ref !== "string" || expected.ref.length > 100) return unavailable;
    const m = /^(.+) ([1-9][0-9]*):([1-9][0-9]*)$/.exec(expected.ref);
    if (!m || !TANAKH_VERSE_COUNTS[m[1]]?.[Number(m[2]) - 1] || Number(m[3]) > TANAKH_VERSE_COUNTS[m[1]][Number(m[2]) - 1] || !source || source.status !== "ready" || source.ref !== expected.ref || !Array.isArray(expected.words) || !expected.words.length || expected.words.length > 512 || Reflect.ownKeys(expected.words).length !== expected.words.length + 1 || source.words.length !== expected.words.length) return unavailable;
    const actualWords: string[] = [];
    for (let i = 0; i < expected.words.length; i++) { const d = Object.getOwnPropertyDescriptor(expected.words, String(i)); if (!d || !Object.hasOwn(d, "value") || typeof d.value !== "string") return unavailable; actualWords.push(d.value); }
    let bytes = 0;
    const skeleton = (text: string, canonical: boolean): string => {
      if (typeof text !== "string" || text.length > 8192 || !text.isWellFormed() || canonical && (text !== text.normalize("NFC") || /[^א-ת\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u034f\u200c\u200d]/u.test(text)) || /[^א-ת\u0591-\u05c7\u034f\u200c\u200d/ \-]/u.test(text)) return fail();
      return text.normalize("NFC").replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u034f\u200c\u200d/־׀׃ \-]/gu, "");
    };
    const matches = actualWords.map((word, index) => {
      if ((bytes += size(word)) > 8192) return fail(); const a = skeleton(word, true), entry = source.words[index];
      if (!a || entry.number !== index + 1 || a !== skeleton(entry.hebrew, false)) return fail();
      const copy = Object.freeze({ number: entry.number, hebrew: entry.hebrew, sourceGloss: entry.sourceGloss, qere: entry.qere, ketiv: entry.ketiv, lemmas: Object.freeze(entry.lemmas.map(l => Object.freeze({ id: l.id, lexical: l.lexical }))), morphology: entry.morphology.status === "ready" ? Object.freeze({ status: "ready" as const, language: entry.morphology.language, morphemes: Object.freeze(entry.morphology.morphemes.map(p => Object.freeze({ ...p }))) }) : Object.freeze({ status: "unavailable" as const, reason: "unrecognized-code" as const }) });
      return Object.freeze({ index, source: copy });
    });
    return Object.freeze({ status: "ready", ref: expected.ref, matches: Object.freeze(matches) });
  } catch { return unavailable; }
}
