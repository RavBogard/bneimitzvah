import { expect, test, vi } from "vitest";
import { createReadingAudioCoordinator, type ReadingAudioSlot } from "../../src/components/portal/workspace/study/reading-audio-coordinator";
const slots: ReadingAudioSlot[] = ["proposed", "assigned", "lifted"];
for (const from of slots) for (const to of slots.filter(slot => slot !== from)) test(`synchronously excludes ${from} before ${to} may prime`, () => {
  const coordinator = createReadingAudioCoordinator(), events: string[] = [];
  const registrations = Object.fromEntries(slots.map(slot => [slot, coordinator.register(slot, () => events.push("stop:" + slot))]));
  const old = registrations[from].claim()!; events.length = 0;
  const next = registrations[to].claim()!; events.push("may-prime:" + to);
  expect(events).toEqual(slots.filter(slot => slot !== to).map(slot => "stop:" + slot).concat("may-prime:" + to));
  expect(registrations[from].isCurrent(old)).toBe(false); expect(registrations[to].isCurrent(next)).toBe(true); coordinator.dispose();
});
test("construction and unrelated registration do not start, stop or invalidate current playback", () => {
  const coordinator = createReadingAudioCoordinator(), first = vi.fn(), other = vi.fn(), assigned = coordinator.register("assigned", first); expect(first).not.toHaveBeenCalled(); const ticket = assigned.claim()!;
  coordinator.register("proposed", other); expect(assigned.isCurrent(ticket)).toBe(true); expect(first).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled(); coordinator.dispose();
});
test("fresh same-owner intent preserves prepared media; stale same-registration release cannot stop it", () => {
  const coordinator = createReadingAudioCoordinator(), stop = vi.fn(), owner = coordinator.register("proposed", stop), old = owner.claim()!, next = owner.claim()!;
  expect(next.generation).toBeGreaterThan(old.generation); expect(stop).not.toHaveBeenCalled(); expect(owner.isCurrent(old)).toBe(false); expect(owner.release(old)).toBe(false); expect(owner.isCurrent(next)).toBe(true);
  expect(owner.release(next)).toBe(true); expect(stop).toHaveBeenCalledOnce(); expect(owner.release(next)).toBe(false); coordinator.dispose();
});
test("same-slot replacement suspends old before returning and old cleanup cannot stop successor", () => {
  const coordinator = createReadingAudioCoordinator(), oldStop = vi.fn(), nextStop = vi.fn(), old = coordinator.register("assigned", oldStop), ticket = old.claim()!;
  const next = coordinator.register("assigned", nextStop); expect(oldStop).toHaveBeenCalledOnce(); expect(old.isCurrent(ticket)).toBe(false); const current = next.claim()!;
  old.dispose(); expect(old.claim()).toBeNull(); expect(old.release(ticket)).toBe(false); expect(next.isCurrent(current)).toBe(true); expect(nextStop).not.toHaveBeenCalled(); coordinator.dispose();
});
test("unregistered/closed registrations and cloned tickets cannot claim or release another intent", () => {
  const coordinator = createReadingAudioCoordinator(), stop = vi.fn(), owner = coordinator.register("lifted", stop), ticket = owner.claim()!;
  expect(owner.release({ ...ticket })).toBe(false); expect(owner.isCurrent(ticket)).toBe(true); owner.dispose(); expect(owner.claim()).toBeNull(); expect(owner.release(ticket)).toBe(false);
  coordinator.dispose(); expect(coordinator.register("proposed", vi.fn()).claim()).toBeNull();
});
test("held load/ack, queued rAF and repeat/EOF work keep original ticket and cannot reclaim after a newer action", async () => {
  const coordinator = createReadingAudioCoordinator(), old = coordinator.register("proposed", vi.fn()), next = coordinator.register("assigned", vi.fn()), ticket = old.claim()!;
  let resolve!: () => void; const held = new Promise<void>(yes => { resolve = yes; }), actions: string[] = [];
  const raf = () => { if (old.isCurrent(ticket)) actions.push("raf-prime"); }, eof = () => { if (old.isCurrent(ticket)) actions.push("repeat"); };
  const acknowledgement = held.then(() => { if (old.isCurrent(ticket)) actions.push("late-play"); }); const current = next.claim()!; raf(); eof(); resolve(); await acknowledgement;
  expect(actions).toEqual([]); expect(next.isCurrent(current)).toBe(true); coordinator.dispose();
});
test("stopAll invalidates before callbacks and attempts every registered cleanup even after failure", () => {
  const coordinator = createReadingAudioCoordinator(), events: string[] = []; let current!: ReturnType<typeof coordinator.register>, ticket!: NonNullable<ReturnType<typeof current.claim>>;
  current = coordinator.register("proposed", () => { events.push("proposed"); expect(current.isCurrent(ticket)).toBe(false); }); ticket = current.claim()!;
  coordinator.register("assigned", () => { events.push("assigned"); throw Error("synthetic stop failure"); }); coordinator.register("lifted", () => events.push("lifted"));
  expect(coordinator.stopAll()).toBe(false); expect(events).toEqual(["proposed", "assigned", "lifted"]); expect(current.claim()).toBeNull();
});
test("failed same-slot replacement retains old cleanup handle and permanently refuses new playback", () => {
  const coordinator = createReadingAudioCoordinator(); let fails = true; const stop = vi.fn(() => { if (fails) throw Error("synthetic stop failure"); });
  const old = coordinator.register("assigned", stop); old.claim(); const replacementStop = vi.fn(), replacement = coordinator.register("assigned", replacementStop);
  expect(replacement.claim()).toBeNull(); expect(old.claim()).toBeNull(); expect(coordinator.register("proposed", vi.fn()).claim()).toBeNull(); expect(stop).toHaveBeenCalledOnce();
  fails = false; expect(coordinator.stopAll()).toBe(true); expect(stop).toHaveBeenCalledTimes(2); expect(replacementStop).not.toHaveBeenCalled(); expect(old.claim()).toBeNull();
});
test("claim cleanup failure stops remaining slots and self, then latches closed to new playback", () => {
  const coordinator = createReadingAudioCoordinator(), events: string[] = [];
  const proposed = coordinator.register("proposed", () => { events.push("proposed"); throw Error("synthetic stop failure"); });
  coordinator.register("assigned", () => events.push("assigned")); const lifted = coordinator.register("lifted", () => events.push("lifted"));
  expect(lifted.claim()).toBeNull(); expect(events).toEqual(["proposed", "assigned", "lifted"]); expect(proposed.claim()).toBeNull(); expect(lifted.claim()).toBeNull();
});
test("reentrant claim is refused during suspension and cannot steal outer ticket", () => {
  const coordinator = createReadingAudioCoordinator(); let other!: ReturnType<typeof coordinator.register>; const attempts: unknown[] = [];
  const first = coordinator.register("proposed", () => attempts.push(other.claim())); other = coordinator.register("assigned", vi.fn()); const ticket = other.claim()!;
  expect(attempts).toEqual([null]); expect(other.isCurrent(ticket)).toBe(true); expect(first.isCurrent(ticket)).toBe(false); coordinator.dispose();
});
test("dispose fences all tickets before callbacks and prevents any future registration playback", () => {
  const coordinator = createReadingAudioCoordinator(), stop = vi.fn(), owner = coordinator.register("assigned", stop), ticket = owner.claim()!;
  expect(coordinator.dispose()).toBe(true); expect(owner.isCurrent(ticket)).toBe(false); expect(owner.claim()).toBeNull(); expect(stop).toHaveBeenCalledOnce(); expect(coordinator.register("lifted", vi.fn()).claim()).toBeNull();
});


