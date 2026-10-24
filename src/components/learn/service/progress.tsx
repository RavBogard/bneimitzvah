"use client";
import { useCallback, useSyncExternalStore } from "react";
import { browserProgressStore, emptyProgress, PROGRESS_KEY, type Progress, type ProgressStore } from "../../../lib/service-course/progress";

/**
 * The learner's progress in this browser: one store, one snapshot per page, shared by every component that asks.
 * Signed in or not, this slice keeps progress on the device; the account's copy arrives with the sync slice.
 */
type State = Readonly<{ progress: Progress | null }>;
const UNLOADED: State = Object.freeze({ progress: null });
let hub: { state: State; listeners: Set<() => void>; store: ProgressStore } | null = null;
function progressHub() {
  if (hub) return hub;
  const store = browserProgressStore(), listeners = new Set<() => void>();
  const made = { state: Object.freeze({ progress: store.load() }) as State, listeners, store };
  hub = made;
  const set = (progress: Progress) => { made.state = Object.freeze({ progress }); for (const listener of listeners) listener(); };
  // Another tab saved: show what it saved.
  window.addEventListener("storage", event => { if (event.key === null || event.key === PROGRESS_KEY) set(store.load()); });
  return made;
}
export function useServiceProgress() {
  const { progress } = useSyncExternalStore(listener => { const h = progressHub(); h.listeners.add(listener); return () => { h.listeners.delete(listener); }; }, () => progressHub().state, () => UNLOADED);
  const update = useCallback((change: (value: Progress) => Progress) => {
    // The stored copy is the working copy: another tab may have saved since this one last read it.
    const h = progressHub(), next = change(h.store.load());
    h.store.save(next); h.state = Object.freeze({ progress: next });
    for (const listener of h.listeners) listener();
  }, []);
  return { progress, update, fresh: emptyProgress };
}
