import type { ReadingPlaybackState, ReadingSelection } from "./main-playback";
import type { ReferenceAudioElement, ReferencePlaybackOptions, ReferencePlaybackState } from "../../../../lib/reference-audio/playback";
import { parseReferenceShortResolution, type ReferenceShortResolution } from "../../../../lib/reference-audio/short-resolution";
import { createReferenceTimeline, currentReferenceWord, referenceWordLoop, type ReferenceTimeline } from "../../../../lib/reference-audio/timeline";
import { shortSourceRange, type ShortReferenceSource } from "../../../../lib/reference-audio/short-source";
import { decodeShortReferenceAudio, downloadShortReferenceAudio, shortAudioDigest, shortMediaFramesMatch, shortWordWav, shortSilentPrime, validateShortDecodedAudio, SHORT_PLAYBACK_LIMITS, type ShortDecodedAudio } from "../../../../lib/reference-audio/short-playback";

export type ShortAudioElement = ReferenceAudioElement & Pick<HTMLAudioElement, "currentSrc" | "readyState" | "ended" | "error">;
type Platform = Pick<ReferencePlaybackOptions, "fetch" | "digest" | "createUrl" | "revokeUrl" | "scheduler"> & {
  audio?(): ShortAudioElement; origin?: string; decode?(bytes: Uint8Array<ArrayBuffer>, source: ShortReferenceSource): Promise<ShortDecodedAudio>;
};
type Data = { source: ShortReferenceSource; timeline: ReferenceTimeline };
type Asset = { key: string; source: ShortReferenceSource; abort: AbortController; work: Promise<Uint8Array<ArrayBuffer>>; bytes?: Uint8Array<ArrayBuffer>; decoded?: ShortDecodedAudio; decoding?: Promise<ShortDecodedAudio> };
const idle: ReferencePlaybackState = Object.freeze({ status: "idle", selection: "verse", repeat: false, speed: 1, speedSupported: false, wordsReady: false, wordCount: 0, retryPlay: false });
const unavailable = () => new Error("Short reference playback unavailable");

/** Unwired page owner. Private DTOs live only here; public media never confers
 * authority. Lifecycle invalidation must suspend/dispose this owner. */
