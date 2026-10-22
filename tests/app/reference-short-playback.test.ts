// Synthetic bytes/media/decoder seams. No real audio decoding or gesture claim.
import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, type ShortReferenceSource } from "../../src/lib/reference-audio/short-source";
import { parseReferenceShortResolution, type ReferenceShortResolution } from "../../src/lib/reference-audio/short-resolution";
import { downloadShortReferenceAudio, shortMediaFramesMatch, shortSilentPrime, shortWordWav, SHORT_WORD_FADE_SECONDS, type ShortDecodedAudio } from "../../src/lib/reference-audio/short-playback";
import { createShortReadingPlayback, type ShortAudioElement } from "../../src/components/portal/workspace/study/short-main-playback";
import type { ReferenceAudioElement } from "../../src/lib/reference-audio/playback";
const origin = "https://example.test", text = "אבג דהו", hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const data = (i = 0) => new Uint8Array([1, 2, 3, i]);
function resolution(i = 0) {
  const sha = hash(data(i)), asset = "ra_" + String(i + 1).repeat(32), start = 10 + i * 10;
  return parseReferenceShortResolution({ schema: "reference-resolution/short-v1", verse: { schema: "reference-verse/v1", ref: `Genesis 1:${i + 1}`, table: "torah", playback: { status: "ready", asset, clip: { start, end: start + 2 } },
    words: { status: "ready", readingTextSha256: hash(text), starts: [start, start + 1] }, attribution: REFERENCE_ATTRIBUTION },
    source: { schema: "reference-short-source/v1", id: "rs_" + sha, parent: { asset, sha256: "a".repeat(64), bytes: 10 }, sha256: sha, bytes: 4, path: `/reference-audio/short-v1/${sha}.mp3`, codec: "mp3", bitrate: 64000, sampleRate: 24000, channels: 1, presentationFrames: 48000, origin: { firstFrame: start * 24000, parentRate: 24000 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version } })!;
}
function response(bytes = data(), url = origin + resolution().source!.path) { const r = new Response(bytes, { headers: { "content-type": "audio/mpeg" } }); Object.defineProperty(r, "url", { value: url }); return r; }
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function decoded(s: ShortReferenceSource): ShortDecodedAudio { const channel = new Float32Array(s.presentationFrames).fill(0.25); return { length: s.presentationFrames, sampleRate: s.sampleRate, numberOfChannels: s.channels, getChannelData: () => channel }; }
class Media extends EventTarget {
  src = ""; currentSrc = ""; readyState = 0; error: MediaError | null = null; preload = ""; duration = 2; currentTime = 0; playbackRate = 1; preservesPitch = true; ended = false;
  urls = new Map<string, Blob>(); attempts: string[] = []; metadataFrames?: number;
  play = vi.fn((): Promise<void> => { this.attempts.push(this.src); this.ended = false; this.dispatchEvent(new Event("playing")); return Promise.resolve(); });
  pause = vi.fn(); removeAttribute(name: string) { if (name === "src") this.src = ""; }
  deferMetadata = false; metadataJobs: { url: string; finish(): void }[] = [];
  load() {
    this.readyState = 0; this.error = null; const url = this.src, blob = this.urls.get(url); if (!blob) { this.currentSrc = ""; return; }
    void blob.arrayBuffer().then(bytes => {
      if (this.src !== url) return; const view = new DataView(bytes);
      let duration = blob.type === "audio/wav" ? (view.getUint32(40, true) / view.getUint16(32, true)) / view.getUint32(24, true) : 2;
      if (this.metadataFrames !== undefined && blob.size !== 204) duration = this.metadataFrames / 24000;
      const finish = () => { if (this.src !== url) return; this.duration = duration; this.currentSrc = url; this.readyState = 1; this.dispatchEvent(new Event("loadedmetadata")); };
      if (this.deferMetadata) this.metadataJobs.push({ url, finish }); else finish();
    });
  }
  finish() { this.currentTime = this.duration; this.ended = true; this.dispatchEvent(new Event("ended")); }
}
function fixture(extra: Partial<Parameters<typeof createShortReadingPlayback>[0]> = {}, platform: Partial<NonNullable<Parameters<typeof createShortReadingPlayback>[0]["platform"]>> = {}) {
  const media = new Media(), frames = new Map<number, FrameRequestCallback>(); let id = 0;
  const fetcher = vi.fn<typeof fetch>(async url => { const i = [0, 1, 2].find(i => String(url) === origin + resolution(i).source!.path)!; return response(data(i), String(url)); });
  const load = vi.fn(async (i: number) => resolution(i)), decode = vi.fn(async (_b: Uint8Array<ArrayBuffer>, s: ShortReferenceSource) => decoded(s));
  const createUrl = vi.fn((blob: Blob) => { const url = "blob:" + (blob.size === 204 ? "prime" : blob.type === "audio/wav" ? "word" : "verse") + ++id; media.urls.set(url, blob); return url; }), revokeUrl = vi.fn();
  const active: ({ verse: number; index: number } | null)[] = [], audio = vi.fn(() => media as ShortAudioElement);
  const player = createShortReadingPlayback({ verses: [0, 1, 2].map(i => ({ ref: `Genesis 1:${i + 1}`, readingText: text, wordCount: 2 })), load, onState: vi.fn(), onActiveWord: w => active.push(w), ...extra,
    platform: { origin, fetch: fetcher, audio, decode, createUrl, revokeUrl, scheduler: { frame(f) { const n = ++id; frames.set(n, f); return n; }, cancelFrame(n) { frames.delete(n); }, timer: setTimeout, clearTimer: clearTimeout }, ...platform } });
  return { player, media, fetcher, load, decode, audio, createUrl, revokeUrl, active, frames };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("false or throwing continuation refuses cached explicit work before any new primer or load", async () => {
  for (const throwing of [false, true]) {
    let valid = true;
    const f = fixture({ canContinue: () => { if (!valid && throwing) throw Error("synthetic continuation refusal"); return valid; } });
    await f.player.select(0); const attempts = f.media.play.mock.calls.length; valid = false;
    await f.player.play(); await f.player.select(1); expect(f.media.play).toHaveBeenCalledTimes(attempts);
    expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.media.src).toBe(""); expect(f.player.state.suspended).toBe(true); f.player.dispose();
  }
  const refused = fixture({ canContinue: () => false }); await refused.player.select(0);
  expect(refused.media.play).not.toHaveBeenCalled(); expect(refused.load).not.toHaveBeenCalled(); expect(refused.fetcher).not.toHaveBeenCalled(); refused.player.dispose();
});

test("a current continuation retains same-owner DTO/body/decode caching and native repeat", async () => {
  const canContinue = vi.fn(() => true), f = fixture({ canContinue });
  await f.player.select(0); f.player.pause(); await f.player.play(); await f.player.select(0, 1); await f.player.select(0, 0);
  f.player.setRepeat(true); const attempts = f.media.play.mock.calls.length; f.media.finish();
  await vi.waitFor(() => { expect(f.media.play.mock.calls.length).toBeGreaterThan(attempts); expect(f.player.state.playback.status).toBe("playing"); });
  expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.decode).toHaveBeenCalledOnce(); expect(f.audio).toHaveBeenCalledOnce();
  expect(canContinue).toHaveBeenCalled(); expect(f.player.state.playback.status).toBe("playing"); f.player.dispose();
});

