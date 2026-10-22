import { TANAKH_VERSE_COUNTS } from "../readings/catalog";

/** Cantor Josh Finkel's reference recordings: the client wire contract only.
 * Licensed to CRC without restriction (MISSION, 2026-10-22), but stored
 * privately and served only through authorized same-origin routes. Students
 * hear them only under the same release hold as PocketTorah. These are whole
 * passage recordings: no verse, phrase or word timings exist, so nothing here
 * carries or implies any timing. No titles, labels, source IDs, provenance or
 * storage keys belong in this contract. */
export const FINKEL_CLIPS_SCHEMA = "finkel-clips/v1" as const;
export const FINKEL_SOURCE = "finkel" as const;
export const FINKEL_PERFORMER = "Cantor Josh Finkel";
export const FINKEL_LIMITS = Object.freeze({ clips: 1000, verses: 512, bytes: 4 * 1024 * 1024, seconds: 3600, responseBytes: 1024 * 1024 });
export const FINKEL_MEDIA_PREFIX = "/api/reference-audio/finkel/media/";
export type FinkelMode = "chant" | "spoken";
export type FinkelClip = Readonly<{
  asset: string; kind: "torah" | "haftarah"; mode: FinkelMode; verses: readonly string[];
  sha256: string; bytes: number; durationSeconds: number; preferred: boolean;
}>;
export type FinkelClips = Readonly<{ schema: typeof FINKEL_CLIPS_SCHEMA; source: typeof FINKEL_SOURCE; pin: string; clips: readonly FinkelClip[] }>;

const TORAH = new Set(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
const PROPHETS = new Set(["Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"]);
export const finkelDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const finkelAsset = (value: unknown): value is string => typeof value === "string" && /^fj_[a-f0-9]{20}$/.test(value);

/** Canonical "Book c:v" inside the Tanakh verse table; null otherwise. */
export function finkelVerse(value: unknown): Readonly<{ book: string; chapter: number; verse: number }> | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const match = /^(.{1,40}) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(value);
  if (!match || !Object.hasOwn(TANAKH_VERSE_COUNTS, match[1])) return null;
  const chapters = TANAKH_VERSE_COUNTS[match[1]], chapter = Number(match[2]), verse = Number(match[3]);
  if (chapter > chapters.length || verse > chapters[chapter - 1]) return null;
  return Object.freeze({ book: match[1], chapter, verse });
}
export const finkelBookKind = (book: string): FinkelClip["kind"] | null => TORAH.has(book) ? "torah" : PROPHETS.has(book) ? "haftarah" : null;
/** Position of a canonical verse inside its book; comparisons need the same book. */
export function finkelOrdinal(ref: Readonly<{ book: string; chapter: number; verse: number }>): number {
  const chapters = TANAKH_VERSE_COUNTS[ref.book]; let total = 0;
  for (let i = 0; i < ref.chapter - 1; i++) total += chapters[i];
  return total + ref.verse;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !Object.hasOwn(d, "value")) return null; result[key] = d.value; }
  return result;
}
function list(value: unknown, max: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) return null; result.push(d.value); }
  return result;
}

/** One clip, closed shape. Verses are canonical, in one book of the declared
 * kind and strictly forward (a passage, never a stitched sequence). */
export function parseFinkelClip(value: unknown): FinkelClip | null {
  try {
    const row = record(value, ["asset", "kind", "mode", "verses", "sha256", "bytes", "durationSeconds", "preferred"]);
    if (!row || !finkelAsset(row.asset) || (row.kind !== "torah" && row.kind !== "haftarah") || (row.mode !== "chant" && row.mode !== "spoken")
      || !finkelDigest(row.sha256) || typeof row.preferred !== "boolean"
      || !Number.isSafeInteger(row.bytes) || (row.bytes as number) < 1 || (row.bytes as number) > FINKEL_LIMITS.bytes
      || typeof row.durationSeconds !== "number" || !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0 || row.durationSeconds > FINKEL_LIMITS.seconds) return null;
    const raw = list(row.verses, FINKEL_LIMITS.verses); if (!raw?.length) return null;
    const verses: string[] = []; let book: string | null = null, previous = 0;
    for (const ref of raw) {
      const parsed = finkelVerse(ref); if (!parsed || finkelBookKind(parsed.book) !== row.kind || (book !== null && parsed.book !== book)) return null;
      const ordinal = finkelOrdinal(parsed); if (ordinal <= previous) return null;
      book = parsed.book; previous = ordinal; verses.push(ref as string);
    }
    return Object.freeze({ asset: row.asset, kind: row.kind, mode: row.mode, verses: Object.freeze(verses), sha256: row.sha256,
      bytes: row.bytes as number, durationSeconds: row.durationSeconds, preferred: row.preferred });
  } catch { return null; }
}

export function parseFinkelClips(value: unknown): FinkelClips | null {
  try {
    const row = record(value, ["schema", "source", "pin", "clips"]);
    if (!row || row.schema !== FINKEL_CLIPS_SCHEMA || row.source !== FINKEL_SOURCE || !finkelDigest(row.pin)) return null;
    const raw = list(row.clips, FINKEL_LIMITS.clips); if (!raw) return null;
    const clips: FinkelClip[] = [], assets = new Set<string>(), hashes = new Set<string>();
    for (const value of raw) {
      const clip = parseFinkelClip(value); if (!clip || assets.has(clip.asset) || hashes.has(clip.sha256)) return null;
      assets.add(clip.asset); hashes.add(clip.sha256); clips.push(clip);
    }
    return Object.freeze({ schema: FINKEL_CLIPS_SCHEMA, source: FINKEL_SOURCE, pin: row.pin, clips: Object.freeze(clips) });
  } catch { return null; }
}

export const finkelMediaPath = (sha256: string) => { if (!finkelDigest(sha256)) throw new Error("Finkel media unavailable"); return `${FINKEL_MEDIA_PREFIX}${sha256}.mp3`; };
/** Plain, simple credit wording shown with every clip. */
export const finkelCredit = (mode: FinkelMode) => `${mode === "chant" ? "Chanted" : "Read"} by ${FINKEL_PERFORMER}`;
export const finkelModeLabel = (mode: FinkelMode) => mode === "chant" ? "Hear the chant" : "Hear the words";
/** "Genesis 22:1–3", "Genesis 22:1–23:2" or "Genesis 22:1". */
export function finkelRangeLabel(verses: readonly string[]): string {
  const first = finkelVerse(verses[0]), last = finkelVerse(verses[verses.length - 1]);
  if (!first || !last) return "";
  if (verses.length === 1) return verses[0];
  return first.chapter === last.chapter ? `${first.book} ${first.chapter}:${first.verse}–${last.verse}` : `${first.book} ${first.chapter}:${first.verse}–${last.chapter}:${last.verse}`;
}