export function createShortReadingPlayback(input: {
  verses: readonly { ref: string; readingText: string; wordCount: number }[];
  load(index: number, signal: AbortSignal): Promise<ReferenceShortResolution>;
  onState(state: ReadingPlaybackState): void;
  onActiveWord(value: { verse: number; index: number } | null): void;
  platform?: Platform;
  /** Trusted synchronous scheduling/lifetime check; never acquires authority. */
  canContinue?(): boolean;
}) {
  const verses = input.verses.map(v => Object.freeze({ ...v })), p = input.platform ?? {};
  let media: ShortAudioElement | undefined;
  try { media = (p.audio ?? (() => new Audio()))(); } catch {}
  const scheduler = p.scheduler ?? { frame: (f: FrameRequestCallback) => requestAnimationFrame(f), cancelFrame: (n: number) => cancelAnimationFrame(n), timer: setTimeout, clearTimer: clearTimeout };
  let state: ReadingPlaybackState = Object.freeze({ verse: null, selection: "verse", playback: idle, timingHeld: false, suspended: false });
  let closed = false, turn = 0, wantsPlay = false, lastPlay = 0, frame: number | undefined, currentData: Data | undefined, asset: Asset | undefined, url: string | undefined;
  let selectionAbort = new AbortController(), context: { index: number; abort: AbortController; work: Promise<Data | null>; data?: Data } | undefined;
  let bound: { key: string; frames: number; rate: number; offset: number; turn: number } | undefined, preferredSpeed = 1, preferredRepeat = false;
  let prime: { turn: number; url: string } | undefined;
  let activeVerse: number | null = null, activeIndex: number | null = null;
  type Job = { entry: Asset; live(): void; resolve(value: ShortDecodedAudio): void; reject(error: unknown): void };
  let decoding = false, pendingDecode: Job | undefined;
  const publish = (patch: Partial<ReadingPlaybackState>) => { if (!closed) { state = Object.freeze({ ...state, ...patch }); input.onState(state); } };
  const playback = (patch: Partial<ReferencePlaybackState>) => publish({ playback: Object.freeze({ ...state.playback, ...patch }) });
  function word(value: { verse: number; index: number } | null) {
    const verse = value?.verse ?? null, index = value?.index ?? null;
    if (verse === activeVerse && index === activeIndex) return;
    activeVerse = verse; activeIndex = index;
    input.onActiveWord(value === null ? null : Object.freeze({ verse: value.verse, index: value.index }));
  }
  let refusing = false;
  function allowed() {
    if (closed || refusing) return false;
    let valid = false; try { valid = input.canContinue === undefined || input.canContinue() === true; } catch {}
    if (!valid) { refusing = true; try { suspend(); } finally { refusing = false; } return false; }
    return !closed;
  }
  function stopFrame() { if (frame !== undefined) scheduler.cancelFrame(frame); frame = undefined; }
  function quiet() { wantsPlay = false; stopFrame(); media?.pause(); word(null); if (state.playback.status === "playing") playback({ status: "ready" }); }
  function invalidate() { turn++; selectionAbort.abort(); selectionAbort = new AbortController(); quiet(); }
  function dropMedia() { lastPlay++; media?.pause(); prime = undefined; bound = undefined; media?.removeAttribute("src"); media?.load(); if (url) { (p.revokeUrl ?? URL.revokeObjectURL)(url); url = undefined; } }
  function primeMedia(mine: number, signal: AbortSignal) {
    if (!media) return; dropMedia(); const selected = media, token = { turn: mine, url: (p.createUrl ?? URL.createObjectURL)(shortSilentPrime()) };
    prime = token; url = token.url; selected.preload = "auto"; selected.src = token.url; selected.load();
    live(mine, signal);
    try { const pending = selected.play(); void pending.then(() => { if (prime === token && (closed || turn !== mine || media !== selected)) selected.pause(); }, () => {}); } catch {}
  }
  function prepared(index: number, selection: ReadingSelection) {
    const data = context?.index === index ? context.data : undefined; if (!data || !asset?.bytes || !bound) return false;
    let key = JSON.stringify(data.source) + ":verse";
    if (selection !== "verse") { const interval = referenceWordLoop(data.timeline, selection), range = interval && shortSourceRange(data.source, interval); if (!range) return false; key = JSON.stringify(data.source) + `:word:${range.firstFrame}:${range.endFrame}`; }
    return bound.key === key;
  }
  const live = (mine: number, signal: AbortSignal) => { if (closed || turn !== mine || signal.aborted || !allowed() || turn !== mine || signal.aborted) throw unavailable(); };
  async function wait<T>(work: Promise<T>, signal: AbortSignal, ms: number = SHORT_PLAYBACK_LIMITS.loadMs): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined, stopped: (() => void) | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => {
      stopped = () => reject(unavailable()); signal.addEventListener("abort", stopped, { once: true }); timeout = setTimeout(stopped, ms); if (signal.aborted) stopped();
    })]); } finally { clearTimeout(timeout); if (stopped) signal.removeEventListener("abort", stopped); }
  }
  const ownsSource = () => !!media && !!bound && bound.turn === turn && media.src === url && media.currentSrc === url;
  function sync() {
    if (!allowed()) return;
    stopFrame(); if (closed || !media || !wantsPlay || !bound || !ownsSource() || media.readyState < 1 || !currentData || state.verse === null) return;
    const index = currentReferenceWord(currentData.timeline, bound.offset + media.currentTime);
    word(index === null ? null : { verse: state.verse, index });
    if (!allowed() || !wantsPlay || !ownsSource()) return;
    frame = scheduler.frame(sync); // Highlight only. Never stops/crops/loops audio.
  }
  async function runDecode(job: Job) {
    decoding = true;
    try {
      job.live(); if (!job.entry.bytes) throw unavailable();
      const value = await (p.decode ?? decodeShortReferenceAudio)(job.entry.bytes, job.entry.source);
      job.live(); validateShortDecodedAudio(value, job.entry.source); if (asset !== job.entry) throw unavailable();
      job.entry.decoded = value; job.resolve(value);
    } catch (error) { job.reject(error); }
    finally { decoding = false; const next = pendingDecode; pendingDecode = undefined; if (next) void runDecode(next); }
  }
  function decoded(entry: Asset, check: () => void): Promise<ShortDecodedAudio> {
    if (entry.decoded) return Promise.resolve(entry.decoded);
    if (entry.decoding) return entry.decoding;
    const work = new Promise<ShortDecodedAudio>((resolve, reject) => {
      const job: Job = { entry, live: check, resolve, reject };
      if (decoding) { pendingDecode?.reject(unavailable()); pendingDecode = job; } else void runDecode(job);
    });
    entry.decoding = work;
    void work.catch(() => { if (entry.decoding === work) entry.decoding = undefined; }); return work;
  }
  function getContext(index: number) {
    if (context?.index === index) return context;
    context?.abort.abort(); const abort = new AbortController();
    const selected = { index, abort, work: Promise.resolve(null) as Promise<Data | null>, data: undefined as Data | undefined }; context = selected;
    selected.work = (async () => {
      const raw = await wait(input.load(index, abort.signal), abort.signal);
      if (!allowed() || context !== selected || abort.signal.aborted) throw unavailable();
      const result = parseReferenceShortResolution(raw);
      if (!result?.source) return null;
      const verse = verses[index]; let hash: string | undefined;
      if (typeof verse.readingText === "string" && verse.readingText.length <= 65536) {
        const bytes = new TextEncoder().encode(verse.readingText.normalize("NFC")); if (bytes.length <= 8192) hash = await wait((p.digest ?? shortAudioDigest)(bytes), abort.signal);
      }
      if (abort.signal.aborted || context !== selected || closed) throw unavailable();
      if (!allowed() || context !== selected || abort.signal.aborted) throw unavailable();
      const timeline = createReferenceTimeline(result.verse, { ref: verse.ref, readingTextSha256: hash, wordCount: verse.wordCount });
      if (!timeline || timeline.asset !== result.source.parent.asset) return null;
      return selected.data = { source: result.source, timeline };
    })(); selected.work = selected.work.catch(error => { abort.abort(); if (context === selected) context = undefined; throw error; });
    void selected.work.catch(() => {}); return selected;
  }
  function getAsset(source: ShortReferenceSource) {
    const key = JSON.stringify(source); if (asset?.key === key) return asset;
    asset?.abort.abort(); asset = undefined; pendingDecode?.reject(unavailable()); pendingDecode = undefined;
    const abort = new AbortController(), selected: Asset = { key, source, abort, work: Promise.resolve(new Uint8Array()) }; asset = selected;
    selected.work = downloadShortReferenceAudio(source, abort.signal, { ...p, origin: p.origin ?? (typeof location === "undefined" ? "" : location.origin) }).then(bytes => {
      if (!allowed() || closed || asset !== selected || abort.signal.aborted) throw unavailable(); selected.bytes = bytes; return bytes;
    }).catch(error => { abort.abort(); if (asset === selected) asset = undefined; throw error; });
    void selected.work.catch(() => {}); return selected;
  }
  async function attach(blob: Blob, key: string, frames: number, rate: number, offset: number, mine: number, signal: AbortSignal) {
    if (!media) throw unavailable();
    if (bound?.key === key && url) {
      if (!shortMediaFramesMatch(media.duration, rate, frames)) throw unavailable(); bound.turn = mine; media.currentTime = 0; return;
    }
    dropMedia(); const selected = media, nextUrl = (p.createUrl ?? URL.createObjectURL)(blob); url = nextUrl;
    let done!: () => void, failed!: () => void;
    const metadata = new Promise<void>((resolve, reject) => { done = () => { if (media === selected && turn === mine && !signal.aborted && selected.src === nextUrl && selected.currentSrc === nextUrl && selected.readyState >= 1) resolve(); }; failed = () => { if (media === selected && turn === mine && selected.src === nextUrl && selected.currentSrc === nextUrl && selected.error) reject(unavailable()); }; selected.addEventListener("loadedmetadata", done); selected.addEventListener("error", failed); });
    try {
      selected.preload = "auto"; selected.src = nextUrl; selected.load(); await wait(metadata, signal, SHORT_PLAYBACK_LIMITS.metadataMs); live(mine, signal);
      if (!shortMediaFramesMatch(selected.duration, rate, frames)) throw unavailable();
      bound = { key, frames, rate, offset, turn: mine }; selected.currentTime = 0;
    } finally { selected.removeEventListener("loadedmetadata", done); selected.removeEventListener("error", failed); }
  }
  async function start(mine: number, signal: AbortSignal) {
    live(mine, signal); if (!media || !bound || bound.turn !== mine) return;
    const selected = media, play = ++lastPlay; wantsPlay = true;
    try {
      const pending = selected.play();
      void pending.then(() => { if (!allowed()) return; if (play === lastPlay && (closed || turn !== mine || !wantsPlay || media !== selected)) selected.pause(); }, () => {});
      await wait(pending, signal, SHORT_PLAYBACK_LIMITS.playMs); live(mine, signal);
      playback({ status: "playing", retryPlay: false }); live(mine, signal); sync();
    } catch { if (!closed && turn === mine) { quiet(); playback({ status: "ready", retryPlay: true }); } }
  }
  async function select(index: number, selection: ReadingSelection = "verse") {
    if (closed || !Number.isSafeInteger(index) || index < 0 || index >= verses.length || selection !== "verse" && (!Number.isSafeInteger(selection) || selection < 0 || selection >= verses[index].wordCount)) return;
    if (!allowed()) return;
    const ready = prepared(index, selection), before = turn; invalidate(); if (turn !== before + 1 || !allowed()) return;
    const mine = turn, signal = selectionAbort.signal;
    try {
      publish({ verse: index, selection, suspended: false, timingHeld: false }); live(mine, signal);
      playback({ status: "loading", selection, retryPlay: false, wordsReady: false, wordCount: 0 }); live(mine, signal);
      if (!ready && !(context?.index === index && context.data && selection !== "verse" && !context.data.timeline.starts)) primeMedia(mine, signal);
      live(mine, signal);
      const ctx = getContext(index), data = ctx.data ?? await wait(ctx.work, signal); live(mine, signal);
      if (!data || !media) { dropMedia(); playback({ status: "unavailable", wordsReady: false, wordCount: 0 }); return; }
      currentData = data; playback({ wordsReady: data.timeline.starts !== null, wordCount: data.timeline.starts?.length ?? 0 }); live(mine, signal);
      if (selection !== "verse" && !data.timeline.starts) { quiet(); publish({ timingHeld: true }); playback({ status: "ready", repeat: false }); return; }
      const entry = getAsset(data.source), bytes = entry.bytes ?? await wait(entry.work, signal); live(mine, signal);
      let frames = data.source.presentationFrames, offset = data.source.origin.firstFrame / data.source.sampleRate, blob: Blob | undefined, key = entry.key + ":verse";
      if (selection !== "verse") {
        const interval = referenceWordLoop(data.timeline, selection), range = interval && shortSourceRange(data.source, interval); if (!range) throw unavailable();
        key = entry.key + `:word:${range.firstFrame}:${range.endFrame}`; frames = range.endFrame - range.firstFrame; offset += range.firstFrame / data.source.sampleRate;
        if (bound?.key !== key) { const value = entry.decoded ?? await wait(decoded(entry, () => { if (!allowed() || closed || asset !== entry || entry.abort.signal.aborted) throw unavailable(); }), signal); live(mine, signal); blob = shortWordWav(value, data.source, range.firstFrame, range.endFrame); }
      } else if (bound?.key !== key) blob = new Blob([bytes], { type: "audio/mpeg" });
      if (blob) await attach(blob, key, frames, data.source.sampleRate, offset, mine, signal);
      else { if (!bound || !shortMediaFramesMatch(media.duration, data.source.sampleRate, frames)) throw unavailable(); bound.turn = mine; media.currentTime = 0; }
      live(mine, signal); const speedSupported = typeof media.preservesPitch === "boolean";
      if (speedSupported) media.preservesPitch = true; media.playbackRate = speedSupported ? preferredSpeed : 1;
      playback({ status: "ready", speedSupported, speed: speedSupported ? preferredSpeed : 1, repeat: preferredRepeat }); await start(mine, signal);
    } catch { if (!closed && turn === mine) { quiet(); dropMedia(); playback({ status: "error", retryPlay: false }); } }
  }
  function suspend() {
    if (closed) return; invalidate(); context?.abort.abort(); context = undefined; currentData = undefined; asset?.abort.abort(); asset = undefined;
    pendingDecode?.reject(unavailable()); pendingDecode = undefined; dropMedia(); publish({ playback: idle, timingHeld: false, suspended: true });
  }
  async function play() {
    if (closed || state.verse === null || state.timingHeld || !allowed()) return;
    if (media && bound && context?.data === currentData && currentData && asset?.bytes && media.src === url && media.currentSrc === url && ["ready", "playing"].includes(state.playback.status)) {
      const before = turn; invalidate(); if (turn !== before + 1 || !allowed() || !bound) return;
      const mine = turn, signal = selectionAbort.signal; bound.turn = mine;
      if (!Number.isFinite(media.currentTime) || media.currentTime < 0 || !shortMediaFramesMatch(media.duration, bound.rate, bound.frames)) { quiet(); playback({ status: "error" }); return; }
      if (media.ended || media.currentTime >= media.duration) media.currentTime = 0;
      await start(mine, signal); return;
    }
    await select(state.verse, state.selection);
  }
  const ended = () => {
    if (!allowed()) return;
    if (closed || !media || !wantsPlay || !bound || !ownsSource() || media.readyState < 1 || !media.ended) return;
    if (!shortMediaFramesMatch(media.currentTime, bound.rate, bound.frames)) { if (media.ended) { quiet(); playback({ status: "error" }); } return; }
    const repeat = state.playback.repeat, index = state.verse, selection = state.selection, mine = turn; quiet();
    if (!allowed() || turn !== mine) return; playback({ status: "ready" });
    if (repeat && index !== null && allowed() && turn === mine) void select(index, selection);
  };
  const playing = () => { if (!allowed()) return; if (!closed && prime?.turn === turn && media?.src === prime.url && media.currentSrc === prime.url) return; if (ownsSource() && (!wantsPlay || closed)) media?.pause(); };
  const error = () => { if (!allowed()) return; if (!closed && ownsSource() && media?.error) { quiet(); playback({ status: "error" }); } };
  const events = [["timeupdate", sync], ["seeked", sync], ["ratechange", sync], ["ended", ended], ["playing", playing], ["error", error]] as const;
  for (const [name, listener] of events) media?.addEventListener(name, listener);
  return Object.freeze({ get state() { return state; }, select,
    play,
    pause() { if (!closed) invalidate(); }, suspend,
    setRepeat(value: boolean) { if (allowed() && !state.timingHeld && typeof value === "boolean") { preferredRepeat = value; playback({ repeat: value }); } },
    setSpeed(value: number) { if (allowed() && media && state.playback.speedSupported && [0.5, 0.75, 1, 1.25].includes(value)) { preferredSpeed = value; media.preservesPitch = true; media.playbackRate = value; playback({ speed: value }); } },
    dispose() { if (closed) return; suspend(); closed = true; for (const [name, listener] of events) media?.removeEventListener(name, listener); media = undefined; },
  });
}
