// Independent invented-byte races; no corpus, provider or browser network.
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createReadingPlayback } from "../../src/components/portal/workspace/study/main-playback";
import { createReferenceAudioReuse, createReferencePlayback, type ReferenceAudioElement, type ReferencePlaybackOptions } from "../../src/lib/reference-audio/playback";
import type { ReferenceResolution, ReferenceSource } from "../../src/lib/reference-audio/source";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";

const words = "אבג דהו", bytes = new Uint8Array([21, 34, 55]);
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const source: ReferenceSource = { schema: "reference-source/v1", asset: "ra_" + "b".repeat(32), url: "https://archive.org/download/PockettorahAudioFiles/Review-one.mp3", bytes: bytes.length, sha256: sha(bytes) };
function resolved(index = 0, selectedSource = source, timed = true): ReferenceResolution {
  const start = 2 + index * 4;
  return { source: selectedSource, verse: { schema: "reference-verse/v1", ref: `Genesis 1:${index + 1}`, table: "torah", playback: { status: "ready", asset: selectedSource.asset, clip: { start, end: start + 3 } }, words: timed ? { status: "ready", readingTextSha256: sha(words), starts: [start, start + 1] } : { status: "unavailable", reason: "no-words" }, attribution: REFERENCE_ATTRIBUTION } };
}
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(done => setTimeout(done, 0));
function response(value = bytes) { const result = new Response(value); Object.defineProperty(result, "url", { value: "https://ia800001.us.archive.org/review.mp3" }); return result; }
class Native extends EventTarget {
  src = ""; preload = ""; duration = 30; currentTime = 0; playbackRate = 1; preservesPitch = true;
  play = vi.fn<() => Promise<void>>().mockResolvedValue(); pause = vi.fn();
  constructor(readonly automaticMetadata = true) { super(); }
  load() { if (this.src && this.automaticMetadata) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
}
function rig(fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response()), automaticMetadata = true) {
  const media: Native[] = [], revoked: string[] = [];
  const platform: Pick<ReferencePlaybackOptions, "fetch" | "audio" | "createUrl" | "revokeUrl" | "scheduler"> = {
    fetch: fetcher, audio() { const value = new Native(automaticMetadata); media.push(value); return value as ReferenceAudioElement; },
    createUrl: () => `blob:review-${media.length}`, revokeUrl: value => { revoked.push(value); },
    scheduler: { frame: () => 1, cancelFrame() {}, timer: () => 1 as unknown as ReturnType<typeof setTimeout>, clearTimer() {} },
  };
  return { platform, media, revoked, fetcher };
}
function controller(r: ReturnType<typeof rig>, reuse: ReturnType<typeof createReferenceAudioReuse>, load: ReferencePlaybackOptions["load"] = async () => resolved(), extra: Partial<ReferencePlaybackOptions> = {}) {
  return createReferencePlayback({ ...r.platform, assetReuse: reuse, ref: "Genesis 1:1", readingText: words, wordCount: 2, load, ...extra });
}
function pageOwner(r: ReturnType<typeof rig>, load: (index: number, signal: AbortSignal) => Promise<ReferenceResolution> = async index => resolved(index)) {
  return createReadingPlayback({ platform: r.platform, verses: [0, 1].map(index => ({ ref: `Genesis 1:${index + 1}`, readingText: words, wordCount: 2 })), load, onState() {}, onActiveWord() {} });
}

it("review fences an older distinct-key completion without evicting the newer verified entry", async () => {
  const old = gate<Response>(), newer = { ...source, url: source.url.replace("one", "two") };
  const r = rig(vi.fn<typeof fetch>().mockImplementationOnce(() => old.promise).mockImplementation(async () => response())), reuse = createReferenceAudioReuse();
  const a = controller(r, reuse), aWork = a.load(); await tick();
  const b = controller(r, reuse, async () => resolved(0, newer)); await b.load();
  expect(b.state.status).toBe("ready"); old.resolve(response()); await aWork;
  expect(a.state.status).toBe("error"); expect(r.media).toHaveLength(1);
  const c = controller(r, reuse, async () => resolved(0, newer)); await c.load();
  expect(c.state.status).toBe("ready"); expect(r.fetcher).toHaveBeenCalledTimes(2);
  a.dispose(); b.dispose(); c.dispose(); reuse.clear();
});

it("review cache hits require fresh authority and actual text binding before any new native media", async () => {
  const r = rig(), reuse = createReferenceAudioReuse(), good = controller(r, reuse); await good.load();
  const denied = controller(r, reuse, async () => { throw new Error("synthetic unavailable"); }); await denied.load();
  const mismatched = controller(r, reuse, async () => resolved(), { readingText: "זחט יכל" }); await mismatched.load();
  // A mismatch can retain verse-only listening but cannot manufacture word timing.
  expect(denied.state.status).toBe("error"); expect(mismatched.state.wordsReady).toBe(false);
  expect(r.fetcher).toHaveBeenCalledTimes(1); expect(r.media).toHaveLength(2);
  expect(r.media.every(value => value.play.mock.calls.length === 0)).toBe(true);
  good.dispose(); denied.dispose(); mismatched.dispose(); reuse.clear();
});

