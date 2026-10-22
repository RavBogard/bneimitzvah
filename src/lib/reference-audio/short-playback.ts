import { parseShortReferenceSource, SHORT_SOURCE_LIMITS, type ShortReferenceSource } from "./short-source";

export const SHORT_PLAYBACK_LIMITS = Object.freeze({ loadMs: 30000, openMs: 10000, progressMs: 5000, metadataMs: 15000, playMs: 8000, emptyReads: 64 });
const unavailable = () => new Error("Short reference audio unavailable");
export const shortAudioDigest = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { void body?.cancel().catch(() => {}); } catch {} };

/** Complete anonymous same-origin public bytes only; never a private API cache. */
export async function downloadShortReferenceAudio(value: ShortReferenceSource, signal: AbortSignal, io: {
  origin: string; fetch?: typeof fetch; digest?: typeof shortAudioDigest; now?: () => number;
}): Promise<Uint8Array<ArrayBuffer>> {
  const source = parseShortReferenceSource(value), origin = new URL(io.origin);
  if (!source || signal.aborted || !["http:", "https:"].includes(origin.protocol) || origin.origin !== io.origin) throw unavailable();
  const now = io.now ?? (() => performance.now()), start = now(), controller = new AbortController();
  const abort = () => controller.abort(), total = setTimeout(abort, SHORT_PLAYBACK_LIMITS.loadMs);
  signal.addEventListener("abort", abort, { once: true }); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const live = () => { if (signal.aborted || controller.signal.aborted || now() - start >= SHORT_PLAYBACK_LIMITS.loadMs) throw unavailable(); };
  async function wait<T>(work: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined, listener: (() => void) | undefined, expired = false;
    const observed = work.then(value => { if (expired || controller.signal.aborted) late?.(value); return value; });
    try { const result = await Promise.race([observed, new Promise<never>((_, reject) => {
      listener = () => reject(unavailable()); controller.signal.addEventListener("abort", listener, { once: true });
      timer = setTimeout(() => { expired = true; abort(); reject(unavailable()); }, ms); if (controller.signal.aborted) listener();
    })]); live(); return result; }
    finally { clearTimeout(timer); if (listener) controller.signal.removeEventListener("abort", listener); }
  }
  try {
    live(); const url = io.origin + source.path;
    const response = await wait((io.fetch ?? fetch)(url, { signal: controller.signal, credentials: "omit", redirect: "error", mode: "same-origin", referrerPolicy: "no-referrer", cache: "force-cache" }), SHORT_PLAYBACK_LIMITS.openMs, r => cancel(r.body));
    if (response.status !== 200 || response.redirected || response.url !== url || !response.body || response.headers.get("content-type") !== "audio/mpeg") { cancel(response.body); throw unavailable(); }
    reader = response.body.getReader(); const bytes = new Uint8Array(source.bytes); let size = 0, empty = 0, progress = now();
    const proto = Object.getPrototypeOf(Uint8Array.prototype), getter = (name: string, value: Uint8Array) => Object.getOwnPropertyDescriptor(proto, name)!.get!.call(value);
    for (;;) {
      const item = await wait(reader.read(), Math.max(1, SHORT_PLAYBACK_LIMITS.progressMs - (now() - progress))); live();
      if (now() - progress >= SHORT_PLAYBACK_LIMITS.progressMs) throw unavailable(); if (item.done) break;
      if (!(item.value instanceof Uint8Array)) throw unavailable();
      const length = getter("byteLength", item.value) as number;
      if (!length) { if (++empty > SHORT_PLAYBACK_LIMITS.emptyReads) throw unavailable(); continue; }
      if (size + length > bytes.length) throw unavailable();
      bytes.set(new Uint8Array(getter("buffer", item.value) as ArrayBuffer, getter("byteOffset", item.value) as number, length), size);
      size += length; empty = 0; progress = now();
    }
    if (size !== source.bytes || await wait((io.digest ?? shortAudioDigest)(bytes), SHORT_PLAYBACK_LIMITS.progressMs) !== source.sha256) throw unavailable();
    live(); return bytes;
  } finally { abort(); clearTimeout(total); signal.removeEventListener("abort", abort); if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} } }
}

export type ShortDecodedAudio = Pick<AudioBuffer, "length" | "sampleRate" | "numberOfChannels" | "getChannelData">;
/** Native-grid identity, not a duration tolerance or decoder-padding correction. */
export function shortMediaFramesMatch(duration: number, rate: number, frames: number): boolean {
  return Number.isFinite(duration) && duration > 0 && Number.isSafeInteger(rate) && rate > 0 && Number.isSafeInteger(frames) && frames > 0 && Math.round(duration * rate) === frames;
}
export async function decodeShortReferenceAudio(bytes: Uint8Array<ArrayBuffer>, source: ShortReferenceSource): Promise<ShortDecodedAudio> {
  if (!parseShortReferenceSource(source)) throw unavailable();
  const context = new OfflineAudioContext(source.channels, 1, source.sampleRate);
  return context.decodeAudioData(bytes.slice().buffer);
}
export function validateShortDecodedAudio(decoded: ShortDecodedAudio, source: ShortReferenceSource): void {
  if (!parseShortReferenceSource(source)) throw unavailable();
  if (decoded.sampleRate !== source.sampleRate || decoded.numberOfChannels !== source.channels || decoded.length !== source.presentationFrames || decoded.length * decoded.numberOfChannels * 4 > 28800000) throw unavailable();
}
function waveBuffer(frames: number, channels: number, rate: number): ArrayBuffer {
  const size = frames * channels * 2, bytes = new ArrayBuffer(44 + size), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, size + 36, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, size, true);
  return bytes;
}
/** 10ms of zeros only. Explicit gesture preparation, never source audio. */
export function shortSilentPrime(): Blob { return new Blob([waveBuffer(80, 1, 8000)], { type: "audio/wav" }); }
/** Raised-cosine fade at each end of a word cut, so a cut inside sound does not click. */
export const SHORT_WORD_FADE_SECONDS = 0.005;
/** The word interval the timeline gives (measured end, or the next onset). No resampling or geometry
 * clamp. PCM16 uses ordinary saturating sample quantization; each end gets a 5 ms raised-cosine fade
 * (shorter for a cut under 10 ms: half its length). */
export function shortWordWav(decoded: ShortDecodedAudio, source: ShortReferenceSource, first: number, end: number): Blob {
  validateShortDecodedAudio(decoded, source);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || first < 0 || end > decoded.length || end <= first || end - first > source.sampleRate * SHORT_SOURCE_LIMITS.seconds) throw unavailable();
  const bytes = waveBuffer(end - first, source.channels, source.sampleRate), view = new DataView(bytes);
  const channels = Array.from({ length: source.channels }, (_, i) => decoded.getChannelData(i));
  if (channels.some(data => !(data instanceof Float32Array) || data.length !== source.presentationFrames)) throw unavailable();
  const fade = Math.min(Math.round(source.sampleRate * SHORT_WORD_FADE_SECONDS), Math.floor((end - first) / 2));
  const gain = (k: number) => k < fade ? 0.5 - 0.5 * Math.cos(Math.PI * k / fade) : 1;
  for (let frame = first; frame < end; frame++) for (let channel = 0; channel < source.channels; channel++) {
    const value = channels[channel][frame]; if (!Number.isFinite(value)) throw unavailable();
    const sample = Math.max(-1, Math.min(1, value * gain(frame - first) * gain(end - 1 - frame))); view.setInt16(44 + ((frame - first) * source.channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}
