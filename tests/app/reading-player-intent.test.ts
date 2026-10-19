import { expect, test, vi } from "vitest";
import { createReadingAudioCoordinator, type ReadingAudioSlot } from "../../src/components/portal/workspace/study/reading-audio-coordinator";
import { createReadingPlayerIntent, readingAudioCurrent, readingAudioDeadline, watchReadingAudioDeadline } from "../../src/components/portal/workspace/study/reading-player-intent";

function fixture(coordinator = createReadingAudioCoordinator(), slot: ReadingAudioSlot = "assigned", events: string[] = []) {
  let active = true, enabled = true, visible = true, serial = 0, deadline: number | undefined;
  const frames = new Map<number, () => void>();
  const playback = { select: vi.fn(async (_index: number, _selection: "verse" | number) => { events.push(slot + ":select"); }), play: vi.fn(async () => { events.push(slot + ":play"); }), pause: vi.fn(),
    suspend: vi.fn(() => { events.push(slot + ":stop"); }), setRepeat: vi.fn(), setSpeed: vi.fn() };
  const intent = createReadingPlayerIntent({ coordinator, slot, playback, active: () => active, enabled: () => enabled && readingAudioCurrent(deadline), visible: () => visible,
    frame: callback => { const id = ++serial; frames.set(id, callback); return id; }, cancelFrame: vi.fn() });
  return { intent, playback, frames, coordinator, setActive(value: boolean) { active = value; }, setEnabled(value: boolean) { enabled = value; }, setVisible(value: boolean) { visible = value; }, setDeadline(value: number) { deadline = value; } };
}
const slots: ReadingAudioSlot[] = ["assigned", "proposed", "lifted"];
for (const from of slots) for (const to of slots.filter(value => value !== from)) test(`stops ${from} before ${to}'s synchronous prime/load seam`, () => {
  const events: string[] = [], coordinator = createReadingAudioCoordinator(), old = fixture(coordinator, from, events), next = fixture(coordinator, to, events);
  old.intent.select(0); events.length = 0; next.intent.select(1, 2);
  expect(events).toEqual([from + ":stop", to + ":select"]); expect(old.intent.isCurrent()).toBe(false); expect(next.intent.isCurrent()).toBe(true);
  old.intent.dispose(); next.intent.dispose();
});

test("construction, registration and setter/native-continuation checks never acquire or start audio", () => {
  const f = fixture(); expect(f.playback.select).not.toHaveBeenCalled(); expect(f.playback.suspend).not.toHaveBeenCalled();
  f.intent.setRepeat(true); f.intent.setSpeed(0.75); expect(f.intent.isCurrent()).toBe(false); expect(f.playback.setRepeat).not.toHaveBeenCalled(); expect(f.playback.setSpeed).not.toHaveBeenCalled();
  f.intent.select(0); const next = fixture(f.coordinator, "proposed"); expect(f.intent.isCurrent()).toBe(true); expect(f.playback.suspend).not.toHaveBeenCalled(); next.intent.dispose(); f.intent.dispose();
});

test("every explicit selection and resume claims, preserving prepared same-owner media and pause position", () => {
  const f = fixture(); f.intent.select(0, "verse"); f.intent.select(0, 2); f.intent.pause(); f.intent.play();
  expect(f.playback.select.mock.calls).toEqual([[0, "verse"], [0, 2]]); expect(f.playback.pause).toHaveBeenCalledOnce(); expect(f.playback.play).toHaveBeenCalledOnce(); expect(f.playback.suspend).not.toHaveBeenCalled();
  f.intent.setRepeat(true); f.intent.setSpeed(0.5); expect(f.playback.setRepeat).toHaveBeenCalledWith(true); expect(f.playback.setSpeed).toHaveBeenCalledWith(0.5); f.intent.dispose();
});

test("inactive Start claims before its frame; a later other-slot click wins without deferred reacquisition", () => {
  const f = fixture(), next = fixture(f.coordinator, "proposed"); f.setActive(false); f.intent.select(0);
  expect(next.playback.suspend).toHaveBeenCalledOnce(); expect(f.playback.select).not.toHaveBeenCalled();
  const delayed = [...f.frames.values()][0]; next.intent.select(2); f.setActive(true); delayed();
  expect(f.playback.select).not.toHaveBeenCalled(); expect(next.intent.isCurrent()).toBe(true); f.intent.dispose(); next.intent.dispose();
});

