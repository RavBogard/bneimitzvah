import { projectStudyVerse, type HebrewSource } from "../hebrew/study-tokens";
import type { ReferenceShortResolution } from "../reference-audio/short-resolution";
import { createReferenceTimeline, referenceWordLoop, type ReferenceTimeline } from "../reference-audio/timeline";
import { shortSourceRange, type ShortReferenceSource } from "../reference-audio/short-source";
import { decodeShortReferenceAudio, downloadShortReferenceAudio, shortAudioDigest, shortWordWav, validateShortDecodedAudio, type ShortDecodedAudio } from "../reference-audio/short-playback";
import type { Melody } from "./course";

/**
 * The course's one cut (plan, slice 1 step 2): a range of engine units of one verse, played from the
 * PocketTorah human recording through the existing content-addressed short route. The bytes are
 * downloaded whole and checked against their SHA-256 (downloadShortReferenceAudio), decoded, mapped
 * to frames through the verse's word timeline, and cut with the 5 ms fades (shortWordWav). A maqaf
 * chain is one unit but several timeline words; the cut spans all of them, as the Lein player does.
 * Only human recordings reach here; there is no path to generated chant.
 */
export type PhraseRequest = Readonly<{ ref: string; kind: Melody; words: readonly [number, number] }>;
export type LoadedVerse = Readonly<{ ref: string; kind: Melody; hebrew: HebrewSource; short: ReferenceShortResolution | null }>;
export type PhraseClip = Readonly<{ blob: Blob; frames: number; sampleRate: number; seconds: number; key: string }>;
export class PhraseUnavailable extends Error { constructor() { super("Phrase recording unavailable"); } }
const unavailable = (): never => { throw new PhraseUnavailable(); };

type Timed = Readonly<{ source: ShortReferenceSource; timeline: ReferenceTimeline; units: readonly (readonly [number, number])[] }>;
export type PhraseAudioIo = Readonly<{
  /** The verse text and its short resolution, from the public ref routes. */
  load(ref: string, kind: Melody, signal: AbortSignal): Promise<LoadedVerse>;
  origin?: string; fetch?: typeof fetch; digest?: typeof shortAudioDigest;
  decode?(bytes: Uint8Array<ArrayBuffer>, source: ShortReferenceSource): Promise<ShortDecodedAudio>;
}>;
export const PHRASE_CACHE = Object.freeze({ decoded: 12, clips: 48 });

function lru<V>(limit: number) {
  const map = new Map<string, V>();
  return {
    get(key: string) { const value = map.get(key); if (value !== undefined) { map.delete(key); map.set(key, value); } return value; },
    set(key: string, value: V) { map.delete(key); map.set(key, value); while (map.size > limit) map.delete(map.keys().next().value!); },
    delete(key: string) { map.delete(key); }, clear() { map.clear(); },
  };
}

/** One per page: a cache of timelines, bytes, decoded verses and cut clips. */
export function createPhraseAudio(io: PhraseAudioIo) {
  const timed = new Map<string, Promise<Timed>>(), bytes = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  const decoded = lru<Promise<ShortDecodedAudio>>(PHRASE_CACHE.decoded), clips = lru<PhraseClip>(PHRASE_CACHE.clips);
  const forget = <V>(map: { delete(key: string): void }, key: string, work: Promise<V>) => { void work.catch(() => map.delete(key)); return work; };

  async function timing(ref: string, kind: Melody, signal: AbortSignal): Promise<Timed> {
    const key = `${kind}:${ref}`;
    let work = timed.get(key);
    if (!work) {
      work = (async () => {
        const verse = await io.load(ref, kind, new AbortController().signal);
        const short = verse.short, source = short?.source;
        if (verse.ref !== ref || !short || !source || short.verse.ref !== ref || short.verse.playback.status !== "ready") return unavailable();
        const projection = projectStudyVerse(ref, verse.hebrew); if (projection.status !== "ready") return unavailable();
        const text = new TextEncoder().encode(projection.projection.readingText.normalize("NFC"));
        if (text.length > 8192) return unavailable();
        const hash = await (io.digest ?? shortAudioDigest)(text);
        const timeline = createReferenceTimeline(short.verse, { ref, readingTextSha256: hash, wordCount: projection.projection.words.length });
        if (!timeline?.starts || timeline.asset !== source.parent.asset) return unavailable();
        const units = projection.projection.tokens.filter(token => token.words.length).map(token => Object.freeze([token.words[0], token.words.at(-1)!] as const));
        return Object.freeze({ source, timeline, units: Object.freeze(units) });
      })();
      timed.set(key, forget(timed, key, work));
    }
    return wait(work, signal);
  }
  function audio(source: ShortReferenceSource, signal: AbortSignal): Promise<ShortDecodedAudio> {
    const key = source.sha256;
    let raw = bytes.get(key);
    if (!raw) {
      raw = downloadShortReferenceAudio(source, new AbortController().signal, { origin: io.origin ?? location.origin, fetch: io.fetch, digest: io.digest });
      bytes.set(key, forget(bytes, key, raw));
    }
    let work = decoded.get(key);
    if (!work) {
      work = raw.then(async value => { const out = await (io.decode ?? decodeShortReferenceAudio)(value, source); validateShortDecodedAudio(out, source); return out; });
      decoded.set(key, work); void work.catch(() => decoded.delete(key));
    }
    return wait(work, signal);
  }
  return Object.freeze({
    /** Can this verse be cut by word? Resolves false rather than throwing. */
    async wordReady(ref: string, kind: Melody, signal: AbortSignal): Promise<boolean> {
      try { await timing(ref, kind, signal); return true; } catch { return false; }
    },
    async phraseClip(request: PhraseRequest, signal: AbortSignal): Promise<PhraseClip> {
      const { ref, kind, words } = request;
      if (!Number.isSafeInteger(words[0]) || !Number.isSafeInteger(words[1]) || words[0] < 0 || words[1] < words[0]) return unavailable();
      const data = await timing(ref, kind, signal), first = data.units[words[0]], last = data.units[words[1]];
      if (!first || !last) return unavailable();
      const a = referenceWordLoop(data.timeline, first[0]), b = referenceWordLoop(data.timeline, last[1]);
      const range = a && b ? shortSourceRange(data.source, { start: a.start, end: b.end }) : null;
      if (!range) return unavailable();
      const key = `${data.source.sha256}:${range.firstFrame}:${range.endFrame}`, known = clips.get(key);
      if (known) return known;
      const value = await audio(data.source, signal);
      if (signal.aborted) return unavailable();
      const blob = shortWordWav(value, data.source, range.firstFrame, range.endFrame), frames = range.endFrame - range.firstFrame;
      const clip = Object.freeze({ blob, frames, sampleRate: data.source.sampleRate, seconds: frames / data.source.sampleRate, key });
      clips.set(key, clip); return clip;
    },
    clear() { timed.clear(); bytes.clear(); decoded.clear(); clips.clear(); },
  });
}
export type PhraseAudio = ReturnType<typeof createPhraseAudio>;

function wait<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new PhraseUnavailable());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new PhraseUnavailable());
    signal.addEventListener("abort", stop, { once: true });
    work.then(value => { signal.removeEventListener("abort", stop); resolve(value); }, error => { signal.removeEventListener("abort", stop); reject(error instanceof PhraseUnavailable ? error : new PhraseUnavailable()); });
  });
}