test("cached native repeat checks the wall clock even when its expiry timer is still queued", async () => {
  let deadline = Infinity; const f = fixture({ canContinue: () => Date.now() < deadline }); await f.player.select(0); f.player.setRepeat(true);
  vi.useFakeTimers(); const now = Date.now(); deadline = now + 1000; let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; f.player.suspend(); }, 1000), attempts = f.media.play.mock.calls.length;
  vi.setSystemTime(deadline + 1); f.media.finish(); for (let n = 0; n < 32; n++) await Promise.resolve();
  expect(timerFired).toBe(false); expect(f.media.play).toHaveBeenCalledTimes(attempts); expect(f.media.src).toBe(""); expect(f.player.state.suspended).toBe(true);
  expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce(); clearTimeout(timer); f.player.dispose();
});

test("held private completion after the wall-clock ceiling cannot fetch or play verified media", async () => {
  vi.useFakeTimers(); const deadline = Date.now() + 1000000, gate = deferred<ReferenceShortResolution>();
  const f = fixture({ canContinue: () => Date.now() < deadline, load: () => gate.promise }); const pending = f.player.select(0);
  const attempts = f.media.play.mock.calls.length; vi.setSystemTime(deadline + 1); gate.resolve(resolution()); await pending;
  expect(f.media.play).toHaveBeenCalledTimes(attempts); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.media.src).toBe(""); expect(f.player.state.suspended).toBe(true); f.player.dispose();
});

