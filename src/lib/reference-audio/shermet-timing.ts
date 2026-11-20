import { canonicalReadingRef } from "../readings/reading-ref";
/** Seconds on the decoded MP3 presentation clock (encoder padding excluded).
 * Publication means the alignment pipeline's objective checks passed. Holds
 * are omitted; no PocketTorah boundary may be substituted. */
export type ShermetTiming = Readonly<{
  version: 1; status: "ready"; kind: "torah" | "haftarah"; ref: string;
  audioSha256: string; readingTextSha256: string; wordCount: number; duration: number;
  words: readonly Readonly<{ start: number; end: number }>[];
}>;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function parseShermetTiming(value: unknown): ShermetTiming | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ShermetTiming;
  const ref = canonicalReadingRef(row.ref, row.kind);
  if (row.version !== 1 || row.status !== "ready" || !ref || ref.verses.length !== 1 || ref.verses[0] !== row.ref
    || !digest(row.audioSha256) || !digest(row.readingTextSha256) || !Number.isSafeInteger(row.wordCount) || row.wordCount < 1 || row.wordCount > 300
    || !Number.isFinite(row.duration) || row.duration <= 0 || row.duration > 180 || !Array.isArray(row.words) || row.words.length !== row.wordCount) return null;
  let end = 0;
  for (const word of row.words) {
    if (!word || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < end || word.end <= word.start || word.end > row.duration) return null;
    end = word.end;
  }
  return row;
}
export function shermetTextMatches(timing: ShermetTiming, binding: { ref: string; readingTextSha256: string; wordCount: number }) {
  return timing.ref === binding.ref && timing.readingTextSha256 === binding.readingTextSha256 && timing.wordCount === binding.wordCount;
}
