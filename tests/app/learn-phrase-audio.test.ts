// Synthetic bytes, timings and decoder seams; no real audio is decoded or played.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, type ShortReferenceSource } from "../../src/lib/reference-audio/short-source";
import { parseReferenceShortResolution } from "../../src/lib/reference-audio/short-resolution";
import type { ShortDecodedAudio } from "../../src/lib/reference-audio/short-playback";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { createPhraseAudio, PhraseUnavailable, type LoadedVerse } from "../../src/lib/learn/phrase-audio";
import { maqafShape, source } from "./learn-synthetic";

const origin = "https://example.test", hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const RATE = 8000, START = 10;
const bytes = new Uint8Array([9, 8, 7, 6]), sha = hash(bytes);
function loaded(ref = "Genesis 1:2", words = maqafShape(), wordsReady = true): LoadedVerse {
  const hebrew = source(words), projection = projectStudyVerse(ref, hebrew);
  if (projection.status !== "ready") throw Error("Synthetic projection refused");
  const count = projection.projection.words.length, asset = "ra_" + "7".repeat(32);
  // One second per reading word, each ending a quarter second before the next starts.
  const starts = Array.from({ length: count }, (_, i) => START + i), ends = starts.map(s => s + 0.75);
  const short = parseReferenceShortResolution({ schema: "reference-resolution/short-v1",
    verse: { schema: "reference-verse/v1", ref, table: "torah", playback: { status: "ready", asset, clip: { start: START, end: START + count } },
      words: wordsReady ? { status: "ready", readingTextSha256: hash(hebrew.readingText), starts, ends } : { status: "unavailable", reason: "override-stale" }, attribution: REFERENCE_ATTRIBUTION },
    source: { schema: "reference-short-source/v1", id: "rs_" + sha, parent: { asset, sha256: "a".repeat(64), bytes: 10 }, sha256: sha, bytes: bytes.length, path: `/reference-audio/short-v1/${sha}.mp3`,
      codec: "mp3", bitrate: 64000, sampleRate: RATE, channels: 1, presentationFrames: count * RATE, origin: { firstFrame: START * RATE, parentRate: RATE }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version } });
  if (!short) throw Error("Synthetic short resolution refused");
  return { ref, kind: "torah", hebrew, short };
}
function rig(verse = loaded()) {
  const fetcher = vi.fn<typeof fetch>(async url => { const r = new Response(bytes, { headers: { "content-type": "audio/mpeg" } }); Object.defineProperty(r, "url", { value: String(url) }); return r; });
  const decode = vi.fn(async (_b: Uint8Array<ArrayBuffer>, s: ShortReferenceSource): Promise<ShortDecodedAudio> => {
    const channel = new Float32Array(s.presentationFrames).fill(0.5); return { length: s.presentationFrames, sampleRate: s.sampleRate, numberOfChannels: 1, getChannelData: () => channel };
  });
  const load = vi.fn(async () => verse);
  return { audio: createPhraseAudio({ load, origin, fetch: fetcher, decode }), fetcher, decode, load };
}
const signal = () => new AbortController().signal;

describe("the phrase cut", () => {
  it("cuts units [4, 6] of a maqaf verse as reading words [4, 7], with the 5 ms fades", async () => {
    const { audio } = rig();
    const clip = await audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [4, 6] }, signal());
    // Word 4 starts at 14 s, word 7 ends at 17.75 s: 3.75 s at 8 kHz.
    expect(clip.frames).toBe(3.75 * RATE);
    expect(clip.sampleRate).toBe(RATE);
    expect(clip.blob.type).toBe("audio/wav");
    const view = new DataView(await clip.blob.arrayBuffer());
    expect(view.getUint32(40, true)).toBe(clip.frames * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(44 + 2 * 1000, true)).toBe(Math.round(0.5 * 32767));
  });
  it("downloads and decodes a verse once for every phrase cut from it", async () => {
    const { audio, fetcher, decode, load } = rig();
    await audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [0, 3] }, signal());
    await audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [7, 8] }, signal());
    const again = await audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [0, 3] }, signal());
    expect(again.frames).toBe(3.75 * RATE);
    expect(load).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledOnce();
  });
  it("refuses, never plays a wider range, when timing is missing or the request is out of range", async () => {
    await expect(rig(loaded("Genesis 1:2", maqafShape(), false)).audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [4, 6] }, signal())).rejects.toBeInstanceOf(PhraseUnavailable);
    expect(await rig(loaded("Genesis 1:2", maqafShape(), false)).audio.wordReady("Genesis 1:2", "torah", signal())).toBe(false);
    const { audio } = rig();
    expect(await audio.wordReady("Genesis 1:2", "torah", signal())).toBe(true);
    await expect(audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [8, 9] }, signal())).rejects.toBeInstanceOf(PhraseUnavailable);
    await expect(audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [3, 2] }, signal())).rejects.toBeInstanceOf(PhraseUnavailable);
    const stopped = new AbortController(); stopped.abort();
    await expect(audio.phraseClip({ ref: "Genesis 1:2", kind: "torah", words: [0, 1] }, stopped.signal)).rejects.toBeInstanceOf(PhraseUnavailable);
  });
  it("refuses a resolution for another verse", async () => {
    const other = { ...loaded(), ref: "Genesis 1:3" };
    await expect(rig(other).audio.phraseClip({ ref: "Genesis 1:3", kind: "torah", words: [0, 1] }, signal())).rejects.toBeInstanceOf(PhraseUnavailable);
  });
});
