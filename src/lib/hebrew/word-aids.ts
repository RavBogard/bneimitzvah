import { TANAKH_VERSE_COUNTS } from "../readings/catalog";

export const WORD_AID_SCHEMA = "study-word-aids/v1" as const;
/** Client safety bounds, not claims about the producer corpus. UTF-16 ranges. */
export const WORD_AID_LIMITS = Object.freeze({ words: 512, sourceBytes: 8192, perWord: 64, syllables: 2048, bytes: 128 * 1024 });
export type WordAidSyllable = Readonly<{ start: number; end: number; stress: "tonic" | "secondary" | null }>;
export type WordAid = Readonly<{ index: number; status: "ready"; syllables: readonly WordAidSyllable[] }>
  | Readonly<{ index: number; status: "unavailable"; reason: "unaccented" | "special-reading" | "unproven" }>;
export type StudyWordAids = Readonly<{ schema: typeof WORD_AID_SCHEMA; ref: string; status: "unavailable"; reason: "reconstruction" | "unsupported-system" | "analysis-unavailable" }>
  | Readonly<{ schema: typeof WORD_AID_SCHEMA; ref: string; status: "ready"; readingTextSha256: string; wordCount: number; words: readonly WordAid[] }>;
/** Hash the ACTUAL rendered NFC readingText independently; never echo DTO hash. */
export type WordAidBinding = Readonly<{ ref: string; readingTextSha256?: string; words?: readonly string[] }>;
const letter = /^[א-תװ-ײיִ-ﭏ]/u;
const encoded = (value: string) => new TextEncoder().encode(value).length;
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
  const out: unknown[] = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) return null; out.push(d.value); }
  return out;
}
export function wordAidRef(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  const m = /^(.+) ([1-9][0-9]*):([1-9][0-9]*)$/.exec(value), count = m && TANAKH_VERSE_COUNTS[m[1]]?.[Number(m[2]) - 1];
  return Boolean(m && count && Number(m[3]) <= count);
}
export function parseStudyWordAids(value: unknown, expected: WordAidBinding): StudyWordAids | null {
  try {
    const binding = row(expected, ["ref", "readingTextSha256", "words"], true);
    if (!binding || !wordAidRef(binding.ref)) return null;
    const outer = row(value, ["schema", "ref", "status", "reason", "readingTextSha256", "wordCount", "words"], true);
    if (!outer || outer.schema !== WORD_AID_SCHEMA || outer.ref !== binding.ref) return null;
    if (outer.status === "unavailable") {
      if (!row(value, ["schema", "ref", "status", "reason"]) || !["reconstruction", "unsupported-system", "analysis-unavailable"].includes(outer.reason as string)) return null;
      return Object.freeze({ schema: WORD_AID_SCHEMA, ref: binding.ref, status: "unavailable", reason: outer.reason as "reconstruction" | "unsupported-system" | "analysis-unavailable" });
    }
    if (outer.status !== "ready" || /^(Psalms|Proverbs|Job) /.test(binding.ref) || !row(value, ["schema", "ref", "status", "readingTextSha256", "wordCount", "words"])
      || typeof binding.readingTextSha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.readingTextSha256) || outer.readingTextSha256 !== binding.readingTextSha256) return null;
    const actualWords = list(binding.words, WORD_AID_LIMITS.words), supplied = list(outer.words, WORD_AID_LIMITS.words);
    if (!actualWords?.length || !supplied || outer.wordCount !== actualWords.length || supplied.length !== actualWords.length) return null;
    let sourceBytes = 0, syllableCount = 0;
    const words: WordAid[] = [];
    for (let index = 0; index < supplied.length; index++) {
      const text = actualWords[index];
      if (typeof text !== "string" || text.length > WORD_AID_LIMITS.sourceBytes || !text.isWellFormed() || text !== text.normalize("NFC") || !letter.test(text)
        || /[^א-תװ-ײיִ-ﭏ\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u034f\u200c\u200d]/u.test(text)
        || (sourceBytes += encoded(text)) > WORD_AID_LIMITS.sourceBytes) return null;
      const item = row(supplied[index], ["index", "status", "reason", "syllables"], true);
      if (!item || item.index !== index) return null;
      if (item.status === "unavailable") {
        if (!row(supplied[index], ["index", "status", "reason"]) || !["unaccented", "special-reading", "unproven"].includes(item.reason as string)) return null;
        words.push(Object.freeze({ index, status: "unavailable", reason: item.reason as "unaccented" | "special-reading" | "unproven" })); continue;
      }
      if (item.status !== "ready" || !row(supplied[index], ["index", "status", "syllables"])) return null;
      const parts = list(item.syllables, WORD_AID_LIMITS.perWord); if (!parts?.length || (syllableCount += parts.length) > WORD_AID_LIMITS.syllables) return null;
      let end = 0, tonic = 0; const syllables: WordAidSyllable[] = [];
      for (const part of parts) {
        const p = row(part, ["start", "end", "stress"]);
        if (!p || p.start !== end || !Number.isSafeInteger(p.end) || (p.end as number) <= end || (p.end as number) > text.length
          || !letter.test(text.slice(end)) || (p.end !== text.length && !letter.test(text.slice(p.end as number)))
          || ![null, "tonic", "secondary"].includes(p.stress as null | "tonic" | "secondary") || (p.stress === "tonic" && ++tonic > 1)) return null;
        end = p.end as number; syllables.push(Object.freeze({ start: p.start as number, end, stress: p.stress as WordAidSyllable["stress"] }));
      }
      if (end !== text.length) return null;
      words.push(Object.freeze({ index, status: "ready", syllables: Object.freeze(syllables) }));
    }
    const result = Object.freeze({ schema: WORD_AID_SCHEMA, ref: binding.ref, status: "ready" as const, readingTextSha256: binding.readingTextSha256, wordCount: words.length, words: Object.freeze(words) });
    return encoded(JSON.stringify(result)) <= WORD_AID_LIMITS.bytes ? result : null;
  } catch { return null; }
}
