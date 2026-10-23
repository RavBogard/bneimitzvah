"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPhraseAudio, type PhraseAudio } from "../../lib/learn/phrase-audio";
import { browserProgressStore, emptyProgress, localDay, PROGRESS_KEY, type Progress, type ProgressStore } from "../../lib/learn/progress";
import { createProgressSync, SYNC_KEY, type Account, type ProgressSync } from "./progress-sync";
import { createClipPlayer, type ClipPlayer, type PlayerState } from "./player";
import { createVerseLoader, type VerseLoader } from "./verses-api";
import { WordCardScope } from "./word-card";

/** One loader, one phrase cache and one audio element per course page; stopped when the page hides. The page's one word card lives here too. */
type Services = Readonly<{ loader: VerseLoader; audio: PhraseAudio; player: ClipPlayer }>;
const Context = createContext<Services | null>(null);

export function LearnServices({ children }: { children: ReactNode }) {
  const ref = useRef<Services | null>(null);
  if (!ref.current) {
    const loader = createVerseLoader(), audio = createPhraseAudio({ load: loader.load });
    ref.current = Object.freeze({ loader, audio, player: createClipPlayer(audio) });
  }
  const services = ref.current;
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") services.player.stop(); }, leave = () => services.player.stop();
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); services.player.stop(); };
  }, [services]);
  return <Context.Provider value={services}><WordCardScope>{children}</WordCardScope></Context.Provider>;
}
export function useLearnServices(): Services {
  const value = useContext(Context); if (!value) throw new Error("Learn services missing");
  return value;
}
const idle: PlayerState = Object.freeze({ id: null, status: "idle", seconds: 0, part: 0 });
export function usePlayerState(): PlayerState {
  const { player } = useLearnServices();
  return useSyncExternalStore(player.subscribe, () => player.state, () => idle);
}

/**
 * The learner's progress: this browser's copy, and, when signed in with a live grant, the account's
 * (progress-sync.ts). One store and one sync per page, shared by every component that asks.
 */
type ProgressState = Readonly<{ progress: Progress | null; account: Account }>;
let shared: { state: ProgressState; listeners: Set<() => void>; store: ProgressStore; sync: ProgressSync } | null = null;
const UNLOADED: ProgressState = Object.freeze({ progress: null, account: Object.freeze({ state: "unknown" as const }) });
function progressHub() {
  if (shared) return shared;
  const store = browserProgressStore(), listeners = new Set<() => void>();
  const hub = { state: UNLOADED, listeners, store, sync: null as unknown as ProgressSync };
  const set = (patch: Partial<ProgressState>) => { hub.state = Object.freeze({ ...hub.state, ...patch }); for (const listener of listeners) listener(); };
  hub.sync = createProgressSync({ fetch: (...args) => fetch(...args), storage: () => { try { return window.localStorage; } catch { return null; } }, store,
    onProgress: progress => set({ progress }), onAccount: account => set({ account }) });
  hub.state = Object.freeze({ progress: store.load(), account: hub.state.account });
  shared = hub;
  void hub.sync.start();
  const hide = () => { if (document.visibilityState !== "visible") hub.sync.flush(); };
  document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", () => hub.sync.flush());
  // Another tab saved: show what it saved.
  window.addEventListener("storage", event => { if (event.key === null || event.key === PROGRESS_KEY || event.key === SYNC_KEY) set({ progress: store.load() }); });
  return hub;
}
function useProgressState(): ProgressState {
  return useSyncExternalStore(listener => { const hub = progressHub(); hub.listeners.add(listener); return () => { hub.listeners.delete(listener); }; },
    () => progressHub().state, () => UNLOADED);
}
export function useProgress() {
  const { progress, account } = useProgressState();
  const update = useCallback((change: (value: Progress) => Progress) => {
    // The stored copy is the working copy: another tab may have saved since this one last read it.
    const hub = progressHub(), next = change(hub.store.load());
    hub.store.save(next); hub.state = Object.freeze({ ...hub.state, progress: next }); for (const listener of hub.listeners) listener();
    hub.sync.changed();
  }, []);
  /** A signed-in student's ceremony: review gaps close in on it. */
  const until = account.state === "synced" ? account.until : null;
  return { progress, update, account, until, today: () => localDay(Date.now()), fresh: emptyProgress };
}