test("unchanged inactive-tab Start uses its original ticket once after activation", () => {
  const f = fixture(); f.setActive(false); f.intent.select(3); const delayed = [...f.frames.values()][0];
  f.setActive(true); delayed(); expect(f.playback.select).toHaveBeenCalledExactlyOnceWith(3, "verse"); expect(f.playback.suspend).not.toHaveBeenCalled(); f.intent.dispose();
});

test("cancelled old frame cannot select or stop a newer same-owner intent", () => {
  const f = fixture(); f.setActive(false); f.intent.select(0); const old = [...f.frames.values()][0]; f.intent.select(1); const next = [...f.frames.values()][1];
  f.setActive(true); old(); next(); expect(f.playback.select).toHaveBeenCalledExactlyOnceWith(1, "verse"); expect(f.playback.suspend).not.toHaveBeenCalled(); f.intent.dispose();
});

test("hidden, disabled and closed paths never claim/prime or steal another reader", () => {
  const f = fixture(), next = fixture(f.coordinator, "proposed"); next.intent.select(0);
  f.setVisible(false); f.intent.select(0); f.intent.play(); f.setVisible(true); f.setEnabled(false); f.intent.select(0); f.intent.play();
  expect(f.playback.select).not.toHaveBeenCalled(); expect(f.playback.play).not.toHaveBeenCalled(); expect(next.intent.isCurrent()).toBe(true);
  f.intent.dispose(); f.setEnabled(true); f.intent.select(0); expect(f.playback.select).not.toHaveBeenCalled(); next.intent.dispose();
});

test("held work checks the old intent and global stop prevents late frame/EOF resumption", async () => {
  const f = fixture(); f.intent.select(0); let resolve!: () => void; const held = new Promise<void>(yes => { resolve = yes; }), heard: string[] = [];
  const late = held.then(() => { if (f.intent.isCurrent()) heard.push("late-play"); }); f.coordinator.stopAll(); resolve(); await late;
  expect(heard).toEqual([]); expect(f.intent.isCurrent()).toBe(false); f.intent.setRepeat(true); expect(f.playback.setRepeat).not.toHaveBeenCalled(); f.intent.dispose();
});

test("StrictMode-style owner cleanup permits a fresh registration on the same parent coordinator", () => {
  const coordinator = createReadingAudioCoordinator(), old = fixture(coordinator); old.intent.select(0); old.intent.dispose(); coordinator.stopAll();
  const fresh = fixture(coordinator); fresh.intent.select(0); expect(fresh.playback.select).toHaveBeenCalledOnce(); expect(fresh.intent.isCurrent()).toBe(true);
  old.intent.dispose(); expect(fresh.intent.isCurrent()).toBe(true); fresh.intent.dispose();
});

test("a throwing other-owner stop refuses the explicit primer and keeps playback blocked", () => {
  const f = fixture(); f.coordinator.register("proposed", () => { throw Error("synthetic stop failure"); });
  f.intent.select(0); f.intent.play(); expect(f.playback.select).not.toHaveBeenCalled(); expect(f.playback.play).not.toHaveBeenCalled(); expect(f.intent.isCurrent()).toBe(false);
});

test("the earlier actual child deadline stops already-playing cached media without another read", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z")); const f = fixture(), metadataStop = vi.fn();
    f.intent.select(0); const deadline = readingAudioDeadline(Date.now() + 300000, new Date(Date.now() + 1000).toISOString());
    const cleanup = watchReadingAudioDeadline(deadline, () => true, () => { f.intent.suspend(); metadataStop(); });
    vi.advanceTimersByTime(999); expect(f.playback.suspend).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
    expect(f.playback.suspend).toHaveBeenCalledOnce(); expect(metadataStop).toHaveBeenCalledOnce(); expect(f.intent.isCurrent()).toBe(false);
    expect(f.playback.select).toHaveBeenCalledOnce(); cleanup(); f.intent.dispose();
  } finally { vi.useRealTimers(); }
});

