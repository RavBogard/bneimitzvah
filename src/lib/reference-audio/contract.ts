import { TANAKH_VERSE_COUNTS } from "../readings/catalog";

/** Client wire contract only; no media, server crypto, registry or I/O. */
export const REFERENCE_AUDIO_SCHEMA = "reference-verse/v1" as const;
export const REFERENCE_AUDIO_LIMITS = Object.freeze({
  // Safety limit for this client, not a claim about corpus completeness.
  words: 512, minClipSeconds: 0.5, maxClipSeconds: 180,
  // The producer permits 1.5ms beyond a 4h source, rounded to milliseconds.
  maxSourceSeconds: 14400.002,
});
export const REFERENCE_ATTRIBUTION = Object.freeze({
  title: "PocketTorah Audio Files", creator: "not-a-box media lab", license: "CC BY-SA 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  changes: "Cut into single verses with computed word timings.",
});
export const REFERENCE_WORD_REASONS = Object.freeze([
  "portal-text-unavailable", "text-binding-missing", "no-words", "empty-word", "word-count-mismatch",
  "portal-word-punctuation", "text-binding-mismatch", "text-mismatch", "maqaf-mismatch",
  "override-stale", "override-unreviewed", "override-shape",
] as const);
export type ReferenceWordReason = typeof REFERENCE_WORD_REASONS[number];
export type SourceSecondsRange = Readonly<{ start: number; end: number }>;
/** ends (index v2): each after its start and at most the next start (the clip end for the last word),
 * either a fade-out measured in the audio or the next start itself. Without ends a word runs to the
 * next start, as in v1. */
export type ReferenceWords = Readonly<{ status: "ready"; readingTextSha256: string; starts: readonly number[]; ends?: readonly number[] }>
  | Readonly<{ status: "unavailable"; reason: ReferenceWordReason }>;
type AvailablePlayback = Readonly<{ status: "ready"; asset: string; clip: SourceSecondsRange }>
  | Readonly<{ status: "needs-review"; review: "start-moved" | "text-mismatch"; asset: string; clip: SourceSecondsRange }>;
export type AvailableReferenceVerse = Readonly<{
  schema: typeof REFERENCE_AUDIO_SCHEMA; ref: string; table: "torah" | "haftarah";
  playback: AvailablePlayback; words: ReferenceWords; attribution: typeof REFERENCE_ATTRIBUTION;
}>;
export type ReferenceVerse = AvailableReferenceVerse | Readonly<{
  schema: typeof REFERENCE_AUDIO_SCHEMA; ref: string;
  playback: Readonly<{ status: "unavailable"; reason: "asset-not-approved" }>;
  words: Readonly<{ status: "unavailable"; reason: "no-playback" }>;
}>;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(k => typeof k !== "string" || !keys.includes(k))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
    result[key] = descriptor.value;
  }
  return result;
}
function finiteSeconds(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= REFERENCE_AUDIO_LIMITS.maxSourceSeconds; }
function canonicalRef(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  const match = /^(.{1,40}) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(value);
  if (!match || !Object.hasOwn(TANAKH_VERSE_COUNTS, match[1])) return false;
  const chapters = TANAKH_VERSE_COUNTS[match[1]], chapter = Number(match[2]), verse = Number(match[3]);
  return chapter <= chapters.length && verse <= chapters[chapter - 1];
}
function times(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isInteger(length) || length < 1 || length > REFERENCE_AUDIO_LIMITS.words || Reflect.ownKeys(value).length !== length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
    result.push(descriptor.value);
  }
  return result;
}
function onsets(value: unknown, clip: SourceSecondsRange): readonly number[] | null {
  const values = times(value); if (!values) return null;
  const result: number[] = [];
  for (const time of values) {
    if (!finiteSeconds(time) || time < clip.start || time >= clip.end || result.length > 0 && time <= result[result.length - 1]) return null;
    result.push(time);
  }
  return Object.freeze(result);
}
/** One end per start: strictly after it, never past the next start, the last never past the clip end. */
function wordEnds(value: unknown, starts: readonly number[], clip: SourceSecondsRange): readonly number[] | null {
  const values = times(value); if (!values || values.length !== starts.length) return null;
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const time = values[i];
    if (!finiteSeconds(time) || time <= starts[i] || time > (i + 1 < starts.length ? starts[i + 1] : clip.end)) return null;
    result.push(time);
  }
  return Object.freeze(result);
}
const mismatch = new Set<string>(["word-count-mismatch", "text-mismatch", "maqaf-mismatch"]);

