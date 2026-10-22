/** Scheduling only, never data authority. Claim synchronously before primer/play
 * or the first await. Deferred work checks its original ticket; never reclaims.
 * suspend must invalidate pending work and drop media, not merely pause it. */
export type ReadingAudioSlot = "proposed" | "assigned" | "lifted" | "finkel-proposed" | "finkel-assigned";
const intentBrand: unique symbol = Symbol("reading audio intent");
export type ReadingAudioIntent = Readonly<{ [intentBrand]: true; generation: number }>;
export type ReadingAudioRegistration = Readonly<{
  claim(): ReadingAudioIntent | null;
  isCurrent(ticket: ReadingAudioIntent): boolean;
  release(ticket: ReadingAudioIntent): boolean;
  dispose(): void;
}>;
export function createReadingAudioCoordinator() {
  type Registration = { slot: ReadingAudioSlot; suspend(): void; disposed: boolean };
  const registrations = new Map<ReadingAudioSlot, Registration>();
  let current: { registration: Registration; ticket: ReadingAudioIntent } | null = null;
  let transitioning = false, draining = false, pendingStop = false, blocked = false, closed = false, generation = 0, stopEpoch = 0;
  const valid = (registration: Registration) => !registration.disposed && registrations.get(registration.slot) === registration;
  function stop(registration: Registration) { try { registration.suspend(); return true; } catch { blocked = true; return false; } }
  const inert: ReadingAudioRegistration = Object.freeze({ claim: () => null, isCurrent: () => false, release: () => false, dispose() {} });
  // Calls made inside suspend callbacks must cancel the outer intent too.
  // The fixed registration set cannot change while this bounded pass runs.
  function drainPending() {
    if (!pendingStop) return true;
    pendingStop = false; draining = true;
    let complete = true;
    try { for (const registration of registrations.values()) if (!stop(registration)) complete = false; }
    finally { draining = false; pendingStop = false; }
    return complete;
  }
  function finishTransition() {
    try { return drainPending(); } finally { transitioning = false; }
  }
  function stopAll() {
    current = null;
    if (!Number.isSafeInteger(++stopEpoch)) blocked = true;
    // A nested call in the complete pass already has every owner covered.
    if (!draining) pendingStop = true;
    if (transitioning) return false;
    transitioning = true;
    return finishTransition();
  }
  return Object.freeze({
    register(slot: ReadingAudioSlot, suspend: () => void): ReadingAudioRegistration {
      if (closed || blocked || transitioning || !["proposed", "assigned", "lifted", "finkel-proposed", "finkel-assigned"].includes(slot) || typeof suspend !== "function") return inert;
      const previous = registrations.get(slot);
      if (previous) {
        // Do not forget a potentially unstoppable old owner on replacement.
        if (current?.registration === previous) current = null;
        const epoch = stopEpoch; transitioning = true;
        try {
          if (!stop(previous) || epoch !== stopEpoch || closed || blocked) return inert;
          previous.disposed = true; registrations.delete(slot);
        } finally { finishTransition(); }
      }
      const registration: Registration = { slot, suspend, disposed: false }; registrations.set(slot, registration);
      const isCurrent = (ticket: ReadingAudioIntent) => !closed && !blocked && !transitioning && valid(registration) && current?.registration === registration && current.ticket === ticket;
      return Object.freeze({
        claim() {
          if (closed || blocked || transitioning || !valid(registration)) return null;
          const epoch = stopEpoch; current = null; transitioning = true;
          try {
            let complete = true;
            for (const other of registrations.values()) if (other !== registration && !stop(other)) complete = false;
            if (epoch !== stopEpoch) return null; // finally drains every owner, including self.
            if (!complete) { stop(registration); return null; }
            if (!valid(registration) || closed || blocked || !Number.isSafeInteger(++generation)) { blocked = true; stop(registration); return null; }
            const ticket: ReadingAudioIntent = Object.freeze({ [intentBrand]: true as const, generation });
            current = { registration, ticket }; return ticket;
          } finally { finishTransition(); }
        },
        isCurrent,
        release(ticket: ReadingAudioIntent) {
          if (!isCurrent(ticket)) return false;
          current = null; transitioning = true;
          const complete = stop(registration);
          return finishTransition() && complete;
        },
        dispose() {
          if (transitioning || !valid(registration)) return;
          if (current?.registration === registration) current = null;
          transitioning = true;
          try { if (stop(registration)) { registration.disposed = true; registrations.delete(slot); } }
          finally { finishTransition(); }
        },
      });
    },
    stopAll,
    dispose() { closed = true; return stopAll(); },
  });
}
