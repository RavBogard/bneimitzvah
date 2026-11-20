import { createShortReadingPlayback } from "./short-main-playback";
import { createShermetPlayback } from "./shermet-playback";
import type { ReadingPlaybackState, ReadingSelection } from "./main-playback";

type PocketInput = Parameters<typeof createShortReadingPlayback>[0];
type Transport = Pick<ReturnType<typeof createShortReadingPlayback>, "state" | "select" | "play" | "pause" | "suspend" | "setRepeat" | "setSpeed" | "dispose">;
export function createPreferredReadingPlayback(input: PocketInput & {
  preference: "shermet" | "pockettorah"; available(): ReadonlySet<string>; canContinue(): boolean;
}, factories = { pockettorah: createShortReadingPlayback, shermet: createShermetPlayback }) {
  let source: "shermet" | "pockettorah" = "pockettorah", fallback: ReadingPlaybackState["fallback"];
  let heard = false, closed = false;
  let state: ReadingPlaybackState;
  const publish = (next: ReadingPlaybackState) => { state = { ...next, source, fallback }; input.onState(state); };
  const pocket = factories.pockettorah({ ...input, canContinue: () => !closed && source === "pockettorah" && input.canContinue(), onState: next => { if (!closed && source === "pockettorah") publish(next); } });
  const shermet = factories.shermet({ verses: input.verses, available: input.available,
    canContinue: () => !closed && source === "shermet" && input.canContinue(), onActiveWord: input.onActiveWord,
    onState(next) {
      if (closed || source !== "shermet") return;
      if (next.playback.status === "playing") heard = true;
      // Once heard, the selected voice stays fixed until another explicit
      // selection. A late media failure never swaps voices during a verse.
      if (!heard && next.verse !== null && ["error", "unavailable"].includes(next.playback.status) && input.canContinue()) {
        source = "pockettorah"; fallback = "failed"; shermet.suspend();
        void pocket.select(next.verse, next.selection);
        return;
      }
      publish(next);
    },
  });
  state = { ...pocket.state, source };
  const active = (): Transport => source === "shermet" ? shermet : pocket;
  return {
    get state() { return state; },
    async select(index: number, selection: ReadingSelection = "verse") {
      if (closed || !input.canContinue() || !input.verses[index]) return;
      const covered = input.available().has(input.verses[index].ref);
      // Stop both before replacing source identity, so old callbacks cannot
      // publish state for the newly selected recording.
      pocket.suspend(); shermet.suspend(); heard = false;
      source = input.preference === "shermet" && covered && selection === "verse" ? "shermet" : "pockettorah";
      fallback = input.preference === "shermet" && source === "pockettorah" ? covered ? "timing" : "missing" : undefined;
      await active().select(index, selection);
    },
    play: () => active().play(), pause: () => active().pause(),
    suspend() { pocket.suspend(); shermet.suspend(); },
    setRepeat: (value: boolean) => active().setRepeat(value), setSpeed: (value: number) => active().setSpeed(value),
    dispose() { closed = true; pocket.dispose(); shermet.dispose(); },
  };
}
