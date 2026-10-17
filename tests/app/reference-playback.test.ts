// Synthetic bytes and media clocks only; these tests do not decode or download audio.
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { createReferencePlayback, downloadReferenceAudio, REFERENCE_PLAYBACK_LIMITS, type ReferenceAudioElement, type ReferencePlaybackState } from "../../src/lib/reference-audio/playback";
import type { ReferenceResolution, ReferenceSource } from "../../src/lib/reference-audio/source";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { ReferencePlayer } from "../../src/components/portal/workspace/study/reference-player";

const data = new Uint8Array([1, 2, 3, 4]);
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const withCredentials = (value: string) => { const url = new URL(value); url.username = "user"; url.password = "pass"; return url.href; };
const text = "אבג דהו זחט";
const source = (): ReferenceSource => ({ schema: "reference-source/v1", asset: "ra_" + "a".repeat(32), url: "https://archive.org/download/PockettorahAudioFiles/Synthetic-1.mp3", sha256: hash(data), bytes: data.length });
const resolution = (): ReferenceResolution => ({ verse: { schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset: source().asset, clip: { start: 10, end: 15 } }, words: { status: "ready", readingTextSha256: hash(text.normalize("NFC")), starts: [10.5, 12, 14] }, attribution: REFERENCE_ATTRIBUTION }, source: source() });
function response(body: BodyInit | ReadableStream<Uint8Array> | null = data, url = "https://ia800000.us.archive.org/source.mp3", headers: Record<string, string> = {}) {
  const result = new Response(body, { headers }); Object.defineProperty(result, "url", { value: url }); return result;
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Media extends EventTarget {
  src = ""; preload = ""; duration = 30; currentTime = 0; playbackRate = 1; preservesPitch = true;
  play = vi.fn<() => Promise<void>>().mockResolvedValue(); pause = vi.fn();
  load = vi.fn(() => { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); });
  removeAttribute = vi.fn((name: string) => { if (name === "src") this.src = ""; });
}
function fixture(overrides: Partial<Parameters<typeof createReferencePlayback>[0]> = {}) {
  const media = new Media(), frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(); let nextId = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
  const states: ReferencePlaybackState[] = [], words: (number | null)[] = [];
  const createUrl = vi.fn(() => "blob:synthetic-" + nextId++), revokeUrl = vi.fn();
  const load = vi.fn(async () => resolution());
  const player = createReferencePlayback({ ref: "Genesis 1:1", readingText: text, wordCount: 3, load, fetch: fetcher,
    audio: () => media as ReferenceAudioElement, createUrl, revokeUrl, onState: s => states.push(s), onActiveWord: w => words.push(w),
    scheduler: { frame(fn) { const id = nextId++; frames.set(id, fn); return id; }, cancelFrame(id) { frames.delete(id); },
      timer(fn) { const id = nextId++; timers.set(id, fn); return id as unknown as ReturnType<typeof setTimeout>; }, clearTimer(id) { timers.delete(id as unknown as number); } }, ...overrides });
  return { player, media, fetcher, load, states, words, createUrl, revokeUrl, frames, timers,
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(0)); },
    timer() { const callback = timers.values().next().value; timers.clear(); callback?.(); } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("verifies exact observed source bytes/hash and sends no external credentials or referrer", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(data, undefined, { "content-length": "4" }));
  const blob = await downloadReferenceAudio(source(), new AbortController().signal, { fetch: fetcher });
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data);
  expect(blob.type).toBe("audio/mpeg");
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(source().url, expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", cache: "no-store", redirect: "follow" }));
  expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
});

it("vets the original URL and only accepts final HTTPS Archive hosts", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const url of ["https://archive.org.evil.test/a.mp3", "http://archive.org/download/PockettorahAudioFiles/Synthetic.mp3", source().url + "?private=1", withCredentials(source().url)]) {
    await expect(downloadReferenceAudio({ ...source(), url }, new AbortController().signal, { fetch: fetcher })).rejects.toThrow("Reference audio unavailable");
  }
  expect(fetcher).not.toHaveBeenCalled();
  for (const url of ["https://evil.test/a", "https://archive.org.evil.test/a", "http://ia.archive.org/a", withCredentials("https://ia.archive.org/a"), "https://ia.archive.org:8443/a", ""]) {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } }), cancel = vi.spyOn(body, "cancel");
    fetcher.mockResolvedValueOnce(response(body, url));
    await expect(downloadReferenceAudio(source(), new AbortController().signal, { fetch: fetcher })).rejects.toThrow("Reference audio unavailable");
    expect(cancel).toHaveBeenCalledTimes(1);
  }
});