it("review disposing a warm-cache consumer during its text digest cannot acquire a Blob or play", async () => {
  const r = rig(), reuse = createReferenceAudioReuse(), first = controller(r, reuse); await first.load();
  const digest = gate<string>(), waiting = controller(r, reuse, async () => resolved(), { digest: () => digest.promise });
  const work = waiting.load(); await tick(); waiting.dispose(); await work; digest.resolve(sha(words)); await tick();
  expect(r.media).toHaveLength(1); expect(r.fetcher).toHaveBeenCalledTimes(1);
  const later = controller(r, reuse); await later.load(); expect(later.state.status).toBe("ready"); expect(r.fetcher).toHaveBeenCalledTimes(1);
  first.dispose(); later.dispose(); reuse.clear();
});

it("review malformed reuse capabilities never invoke their user getters or accept unverified bytes", async () => {
  const r = rig(), getter = vi.fn(() => new Blob([bytes]));
  const forged = Object.freeze({ clear() {}, get: getter });
  const playback = createReferencePlayback({ ...r.platform, assetReuse: forged, ref: "Genesis 1:1", readingText: words, wordCount: 2, load: async () => resolved() });
  await playback.load(); expect(playback.state.status).toBe("error"); expect(getter).not.toHaveBeenCalled(); expect(r.fetcher).not.toHaveBeenCalled(); expect(r.media).toHaveLength(0); playback.dispose();
});

it("review clear plus a failed download cannot resurrect previously verified cached bytes", async () => {
  const r = rig(vi.fn<typeof fetch>().mockImplementationOnce(async () => response()).mockImplementationOnce(async () => response(new Uint8Array([0, 0, 0]))).mockImplementation(async () => response())), reuse = createReferenceAudioReuse();
  const first = controller(r, reuse); await first.load(); reuse.clear();
  const failed = controller(r, reuse); await failed.load(); expect(failed.state.status).toBe("error");
  const retry = controller(r, reuse); await retry.load(); expect(retry.state.status).toBe("ready"); expect(r.fetcher).toHaveBeenCalledTimes(3);
  first.dispose(); failed.dispose(); retry.dispose(); reuse.clear();
});

it("review newest selection owns held native metadata and suspension cannot resume it late", async () => {
  const r = rig(undefined, false), load = vi.fn(async (index: number) => resolved(index)), owner = pageOwner(r, load);
  const old = owner.select(0, 0); await vi.waitFor(() => expect(r.media).toHaveLength(1), { interval: 1 });
  const latest = owner.select(1, 1); await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2), { interval: 1 });
  expect(r.media).toHaveLength(1); r.media[0].dispatchEvent(new Event("loadedmetadata")); await Promise.all([old, latest]);
  expect(r.media[0].play).toHaveBeenCalledTimes(1); expect(r.media[0].currentTime).toBe(7);
  owner.suspend(); const pending = owner.play(); await vi.waitFor(() => expect(r.media).toHaveLength(2), { interval: 1 }); owner.suspend(); await pending;
  r.media[1].dispatchEvent(new Event("loadedmetadata")); await tick(); expect(r.media[1].play).not.toHaveBeenCalled(); expect(r.media[1].src).toBe("");
  expect(load).toHaveBeenCalledTimes(3); expect(r.fetcher).toHaveBeenCalledTimes(1); owner.dispose();
});

it("review timing hold never silently plays a verse and explicit resume retains passage preferences", async () => {
  const r = rig(), load = vi.fn(async (index: number) => resolved(index, source, index === 0)), owner = pageOwner(r, load);
  await owner.select(0, 0); owner.setSpeed(0.5); owner.setRepeat(true);
  await owner.select(1, 1); expect(owner.state.timingHeld).toBe(true); expect(r.media).toHaveLength(1); expect(r.media[0].play).toHaveBeenCalledTimes(1);
  owner.suspend(); await owner.play(); expect(owner.state.timingHeld).toBe(true); expect(r.media[1].play).not.toHaveBeenCalled();
  await owner.select(1, "verse"); expect(owner.state.playback).toMatchObject({ status: "playing", speed: 0.5, repeat: true });
  expect(r.media[1].currentTime).toBe(6); expect(r.media[1].play).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(3); expect(r.fetcher).toHaveBeenCalledTimes(1); owner.dispose();
});