/** Consume the actual buildVerseDto wire variants. Invalid/oversize input is
 * unavailable; no repair, normalization, path resolution or mutation occurs. */
export function parseReferenceVerse(value: unknown): ReferenceVerse | null {
  try {
    // Inspect the discriminator without invoking a getter.
    if (!value || typeof value !== "object") return null;
    const playbackValue = Object.getOwnPropertyDescriptor(value, "playback")?.value;
    const status = playbackValue && typeof playbackValue === "object" ? Object.getOwnPropertyDescriptor(playbackValue, "status")?.value : undefined;
    if (status === "unavailable") {
      const dto = record(value, ["schema", "ref", "playback", "words"]), playback = record(playbackValue, ["status", "reason"]);
      const words = dto && record(dto.words, ["status", "reason"]);
      if (!dto || dto.schema !== REFERENCE_AUDIO_SCHEMA || !canonicalRef(dto.ref) || !playback || playback.reason !== "asset-not-approved" || !words || words.status !== "unavailable" || words.reason !== "no-playback") return null;
      return Object.freeze({ schema: REFERENCE_AUDIO_SCHEMA, ref: dto.ref, playback: Object.freeze({ status: "unavailable", reason: "asset-not-approved" }), words: Object.freeze({ status: "unavailable", reason: "no-playback" }) });
    }
    if (status !== "ready" && status !== "needs-review") return null;
    const dto = record(value, ["schema", "ref", "table", "playback", "words", "attribution"]);
    if (!dto || dto.schema !== REFERENCE_AUDIO_SCHEMA || !canonicalRef(dto.ref) || dto.table !== "torah" && dto.table !== "haftarah") return null;
    const playback = record(playbackValue, status === "ready" ? ["status", "asset", "clip"] : ["status", "review", "asset", "clip"]);
    if (!playback || typeof playback.asset !== "string" || !/^ra_[a-f0-9]{32}$/.test(playback.asset) || status === "needs-review" && playback.review !== "start-moved" && playback.review !== "text-mismatch") return null;
    const range = record(playback.clip, ["start", "end"]);
    if (!range || !finiteSeconds(range.start) || !finiteSeconds(range.end) || range.end - range.start < REFERENCE_AUDIO_LIMITS.minClipSeconds || range.end - range.start > REFERENCE_AUDIO_LIMITS.maxClipSeconds) return null;
    const clip = Object.freeze({ start: range.start, end: range.end });
    const attribution = record(dto.attribution, Object.keys(REFERENCE_ATTRIBUTION));
    if (!attribution || Object.entries(REFERENCE_ATTRIBUTION).some(([key, text]) => attribution[key] !== text)) return null;
    const wordStatus = dto.words && typeof dto.words === "object" ? Object.getOwnPropertyDescriptor(dto.words, "status")?.value : undefined;
    let words: ReferenceWords;
    if (wordStatus === "ready") {
      const withEnds = Reflect.ownKeys(dto.words as object).includes("ends");
      const word = record(dto.words, withEnds ? ["status", "readingTextSha256", "starts", "ends"] : ["status", "readingTextSha256", "starts"]);
      if (!word || typeof word.readingTextSha256 !== "string" || !/^[a-f0-9]{64}$/.test(word.readingTextSha256)) return null;
      const starts = onsets(word.starts, clip); if (!starts) return null;
      const ends = withEnds ? wordEnds(word.ends, starts, clip) : undefined; if (ends === null) return null;
      words = Object.freeze(ends ? { status: "ready", readingTextSha256: word.readingTextSha256, starts, ends } : { status: "ready", readingTextSha256: word.readingTextSha256, starts });
    } else {
      const word = record(dto.words, ["status", "reason"]);
      if (!word || word.status !== "unavailable" || !(REFERENCE_WORD_REASONS as readonly unknown[]).includes(word.reason)) return null;
      words = Object.freeze({ status: "unavailable", reason: word.reason as ReferenceWordReason });
    }
    const textMismatch = words.status === "unavailable" && mismatch.has(words.reason);
    if (textMismatch !== (status === "needs-review" && playback.review === "text-mismatch")) return null;
    const playable: AvailablePlayback = status === "ready" ? Object.freeze({ status: "ready", asset: playback.asset, clip }) : Object.freeze({ status: "needs-review", review: playback.review as "start-moved" | "text-mismatch", asset: playback.asset, clip });
    return Object.freeze({ schema: REFERENCE_AUDIO_SCHEMA, ref: dto.ref, table: dto.table, playback: playable, words, attribution: REFERENCE_ATTRIBUTION });
  } catch { return null; }
}