test("held actual play acknowledgement after the ceiling is suspended rather than published as playing", async () => {
  let deadline = Infinity; const f = fixture({ canContinue: () => Date.now() < deadline }), gate = deferred<void>(), play = f.media.play;
  let entered = false; f.media.play = vi.fn(() => { const pending = play(); if (f.media.src.includes("blob:verse")) { entered = true; return gate.promise; } return pending; });
  const pending = f.player.select(0); await vi.waitFor(() => expect(entered).toBe(true)); vi.useFakeTimers(); deadline = Date.now() + 1000;
  vi.setSystemTime(deadline + 1); gate.resolve(); await pending; expect(f.player.state.suspended).toBe(true); expect(f.media.src).toBe(""); f.player.dispose();
});

test("held nonabortable decode cannot create a Word segment after its continuation ceiling", async () => {
  let deadline = Infinity; const gate = deferred<ShortDecodedAudio>(), f = fixture({ canContinue: () => Date.now() < deadline }, { decode: () => gate.promise });
  await f.player.select(0); const pending = f.player.select(0, 1); await vi.waitFor(() => expect(f.player.state.selection).toBe(1));
  vi.useFakeTimers(); deadline = Date.now() + 1000; vi.setSystemTime(deadline + 1); gate.resolve(decoded(resolution().source!)); await pending;
  expect(f.createUrl.mock.calls.some(([blob]) => blob.type === "audio/wav" && blob.size > 204)).toBe(false); expect(f.player.state.suspended).toBe(true); expect(f.media.src).toBe(""); f.player.dispose();
});

test("playing and queued highlight callbacks refuse a lost continuation without restarting", async () => {
  for (const event of ["playing", "frame"] as const) {
    let valid = true; const f = fixture({ canContinue: () => valid }); await f.player.select(0); const frame = [...f.frames.values()][0], attempts = f.media.play.mock.calls.length;
    valid = false; if (event === "playing") f.media.dispatchEvent(new Event("playing")); else frame(0);
    expect(f.media.src).toBe(""); expect(f.player.state.suspended).toBe(true); expect(f.frames.size).toBe(0); expect(f.media.play).toHaveBeenCalledTimes(attempts); expect(f.active.at(-1)).toBeNull(); f.player.dispose();
  }
});

test("state and highlight callbacks that revoke continuation are rechecked before further work", async () => {
  let valid = true;
  const early = fixture({ canContinue: () => valid, onState: state => { if (state.verse !== null && !state.suspended) valid = false; } }); await early.player.select(0);
  expect(early.media.play).not.toHaveBeenCalled(); expect(early.load).not.toHaveBeenCalled(); early.player.dispose();
  valid = true; const metadata = fixture({ canContinue: () => valid, onState: state => { if (state.playback.wordsReady) valid = false; } }); await metadata.player.select(0);
  expect(metadata.fetcher).not.toHaveBeenCalled(); expect(metadata.media.src).toBe(""); metadata.player.dispose();
  valid = true; const highlight = fixture({ canContinue: () => valid, onActiveWord: word => { if (word !== null) valid = false; } }); await highlight.player.select(0);
  expect(highlight.frames.size).toBe(0); expect(highlight.media.src).toBe(""); expect(highlight.player.state.suspended).toBe(true); highlight.player.dispose();
});

