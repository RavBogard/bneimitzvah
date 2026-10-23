import { shortSilentPrime } from "../../lib/reference-audio/short-playback";
import type { PhraseAudio, PhraseRequest } from "../../lib/learn/phrase-audio";

/**
 * One audio element per course page. A play is a list of phrase cuts played in turn (two phrases for
 * same-or-different, the right then the chosen family after a miss). The element is primed with 10 ms
 * of silence inside the tap, as the Lein player does, so a phone lets the real clip play when it arrives.
 */
export type PlayerState = Readonly<{ id: string | null; status: "idle" | "loading" | "playing" | "error"; seconds: number; part: number }>;
const IDLE: PlayerState = Object.freeze({ id: null, status: "idle", seconds: 0, part: 0 });
export const PLAY_GAP_MS = 450;

export function createClipPlayer(audio: PhraseAudio, make: () => HTMLAudioElement = () => new Audio()) {
  let media: HTMLAudioElement | null = null, url: string | null = null, turn = 0, state = IDLE, controller = new AbortController();
  const listeners = new Set<() => void>();
  const publish = (next: PlayerState) => { state = Object.freeze(next); for (const listener of listeners) listener(); };
  const element = () => { if (!media) { try { media = make(); media.preload = "auto"; } catch { media = null; } } return media; };
  const release = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  function attach(blob: Blob) { const node = element(); if (!node) throw new Error("No audio"); release(); url = URL.createObjectURL(blob); node.src = url; return node; }
  function halt() { turn++; controller.abort(); controller = new AbortController(); const node = media; if (node) { node.pause(); } }
  const ended = (node: HTMLAudioElement, mine: number) => new Promise<void>(resolve => {
    const done = () => { node.removeEventListener("ended", done); node.removeEventListener("pause", paused); resolve(); };
    const paused = () => { if (turn !== mine || node.ended) done(); };
    node.addEventListener("ended", done); node.addEventListener("pause", paused);
  });
  return Object.freeze({
    get state() { return state; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Plays the cuts in order. Resolves when they have all played, or quietly when replaced or stopped. */
    async play(id: string, requests: readonly PhraseRequest[], options: { rate?: number } = {}): Promise<boolean> {
      halt(); const mine = turn, signal = controller.signal;
      publish({ id, status: "loading", seconds: 0, part: 0 });
      // Inside the tap: unlock the element with silence before any network wait.
      try { const node = attach(shortSilentPrime()); void node.play().catch(() => {}); } catch { /* No element; the clip below reports the error. */ }
      try {
        for (const [part, request] of requests.entries()) {
          const clip = await audio.phraseClip(request, signal);
          if (turn !== mine) return false;
          const node = attach(clip.blob), rate = options.rate ?? 1;
          if (typeof node.preservesPitch === "boolean") node.preservesPitch = true;
          node.playbackRate = rate; node.defaultPlaybackRate = rate;
          const finished = ended(node, mine);
          await node.play();
          if (turn !== mine) return false;
          publish({ id, status: "playing", seconds: clip.seconds / rate, part });
          await finished;
          if (turn !== mine) return false;
          if (part < requests.length - 1) await new Promise(resolve => setTimeout(resolve, PLAY_GAP_MS));
          if (turn !== mine) return false;
        }
        publish(IDLE); return true;
      } catch (error) {
        // A browser that wants another tap is not a failed recording: the tile simply waits.
        if (turn === mine) publish(error instanceof DOMException && error.name === "NotAllowedError" ? IDLE : { id, status: "error", seconds: 0, part: 0 });
        return false;
      }
    },
    stop() { halt(); if (state.status !== "idle") publish(IDLE); },
    dispose() { halt(); release(); listeners.clear(); if (media) { media.removeAttribute("src"); media.load(); } media = null; },
  });
}
export type ClipPlayer = ReturnType<typeof createClipPlayer>;