test("reentrant stopAll cancels the outer claim and drains every owner before returning", async () => {
  const coordinator = createReadingAudioCoordinator(); let closeScope = false;
  const nested: boolean[] = [], actions: string[] = [];
  const firstStop = vi.fn(() => { if (closeScope) nested.push(coordinator.stopAll()); });
  const nextStop = vi.fn(), lastStop = vi.fn();
  const first = coordinator.register("proposed", firstStop), next = coordinator.register("assigned", nextStop);
  coordinator.register("lifted", lastStop); const old = first.claim()!;
  let complete!: () => void; const held = new Promise<void>(yes => { complete = yes; });
  const late = held.then(() => { if (first.isCurrent(old)) actions.push("late-play"); });
  firstStop.mockClear(); nextStop.mockClear(); lastStop.mockClear(); closeScope = true;
  expect(next.claim()).toBeNull(); expect(first.isCurrent(old)).toBe(false); expect(first.release(old)).toBe(false);
  for (const stop of [firstStop, nextStop, lastStop]) { expect(stop.mock.calls.length).toBeGreaterThanOrEqual(1); expect(stop.mock.calls.length).toBeLessThanOrEqual(2); }
  expect(nested.length).toBeGreaterThan(0); expect(nested.every(value => value === false)).toBe(true);
  if (first.isCurrent(old)) actions.push("raf-or-repeat"); complete(); await late; expect(actions).toEqual([]);
  // A clean scope stop cancels this attempt, without poisoning future intent.
  closeScope = false; const fresh = next.claim()!; expect(fresh).not.toBeNull(); expect(next.isCurrent(fresh)).toBe(true);
  coordinator.dispose();
});