test("claim ceilings fail closed and a retired timer cannot stop the new page", () => {
  vi.useFakeTimers();
  try {
    const now = Date.now(), stop = vi.fn(); let current = true;
    expect(readingAudioDeadline(now + 1000, new Date(now + 300000).toISOString())).toBe(now + 1000);
    const cleanup = watchReadingAudioDeadline(now + 1000, () => current, stop); current = false; vi.advanceTimersByTime(1000); expect(stop).not.toHaveBeenCalled(); cleanup();
    watchReadingAudioDeadline(readingAudioDeadline(now + 300000, "invalid"), () => true, stop); expect(stop).toHaveBeenCalledOnce();
    watchReadingAudioDeadline(now, () => true, stop); expect(stop).toHaveBeenCalledTimes(2);
    expect(readingAudioDeadline(now + 1000)).toBe(now + 1000);
  } finally { vi.useRealTimers(); }
});

test("cached explicit Play/select checks the actual clock before a queued expiry timer runs", () => {
  vi.useFakeTimers();
  try {
    const now = Date.now(), f = fixture(); f.setDeadline(now + 1000); f.intent.select(0);
    // Change the clock without advancing timer tasks, matching the event-queue race.
    vi.setSystemTime(now + 1000); expect(f.intent.isCurrent()).toBe(false); f.intent.play(); f.intent.select(0, 1);
    expect(f.playback.play).not.toHaveBeenCalled(); expect(f.playback.select).toHaveBeenCalledOnce(); expect(f.playback.suspend).toHaveBeenCalled();
    expect(readingAudioCurrent(NaN)).toBe(false); expect(readingAudioCurrent(Infinity)).toBe(false); expect(readingAudioCurrent()).toBe(true); f.intent.dispose();
  } finally { vi.useRealTimers(); }
});


test("controlled preview follows navigation without selecting, loading or retaining an old word", async () => {
  const { readingPlayerPreview } = await import("../../src/components/portal/workspace/study/reading-player-intent");
  const f = fixture();
  const state = { verse: 0, selection: 2, playback: { status: "ready", selection: 2, repeat: false, speed: 1, speedSupported: true, wordsReady: true, wordCount: 3, retryPlay: false }, timingHeld: false, suspended: false } satisfies import("../../src/components/portal/workspace/study/main-playback").ReadingPlaybackState;
  expect(readingPlayerPreview(state, 1, false)).toEqual({ index: 1, current: false, selection: "verse" });
  expect(f.playback.select).not.toHaveBeenCalled(); expect(f.playback.play).not.toHaveBeenCalled();
  f.intent.suspend(); f.intent.select(1, "verse");
  expect(f.playback.select).toHaveBeenCalledExactlyOnceWith(1, "verse");
  expect(readingPlayerPreview(state, 0, false).selection).toBe("verse");
  expect(readingPlayerPreview(state, undefined, true)).toEqual({ index: 0, current: true, selection: 2 });
  f.intent.dispose();
});


test("modal target snapshot fences held work and same-index return without reacquiring old intent", async () => {
  const { createReadingPlayerTarget } = await import("../../src/components/portal/workspace/study/reading-player-intent");
  const target = createReadingPlayerTarget(), f = fixture(), value = { index: 0, generation: 1 };
  expect(target.current(value)).toBe(false); target.select(value); f.intent.select(value.index);
  let resolve!: () => void;
  const heard: number[] = [], late = new Promise<void>(yes => { resolve = yes; }).then(() => { if (f.intent.isCurrent() && target.current(value)) heard.push(value.index); });
  f.intent.suspend(); value.index = 1; value.generation++;
  expect(target.current(value)).toBe(false); resolve(); await late; expect(heard).toEqual([]);
  target.select(value); f.intent.select(value.index); expect(target.current(value)).toBe(true);
  value.index = 0; value.generation++; expect(target.current(value)).toBe(false);
  target.clear(); expect(target.current(value)).toBe(false); expect(target.current()).toBe(true);
  f.intent.dispose();
});
