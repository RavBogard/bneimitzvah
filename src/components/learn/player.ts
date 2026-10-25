import { shortSilentPrime } from "../../lib/reference-audio/short-playback";
import type { PhraseAudio, PhraseClip, PhraseRequest } from "../../lib/learn/phrase-audio";

/** One media element per course page. Word outlines follow its clock, never elapsed wall time. */
export type PlayerState = Readonly<{ id: string | null; status: "idle" | "loading" | "playing" | "paused" | "error"; seconds: number; part: number;
  current?: Readonly<{ ref: string; kind: PhraseRequest["kind"]; word: number }> | null }>;
const IDLE: PlayerState = Object.freeze({ id: null, status: "idle", seconds: 0, part: 0 });
export const PLAY_GAP_MS = 450;
export type PlaybackBinding = string | Readonly<{ id: string; part: number }>;
/** Bind the visible example as well as the verse: two examples can show the same words. */
export function activeLessonWord(state: PlayerState, verse: Pick<PhraseRequest, "ref" | "kind">, bindings: readonly PlaybackBinding[]): number | null {
  return state.status === "playing" && state.current?.ref === verse.ref && state.current.kind === verse.kind
    && bindings.some(binding => typeof binding === "string" ? binding === state.id : binding.id === state.id && binding.part === state.part)
    ? state.current.word : null;
}
export function createClipPlayer(audio: PhraseAudio, make: () => HTMLAudioElement = () => new Audio()) {
  let media: HTMLAudioElement | null = null, url: string | null = null, turn = 0, state = IDLE, controller = new AbortController();
  const listeners = new Set<() => void>();
  const publish = (next: PlayerState) => { state = Object.freeze(next); for (const listener of listeners) listener(); };
  const release = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  function attach(blob: Blob) {
    if (!media) { media = make(); media.preload = "auto"; }
    media.pause(); release(); url = URL.createObjectURL(blob); media.src = url; return media;
  }
  function halt() { turn++; controller.abort(); controller = new AbortController(); media?.pause(); }
  function follow(node: HTMLAudioElement, clip: PhraseClip, request: PhraseRequest, id: string, part: number, mine: number, signal: AbortSignal, rate: number) {
    let ready = false, sounding = true, frame: number | null = null, settled = false;
    let resolve!: () => void, reject!: (error: Error) => void;
    const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void finished.catch(() => {});
    const sample = () => {
      if (!ready || settled || turn !== mine || signal.aborted) return;
      const at = node.currentTime, status = node.paused && !node.ended ? "paused" : "playing";
      const word = sounding && !node.paused && !node.ended && !node.seeking && Number.isFinite(at)
        ? clip.words.find(row => row.start <= at && at < row.end)?.word ?? null : null;
      if (state.status !== status || (state.current?.word ?? null) !== word || state.id !== id || state.part !== part) {
        publish({ id, status, seconds: clip.seconds / rate, part, current: word === null ? null : { ref: request.ref, kind: request.kind, word } });
      }
    };
    const tick = () => { frame = null; sample(); if (!settled && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(tick); };
    const playing = () => { sounding = true; sample(); }, waiting = () => { sounding = false; sample(); };
    const cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      for (const [event, handler] of events) node.removeEventListener(event, handler);
      signal.removeEventListener("abort", abort);
    };
    const finish = (error?: Error) => {
      if (settled) return; settled = true; cleanup();
      if (turn === mine && ready) publish({ id, status: "loading", seconds: 0, part, current: null });
      if (error) reject(error); else resolve();
    };
    const done = () => finish(), failed = () => finish(new Error("Media playback failed")), abort = () => finish();
    const events: [string, () => void][] = [["timeupdate", sample], ["playing", playing], ["waiting", waiting], ["seeking", waiting], ["seeked", playing], ["pause", waiting], ["ended", done], ["error", failed]];
    for (const [event, handler] of events) node.addEventListener(event, handler);
    signal.addEventListener("abort", abort, { once: true });
    return { finished, start() { if (settled || turn !== mine || signal.aborted) return; ready = true; sample(); tick(); }, cancel: done };
  }
  return Object.freeze({
    get state() { return state; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async play(id: string, requests: readonly PhraseRequest[], options: { rate?: number } = {}): Promise<boolean> {
      halt(); const mine = turn, signal = controller.signal;
      publish({ id, status: "loading", seconds: 0, part: 0 });
      try { const node = attach(shortSilentPrime()); void node.play().catch(() => {}); } catch { /* The real clip reports unavailable media. */ }
      try {
        for (const [part, request] of requests.entries()) {
          const clip = await audio.phraseClip(request, signal);
          if (turn !== mine) return false;
          const rate = options.rate ?? 1;
          if (![0.5, 0.75, 1, 1.25].includes(rate)) throw new Error("Unsupported rate");
          const node = attach(clip.blob);
          if (typeof node.preservesPitch === "boolean") node.preservesPitch = true;
          node.playbackRate = rate; node.defaultPlaybackRate = rate;
          const tracking = follow(node, clip, request, id, part, mine, signal, rate);
          try { await Promise.race([node.play(), tracking.finished]); tracking.start(); await tracking.finished; } finally { tracking.cancel(); }
          if (turn !== mine) return false;
          if (part < requests.length - 1) await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, PLAY_GAP_MS); signal.addEventListener("abort", done, { once: true });
          });
          if (turn !== mine) return false;
        }
        publish(IDLE); return true;
      } catch (error) {
        if (turn === mine) { media?.pause(); publish(error instanceof DOMException && error.name === "NotAllowedError" ? IDLE : { id, status: "error", seconds: 0, part: 0 }); }
        return false;
      }
    },
    pause() { media?.pause(); },
    async resume() {
      if (state.status !== "paused") return;
      const mine = turn, { id, part } = state;
      try { await media?.play(); } catch { if (turn === mine) { halt(); publish({ id, status: "error", seconds: 0, part }); } }
    },
    stop() { halt(); if (state.status !== "idle") publish(IDLE); },
    dispose() { halt(); publish(IDLE); release(); listeners.clear(); if (media) { media.removeAttribute("src"); media.load(); } media = null; },
  });
}
export type ClipPlayer = ReturnType<typeof createClipPlayer>;
