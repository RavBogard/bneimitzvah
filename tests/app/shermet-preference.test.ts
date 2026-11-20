import { expect, it } from "vitest";
import { createPreferredReadingPlayback } from "../../src/components/portal/workspace/study/preferred-reading-playback";
import type { ReadingPlaybackState, ReadingSelection } from "../../src/components/portal/workspace/study/main-playback";

it("prefers Shermet per verse, truthfully falls back before play, and never changes a playing voice", async () => {
  const calls: string[] = [];
  let shermetPublish!: (state: ReadingPlaybackState) => void;
  const initial: ReadingPlaybackState = { verse: null, selection: "verse", suspended: false, timingHeld: false, playback: { status: "idle", selection: "verse", repeat: false, speed: 1, speedSupported: true, wordsReady: false, wordCount: 0, retryPlay: false } };
  const factory = (name: string) => (input: { onState(state: ReadingPlaybackState): void }) => {
    let state = initial;
    if (name === "shermet") shermetPublish = input.onState;
    return { get state() { return state; }, async select(index: number, selection: ReadingSelection = "verse") { calls.push(`${name}:${index}:${selection}`); state = { ...initial, verse: index, selection, playback: { ...initial.playback, status: "loading", selection } }; input.onState(state); }, async play() {}, pause() {}, suspend() {}, setRepeat() {}, setSpeed() {}, dispose() {} };
  };
  const player = createPreferredReadingPlayback({ preference: "shermet", verses: [{ ref: "Exodus 35:1", readingText: "", wordCount: 2 }, { ref: "Exodus 35:2", readingText: "", wordCount: 2 }], available: () => new Set(["Exodus 35:1"]), canContinue: () => true, load: async () => { throw new Error("Unused"); }, onState() {}, onActiveWord() {} }, { pockettorah: factory("pockettorah"), shermet: factory("shermet") });
  await player.select(0); expect(player.state.source).toBe("shermet");
  shermetPublish({ ...player.state, playback: { ...player.state.playback, status: "error" } });
  expect(player.state.source).toBe("pockettorah"); expect(player.state.fallback).toBe("failed");
  await player.select(1); expect(player.state.source).toBe("pockettorah"); expect(player.state.fallback).toBe("missing");
  await player.select(0, 1); expect(player.state.source).toBe("pockettorah"); expect(player.state.fallback).toBe("timing");
  await player.select(0); shermetPublish({ ...player.state, playback: { ...player.state.playback, status: "playing" } });
  const count = calls.length;
  shermetPublish({ ...player.state, playback: { ...player.state.playback, status: "error" } });
  expect(player.state.source).toBe("shermet"); expect(calls).toHaveLength(count);
  player.dispose();
});