it("refuses too many/few decoded bytes, a stale hash, non-200 and bodyless responses", async () => {
  for (const [body, sourceValue] of [[new Uint8Array([1, 2, 3]), source()], [new Uint8Array([1, 2, 3, 4, 5]), source()], [data, { ...source(), sha256: "b".repeat(64) }]] as const) {
    await expect(downloadReferenceAudio(sourceValue, new AbortController().signal, { fetch: vi.fn(async () => response(body)) })).rejects.toThrow("Reference audio unavailable");
  }
  for (const bad of [new Response(null, { status: 204 }), response(null)]) await expect(downloadReferenceAudio(source(), new AbortController().signal, { fetch: vi.fn(async () => bad) })).rejects.toThrow("Reference audio unavailable");
  const fetcher = vi.fn<typeof fetch>();
  await expect(downloadReferenceAudio({ ...source(), bytes: REFERENCE_PLAYBACK_LIMITS.bytes + 1 }, new AbortController().signal, { fetch: fetcher })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("uses observed decoded bytes even when transfer length/encoding headers differ", async () => {
  const blob = await downloadReferenceAudio(source(), new AbortController().signal, { fetch: vi.fn(async () => response(data, undefined, { "content-length": "2", "content-encoding": "gzip" })) });
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data);
});

it("bounds empty-reader starvation and never awaits a stalled cancellation", async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array()); }, cancel() { return new Promise<void>(() => {}); } });
  await expect(downloadReferenceAudio(source(), new AbortController().signal, { fetch: vi.fn(async () => response(body)) })).rejects.toThrow("Reference audio unavailable");
  expect(pulls).toBeLessThanOrEqual(REFERENCE_PLAYBACK_LIMITS.emptyReads + 2);
  expect(body.locked).toBe(false);
});

it("settles aborted fetch immediately and cancels an eventual late response", async () => {
  const gate = deferred<Response>(), abort = new AbortController();
  const work = downloadReferenceAudio(source(), abort.signal, { fetch: vi.fn(() => gate.promise) });
  abort.abort(); await expect(work).rejects.toThrow("Reference audio unavailable");
  const late = response(), cancel = vi.spyOn(late.body!, "cancel"); gate.resolve(late); await Promise.resolve(); await Promise.resolve();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("checks elapsed time after fetch settlement and cancels a rejected body", async () => {
  let now = 0;
  const result = response(), cancel = vi.spyOn(result.body!, "cancel");
  await expect(downloadReferenceAudio(source(), new AbortController().signal, { now: () => now, fetch: vi.fn(async () => { now = 60_001; return result; }) })).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("stops a stalled body on the idle deadline", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); }, cancel });
  const work = downloadReferenceAudio(source(), new AbortController().signal, { fetch: vi.fn(async () => response(body)) });
  const asserted = expect(work).rejects.toThrow("Reference audio unavailable");
  await vi.advanceTimersByTimeAsync(REFERENCE_PLAYBACK_LIMITS.idleMs + 1); await asserted;
  expect(cancel).toHaveBeenCalled();
});

it("does not fetch, create audio or autoplay on construction; explicit load verifies before native setup", async () => {
  const f = fixture();
  expect(f.load).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.media.load).not.toHaveBeenCalled();
  await f.player.load();
  expect(f.player.state).toMatchObject({ status: "ready", wordsReady: true, wordCount: 3, speedSupported: true });
  expect(f.media.src).toMatch(/^blob:synthetic-/); expect(f.media.currentTime).toBe(10); expect(f.media.preservesPitch).toBe(true);
  expect(f.media.play).not.toHaveBeenCalled(); expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
  f.player.dispose();
});

