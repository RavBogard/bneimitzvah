"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPhraseAudio, type PhraseAudio } from "../../lib/learn/phrase-audio";
import { browserProgressStore, emptyProgress, localDay, PROGRESS_KEY, type Progress, type ProgressStore } from "../../lib/learn/progress";
import { createProgressSync, SYNC_KEY, type Account, type ProgressSync } from "./progress-sync";
import { createClipPlayer, type ClipPlayer, type PlayerState } from "./player";
import { createVerseLoader, type VerseLoader } from "./verses-api";
import { WordCardScope } from "./word-card";
import { directLearningFetch, waitingForLearningScope, type LearningTransport } from "./child-practice";
import { useLearningTransport } from "./scoped-learning";

/** One loader, one phrase cache and one audio element per course page; stopped when the page hides. The page's one word card lives here too. */
type Services = Readonly<{ loader: VerseLoader; audio: PhraseAudio; player: ClipPlayer }>;
const Context = createContext<Services | null>(null);

export function LearnServices({ children }: { children: ReactNode }) {
  const ref = useRef<Services | null>(null);
  if (!ref.current) {
    const loader = createVerseLoader(), audio = createPhraseAudio({ load: loader.load, preferShermet: true });
    ref.current = Object.freeze({ loader, audio, player: createClipPlayer(audio) });
  }
  const services = ref.current;
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") services.player.stop(); }, leave = () => services.player.stop();
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); services.player.stop(); };
  }, [services]);
  return <Context.Provider value={services}><WordCardScope>{children}<LearnRecordingCredit /></WordCardScope></Context.Provider>;
}
function LearnRecordingCredit() {
  const state = usePlayerState();
  if (!state.source || !["playing", "paused"].includes(state.status)) return null;
  return <p aria-live="polite">{state.source === "shermet" ? <><a href="https://www.templeisraelomaha.com/cantors-classroom" target="_blank" rel="noreferrer">Cantor Wendy Shermet · Temple Israel, Omaha</a> · Binder/Schleifer</> : <><a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noreferrer">PocketTorah</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>. Shermet timing is unavailable for this selection.</>}</p>;
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
type ProgressHub = { state: ProgressState; listeners: Set<() => void>; store: ProgressStore; sync: ProgressSync };
let shared: ProgressHub | null = null;
const childHubs = new WeakMap<LearningTransport, ProgressHub>();
const UNLOADED: ProgressState = Object.freeze({ progress: null, account: Object.freeze({ state: "unknown" as const }) });
function progressHub(child: LearningTransport | null) {
  const existing = child ? childHubs.get(child) : shared;
  if (existing) return existing;
  const storage = child?.storage ?? (() => { try { return window.localStorage; } catch { return null; } });
  const store = browserProgressStore(storage), listeners = new Set<() => void>();
  const hub = { state: UNLOADED, listeners, store, sync: null as unknown as ProgressSync };
  const set = (patch: Partial<ProgressState>) => { hub.state = Object.freeze({ ...hub.state, ...patch }); for (const listener of listeners) listener(); };
  hub.sync = createProgressSync({ fetch: child?.fetch ?? directLearningFetch, storage, store, accountOnly: child !== null, ownerScoped: child?.ownerScoped,
    onProgress: progress => set({ progress }), onAccount: account => set({ account }) });
  hub.state = Object.freeze({ progress: store.load(), account: hub.state.account });
  if (child) childHubs.set(child, hub); else shared = hub;
  void hub.sync.start();
  const flush = () => hub.sync.flush();
  const hide = () => { if (document.visibilityState !== "visible") flush(); };
  const reconnect = () => { void hub.sync.start(); };
  const key = child?.storageKey ?? ((name: string) => name);
  const changed = (event: StorageEvent) => {
    if (!hub.sync.frozen && (event.key === null || event.key === key(PROGRESS_KEY) || event.key === key(SYNC_KEY))) set({ progress: store.load() });
  };
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", flush);
  window.addEventListener("online", reconnect);
  window.addEventListener("storage", changed);
  child?.onClose(() => {
    flush();
    document.removeEventListener("visibilitychange", hide);
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("online", reconnect);
    window.removeEventListener("storage", changed);
  });
  return hub;
}
export function useProgress() {
  const child = useLearningTransport();
  const { progress, account } = useSyncExternalStore(
    listener => { if (!child && waitingForLearningScope()) return () => {}; const hub = progressHub(child); hub.listeners.add(listener); return () => { hub.listeners.delete(listener); }; },
    () => !child && waitingForLearningScope() ? UNLOADED : progressHub(child).state, () => UNLOADED);
  const update = useCallback((change: (value: Progress) => Progress) => {
    // The stored copy is the working copy: another tab may have saved since this one last read it. A frozen tab (the
    // browser's copy is another account's now) keeps its change on this page only and saves nothing into that copy.
    if (!child && waitingForLearningScope()) return;
    const hub = progressHub(child), next = change(hub.sync.frozen ? hub.state.progress ?? emptyProgress() : hub.store.load());
    hub.sync.record(next); hub.state = Object.freeze({ ...hub.state, progress: next }); for (const listener of hub.listeners) listener();
  }, [child]);
  /** A signed-in student's ceremony: review gaps close in on it. */
  const until = account.state === "synced" ? account.until : null;
  return { progress, update, account, until, today: () => localDay(Date.now()), fresh: emptyProgress };
}
