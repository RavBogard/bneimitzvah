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

import { afterEach } from "vitest";
import { activeLessonWord, createClipPlayer, PLAY_GAP_MS } from "../../src/components/learn/player";
import type { PhraseAudio } from "../../src/lib/learn/phrase-audio";

class TestMedia extends EventTarget {
  currentTime = 0; paused = true; ended = false; seeking = false; preload = ""; playbackRate = 1; defaultPlaybackRate = 1; preservesPitch = true;
  private value = "";
  get src() { return this.value; }
  set src(value: string) { this.value = value; this.currentTime = 0; this.ended = false; this.paused = true; }
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event("playing")); });
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")); } }
  at(seconds: number) { this.currentTime = seconds; this.dispatchEvent(new Event("timeupdate")); }
  end() { this.ended = true; this.paused = true; this.dispatchEvent(new Event("ended")); }
  removeAttribute() {} load() {}
}
const phrase = { ref: "Genesis 1:2", kind: "torah" as const, words: [4, 6] as const };
const tick = async () => { for (let n = 0; n < 24; n++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the authoritative word cut through the course player", () => {
  it("maps actual onsets and ends to media seconds, preserving gaps and canonical maqaf words at slow rate", async () => {
    const { audio } = rig(), media = new TestMedia(), player = createClipPlayer(audio, () => media as unknown as HTMLAudioElement);
    const clip = await audio.phraseClip(phrase, signal());
    expect(clip.words).toEqual([{ word: 4, start: 0, end: 0.75 }, { word: 5, start: 1, end: 1.75 }, { word: 6, start: 2, end: 2.75 }, { word: 7, start: 3, end: 3.75 }]);
    const done = player.play("example", [phrase], { rate: 0.5 });
    await vi.waitFor(() => expect(player.state.status).toBe("playing"));
    expect(media.playbackRate).toBe(0.5);
    const active = () => activeLessonWord(player.state, phrase, ["example"]);
    expect(active()).toBe(4);
    media.at(0.75); expect(active()).toBeNull();
    media.at(1); expect(active()).toBe(5);
    media.at(2); expect(active()).toBe(6);
    media.at(2.75); expect(active()).toBeNull();
    media.at(3); expect(active()).toBe(7);
    expect(activeLessonWord(player.state, { ...phrase, kind: "haftarah" }, ["example"])).toBeNull();
    expect(activeLessonWord(player.state, { ...phrase, ref: "Genesis 1:3" }, ["example"])).toBeNull();
    expect(activeLessonWord(player.state, phrase, ["duplicate-example"])).toBeNull();
    media.end(); expect(await done).toBe(true); expect(player.state.status).toBe("idle");
    player.dispose();
  });
  it("clears on buffering, seeking and pause, follows the sought media position, and stops on media error", async () => {
    const { audio } = rig(), media = new TestMedia(), player = createClipPlayer(audio, () => media as unknown as HTMLAudioElement);
    const done = player.play("example", [phrase]);
    await vi.waitFor(() => expect(player.state.current?.word).toBe(4));
    media.dispatchEvent(new Event("waiting")); expect(player.state.current).toBeNull();
    media.at(1.2); expect(player.state.current).toBeNull();
    media.dispatchEvent(new Event("playing")); expect(player.state.current?.word).toBe(5);
    player.pause(); expect(player.state.status).toBe("paused"); expect(player.state.current).toBeNull();
    await player.resume(); expect(player.state.current?.word).toBe(5);
    media.seeking = true; media.dispatchEvent(new Event("seeking")); media.at(2.1); expect(player.state.current).toBeNull();
    media.seeking = false; media.dispatchEvent(new Event("seeked")); expect(player.state.current?.word).toBe(6);
    media.dispatchEvent(new Event("error")); expect(await done).toBe(false);
    expect(player.state.status).toBe("error"); expect(player.state.current).toBeUndefined();
    player.dispose();
  });
  it("clears between compared clips and binds duplicate verses to their actual comparison part", async () => {
    const { audio } = rig(), media = new TestMedia(), player = createClipPlayer(audio, () => media as unknown as HTMLAudioElement);
    await audio.phraseClip(phrase, signal());
    vi.useFakeTimers();
    const done = player.play("pair", [phrase, phrase]); await tick();
    expect(player.state.status).toBe("playing"); expect(player.state.part).toBe(0);
    expect(activeLessonWord(player.state, phrase, [{ id: "pair", part: 1 }])).toBeNull();
    media.end(); await tick(); expect(player.state.status).toBe("loading"); expect(player.state.current).toBeNull();
    await vi.advanceTimersByTimeAsync(PLAY_GAP_MS);
    expect(player.state.part).toBe(1); expect(player.state.current?.word).toBe(4);
    expect(activeLessonWord(player.state, phrase, [{ id: "pair", part: 0 }])).toBeNull();
    media.end(); expect(await done).toBe(true); player.dispose();
  });
  it("settles an aborted pending play and rejects stale play/load callbacks after replacement", async () => {
    const { audio } = rig(), media = new TestMedia(), player = createClipPlayer(audio, () => media as unknown as HTMLAudioElement);
    await audio.phraseClip(phrase, signal());
    let release!: () => void;
    media.play.mockImplementationOnce(async () => {}).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const old = player.play("old", [phrase]); await tick();
    expect(release).toBeTypeOf("function"); player.stop();
    expect(await old).toBe(false); expect(player.state.status).toBe("idle");
    const current = player.play("new", [phrase]); await tick();
    expect(player.state.id).toBe("new"); expect(player.state.current?.word).toBe(4);
    release(); await tick(); expect(player.state.id).toBe("new");
    player.dispose(); expect(await current).toBe(false); expect(player.state.status).toBe("idle");
    media.at(2); expect(player.state.status).toBe("idle");
    let resolveClip!: (clip: Awaited<ReturnType<PhraseAudio["phraseClip"]>>) => void;
    const clip = await audio.phraseClip(phrase, signal());
    const pending = createClipPlayer({ ...audio, phraseClip: () => new Promise(resolve => { resolveClip = resolve; }) }, () => new TestMedia() as unknown as HTMLAudioElement);
    const loading = pending.play("loading", [phrase]); pending.stop(); resolveClip(clip);
    expect(await loading).toBe(false); expect(pending.state.status).toBe("idle"); pending.dispose();
  });
});

it("does not let a stale rejected resume stop replacement playback", async () => {
  const { audio } = rig(), media = new TestMedia(), player = createClipPlayer(audio, () => media as unknown as HTMLAudioElement);
  const first = player.play("first", [phrase]);
  await vi.waitFor(() => expect(player.state.status).toBe("playing")); player.pause();
  let rejectResume!: (error: Error) => void;
  media.play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectResume = reject; }));
  const resumed = player.resume(), replacement = player.play("replacement", [phrase]);
  await vi.waitFor(() => expect(player.state.id === "replacement" && player.state.status === "playing").toBe(true));
  rejectResume(new Error("Old resume rejected")); await resumed;
  expect(await first).toBe(false); expect(player.state.id).toBe("replacement"); expect(player.state.current?.word).toBe(4);
  player.stop(); expect(await replacement).toBe(false); player.dispose();
});