test("whole same-origin public bytes require exact SHA/size/URL and omit credentials/redirects", async () => {
  const s = resolution().source!, get = vi.fn<typeof fetch>(async () => response());
  expect(await downloadShortReferenceAudio(s, new AbortController().signal, { origin, fetch: get })).toEqual(data());
  expect(get).toHaveBeenCalledWith(origin + s.path, expect.objectContaining({ credentials: "omit", redirect: "error", mode: "same-origin", cache: "force-cache", referrerPolicy: "no-referrer" }));
  expect(get.mock.calls[0][1]?.headers).toBeUndefined();
  for (const r of [response(data(), "https://other.test" + s.path), response(new Uint8Array([1, 2])), response(new Uint8Array([1, 2, 3, 4, 5])), response(data(2)), new Response(null, { status: 503 })]) await expect(downloadShortReferenceAudio(s, new AbortController().signal, { origin, fetch: vi.fn(async () => r) })).rejects.toThrow();
});
test("aborted open settles and cancels late bodies without trusting stalled cancellation", async () => {
  const gate = deferred<Response>(), abort = new AbortController(), pending = downloadShortReferenceAudio(resolution().source!, abort.signal, { origin, fetch: vi.fn(() => gate.promise) });
  abort.abort(); await expect(pending).rejects.toThrow(); const r = response(), cancel = vi.spyOn(r.body!, "cancel"); gate.resolve(r); await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
test("tiny/empty progress and stalled bodies remain bounded, and intrinsic bytes ignore shadow getters", async () => {
  const s = resolution().source!, chunk = data(); let getterCalls = 0;
  Object.defineProperty(chunk, "byteLength", { get() { getterCalls++; throw Error("synthetic shadow"); } });
  const positive = new Response(new ReadableStream({ start(c) { c.enqueue(chunk); c.close(); } }), { headers: { "content-type": "audio/mpeg" } }); Object.defineProperty(positive, "url", { value: origin + s.path });
  expect(await downloadShortReferenceAudio(s, new AbortController().signal, { origin, fetch: vi.fn(async () => positive) })).toEqual(data()); expect(getterCalls).toBe(0);
  const make = (body: ReadableStream<Uint8Array>) => { const r = new Response(body, { headers: { "content-type": "audio/mpeg" } }); Object.defineProperty(r, "url", { value: origin + s.path }); return r; };
  await expect(downloadShortReferenceAudio(s, new AbortController().signal, { origin, fetch: vi.fn(async () => make(new ReadableStream({ start(c) { for (let i = 0; i < 65; i++) c.enqueue(new Uint8Array()); } }))) })).rejects.toThrow();
  vi.useFakeTimers(); const pending = downloadShortReferenceAudio(s, new AbortController().signal, { origin, fetch: vi.fn(async () => make(new ReadableStream({ cancel() { return new Promise(() => {}); } }))) });
  const assertion = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(5001); await assertion;
});
test("integer-frame identity accepts measured microseconds but rejects off-by-one, padding and invalid duration", () => {
  expect(shortMediaFramesMatch(34.574036, 44100, 1524715)).toBe(true);
  for (const duration of [0, NaN, Infinity, -1, 2 + 1 / 24000, 2 + 1152 / 24000]) expect(shortMediaFramesMatch(duration, 24000, 48000)).toBe(false);
});
test("silent gesture bytes are bounded zeros; Word WAV has physical selected frame bounds", async () => {
  const prime = new Uint8Array(await shortSilentPrime().arrayBuffer()); expect(prime.length).toBe(204); expect(prime.slice(44).every(v => v === 0)).toBe(true);
  const s = resolution().source!, blob = shortWordWav(decoded(s), s, 12000, 24000), bytes = await blob.arrayBuffer(), header = new DataView(bytes);
  expect(header.getUint32(40, true)).toBe(24000); expect(header.getUint32(24, true)).toBe(24000); expect(blob.size).toBe(24044);
  expect(() => shortWordWav(decoded(s), s, -1, 3)).toThrow(); expect(() => shortWordWav({ ...decoded(s), sampleRate: 48000 }, s, 0, 1)).toThrow();
});
test("no mount autoplay; cold select primes synchronously before pending private load", async () => {
  const gate = deferred<ReferenceShortResolution>(), f = fixture({ load: () => gate.promise }); expect(f.media.play).not.toHaveBeenCalled();
  const pending = f.player.select(0); expect(f.media.attempts).toEqual([expect.stringContaining("blob:prime")]); expect(f.player.state.playback.status).toBe("loading");
  f.player.suspend(); gate.resolve(resolution()); await pending; expect(f.media.attempts).toHaveLength(1); expect(f.player.state.suspended).toBe(true); f.player.dispose();
});
test("Verse skips decoding, reuses sameverse DTO/body and plays ready media before awaiting", async () => {
  const f = fixture(); await f.player.select(0); expect(f.player.state.playback.status).toBe("playing"); expect(f.decode).not.toHaveBeenCalled(); expect(f.audio).toHaveBeenCalledOnce();
  const before = f.media.play.mock.calls.length, pending = f.player.play(); expect(f.media.play.mock.calls.length).toBe(before + 1); expect(f.media.attempts.at(-1)).toContain("blob:verse"); await pending;
  expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce(); f.player.dispose();
});
test("Pause then Play resumes halfway while explicit selection and ended Play restart", async () => {
  const f = fixture(); await f.player.select(0); f.media.currentTime = 0.8; f.player.pause(); const pending = f.player.play();
  expect(f.media.currentTime).toBe(0.8); await pending; expect(f.player.state.playback.status).toBe("playing");
  await f.player.select(0); expect(f.media.currentTime).toBe(0); f.media.finish(); await f.player.play(); expect(f.media.currentTime).toBe(0);
  expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce(); f.player.dispose();
});
test("Word lazily decodes once, native EOF/repeat and highlights use original clock without polling cutoff", async () => {
  const f = fixture(); await f.player.select(0); await f.player.select(0, 1); expect(f.decode).toHaveBeenCalledOnce(); expect(f.player.state.selection).toBe(1); expect(f.media.duration).toBe(1);
  f.media.currentTime = 0.25; f.media.dispatchEvent(new Event("timeupdate")); expect(f.active.at(-1)).toEqual({ verse: 0, index: 1 });
  const pauses = f.media.pause.mock.calls.length; f.media.currentTime = 1; f.media.dispatchEvent(new Event("timeupdate")); expect(f.media.pause).toHaveBeenCalledTimes(pauses);
  f.player.setSpeed(0.75); expect(f.media.playbackRate).toBe(0.75); f.player.setRepeat(true); f.media.finish(); await vi.waitFor(() => expect(f.player.state.playback.status).toBe("playing"));
  expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.decode).toHaveBeenCalledOnce(); f.player.setRepeat(false); f.media.finish(); expect(f.active.at(-1)).toBeNull(); f.player.dispose();
});
test("highlight callbacks publish only real pair changes across RAF, boundaries, verse and clears", async () => {
  const f = fixture(); await f.player.select(0); expect(f.active).toEqual([{ verse: 0, index: 0 }]);
  const tick = () => { const queued = [...f.frames.values()]; f.frames.clear(); queued.forEach(callback => callback(0)); };
  for (const time of [0.1, 0.2, 0.9]) { f.media.currentTime = time; f.media.dispatchEvent(new Event("timeupdate")); tick(); }
  expect(f.active).toEqual([{ verse: 0, index: 0 }]);
  f.media.currentTime = 1; f.media.dispatchEvent(new Event("timeupdate")); tick(); expect(f.active.at(-1)).toEqual({ verse: 0, index: 1 }); expect(f.active).toHaveLength(2);
  f.player.pause(); f.player.pause(); f.player.suspend(); expect(f.active).toEqual([{ verse: 0, index: 0 }, { verse: 0, index: 1 }, null]);
  await f.player.select(1); tick(); f.media.dispatchEvent(new Event("timeupdate")); expect(f.active.at(-1)).toEqual({ verse: 1, index: 0 }); expect(f.active).toHaveLength(4);
  f.media.finish(); f.player.pause(); f.player.suspend(); expect(f.active.at(-1)).toBeNull(); expect(f.active).toHaveLength(5); f.player.dispose(); expect(f.active).toHaveLength(5);
});
test("wrong rendered NFC/count holds Word but preserves Verse, with no broader selection fallback", async () => {
  const f = fixture({ verses: [{ ref: "Genesis 1:1", readingText: "אחר", wordCount: 2 }] }); await f.player.select(0); expect(f.player.state.playback.wordsReady).toBe(false);
  const before = f.media.play.mock.calls.length; await f.player.select(0, 0); expect(f.player.state.timingHeld).toBe(true); expect(f.media.play).toHaveBeenCalledTimes(before); expect(f.decode).not.toHaveBeenCalled(); f.player.dispose();
});
test("rapid verse intent fences late private load and keeps one element", async () => {
  const gate = deferred<ReferenceShortResolution>(), f = fixture({ load: (i: number) => i === 0 ? gate.promise : Promise.resolve(resolution(i)) });
  const old = f.player.select(0); await f.player.select(1); const count = f.media.play.mock.calls.length; gate.resolve(resolution()); await old;
  expect(f.player.state.verse).toBe(1); expect(f.media.play).toHaveBeenCalledTimes(count); expect(f.audio).toHaveBeenCalledOnce(); f.player.dispose();
});
test("failed current download is evicted so retry succeeds without another private DTO load", async () => {
  for (const failure of ["reject", "corrupt"] as const) {
    const f = fixture(); if (failure === "reject") f.fetcher.mockRejectedValueOnce(Error("synthetic transient")); else f.fetcher.mockResolvedValueOnce(response(data(2)));
    await f.player.select(0); expect(f.player.state.playback.status).toBe("error"); await f.player.play();
    expect(f.player.state.playback.status).toBe("playing"); expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledTimes(2); f.player.dispose();
  }
});
test("late old fetch rejection cannot evict the newer verse's verified body", async () => {
  const gate = deferred<Response>(), f = fixture(); f.fetcher.mockImplementationOnce(() => gate.promise);
  const old = f.player.select(0); await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce()); await f.player.select(1);
  gate.reject(Error("synthetic late failure")); await old; await f.player.select(1);
  expect(f.player.state.verse).toBe(1); expect(f.player.state.playback.status).toBe("playing"); expect(f.fetcher).toHaveBeenCalledTimes(2); f.player.dispose();
});
test("stale prime/play acknowledgments cannot pause newer verified media; quiet pause fences the last pending play", async () => {
  const f = fixture(), prime = deferred<void>(); f.media.play.mockImplementationOnce(() => prime.promise); await f.player.select(0);
  const count = f.media.pause.mock.calls.length; prime.resolve(); await Promise.resolve(); expect(f.media.pause).toHaveBeenCalledTimes(count); expect(f.player.state.playback.status).toBe("playing");
  const late = deferred<void>(); f.media.play.mockImplementationOnce(() => late.promise); const pending = f.player.play(); f.player.pause(); late.resolve(); await pending; expect(f.player.state.playback.status).toBe("ready"); f.player.dispose();
});
test("old verified play acknowledgment cannot stop a newer cold selection's gesture primer", async () => {
  const next = deferred<ReferenceShortResolution>(), f = fixture({ load: i => i === 0 ? Promise.resolve(resolution()) : next.promise });
  await f.player.select(0); const ack = deferred<void>(); f.media.play.mockImplementationOnce(() => ack.promise); const old = f.player.play();
  const newer = f.player.select(1), pauses = f.media.pause.mock.calls.length; ack.resolve(); await old;
  expect(f.media.pause).toHaveBeenCalledTimes(pauses); expect(f.media.src).toContain("blob:prime");
  next.resolve(resolution(1)); await newer; expect(f.player.state.verse).toBe(1); expect(f.player.state.playback.status).toBe("playing"); f.player.dispose();
});
test("queued primer metadata/ended/error events cannot validate or stop a new source lease", async () => {
  const f = fixture(); f.media.deferMetadata = true; const pending = f.player.select(0);
  await vi.waitFor(() => { expect(f.createUrl).toHaveBeenCalledTimes(2); expect(f.media.metadataJobs.some(job => job.url === f.media.src)).toBe(true); });
  f.media.currentSrc = "blob:old-prime"; f.media.readyState = 1; f.media.duration = 0.01;
  f.media.dispatchEvent(new Event("loadedmetadata")); await Promise.resolve(); expect(f.player.state.playback.status).toBe("loading");
  f.media.metadataJobs.forEach(job => job.finish()); await pending; expect(f.player.state.playback.status).toBe("playing");
  const before = f.media.pause.mock.calls.length; f.media.ended = false; f.media.dispatchEvent(new Event("ended")); f.media.dispatchEvent(new Event("error"));
  expect(f.player.state.playback.status).toBe("playing"); expect(f.media.pause).toHaveBeenCalledTimes(before); f.player.dispose();
});
test("real play rejection offers explicit current-selection retry, never automatic fallback", async () => {
  const f = fixture(); f.media.play.mockImplementationOnce(() => Promise.resolve()).mockRejectedValueOnce(new DOMException("synthetic", "NotAllowedError"));
  await f.player.select(0); expect(f.player.state.playback.retryPlay).toBe(true); expect(f.player.state.playback.status).toBe("ready"); expect(f.load).toHaveBeenCalledOnce(); f.player.dispose();
});
test("metadata/decoded frame or rate mismatch refuses; no duration correction, resampling or crop clamp", async () => {
  const f = fixture(); f.media.metadataFrames = 48001; await f.player.select(0); expect(f.player.state.playback.status).toBe("error"); f.player.dispose();
  const g = fixture({}, { decode: async (_b, s) => ({ ...decoded(s), length: s.presentationFrames + 1 }) }); await g.player.select(0, 0); expect(g.player.state.playback.status).toBe("error"); expect(g.media.attempts.every(url => url.includes("prime"))).toBe(true); g.player.dispose();
});
test("decode work is serialized and only the newest queued verse survives", async () => {
  let calls = 0; const first = deferred<ShortDecodedAudio>(), decode = vi.fn((_b: Uint8Array<ArrayBuffer>, s: ShortReferenceSource) => ++calls === 1 ? first.promise : Promise.resolve(decoded(s))), f = fixture({}, { decode });
  const a = f.player.select(0, 0); await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce()); const b = f.player.select(1, 0); await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2)); const c = f.player.select(2, 0); await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(3));
  first.resolve(decoded(resolution().source!)); await Promise.all([a, b, c]); expect(decode).toHaveBeenCalledTimes(2); expect(decode.mock.calls[1][1].parent.asset).toBe(resolution(2).source!.parent.asset); expect(f.player.state.verse).toBe(2); expect(f.player.state.playback.status).toBe("playing"); f.player.dispose();
});
test("scope suspend discards late decode and private cache; resume reloads without changing the element", async () => {
  const gate = deferred<ShortDecodedAudio>(), decode = vi.fn(() => gate.promise), f = fixture({}, { decode });
  const pending = f.player.select(0, 0); await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce()); f.player.suspend(); gate.resolve(decoded(resolution().source!)); await pending;
  expect(f.player.state.suspended).toBe(true); expect(f.media.src).toBe(""); expect(f.frames.size).toBe(0);
  await f.player.select(0); expect(f.load).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledTimes(2); expect(f.audio).toHaveBeenCalledOnce(); f.player.dispose();
});