it("uses source time for highlighting and precise selection bounds at each speed", async () => {
  const f = fixture(); await f.player.load(); await f.player.play();
  f.media.currentTime = 10.25; f.frame(); expect(f.words.at(-1) ?? null).toBeNull();
  f.media.currentTime = 12; f.frame(); expect(f.words.at(-1)).toBe(1);
  f.player.select(1); expect(f.media.currentTime).toBe(12);
  f.player.setSpeed(0.5); expect(f.media.playbackRate).toBe(0.5); expect(f.media.preservesPitch).toBe(true);
  f.media.currentTime = 14; f.timer();
  expect(f.player.state.status).toBe("ready"); expect(f.media.currentTime).toBe(14); expect(f.words.at(-1)).toBeNull();
  expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
  f.player.dispose();
});

it("repeats the selected word, changes selections explicitly and stops at the verse end", async () => {
  const f = fixture(); await f.player.load(); f.player.select(2); f.player.setRepeat(true); await f.player.play();
  f.media.currentTime = 15.02; f.media.dispatchEvent(new Event("timeupdate"));
  expect(f.media.currentTime).toBe(14); expect(f.player.state.status).toBe("playing"); expect(f.words.at(-1)).toBe(2);
  f.player.select("verse"); expect(f.media.currentTime).toBe(10);
  f.player.setRepeat(false); f.media.currentTime = 15; f.frame();
  expect(f.player.state.status).toBe("ready"); expect(f.media.currentTime).toBe(15);
  f.player.dispose();
});

it("preserves verse-only playback for stale text/count and refuses a wrong ref or held playback without download", async () => {
  for (const overrides of [{ readingText: text + " changed" }, { wordCount: 2 }]) {
    const f = fixture(overrides); await f.player.load();
    expect(f.player.state).toMatchObject({ status: "ready", wordsReady: false, wordCount: 0 });
    f.player.select(0); expect(f.player.state.selection).toBe("verse"); f.player.dispose();
  }
  const wrong = fixture({ ref: "Genesis 1:2" }); await wrong.player.load(); expect(wrong.player.state.status).toBe("unavailable"); expect(wrong.fetcher).not.toHaveBeenCalled(); wrong.player.dispose();
  const dto = resolution();
  const held = { ...dto, verse: { ...dto.verse, playback: { ...dto.verse.playback, status: "needs-review", review: "start-moved" } }, source: null } as ReferenceResolution;
  const f = fixture({ load: async () => held }); await f.player.load(); expect(f.player.state.status).toBe("unavailable"); expect(f.fetcher).not.toHaveBeenCalled(); f.player.dispose();
});

it("returns ready after native play rejection and permits an explicit user retry", async () => {
  const f = fixture(); await f.player.load(); f.media.play.mockRejectedValueOnce(new Error("private media details"));
  await f.player.play(); expect(f.player.state).toMatchObject({ status: "ready", retryPlay: true });
  await f.player.play(); expect(f.player.state).toMatchObject({ status: "playing", retryPlay: false });
  f.player.pause(); f.media.currentTime = 12; f.media.dispatchEvent(new Event("timeupdate"));
  expect(f.words.at(-1) ?? null).toBeNull(); expect(f.frames.size).toBe(0); f.player.dispose();
});

it("does not revive paused or disposed playback when a play promise resolves late", async () => {
  const f = fixture(); await f.player.load(); const gate = deferred<void>(); f.media.play.mockReturnValueOnce(gate.promise);
  const playing = f.player.play(); f.player.pause(); gate.resolve(); await playing;
  expect(f.player.state.status).toBe("ready"); expect(f.frames.size).toBe(0);
  const second = deferred<void>(); f.media.play.mockReturnValueOnce(second.promise);
  const stale = f.player.play(); f.player.dispose(); const stateCount = f.states.length; second.resolve(); await stale;
  expect(f.states).toHaveLength(stateCount); expect(f.media.src).toBe(""); expect(f.revokeUrl).toHaveBeenCalledTimes(1);
  f.media.dispatchEvent(new Event("playing")); expect(f.frames.size).toBe(0);
});

it("fences late resolver/hash results and escaped selection handles after scope disposal", async () => {
  const gate = deferred<ReferenceResolution>(), f = fixture({ load: () => gate.promise });
  const loading = f.player.load(), select = f.player.select; f.player.dispose(); await loading;
  gate.resolve(resolution()); await Promise.resolve(); await Promise.resolve(); select(1);
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.createUrl).not.toHaveBeenCalled(); expect(f.media.play).not.toHaveBeenCalled();
  const digestGate = deferred<string>(), second = fixture({ digest: () => digestGate.promise });
  const pending = second.player.load(); await Promise.resolve(); await Promise.resolve(); second.player.dispose(); await pending;
  digestGate.resolve(hash(text)); await Promise.resolve(); expect(second.fetcher).not.toHaveBeenCalled();
});

