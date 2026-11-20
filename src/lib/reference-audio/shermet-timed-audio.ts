import { projectStudyVerse, type HebrewSource } from "../hebrew/study-tokens";
import { parseShermetTiming, shermetTextMatches, type ShermetTiming } from "./shermet-timing";
import { shortAudioDigest } from "./short-playback";

type Decoded = Pick<AudioBuffer, "sampleRate" | "length" | "duration" | "numberOfChannels" | "getChannelData">;
export type ShermetTimedClip = { blob: Blob; frames: number; sampleRate: number; seconds: number; key: string; source: "shermet"; words: readonly { word: number; start: number; end: number }[] };
export function createShermetTimedAudio(io: { fetch?: typeof fetch; digest?: typeof shortAudioDigest; decode?(bytes: ArrayBuffer): Promise<Decoded> } = {}) {
  const fetcher = io.fetch ?? fetch, digest = io.digest ?? shortAudioDigest;
  const cached = new Map<string, { timing: ShermetTiming; audio: Decoded }>();
  async function timing(ref: string, hebrew: HebrewSource, signal: AbortSignal) {
    const projection = projectStudyVerse(ref, hebrew);
    if (projection.status !== "ready") return null;
    const response = await fetcher(`/api/shermet-audio/timing?${new URLSearchParams({ ref })}`, { signal, credentials: "omit", redirect: "error", cache: "no-store" });
    if (!response.ok) return null;
    const text = await response.text(); if (text.length > 64 * 1024) return null;
    const row = parseShermetTiming(JSON.parse(text).timing);
    if (!row || !shermetTextMatches(row, { ref, wordCount: projection.projection.words.length, readingTextSha256: await digest(new TextEncoder().encode(projection.projection.readingText.normalize("NFC"))) })) return null;
    return row;
  }
  async function decoded(row: ShermetTiming, signal: AbortSignal) {
    const key = `${row.ref}:${row.audioSha256}`, known = cached.get(key);
    if (known) { cached.delete(key); cached.set(key, known); return known.audio; }
    const response = await fetcher(`/api/shermet-audio?${new URLSearchParams({ ref: row.ref })}`, { signal, credentials: "omit", redirect: "error", cache: "no-store" });
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 20 * 1024 * 1024) throw new Error("Recording unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) { const result = await reader.read(); if (result.done) break; length += result.value.length; if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("Recording unavailable"); } chunks.push(result.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (await digest(bytes) !== row.audioSha256 || signal.aborted) throw new Error("Recording unavailable");
    const audio = io.decode ? await io.decode(bytes.buffer) : await decode(bytes.buffer);
    if (signal.aborted || !Number.isFinite(audio.duration) || Math.abs(audio.duration - row.duration) > 0.05 || ![1, 2].includes(audio.numberOfChannels) || audio.sampleRate < 8000 || audio.sampleRate > 96000 || audio.length * audio.numberOfChannels * 4 > 64 * 1024 * 1024) throw new Error("Recording unavailable");
    cached.set(key, { timing: row, audio });
    while (cached.size > 2) cached.delete(cached.keys().next().value!);
    return audio;
  }
  return {
    timing,
    async clip(ref: string, hebrew: HebrewSource, first: number, last: number, signal: AbortSignal): Promise<ShermetTimedClip | null> {
      const row = await timing(ref, hebrew, signal);
      if (!row || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0 || last < first || last >= row.wordCount) return null;
      const audio = await decoded(row, signal), start = Math.floor(row.words[first].start * audio.sampleRate), end = Math.ceil(row.words[last].end * audio.sampleRate);
      if (end > audio.length || end <= start) return null;
      const blob = wav(audio, start, end), origin = start / audio.sampleRate;
      return { blob, frames: end - start, sampleRate: audio.sampleRate, seconds: (end - start) / audio.sampleRate, key: `shermet:${row.audioSha256}:${first}:${last}`, source: "shermet", words: row.words.slice(first, last + 1).map((word, i) => ({ word: first + i, start: word.start - origin, end: word.end - origin })) };
    },
    clear() { cached.clear(); },
  };
}
async function decode(bytes: ArrayBuffer): Promise<Decoded> {
  const context = new AudioContext();
  try { return await context.decodeAudioData(bytes); } finally { await context.close(); }
}
function wav(audio: Decoded, first: number, end: number) {
  const frames = end - first, channels = audio.numberOfChannels, buffer = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, frames * channels * 2, true);
  const fade = Math.min(Math.round(audio.sampleRate * 0.005), Math.floor(frames / 2));
  const gain = (at: number) => at < fade ? 0.5 - 0.5 * Math.cos(Math.PI * at / fade) : 1;
  for (let channel = 0; channel < channels; channel++) {
    const samples = audio.getChannelData(channel);
    if (samples.length !== audio.length) throw new Error("Recording unavailable");
    for (let i = 0; i < frames; i++) {
      const value = samples[first + i]; if (!Number.isFinite(value)) throw new Error("Recording unavailable");
      const sample = Math.max(-1, Math.min(1, value * gain(i) * gain(frames - i - 1)));
      view.setInt16(44 + (i * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}
