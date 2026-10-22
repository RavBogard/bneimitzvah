import { parseReferenceVerse, type SourceSecondsRange } from "./contract";

/** The UI adapter must compute this SHA256 from its ACTUAL NFC rendered
 * readingText, never echo the response hash. It owns async generation fencing. */
export type ReferenceTextBinding = Readonly<{ ref: string; readingTextSha256?: string; wordCount?: number }>;
const constructionKey = Symbol("validated-reference-timeline");
class Timeline {
  #valid = true;
  readonly ref: string;
  readonly asset: string;
  readonly clip: SourceSecondsRange;
  readonly starts: readonly number[] | null;
  readonly ends: readonly number[] | null;
  constructor(key: typeof constructionKey, ref: string, asset: string, clip: SourceSecondsRange, starts: readonly number[] | null, ends: readonly number[] | null) {
    if (key !== constructionKey) throw new Error("Reference timeline unavailable");
    this.ref = ref; this.asset = asset; this.clip = clip; this.starts = starts; this.ends = starts ? ends : null; Object.freeze(this);
  }
  static valid(value: unknown): value is Timeline { return typeof value === "object" && value !== null && #valid in value; }
}
export type ReferenceTimeline = Timeline;

/** Wrong verse rejects ALL playback; stale/missing text or count leaves only
 * verse playback. Held/unavailable DTOs never construct a playable timeline. */
export function createReferenceTimeline(value: unknown, binding: ReferenceTextBinding): ReferenceTimeline | null {
  try {
    const dto = parseReferenceVerse(value);
    if (!dto || dto.playback.status !== "ready" || !binding || typeof binding !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(binding))) return null;
    const fields = Object.getOwnPropertyDescriptors(binding);
    if (Reflect.ownKeys(binding).some(key => typeof key !== "string" || !["ref", "readingTextSha256", "wordCount"].includes(key)) || Object.values(fields).some(field => !Object.hasOwn(field, "value")) || fields.ref?.value !== dto.ref) return null;
    const hash: unknown = fields.readingTextSha256?.value, count: unknown = fields.wordCount?.value;
    const starts = dto.words.status === "ready" && hash === dto.words.readingTextSha256 && Number.isInteger(count) && count === dto.words.starts.length ? dto.words.starts : null;
    return new Timeline(constructionKey, dto.ref, dto.playback.asset, dto.playback.clip, starts, starts && dto.words.status === "ready" ? dto.words.ends ?? null : null);
  } catch { return null; }
}

/** Every time/range is ORIGINAL ASSET SECONDS, not wall time or clip-relative
 * time. Playback speed/pitch must not scale these source coordinates. */
export function currentReferenceWord(timeline: ReferenceTimeline | null, sourceSeconds: number): number | null {
  if (!Timeline.valid(timeline) || typeof sourceSeconds !== "number" || !Number.isFinite(sourceSeconds) || sourceSeconds < timeline.clip.start || sourceSeconds >= timeline.clip.end || !timeline.starts || sourceSeconds < timeline.starts[0]) return null;
  let lo = 0, hi = timeline.starts.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (timeline.starts[mid] <= sourceSeconds) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
export function referenceVerseLoop(timeline: ReferenceTimeline | null): SourceSecondsRange | null { return Timeline.valid(timeline) ? timeline.clip : null; }

/** [start, end) with the index's measured end (v2), else the onset interval [start, next onset) or
 * [last onset, verse end). Ends are measured from the audio, never fabricated; without one, a gap
 * after an onset belongs to its interval. Highlighting (currentReferenceWord) still follows onsets. */
export function referenceWordLoop(timeline: ReferenceTimeline | null, wordIndex: number): SourceSecondsRange | null {
  if (!Timeline.valid(timeline) || !timeline.starts || !Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= timeline.starts.length) return null;
  return Object.freeze({ start: timeline.starts[wordIndex], end: timeline.ends?.[wordIndex] ?? timeline.starts[wordIndex + 1] ?? timeline.clip.end });
}
/** Selection seeks are source seconds, with no hidden clip offset/subtraction. */
export function referenceSeekSeconds(timeline: ReferenceTimeline | null, selection: "verse" | number = "verse"): number | null {
  return selection === "verse" ? referenceVerseLoop(timeline)?.start ?? null : referenceWordLoop(timeline, selection)?.start ?? null;
}