it("pauses/unloads/revokes every owned URL on reload and final teardown", async () => {
  const f = fixture(); await f.player.load(); await f.player.play(); const first = f.media.src;
  await f.player.load(); expect(f.revokeUrl).toHaveBeenCalledExactlyOnceWith(first);
  const last = f.media.src, states = f.states.length; f.player.dispose(); f.player.dispose();
  expect(f.revokeUrl).toHaveBeenCalledTimes(2); expect(f.revokeUrl).toHaveBeenLastCalledWith(last);
  f.media.dispatchEvent(new Event("error")); f.media.dispatchEvent(new Event("seeked"));
  expect(f.states).toHaveLength(states); expect(f.media.src).toBe(""); expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
});

it("does not change speed if native pitch preservation is unsupported", async () => {
  const f = fixture(); Object.defineProperty(f.media, "preservesPitch", { value: undefined, writable: true }); await f.player.load();
  expect(f.player.state.speedSupported).toBe(false); f.player.setSpeed(0.5); expect(f.media.playbackRate).toBe(1); f.player.dispose();
});

it("bounds native play settlement and does not revive after a late success", async () => {
  const f = fixture(); await f.player.load(); vi.useFakeTimers();
  const gate = deferred<void>(); f.media.play.mockReturnValueOnce(gate.promise);
  const playing = f.player.play(); await vi.advanceTimersByTimeAsync(REFERENCE_PLAYBACK_LIMITS.playMs + 1); await playing;
  expect(f.player.state).toMatchObject({ status: "ready", retryPlay: true });
  const count = f.states.length; gate.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(f.states).toHaveLength(count); expect(f.frames.size).toBe(0); f.player.dispose();
});

it("refuses a native source shorter than the selected clip and releases the verified URL", async () => {
  const f = fixture(); f.media.duration = 12;
  await f.player.load(); expect(f.player.state.status).toBe("error");
  expect(f.revokeUrl).toHaveBeenCalledTimes(1); expect(f.media.src).toBe(""); expect(f.media.play).not.toHaveBeenCalled();
  f.player.dispose(); expect(f.revokeUrl).toHaveBeenCalledTimes(1);
});

it("aborts an in-progress source read and never creates a native media URL", async () => {
  const read = deferred<void>(), dispatched = deferred<void>();
  const f = fixture({ fetch: vi.fn(async () => { dispatched.resolve(); return response(new ReadableStream<Uint8Array>({ pull() { return read.promise; } })); }) });
  const loading = f.player.load();
  await dispatched.promise;
  f.player.dispose(); await loading; read.resolve(); await Promise.resolve();
  expect(f.createUrl).not.toHaveBeenCalled(); expect(f.media.play).not.toHaveBeenCalled();
});

it("keeps speed finite and within the supported 0.5–1.25 range", async () => {
  const f = fixture(); await f.player.load();
  for (const speed of [0, 0.49, 1.251, 2, NaN, Infinity]) f.player.setSpeed(speed);
  expect(f.media.playbackRate).toBe(1); expect(f.player.state.speed).toBe(1);
  f.player.setSpeed(1.25); expect(f.media.playbackRate).toBe(1.25); expect(f.player.state.speed).toBe(1.25); f.player.dispose();
});

it("renders explicit keyboard controls without effects, media URLs, autoplay or word guesses", () => {
  const load = vi.fn(async () => resolution()), active = vi.fn(), register = vi.fn();
  const html = renderToStaticMarkup(createElement(ReferencePlayer, { scopeKey: "scope-a", verseRef: "Genesis 1:1", readingText: text, wordCount: 3, load, onActiveWord: active, registerWordSelection: register }));
  expect(load).not.toHaveBeenCalled(); expect(active).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
  expect(html).toContain("Load recording"); expect(html).toContain("Whole verse"); expect(html).toContain("Speed"); expect(html).toContain("Repeat");
  expect(html).not.toContain("Word 1"); expect(html).not.toContain("archive.org/download/"); expect(html).toContain("https://archive.org/details/PockettorahAudioFiles"); expect(html).not.toContain("<audio"); expect(html).not.toContain("autoplay");
});
