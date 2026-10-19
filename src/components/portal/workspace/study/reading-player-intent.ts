import type { ReadingSelection } from "./main-playback";
import type { ReadingAudioIntent, ReadingAudioSlot, createReadingAudioCoordinator } from "./reading-audio-coordinator";

type Playback = { select(index: number, selection: ReadingSelection): Promise<void>; play(): Promise<void>; pause(): void; suspend(): void; setRepeat(value: boolean): void; setSpeed(value: number): void };
/** Actual claim/child ceilings only; this never invents session validity. */
export function readingAudioDeadline(proposal: number, child?: string | null) {
  return Math.min(proposal, child === undefined || child === null ? Infinity : Date.parse(child));
}
export function readingAudioCurrent(deadline?: number) {
  return deadline === undefined || Number.isFinite(deadline) && Date.now() < deadline;
}
export function watchReadingAudioDeadline(deadline: number, current: () => boolean, stop: () => void) {
  const expire = () => { if (current()) stop(); }, remaining = deadline - Date.now();
  if (!Number.isFinite(deadline) || remaining <= 0) { expire(); return () => {}; }
  const timer = setTimeout(expire, remaining); return () => clearTimeout(timer);
}
/** Scheduling only. Real metadata owners and the core retain data/source fences. */
export function createReadingPlayerIntent(input: {
  coordinator: ReturnType<typeof createReadingAudioCoordinator>; slot: ReadingAudioSlot; playback: Playback;
  enabled(): boolean; active(): boolean; visible(): boolean;
  frame(callback: () => void): number; cancelFrame(id: number): void;
}) {
  let closed = false, ticket: ReadingAudioIntent | null = null, frame: number | undefined;
  function cancel() { if (frame !== undefined) input.cancelFrame(frame); frame = undefined; }
  function suspend() { cancel(); ticket = null; input.playback.suspend(); }
  const registration = input.coordinator.register(input.slot, suspend);
  const permitted = () => { try { return !closed && input.enabled() && input.visible(); } catch { return false; } };
  const current = (value: ReadingAudioIntent | null) => Boolean(value && ticket === value && registration.isCurrent(value) && permitted());
  function intent(action: () => Promise<void>) {
    if (!permitted()) { suspend(); return; }
    cancel(); const selected = registration.claim(); if (!selected) return;
    ticket = selected;
    const run = () => { if (!current(selected)) return; if (!input.active()) { suspend(); return; } void action(); };
    // Inactive-tab Start captures its ticket NOW; the frame may only check it.
    if (input.active()) run();
    else { const scheduled = input.frame(() => { if (frame === scheduled) frame = undefined; run(); }); frame = scheduled; }
  }
  return Object.freeze({
    select(index: number, selection: ReadingSelection = "verse") { intent(() => input.playback.select(index, selection)); },
    play() { intent(() => input.playback.play()); },
    pause() { cancel(); if (!closed) input.playback.pause(); },
    suspend,
    isCurrent() { return current(ticket) && input.active(); },
    setRepeat(value: boolean) { if (current(ticket) && input.active()) input.playback.setRepeat(value); },
    setSpeed(value: number) { if (current(ticket) && input.active()) input.playback.setSpeed(value); },
    dispose() { if (closed) return; closed = true; suspend(); registration.dispose(); },
  });
}
