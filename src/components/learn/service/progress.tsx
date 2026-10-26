"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { browserProgressStore, emptyProgress, PROGRESS_KEY, type Progress, type ProgressStore } from "../../../lib/service-course/progress";
import { parsePath, type Path } from "../../../lib/service-course/path";
import { createProgressSync, GUEST_KEY, SYNC_KEY, type Account, type ProgressSync } from "./progress-sync";

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
  made.state = Object.freeze({ progress: made.sync.load(), account: made.state.account });
  hub = made;
  void made.sync.start();
  const hide = () => { if (document.visibilityState !== "visible") made.sync.flush(); };
  document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", () => made.sync.flush());
  // Back online: the account's copy and this device's meet again.
  window.addEventListener("online", () => { void made.sync.start(); });
  // Another tab saved: show what it saved, unless another account owns the device now (then this tab is frozen).
  window.addEventListener("storage", event => { if ((event.key === null || event.key === PROGRESS_KEY || event.key === SYNC_KEY || event.key === GUEST_KEY) && made.sync.writable) set({ progress: made.sync.load() }); });
  return made;
}
/**
 * One local change: the stored copy is the working copy (another tab may have saved since this one last read it). A tab another
 * account has taken the device from saves nothing, so whoever uses that tab next cannot write into the other account's copy.
 */
export function writeLocal(store: ProgressStore, sync: Pick<ProgressSync, "writable" | "changed" | "stamp" | "apart" | "guest" | "record">, change: (value: Progress) => Progress, completed?: string): Progress | null {
  if (!sync.writable) return null;
  // A marker here but no account this page may count work for (signed out, refused, another tab's account): the work is signed-out
  // work, kept in the set-aside copy and never sent (2.0 SC5a review).
  if (sync.apart) { const next = change(sync.guest.load()); sync.guest.save(next); return next; }
  // `stamp`: the account a lesson finished now counts for, or null with no marker (progress-sync.ts).
  const stamp = sync.stamp, next = change(store.load());
  store.save(next);
  if (stamp !== null && completed !== undefined && Object.hasOwn(next.lessons, completed)) sync.record(completed, stamp);
  sync.changed();
  return next;
}
export function useServiceProgress() {
  const { progress, account } = useSyncExternalStore(listener => { const h = progressHub(); h.listeners.add(listener); return () => { h.listeners.delete(listener); }; }, () => progressHub().state, () => UNLOADED);
  /** `completed`: the lesson this change finishes, so it can count for the account (2.0 SC5a). */
  const update = useCallback((change: (value: Progress) => Progress, completed?: string) => {
    const h = progressHub(), next = writeLocal(h.store, h.sync, change, completed);
    if (!next) return;
    h.state = Object.freeze({ ...h.state, progress: next });
    for (const listener of h.listeners) listener();
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
