import type { ReferencePlaybackState } from "../../../../lib/reference-audio/playback";
export type ReadingSelection = "verse" | number;
export type ReadingPlaybackState = Readonly<{ verse: number | null; selection: ReadingSelection; playback: ReferencePlaybackState; timingHeld: boolean; suspended: boolean;
  source?: "shermet" | "pockettorah"; fallback?: "missing" | "timing" | "failed";
}>;
