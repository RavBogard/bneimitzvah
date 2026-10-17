import "server-only";
import { createHash } from "node:crypto";
import { verseUnits } from "../../../trope/text.mjs";
import { projectStudyVerse } from "../../lib/hebrew/study-tokens";
import { parseStudyWordAids, WORD_AID_SCHEMA, WORD_AID_LIMITS, wordAidRef, type StudyWordAids, type WordAid, type WordAidSyllable } from "../../lib/hebrew/word-aids";
import type { StudyVerse } from "./types";

const unavailable = (ref: string, reason: "reconstruction" | "unsupported-system" | "analysis-unavailable"): StudyWordAids => Object.freeze({ schema: WORD_AID_SCHEMA, ref, status: "unavailable", reason });
const fail = () => { throw new Error("Word aids unavailable"); };
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return fail(); return value as Record<string, unknown>; };
const array = (value: unknown, bound: number): unknown[] => { if (!Array.isArray(value) || value.length > bound) return fail(); return value; };
const literal = (value: unknown): string => typeof value === "string" ? value.normalize("NFC") : fail();
const withoutSeparators = (value: unknown) => literal(value).replace(/[־׃׀]/gu, "");
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Pure guide from the authorized parsed verse; no raw HTML, provider or audio. */
export function createStudyWordAids(verse: StudyVerse): StudyWordAids | null {
  let ref = "";
  try {
    const candidate = verse?.ref;
    if (!wordAidRef(candidate)) return null;
    ref = candidate;
    let p;
    try { p = projectStudyVerse(ref, verse.hebrew); } catch { return unavailable(ref, "reconstruction"); }
    if (p.status !== "ready") return unavailable(ref, "reconstruction");
    if (/^(Psalms|Proverbs|Job) /.test(ref)) return unavailable(ref, "unsupported-system");
    const projection = p.projection, expected = projection.words.map(word => word.text);
    const hash = createHash("sha256").update(projection.readingText.normalize("NFC")).digest("hex");
    const analysis = object(verseUnits(escape(projection.readingText), { ref }));
    if (array(analysis.warnings, WORD_AID_LIMITS.words).length || literal(analysis.he) !== projection.readingText) return unavailable(ref, "analysis-unavailable");
    const units = array(analysis.units, WORD_AID_LIMITS.words), words: WordAid[] = []; let next = 0, remaining = literal(analysis.he);
    for (let ui = 0; ui < units.length; ui++) {
      const unit = object(units[ui]), rawWords = array(unit.words, WORD_AID_LIMITS.words).map(literal), text = literal(unit.text);
      remaining = remaining.replace(/^[\s׀]*/u, "");
      if (rawWords.join("") !== text || !remaining.startsWith(text)) return fail();
      remaining = remaining.slice(text.length);
      const originals = rawWords.map(withoutSeparators);
      if (!originals.length || originals.some((word, i) => !word || word !== expected[next + i])) return fail();
      const syllables = array(unit.syllables, WORD_AID_LIMITS.syllables).map(object), accents = array(unit.accents, WORD_AID_LIMITS.syllables).map(object);
      const special = syllables.some(s => Object.hasOwn(s, "read"));
      const explicit = originals.some(word => /[\u0591-\u05af]/u.test(word));
      const silluq = ui === units.length - 1 && projection.readingText.endsWith("׃") && accents.some(a => a.cp === "05BD" && a.name === "silluq");
      const tonic = syllables.filter(s => s.stress === "tonic"), accentNames = new Set(accents.map(a => a.name));
      const ambiguous = originals.some(word => new Set([...word].filter(ch => /[\u0591-\u05af]/u.test(ch))).size > 1);
      const proven = !ambiguous && (explicit || silluq) && tonic.length === 1 && typeof tonic[0].accent === "string" && accentNames.has(tonic[0].accent)
        && syllables.every(s => [null, "tonic", "secondary"].includes(s.stress as null | "tonic" | "secondary") && (s.stress === null || accentNames.has(s.accent) || s.stress === "secondary" && s.meteg === true && literal(s.he).includes("ֽ")));
      if (syllables.some(s => !Number.isSafeInteger(s.word) || (s.word as number) < 0 || (s.word as number) >= originals.length)) return fail();
      for (let wi = 0; wi < originals.length; wi++) {
        const index = next++, own = syllables.filter(s => s.word === wi), pieces = own.map(s => literal(s.he));
        if (!own.length || pieces.join("") !== originals[wi]) return fail();
        if (special || !proven) { words.push({ index, status: "unavailable", reason: special ? "special-reading" : !explicit && !silluq ? "unaccented" : "unproven" }); continue; }
        let offset = 0;
        const ranges = pieces.map((text, i): WordAidSyllable => { const start = offset; offset += text.length; return { start, end: offset, stress: own[i].stress as WordAidSyllable["stress"] }; });
        words.push({ index, status: "ready", syllables: ranges });
      }
    }
    if (next !== expected.length || !/^[\s׀]*$/u.test(remaining)) return fail();
    return parseStudyWordAids({ schema: WORD_AID_SCHEMA, ref, status: "ready", readingTextSha256: hash, wordCount: expected.length, words }, { ref, readingTextSha256: hash, words: expected }) ?? unavailable(ref, "analysis-unavailable");
  } catch { return ref ? unavailable(ref, "analysis-unavailable") : null; }
}