it("review a disposed verse cannot cancel the same-source owner download or play when that download completes", async () => {
  const body = gate<Response>(), entered = gate<void>(); let signal: AbortSignal | null | undefined;
  const r = rig(vi.fn(async (_url, init) => { signal = init?.signal; entered.resolve(); return body.promise; }));
  const load = vi.fn(async (index: number) => resolved(index)), owner = pageOwner(r, load);
  const old = owner.select(0, 0); await entered.promise;
  const latest = owner.select(1, 1); await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2), { interval: 1 });
  expect(signal?.aborted).toBe(false); expect(r.fetcher).toHaveBeenCalledTimes(1);
  body.resolve(response()); await Promise.all([old, latest]);
  expect(r.media).toHaveLength(1); expect(r.media[0].play).toHaveBeenCalledTimes(1); expect(r.media[0].currentTime).toBe(7);
  owner.dispose(); expect(r.media[0].src).toBe(""); expect(r.revoked).toHaveLength(1);
});

it("review a previous pending play acknowledgement cannot pause the newer shared-media lease", async () => {
  const r = rig(), delayed = gate<void>();
  const native = r.platform.audio!; r.platform.audio = () => { const media = native() as Native; media.play.mockImplementationOnce(() => delayed.promise); return media as ReferenceAudioElement; };
  const owner = pageOwner(r), old = owner.select(0, 0);
  await vi.waitFor(() => expect(r.media[0]?.play).toHaveBeenCalledTimes(1), { interval: 1 });
  await owner.select(1, 1); const paused = r.media[0].pause.mock.calls.length;
  delayed.resolve(); await old; await tick();
  expect(r.media).toHaveLength(1); expect(r.media[0].pause).toHaveBeenCalledTimes(paused); expect(owner.state.playback.status).toBe("playing"); expect(r.media[0].currentTime).toBe(7);
  owner.dispose();
});

it("review final owner disposal aborts shared preparation and refuses every late media completion", async () => {
  const body = gate<Response>(), entered = gate<void>(); let signal: AbortSignal | null | undefined;
  const r = rig(vi.fn(async (_url, init) => { signal = init?.signal; entered.resolve(); return body.promise; })), owner = pageOwner(r);
  const work = owner.select(0, 0); await entered.promise; owner.dispose(); await work;
  expect(signal?.aborted).toBe(true); body.resolve(response()); await tick();
  expect(r.media).toHaveLength(0); expect(r.fetcher).toHaveBeenCalledTimes(1); await owner.select(1, 1); expect(r.media).toHaveLength(0);
});

it("review queued old playing callbacks cannot pause the new owner's shared media", async () => {
  const r = rig(), held: (EventListenerOrEventListenerObject | null)[] = [], native = r.platform.audio!;
  r.platform.audio = () => { const media = native(), add = media.addEventListener.bind(media);
    vi.spyOn(media,"addEventListener").mockImplementation((name, listener, options) => { if(name==="playing")held.push(listener); add(name,listener,options); }); return media; };
  const owner = pageOwner(r); await owner.select(0, 0); expect(held).toHaveLength(2); const old = held[1];
  await owner.select(1, 1); const paused = r.media[0].pause.mock.calls.length;
  if(typeof old==="function")old.call(r.media[0],new Event("playing"));else old?.handleEvent(new Event("playing"));
  expect(r.media[0].pause).toHaveBeenCalledTimes(paused); expect(owner.state.playback.status).toBe("playing");owner.dispose();
});

it("review warmed media never bypasses a new verse authority refusal or duration/text timing checks", async () => {
  const r = rig(); let denied = true;
  const owner = pageOwner(r, async index => { if (index && denied) throw Error("synthetic-denied"); return resolved(index); });
  await owner.select(0, 0); await owner.select(1, 0);
  expect(owner.state.playback.status).toBe("error"); expect(r.media[0].play).toHaveBeenCalledTimes(1); expect(r.fetcher).toHaveBeenCalledTimes(1);
  denied = false; r.media[0].duration = 5; await owner.select(1, 0);
  expect(owner.state.playback.status).toBe("error"); expect(r.media[0].play).toHaveBeenCalledTimes(1);
  r.media[0].duration = 30; await owner.select(1, 0);
  expect(owner.state.playback.status).toBe("playing"); expect(r.media).toHaveLength(1); expect(r.media[0].play).toHaveBeenCalledTimes(2); owner.dispose();
});

it("review exact source hash and byte-count changes cannot reuse already prepared media", async () => {
  for (const changed of ["hash", "bytes"] as const) {
    const other = changed === "hash" ? new Uint8Array([22,34,55]) : new Uint8Array([21,34,55,89]);
    const next = { ...source, sha256: sha(other), bytes: other.length };
    const r = rig(vi.fn<typeof fetch>().mockImplementationOnce(async () => response()).mockImplementation(async () => response(other)));
    const owner = pageOwner(r, async index => resolved(index, index ? next : source));
    await owner.select(0, 0); await owner.select(1, 1);
    expect(r.fetcher).toHaveBeenCalledTimes(2); expect(r.media).toHaveLength(2); expect(r.media[0].src).toBe(""); expect(r.media[1].play).toHaveBeenCalledTimes(1); owner.dispose();
  }
});
