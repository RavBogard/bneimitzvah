import type { ReferenceAudioElement } from "../../../../lib/reference-audio/playback";
import type { ReadingPlaybackState, ReadingSelection } from "./main-playback";

/** Whole-verse human recordings. No PocketTorah timing is reused. */
export function createShermetPlayback(input: {
  verses: readonly { ref: string }[]; available: ReadonlySet<string> | (() => ReadonlySet<string>); canContinue(): boolean;
  onState(state: ReadingPlaybackState): void; onActiveWord(value: null): void;
  audio?(): ReferenceAudioElement;
}) {
  let state: ReadingPlaybackState = { verse: null, selection: "verse", timingHeld: false, suspended: false,
    playback: { status: "idle", selection: "verse", repeat: false, speed: 1, speedSupported: false, wordsReady: false, wordCount: 0, retryPlay: false } };
  let media: ReferenceAudioElement | null = null, closed = false, generation = 0, lastPlay = 0, wantsPlay = false;
  const publish = (patch: Partial<ReadingPlaybackState>, playback = {}) => { state = { ...state, ...patch, playback: { ...state.playback, ...playback } }; input.onState(state); };
  const allowed = () => !closed && input.canContinue();
  function drop() { generation++; wantsPlay = false; if (media) { media.pause(); media.removeEventListener("ended", ended); media.removeEventListener("error", failed); media.removeAttribute("src"); media.load(); media = null; } input.onActiveWord(null); }
  function failed() { if (allowed()) { drop(); publish({}, { status: "error" }); } }
  function ended() {
    if (!allowed()) { drop(); return; }
    if (state.playback.repeat && media) { media.currentTime = 0; void play(); }
    else publish({}, { status: "ready" });
  }
  async function play() {
    if (!allowed() || state.timingHeld || state.verse === null) return;
    if (!media) { await select(state.verse, state.selection); return; }
    const selected = media, ticket = generation, attempt = ++lastPlay; wantsPlay = true;
    try {
      await selected.play();
      if (!allowed() || ticket !== generation || media !== selected || attempt !== lastPlay) { if (!allowed() || media !== selected || !wantsPlay) selected.pause(); return; }
      publish({ suspended: false }, { status: "playing", retryPlay: false });
    } catch { if (allowed() && ticket === generation && attempt === lastPlay) { wantsPlay = false; publish({}, { status: "ready", retryPlay: true }); } }
  }
  async function select(index: number, selection: ReadingSelection = "verse") {
    if (!allowed() || !Number.isSafeInteger(index) || !input.verses[index]) return;
    drop();
    publish({ verse: index, selection, timingHeld: selection !== "verse", suspended: false }, { selection, status: "loading", retryPlay: false });
    const available = typeof input.available === "function" ? input.available() : input.available;
    if (!available.has(input.verses[index].ref)) { publish({}, { status: "unavailable", repeat: false }); return; }
    if (selection !== "verse") { publish({}, { status: "ready", repeat: false }); return; }
    media = input.audio?.() ?? new Audio();
    media.preload = "auto"; media.src = `/api/shermet-audio?${new URLSearchParams({ ref: input.verses[index].ref })}`;
    media.addEventListener("ended", ended); media.addEventListener("error", failed);
    publish({}, { speedSupported: "preservesPitch" in media });
    media.preservesPitch = true; media.playbackRate = state.playback.speed;
    await play();
  }
  return {
    get state() { return state; }, select, play,
    pause() { generation++; wantsPlay = false; media?.pause(); input.onActiveWord(null); publish({}, { status: state.playback.status === "playing" ? "ready" : state.playback.status }); },
    suspend() { drop(); publish({ suspended: true }, { status: state.verse === null ? "idle" : "ready" }); },
    setRepeat(value: boolean) { if (allowed() && !state.timingHeld) publish({}, { repeat: value }); },
    setSpeed(value: number) { if (allowed() && media && state.playback.speedSupported && [0.5, 0.75, 1, 1.25].includes(value)) { media.playbackRate = value; publish({}, { speed: value }); } },
    dispose() { closed = true; drop(); },
  };
}
