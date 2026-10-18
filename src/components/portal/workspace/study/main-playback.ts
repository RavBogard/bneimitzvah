import { createReferenceAudioReuse, createReferencePlayback, type ReferencePlayback, type ReferencePlaybackOptions, type ReferencePlaybackState } from "../../../../lib/reference-audio/playback";
import type { ReferenceResolution } from "../../../../lib/reference-audio/source";
export type ReadingSelection = "verse" | number;
export type ReadingPlaybackState = Readonly<{ verse: number | null; selection: ReadingSelection; playback: ReferencePlaybackState; timingHeld: boolean; suspended: boolean }>;
const idle: ReferencePlaybackState = Object.freeze({ status: "idle", selection: "verse", repeat: false, speed: 1, speedSupported: false, wordsReady: false, wordCount: 0, retryPlay: false });
/** One page/authority owner, one native controller, one completed verified asset.
 * Only an explicit select/play call can play; clocks never choose another verse. */
export function createReadingPlayback(input: {
  verses: readonly { ref: string; readingText: string; wordCount: number }[];
  load(index: number, signal: AbortSignal): Promise<ReferenceResolution>;
  onState(state: ReadingPlaybackState): void;
  onActiveWord(value: { verse: number; index: number } | null): void;
  platform?: Pick<ReferencePlaybackOptions, "audio" | "fetch" | "digest" | "createUrl" | "revokeUrl" | "scheduler">;
}) {
  const verses = input.verses.map(verse => Object.freeze({ ...verse })), assetReuse = createReferenceAudioReuse();
  let current: ReferencePlayback | undefined, currentVerse: number | null = null, loading: Promise<void> | undefined, closed = false, turn = 0, preferredSpeed = 1, preferredRepeat = false;
  let state: ReadingPlaybackState = Object.freeze({ verse: null, selection: "verse", playback: idle, timingHeld: false, suspended: false });
  const publish = (patch: Partial<ReadingPlaybackState>) => { if (!closed) { state = Object.freeze({ ...state, ...patch }); input.onState(state); } };
  async function select(index: number, selection: ReadingSelection = "verse") {
    if (closed || !Number.isSafeInteger(index) || index < 0 || index >= verses.length || selection !== "verse" && (!Number.isSafeInteger(selection) || selection < 0 || selection >= verses[index].wordCount)) return;
    const mine = ++turn; current?.pause();
    if (currentVerse !== index || !current) {
      current?.dispose(); current = undefined; loading = undefined; input.onActiveWord(null); currentVerse = index;
      publish({ verse: index, selection, playback: idle, timingHeld: false, suspended: false });
      const owner = createReferencePlayback({ ...input.platform, ...verses[index], assetReuse,
        load: signal => input.load(index, signal),
        onState: playback => { if (!closed && current === owner) publish({ playback }); },
        onActiveWord: word => { if (!closed && current === owner) input.onActiveWord(word === null ? null : { verse: index, index: word }); },
      }); current = owner;
    } else publish({ selection, timingHeld: false, suspended: false });
    const owner = current;
    if (!["ready", "playing"].includes(owner.state.status)) {
      if (!loading) loading = owner.load();
      const pending = loading; await pending; if (loading === pending) loading = undefined;
    }
    if (closed || mine !== turn || current !== owner) return;
    if (!["ready", "playing"].includes(owner.state.status)) return;
    if (selection !== "verse" && !owner.state.wordsReady) { owner.pause(); owner.setRepeat(false); publish({ timingHeld: true }); return; }
    if (owner.state.speedSupported) owner.setSpeed(preferredSpeed);
    owner.setRepeat(preferredRepeat);
    owner.select(selection);
    // A selection refusal is never permission to play a broader interval.
    if (owner.state.selection !== selection) { owner.pause(); publish({ timingHeld: true }); return; }
    await owner.play();
  }
  function suspend() {
    if (closed) return; turn++; current?.dispose(); current = undefined; currentVerse = null; loading = undefined;
    input.onActiveWord(null); publish({ playback: idle, timingHeld: false, suspended: true });
  }
  return Object.freeze({ get state() { return state; }, select,
    play() { return state.verse === null ? Promise.resolve() : select(state.verse, state.selection); },
    pause() { if (!closed) { turn++; current?.pause(); } }, suspend,
    setRepeat(value: boolean) { if (!closed && !state.timingHeld && typeof value === "boolean") { preferredRepeat = value; current?.setRepeat(value); } },
    setSpeed(value: number) { if (!closed && current?.state.speedSupported && Number.isFinite(value) && value >= 0.5 && value <= 1.25) { preferredSpeed = value; current.setSpeed(value); } },
    dispose() { if (closed) return; suspend(); closed = true; assetReuse.clear(); },
  });
}
