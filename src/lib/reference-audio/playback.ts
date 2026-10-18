import { parseReferenceResolution, parseReferenceSource, type ReferenceResolution, type ReferenceSource } from "./source";
import { createReferenceTimeline, currentReferenceWord, referenceVerseLoop, referenceWordLoop, type ReferenceTimeline } from "./timeline";

export const REFERENCE_PLAYBACK_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, loadMs: 60_000, idleMs: 10_000, metadataMs: 15_000, playMs: 8_000, emptyReads: 64 });
const unavailable = () => new Error("Reference audio unavailable");
const clock = () => performance.now();
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
};
function finalArchiveUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      (url.hostname === "archive.org" || url.hostname.endsWith(".archive.org"));
  } catch { return false; }
}
function cancel(body: ReadableStream<Uint8Array> | null | undefined) { try { void body?.cancel().catch(() => {}); } catch {} }

/** Whole-source verification, not a separately cut clip. Never sends credentials.
 * Fetch redirect checks include the observed final URL; SHA binds the decoded bytes. */
export async function downloadReferenceAudio(sourceValue: ReferenceSource, signal: AbortSignal, io: {
  fetch?: typeof fetch; digest?: typeof sha256; now?: () => number;
} = {}): Promise<Blob> {
  const source = parseReferenceSource(sourceValue);
  if (!source || signal.aborted) throw unavailable();
  const fetcher = io.fetch ?? fetch, digest = io.digest ?? sha256, now = io.now ?? clock;
  const deadline = now() + REFERENCE_PLAYBACK_LIMITS.loadMs, abort = new AbortController();
  const externalAbort = () => abort.abort();
  signal.addEventListener("abort", externalAbort, { once: true });
  const totalTimer = setTimeout(() => abort.abort(), REFERENCE_PLAYBACK_LIMITS.loadMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const live = () => { if (abort.signal.aborted || signal.aborted || now() >= deadline) throw unavailable(); };
  async function wait<T>(work: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined, expired = false;
    const observed = work.then(value => { if (expired || abort.signal.aborted) { late?.(value); throw unavailable(); } return value; });
    try {
      const value = await Promise.race([observed, new Promise<never>((_, reject) => {
        onAbort = () => { expired = true; reject(unavailable()); };
        abort.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => { expired = true; reject(unavailable()); }, Math.max(1, ms));
        if (abort.signal.aborted) onAbort();
      })]);
      try { live(); return value; } catch { late?.(value); throw unavailable(); }
    } finally { if (timer) clearTimeout(timer); if (onAbort) abort.signal.removeEventListener("abort", onAbort); }
  }
  try {
    live();
    const response = await wait(fetcher(source.url, { signal: abort.signal, credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", cache: "no-store", redirect: "follow" }), REFERENCE_PLAYBACK_LIMITS.loadMs, response => cancel(response.body));
    try {
      if (response.status !== 200 || response.type === "opaque" || !finalArchiveUrl(response.url) || !response.body) throw unavailable();
      // Content-Length can describe compressed transfer bytes. The observed
      // decoded stream must match the approved source's exact size/hash below.
      live();
    } catch { cancel(response.body); throw unavailable(); }
    reader = response.body!.getReader();
    const bytes = new Uint8Array(source.bytes);
    let received = 0, empty = 0, progress = now();
    while (true) {
      live();
      const idleLeft = REFERENCE_PLAYBACK_LIMITS.idleMs - (now() - progress);
      if (idleLeft <= 0) throw unavailable();
      const part = await wait(reader.read(), Math.min(idleLeft, deadline - now()));
      if (now() - progress >= REFERENCE_PLAYBACK_LIMITS.idleMs) throw unavailable();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw unavailable();
      if (!part.value.byteLength) { if (++empty > REFERENCE_PLAYBACK_LIMITS.emptyReads) throw unavailable(); continue; }
      if (part.value.byteLength > source.bytes - received) throw unavailable();
      bytes.set(part.value, received); received += part.value.byteLength; progress = now(); empty = 0;
    }
    if (received !== source.bytes || received > REFERENCE_PLAYBACK_LIMITS.bytes) throw unavailable();
    const actualHash = await wait(digest(bytes), deadline - now());
    if (actualHash !== source.sha256) throw unavailable();
    live(); return new Blob([bytes], { type: "audio/mpeg" });
  } catch { abort.abort(); try { void reader?.cancel().catch(() => {}); } catch {} throw unavailable(); }
  finally { clearTimeout(totalTimer); signal.removeEventListener("abort", externalAbort); try { reader?.releaseLock(); } catch {} }
}

// Module-private capability: callers can clear it, never supply an unverified Blob.
const assetReuses = new WeakMap<object, (source: ReferenceSource, signal: AbortSignal, io: { fetch?: typeof fetch; digest?: typeof sha256 }) => Promise<Blob>>();
export function createReferenceAudioReuse() {
  let generation = 0, entry: { key: string; blob: Blob } | undefined;
  const capability = Object.freeze({ clear() { generation++; entry = undefined; } });
  assetReuses.set(capability, async (value, signal, io) => {
    const source = parseReferenceSource(value);
    if (!source || signal.aborted) throw unavailable();
    const key = JSON.stringify([source.url, source.sha256, source.bytes]);
    if (entry?.key === key) return entry.blob;
    const mine = ++generation; entry = undefined;
    const blob = await downloadReferenceAudio(source, signal, io);
    if (signal.aborted || mine !== generation) throw unavailable();
    entry = { key, blob }; return blob;
  });
  return capability;
}
export type ReferenceAudioReuse = ReturnType<typeof createReferenceAudioReuse>;

export type ReferencePlaybackState = Readonly<{
  status: "idle" | "loading" | "ready" | "playing" | "unavailable" | "error";
  selection: "verse" | number; repeat: boolean; speed: number; speedSupported: boolean;
  wordsReady: boolean; wordCount: number; retryPlay: boolean;
}>;
export type ReferenceAudioElement = Pick<HTMLAudioElement, "src" | "preload" | "duration" | "currentTime" | "playbackRate" | "preservesPitch" | "play" | "pause" | "load" | "removeAttribute" | "addEventListener" | "removeEventListener">;
type Scheduler = { frame(fn: FrameRequestCallback): number; cancelFrame(id: number): void; timer(fn: () => void, ms: number): ReturnType<typeof setTimeout>; clearTimer(id: ReturnType<typeof setTimeout>): void };
export type ReferencePlaybackOptions = {
  load(signal: AbortSignal): Promise<ReferenceResolution>;
  ref: string; readingText: string; wordCount: number;
  assetReuse?: ReferenceAudioReuse;
  onState?(state: ReferencePlaybackState): void; onActiveWord?(index: number | null): void;
  // Platform seams for deterministic offline tests; no configurable production caps.
  audio?(): ReferenceAudioElement; fetch?: typeof fetch; digest?: typeof sha256;
  createUrl?(blob: Blob): string; revokeUrl?(url: string): void; scheduler?: Scheduler;
};

/** One controller owns one authorized study mount. No load or play on creation. */
export function createReferencePlayback(options: ReferencePlaybackOptions) {
  const scheduler = options.scheduler ?? { frame: fn => requestAnimationFrame(fn), cancelFrame: id => cancelAnimationFrame(id), timer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id) };
  let state: ReferencePlaybackState = Object.freeze({ status: "idle", selection: "verse", repeat: false, speed: 1, speedSupported: false, wordsReady: false, wordCount: 0, retryPlay: false });
  let disposed = false, generation = 0, playGeneration = 0, wantsPlay = false, activeWord: number | null = null;
  let abort: AbortController | undefined, audio: ReferenceAudioElement | undefined, timeline: ReferenceTimeline | null = null, url: string | undefined;
  let frame: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let detach = () => {};
  const publish = (patch: Partial<ReferencePlaybackState>) => { if (!disposed) { state = Object.freeze({ ...state, ...patch }); options.onState?.(state); } };
  const word = (index: number | null) => { if (activeWord !== index) { activeWord = index; options.onActiveWord?.(index); } };
  const stopClock = () => { if (frame !== undefined) scheduler.cancelFrame(frame); if (timer !== undefined) scheduler.clearTimer(timer); frame = undefined; timer = undefined; };
  const range = () => state.selection === "verse" ? referenceVerseLoop(timeline) : referenceWordLoop(timeline, state.selection);
  function pause() { wantsPlay = false; playGeneration++; stopClock(); audio?.pause(); word(null); if (state.status === "playing") publish({ status: "ready" }); }
  function clearMedia() {
    pause(); detach(); detach = () => {};
    if (audio) { audio.removeAttribute("src"); audio.load(); audio = undefined; }
    if (url) { (options.revokeUrl ?? URL.revokeObjectURL)(url); url = undefined; }
    timeline = null;
  }
  function sync() {
    stopClock();
    if (disposed || !audio || !timeline || !wantsPlay) return;
    const selected = range(); if (!selected) { pause(); return; }
    if (audio.currentTime >= selected.end) {
      if (!state.repeat) { pause(); audio.currentTime = selected.end; return; }
      audio.currentTime = selected.start;
    } else if (audio.currentTime < selected.start) audio.currentTime = selected.start;
    word(currentReferenceWord(timeline, audio.currentTime));
    frame = scheduler.frame(sync);
    timer = scheduler.timer(sync, Math.max(10, Math.min(1000, (selected.end - audio.currentTime) / state.speed * 1000)));
  }
  async function play() {
    if (disposed || !audio || !timeline || !["ready", "playing"].includes(state.status)) return;
    const media = audio, mine = generation, intent = ++playGeneration, selected = range();
    if (!selected) return;
    wantsPlay = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (media.currentTime < selected.start || media.currentTime >= selected.end) media.currentTime = selected.start;
      const pending = media.play();
      void pending.then(() => { if (disposed || media !== audio || !wantsPlay) media.pause(); }, () => {});
      await Promise.race([pending, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(unavailable()), REFERENCE_PLAYBACK_LIMITS.playMs); })]);
      if (disposed || generation !== mine || playGeneration !== intent) return;
      publish({ status: "playing", retryPlay: false }); sync();
    } catch {
      if (disposed || generation !== mine || playGeneration !== intent) return;
      pause(); publish({ status: "ready", retryPlay: true });
    } finally { if (timeout) clearTimeout(timeout); }
  }
  async function load() {
    if (disposed || state.status === "loading") return;
    const mine = ++generation; abort?.abort(); clearMedia(); abort = new AbortController();
    const signal = abort.signal;
    const live = () => { if (disposed || generation !== mine || signal.aborted) throw unavailable(); };
    publish({ status: "loading", selection: "verse", wordsReady: false, wordCount: 0, retryPlay: false, speed: 1, speedSupported: false });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const end = performance.now() + REFERENCE_PLAYBACK_LIMITS.loadMs;
    const awaitLive = async <T,>(pending: Promise<T>) => {
      let onAbort: (() => void) | undefined;
      try {
        const result = await Promise.race([pending, new Promise<never>((_, reject) => {
          onAbort = () => reject(unavailable()); signal.addEventListener("abort", onAbort, { once: true });
          timeout = setTimeout(() => reject(unavailable()), Math.max(1, end - performance.now()));
          if (signal.aborted) onAbort();
        })]);
        live(); if (performance.now() >= end) throw unavailable(); return result;
      } finally { if (timeout) clearTimeout(timeout); timeout = undefined; if (onAbort) signal.removeEventListener("abort", onAbort); }
    };
    try {
      const resolution = parseReferenceResolution(await awaitLive(options.load(signal)));
      if (!resolution || !resolution.source) { publish({ status: "unavailable" }); return; }
      let hash: string | undefined;
      if (typeof options.readingText === "string" && options.readingText.length <= 65536) {
        const text = new TextEncoder().encode(options.readingText.normalize("NFC"));
        if (text.byteLength <= 8192) hash = await awaitLive((options.digest ?? sha256)(text));
      }
      const current = createReferenceTimeline(resolution.verse, { ref: options.ref, readingTextSha256: hash, wordCount: options.wordCount });
      if (!current || current.asset !== resolution.source.asset) { publish({ status: "unavailable" }); return; }
      const reuse = options.assetReuse === undefined ? undefined : assetReuses.get(options.assetReuse);
      if (options.assetReuse !== undefined && !reuse) throw unavailable();
      const blob = await awaitLive(reuse ? reuse(resolution.source, signal, { fetch: options.fetch, digest: options.digest }) : downloadReferenceAudio(resolution.source, signal, { fetch: options.fetch, digest: options.digest }));
      live();
      timeline = current; url = (options.createUrl ?? URL.createObjectURL)(blob);
      audio = (options.audio ?? (() => new Audio()))();
      const media = audio;
      const event = () => { if (!disposed && generation === mine && audio === media) sync(); };
      const ended = () => { if (!disposed && generation === mine && audio === media) { sync(); if (wantsPlay && state.repeat) void play(); } };
      const error = () => { if (!disposed && generation === mine && audio === media) { pause(); publish({ status: "error" }); } };
      const playing = () => { if (disposed || generation !== mine || audio !== media || !wantsPlay) media.pause(); };
      const events = [["timeupdate", event], ["seeked", event], ["ratechange", event], ["ended", ended], ["error", error], ["playing", playing]] as const;
      for (const [name, listener] of events) media.addEventListener(name, listener);
      detach = () => { for (const [name, listener] of events) media.removeEventListener(name, listener); };
      const metadata = new Promise<void>((resolve, reject) => {
        const done = () => { cleanup(); resolve(); }, failed = () => { cleanup(); reject(unavailable()); };
        const timer = setTimeout(failed, REFERENCE_PLAYBACK_LIMITS.metadataMs);
        const cleanup = () => { clearTimeout(timer); media.removeEventListener("loadedmetadata", done); media.removeEventListener("error", failed); signal.removeEventListener("abort", failed); };
        media.addEventListener("loadedmetadata", done); media.addEventListener("error", failed); signal.addEventListener("abort", failed, { once: true });
      });
      media.preload = "metadata"; media.src = url; media.load();
      await awaitLive(metadata);
      if (!Number.isFinite(media.duration) || media.duration + 0.01 < current.clip.end) throw unavailable();
      const speedSupported = typeof media.preservesPitch === "boolean";
      if (speedSupported) media.preservesPitch = true;
      media.playbackRate = 1; media.currentTime = current.clip.start;
      publish({ status: "ready", speedSupported, wordsReady: current.starts !== null, wordCount: current.starts?.length ?? 0 });
    } catch {
      if (disposed || generation !== mine) return;
      abort?.abort(); clearMedia(); publish({ status: "error" });
    } finally { if (timeout) clearTimeout(timeout); }
  }
  function select(selection: "verse" | number) {
    if (disposed || !audio || !timeline) return;
    const selected = selection === "verse" ? referenceVerseLoop(timeline) : referenceWordLoop(timeline, selection);
    if (!selected) return;
    publish({ selection }); audio.currentTime = selected.start; sync();
  }
  return {
    get state() { return state; }, load, play, pause, select,
    setRepeat(repeat: boolean) { if (!disposed && typeof repeat === "boolean") publish({ repeat }); },
    setSpeed(speed: number) {
      if (disposed || !audio || !state.speedSupported || !Number.isFinite(speed) || speed < 0.5 || speed > 1.25) return;
      audio.preservesPitch = true; audio.playbackRate = speed; publish({ speed }); sync();
    },
    dispose() { if (disposed) return; disposed = true; generation++; abort?.abort(); clearMedia(); word(null); },
  };
}
export type ReferencePlayback = ReturnType<typeof createReferencePlayback>;
