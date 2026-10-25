"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { browserProgressStore, emptyProgress, PROGRESS_KEY, type Progress, type ProgressStore } from "../../../lib/service-course/progress";
import { parsePath, type Path } from "../../../lib/service-course/path";
import { createProgressSync, SYNC_KEY, type Account, type ProgressSync } from "./progress-sync";

/**
 * The learner's progress in the service course: this browser's copy, and, signed in with a live grant, the account's
 * (progress-sync.ts, 2.0 SC4). One store and one sync per page, shared by every component that asks, on Learn to lein's model
 * (components/learn/services.tsx).
 */
type State = Readonly<{ progress: Progress | null; account: Account }>;
const UNLOADED: State = Object.freeze({ progress: null, account: Object.freeze({ state: "unknown" as const }) });
let hub: { state: State; listeners: Set<() => void>; store: ProgressStore; sync: ProgressSync } | null = null;
function progressHub() {
  if (hub) return hub;
  const store = browserProgressStore(), listeners = new Set<() => void>();
  const made = { state: UNLOADED, listeners, store, sync: null as unknown as ProgressSync };
  const set = (patch: Partial<State>) => { made.state = Object.freeze({ ...made.state, ...patch }); for (const listener of listeners) listener(); };
  made.sync = createProgressSync({ fetch: (...args) => fetch(...args), storage: () => { try { return window.localStorage; } catch { return null; } }, store,
    onProgress: progress => set({ progress }), onAccount: account => set({ account }) });
  made.state = Object.freeze({ progress: store.load(), account: made.state.account });
  hub = made;
  void made.sync.start();
  const hide = () => { if (document.visibilityState !== "visible") made.sync.flush(); };
  document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", () => made.sync.flush());
  // Back online: the account's copy and this device's meet again.
  window.addEventListener("online", () => { void made.sync.start(); });
  // Another tab saved: show what it saved.
  window.addEventListener("storage", event => { if (event.key === null || event.key === PROGRESS_KEY || event.key === SYNC_KEY) set({ progress: store.load() }); });
  return made;
}
export function useServiceProgress() {
  const { progress, account } = useSyncExternalStore(listener => { const h = progressHub(); h.listeners.add(listener); return () => { h.listeners.delete(listener); }; }, () => progressHub().state, () => UNLOADED);
  const update = useCallback((change: (value: Progress) => Progress) => {
    // The stored copy is the working copy: another tab may have saved since this one last read it.
    const h = progressHub(), next = change(h.store.load());
    h.store.save(next); h.state = Object.freeze({ ...h.state, progress: next });
    for (const listener of h.listeners) listener();
    h.sync.changed();
  }, []);
  return { progress, account, update, fresh: emptyProgress };
}

/**
 * A signed-in student's own parts (2.0 SC4, A4 6.3), asked for once per page and only when the account is synced: signed out,
 * or an account that keeps no progress here, never asks. "none" is an account with no student of its own (a 403): no Your parts,
 * and nothing said. Kept in memory only; the offline copy is SC6's.
 */
export type PathView = Readonly<{ status: "idle" } | { status: "loading" } | { status: "none" } | { status: "error" } | { status: "ready"; path: Path }>;
const PATH_LIMIT = 64 * 1024;
export async function loadPath(fetcher: typeof fetch = (...args) => fetch(...args)): Promise<PathView> {
  try {
    const response = await fetcher("/api/learn/service/path", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { accept: "application/json" } });
    if (response.status === 401 || response.status === 403 || response.status === 404) return { status: "none" };
    if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return { status: "error" };
    const text = await response.text();
    if (text.length > PATH_LIMIT) return { status: "error" };
    const path = parsePath(JSON.parse(text));
    return path ? { status: "ready", path } : { status: "error" };
  } catch { return { status: "error" }; }
}
export function useServicePath(account: Account): PathView {
  const [view, setView] = useState<PathView>({ status: "idle" });
  const synced = account.state === "synced";
  useEffect(() => {
    if (!synced) { setView({ status: "idle" }); return; }
    let live = true;
    setView({ status: "loading" });
    void loadPath().then(next => { if (live) setView(next); });
    return () => { live = false; };
  }, [synced]);
  return view;
}
/** The lesson ids of a student's own path, when the home lists one (assigned, or the default six when there is no plan). */
export function pathLessons(view: PathView): readonly string[] | null {
  if (view.status !== "ready" || (view.path.state !== "assigned" && view.path.state !== "no-plan") || !view.path.items.length) return null;
  return view.path.items.map(item => item.lesson);
}