test("word WAV cuts fade in and out over 5 ms with a raised cosine; the middle is untouched", async () => {
  const s = resolution().source!, bytes = new DataView(await shortWordWav(decoded(s), s, 12000, 24000).arrayBuffer());
  const sample = (k: number) => bytes.getInt16(44 + k * 2, true) / 32767, fade = Math.round(s.sampleRate * SHORT_WORD_FADE_SECONDS);
  expect(fade).toBe(120);
  expect(sample(0)).toBe(0); expect(sample(11999)).toBe(0);
  expect(sample(60)).toBeCloseTo(0.25 * 0.5, 3);
  expect(sample(fade)).toBeCloseTo(0.25, 3); expect(sample(6000)).toBeCloseTo(0.25, 3); expect(sample(11999 - fade)).toBeCloseTo(0.25, 3);
  for (let k = 1; k < fade; k++) expect(sample(k)).toBeGreaterThanOrEqual(sample(k - 1));
  // A cut shorter than two fades fades over half its length and never exceeds the source level.
  const short = new DataView(await shortWordWav(decoded(s), s, 100, 140).arrayBuffer());
  const values = Array.from({ length: 40 }, (_, k) => short.getInt16(44 + k * 2, true) / 32767);
  expect(values[0]).toBe(0); expect(values[39]).toBe(0); expect(Math.max(...values)).toBeLessThanOrEqual(0.2501);
});
