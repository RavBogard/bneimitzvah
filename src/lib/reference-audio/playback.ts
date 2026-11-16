// Types shared by the reading player (short-playback.ts holds the player itself).
export type ReferencePlaybackState = Readonly<{
  status: "idle" | "loading" | "ready" | "playing" | "unavailable" | "error";
  selection: "verse" | number; repeat: boolean; speed: number; speedSupported: boolean;
  wordsReady: boolean; wordCount: number; retryPlay: boolean;
}>;
export type ReferenceAudioElement = Pick<HTMLAudioElement, "src" | "preload" | "duration" | "currentTime" | "playbackRate" | "preservesPitch" | "play" | "pause" | "load" | "removeAttribute" | "addEventListener" | "removeEventListener">;
type Scheduler = { frame(fn: FrameRequestCallback): number; cancelFrame(id: number): void; timer(fn: () => void, ms: number): ReturnType<typeof setTimeout>; clearTimer(id: ReturnType<typeof setTimeout>): void };
// Platform seams for deterministic offline tests; no configurable production caps.
export type ReferencePlaybackOptions = {
  audio?(): ReferenceAudioElement; fetch?: typeof fetch; digest?(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
  createUrl?(blob: Blob): string; revokeUrl?(url: string): void; scheduler?: Scheduler;
};