test("a nested all-stop during same-slot replacement refuses the successor and retains the old handle", () => {
  const coordinator = createReadingAudioCoordinator(); let closeScope = false;
  const oldStop = vi.fn(() => { if (closeScope) coordinator.stopAll(); }), otherStop = vi.fn(), successorStop = vi.fn();
  const old = coordinator.register("assigned", oldStop); coordinator.register("proposed", otherStop); const ticket = old.claim()!;
  oldStop.mockClear(); otherStop.mockClear(); closeScope = true;
  const replacement = coordinator.register("assigned", successorStop);
  expect(replacement.claim()).toBeNull(); expect(old.isCurrent(ticket)).toBe(false);
  expect(otherStop).toHaveBeenCalledOnce(); expect(successorStop).not.toHaveBeenCalled();
  closeScope = false; const fresh = old.claim()!; expect(fresh).not.toBeNull(); expect(old.isCurrent(fresh)).toBe(true);
  coordinator.dispose();
});

test("nested all-stop callbacks do not recurse and all owners are attempted despite a throw", () => {
  const coordinator = createReadingAudioCoordinator(), events: string[] = []; const nested: boolean[] = [];
  const first = coordinator.register("proposed", () => { events.push("proposed"); nested.push(coordinator.stopAll()); });
  coordinator.register("assigned", () => { events.push("assigned"); nested.push(coordinator.stopAll()); throw Error("synthetic stop failure"); });
  coordinator.register("lifted", () => { events.push("lifted"); nested.push(coordinator.stopAll()); });
  expect(coordinator.stopAll()).toBe(false); expect(events).toEqual(["proposed", "assigned", "lifted"]);
  expect(nested).toEqual([false, false, false]); expect(first.claim()).toBeNull();
});

test("replacement cancellation keeps a failed old cleanup reachable for an explicit later stop", () => {
  const coordinator = createReadingAudioCoordinator(); let fails = false;
  const oldStop = vi.fn(() => { if (fails) { coordinator.stopAll(); throw Error("synthetic stop failure"); } });
  const remaining = vi.fn(), successorStop = vi.fn(), old = coordinator.register("assigned", oldStop);
  coordinator.register("lifted", remaining); old.claim(); oldStop.mockClear(); remaining.mockClear(); fails = true;
  const replacement = coordinator.register("assigned", successorStop);
  expect(replacement.claim()).toBeNull(); expect(old.claim()).toBeNull(); expect(remaining).toHaveBeenCalledOnce();
  expect(successorStop).not.toHaveBeenCalled(); const attempts = oldStop.mock.calls.length;
  fails = false; expect(coordinator.stopAll()).toBe(true); expect(oldStop).toHaveBeenCalledTimes(attempts + 1);
  expect(old.claim()).toBeNull(); // The actual thrown cleanup, unlike a clean stop, remains latched.
});

test("release and registration cleanup complete a nested global stop before returning", () => {
  for (const action of ["release", "dispose"] as const) {
    const coordinator = createReadingAudioCoordinator(); let stopScope = false;
    const stop = vi.fn(() => { if (stopScope) coordinator.stopAll(); }), otherStop = vi.fn();
    const owner = coordinator.register("proposed", stop); coordinator.register("assigned", otherStop); const ticket = owner.claim()!;
    stop.mockClear(); otherStop.mockClear(); stopScope = true;
    if (action === "release") expect(owner.release(ticket)).toBe(true); else owner.dispose();
    expect(owner.isCurrent(ticket)).toBe(false); expect(otherStop).toHaveBeenCalledOnce();
    stopScope = false; coordinator.dispose();
  }
});
