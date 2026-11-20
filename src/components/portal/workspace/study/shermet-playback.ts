import type { ReferenceAudioElement } from "../../../../lib/reference-audio/playback";
import type { ReadingPlaybackState, ReadingSelection } from "./main-playback";
import type { ShermetTiming } from "../../../../lib/reference-audio/shermet-timing";
import type { ShermetTimedClip } from "../../../../lib/reference-audio/shermet-timed-audio";
import { applyRecordingTempo, recordingPitchSupported, validRecordingSpeed } from "../../../../lib/reference-audio/recording-tempo";
export type ShermetPlaybackTiming = {
  timing(index: number, signal: AbortSignal): Promise<ShermetTiming | null>;
  clip(index: number, word: number, signal: AbortSignal): Promise<ShermetTimedClip | null>;
};

/** Whole-verse human recordings. No PocketTorah timing is reused. */
export function createShermetPlayback(input: {
  verses: readonly { ref: string }[]; available: ReadonlySet<string> | (() => ReadonlySet<string>); canContinue(): boolean;
  onState(state: ReadingPlaybackState): void; onActiveWord(value: { verse: number; index: number } | null): void;
  timed?: ShermetPlaybackTiming;
  initialSpeed?: number;
  audio?(): ReferenceAudioElement;
}) {
  let state: ReadingPlaybackState = { verse: null, selection: "verse", timingHeld: false, suspended: false,
    playback: { status: "idle", selection: "verse", repeat: false, speed: validRecordingSpeed(input.initialSpeed ?? 1) ? input.initialSpeed ?? 1 : 1, speedSupported: false, wordsReady: false, wordCount: 0, retryPlay: false } };
  let media: ReferenceAudioElement | null = null, closed = false, generation = 0, lastPlay = 0, wantsPlay = false;
  let abort = new AbortController(), url: string | null = null, frame: number | null = null;
  let words: readonly { word: number; start: number; end: number }[] = [];
  const publish = (patch: Partial<ReadingPlaybackState>, playback = {}) => { state = { ...state, ...patch, playback: { ...state.playback, ...playback } }; input.onState(state); };
  const allowed = () => !closed && input.canContinue();
  function clearWord() { if (frame !== null) cancelAnimationFrame(frame); frame = null; input.onActiveWord(null); }
  function sounding() { if (state.playback.status === "playing") { clearWord(); follow(); } }
  function tempo() { if (media) applyRecordingTempo(media, "shermet", state.playback.speed); }
  function follow() {
    frame = null;
    if (!allowed() || !media || state.playback.status !== "playing" || state.verse === null) { input.onActiveWord(null); return; }
    const word = words.find(word => word.start <= media!.currentTime && media!.currentTime < word.end);
    input.onActiveWord(word ? { verse: state.verse, index: word.word } : null);
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(follow);
  }
  function drop() {
    generation++; wantsPlay = false; abort.abort(); abort = new AbortController(); words = []; clearWord();
    if (media) { media.pause(); media.removeEventListener("ended", ended); media.removeEventListener("error", failed); media.removeEventListener("playing", sounding); media.removeEventListener("waiting", clearWord); media.removeEventListener("seeking", clearWord); media.removeEventListener("ratechange", tempo); media.removeAttribute("src"); media.load(); media = null; }
    if (url) { URL.revokeObjectURL(url); url = null; }
  }
  function failed() { if (allowed()) { drop(); publish({}, { status: "error" }); } }
  function ended() {
    if (!allowed()) { drop(); return; }
    if (state.playback.repeat && media) { media.currentTime = 0; void play(); }
    else { clearWord(); publish({}, { status: "ready" }); }
  }
  async function play() {
    if (!allowed() || state.timingHeld || state.verse === null) return;
    if (!media) { await select(state.verse, state.selection); return; }
    const selected = media, ticket = generation, attempt = ++lastPlay; wantsPlay = true;
    try {
      tempo();
      await selected.play();
      if (!allowed() || ticket !== generation || media !== selected || attempt !== lastPlay) { if (!allowed() || media !== selected || !wantsPlay) selected.pause(); return; }
      publish({ suspended: false }, { status: "playing", retryPlay: false });
      clearWord(); follow();
    } catch { if (allowed() && ticket === generation && attempt === lastPlay) { wantsPlay = false; publish({}, { status: "ready", retryPlay: true }); } }
  }
  async function select(index: number, selection: ReadingSelection = "verse") {
    if (!allowed() || !Number.isSafeInteger(index) || !input.verses[index]) return;
    drop();
    publish({ verse: index, selection, timingHeld: selection !== "verse", suspended: false }, { selection, status: "loading", retryPlay: false, wordsReady: false, wordCount: 0 });
    const available = typeof input.available === "function" ? input.available() : input.available;
    if (!available.has(input.verses[index].ref)) { publish({}, { status: "unavailable", repeat: false }); return; }
    const ticket = generation, signal = abort.signal;
    let clip: ShermetTimedClip | null = null;
    if (selection !== "verse") {
      if (!input.timed) { publish({}, { status: "ready", repeat: false }); return; }
      try { clip = await input.timed.clip(index, selection, signal); } catch { /* Timing holds use the fallback source. */ }
      if (signal.aborted || !allowed() || generation !== ticket) return;
      if (!clip) { publish({}, { status: "unavailable", repeat: false }); return; }
      words = clip.words; publish({ timingHeld: false }, { wordsReady: true });
    }
    media = input.audio?.() ?? new Audio();
    if (clip) url = URL.createObjectURL(clip.blob);
    media.preload = "auto"; media.src = url ?? `/api/shermet-audio?${new URLSearchParams({ ref: input.verses[index].ref })}`;
    media.addEventListener("ended", ended); media.addEventListener("error", failed);
    media.addEventListener("playing", sounding); media.addEventListener("waiting", clearWord); media.addEventListener("seeking", clearWord);
    publish({}, { speedSupported: recordingPitchSupported(media) });
    media.addEventListener("ratechange", tempo); tempo();
    if (selection === "verse" && input.timed) {
      void input.timed.timing(index, signal).then(row => {
        if (row && !signal.aborted && allowed() && generation === ticket) { words = row.words.map((word, i) => ({ ...word, word: i })); publish({}, { wordsReady: true, wordCount: row.wordCount }); }
      }).catch(() => {});
    }
    await play();
  }
  return {
    get state() { return state; }, select, play,
    pause() { generation++; wantsPlay = false; media?.pause(); clearWord(); publish({}, { status: state.playback.status === "playing" ? "ready" : state.playback.status }); },
    suspend() { drop(); publish({ suspended: true }, { status: state.verse === null ? "idle" : "ready" }); },
    setRepeat(value: boolean) { if (allowed() && !state.timingHeld) publish({}, { repeat: value }); },
    setSpeed(value: number) { if (allowed() && media && state.playback.speedSupported && validRecordingSpeed(value)) { publish({}, { speed: value }); tempo(); } },
    dispose() { closed = true; drop(); },
  };
}
