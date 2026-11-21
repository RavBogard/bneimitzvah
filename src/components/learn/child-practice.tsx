"use client";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { childLearnHref, childLearnPath, CHILD_LEARN_RESUME, isLearnPath, PERSONAL_STUDY_PARAM, PRACTICE_STUDENT_HEADER } from "../../lib/learn/child-practice";
import { childPracticePartition, continueOfflineChildPractice, forgetChildPracticeLease, readPracticeLease, stampChildPracticeHistory, type PracticeLease } from "../../lib/offline/practice-lease";
import { purgeGeneration, subscribeOfflineState } from "../../lib/offline/pack-index";
import { servedOffline } from "../../lib/offline/signal";
import { PortalRequestError } from "../portal/api";
import { workspaceApi, type Assigned, type Selection } from "../portal/workspace/api";
import { tabPractice } from "../portal/workspace/practice";

type LearningStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type LearningTransport = Readonly<{
  fetch: typeof fetch; ownerScoped?: boolean; storage(): LearningStorage | null; storageKey(key: string): string; onClose(action: () => void): void; close?(): void;
}>;
export type ChildLearning = LearningTransport & Readonly<{ selection: Selection; assigned: Assigned }>;
const Context = createContext<ChildLearning | null>(null);
const OfflineContext = createContext<{ transport: LearningTransport; lease: PracticeLease } | null>(null);
export const useOfflineChildLearning = () => useContext(OfflineContext);
export const useChildLearning = () => useContext(Context);
const denied = (status: number) => [401, 403, 404].includes(status);

const routeListeners = new Set<() => void>();
const watchRoute = (listen: () => void) => { routeListeners.add(listen); return () => { routeListeners.delete(listen); }; };
export const useLearningSearch = () => useSyncExternalStore(watchRoute, () => window.location.search, () => "");

export function waitingForLearningScope() {
  if (typeof window === "undefined") return false;
  // The incoming Learn tree can render before Next commits the browser URL.
  if (tabPractice().selection !== null) return true;
  return isLearnPath(location.pathname) && (childLearnPath(location.pathname, location.search)
    || new URLSearchParams(location.search).get(PERSONAL_STUDY_PARAM) === "1");
}

/** A direct hub may still exist from an earlier client route. Pause its transport during scoped study. */
export const directLearningFetch: typeof fetch = (url, init) =>
  waitingForLearningScope() ? Promise.resolve(new Response(null, { status: 503 })) : fetch(url, init);

export function PracticeNavigationGuard() {
  const path = usePathname(), query = useSearchParams(), router = useRouter();
  const previousPath = useRef(path);
  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = path;
    for (const listen of routeListeners) listen();
    const practice = tabPractice(), selection = practice.selection;
    if (!selection || path === `/workspace/practice/${selection.context.studentId}`) return;
    if (isLearnPath(path)) {
      if (!childLearnPath(path, window.location.search)) {
        router.replace(childLearnHref(`${path}${location.search}${location.hash}`));
      }
      return;
    }
    // A selection can finish while the parent route is still rendering. Only
    // a departure from practice may close it, never a query change on that route.
    if (previous === path || !(previous.startsWith("/workspace/practice/") || isLearnPath(previous))) return;
    practice.invalidate();
    if (!practice.pending) void practice.exit().catch(() => undefined);
  }, [path, query, router]);
  return null;
}


function childStorage(partition: string): Pick<LearningTransport, "storage" | "storageKey"> {
  const storageKey = (key: string) => partition + key, fallback = new Map<string, string>();
  const browserStore: LearningStorage = {
    getItem(key) {
      if (fallback.has(key)) return fallback.get(key)!;
      try { return window.localStorage.getItem(storageKey(key)); } catch { return null; }
    },
    setItem(key, value) {
      try { window.localStorage.setItem(storageKey(key), value); fallback.delete(key); } catch { fallback.set(key, value); }
    },
    removeItem(key) {
      fallback.delete(key);
      try { window.localStorage.removeItem(storageKey(key)); } catch { /* Storage is unavailable. */ }
    },
  };
  return { storage: () => browserStore, storageKey };
}

export function ChildPracticeLearn({ children }: { children: ReactNode }) {
  const path = usePathname(), search = useLearningSearch(), router = useRouter();
  const [mounted, setMounted] = useState(false), [scope, setScope] = useState<ChildLearning | null>(null);
  const [unavailable, setUnavailable] = useState(false), [retry, setRetry] = useState(0);
  const [offline, setOffline] = useState<{ transport: LearningTransport; lease: PracticeLease } | null>(null);
  const route = useRef(path); route.current = path;
  useEffect(() => setMounted(true), []);
  const child = mounted && (childLearnPath(path, search) || isLearnPath(path) && tabPractice().selection !== null);

  useEffect(() => {
    if (!child) return;
    const practice = tabPractice(), selection = practice.selection;
    let live = true;
    const close = new Set<() => void>(), abort = new AbortController();
    const current = () => live && practice.selection?.context.id === selection?.context.id;
    const end = () => {
      if (!current()) return;
      setScope(null);
      setOffline(null);
      practice.invalidate();
      if (!practice.pending) void practice.exit().catch(() => undefined);
      router.replace(`/mine?${CHILD_LEARN_RESUME}=1`);
    };
    const expired = () => { setOffline(null); setUnavailable(true); };
    let offlineExpiry: ReturnType<typeof setTimeout> | undefined;
    const pack = () => route.current === "/learn/service" || route.current.startsWith("/learn/service/") ? "service" : "course";
    const openOffline = async () => {
      const lease = await readPracticeLease("child", pack());
      if (!current()) return;
      if (!lease?.partition || route.current === "/learn/run-through") { expired(); return; }
      clearTimeout(offlineExpiry);
      offlineExpiry = setTimeout(expired, Math.max(0, lease.expiresAt - Date.now()));
      setOffline({ lease, transport: {
        ...childStorage(lease.partition), ownerScoped: true, fetch: async () => new Response(null, { status: 503 }),
        onClose: action => { close.add(action); },
      } });
    };
    const navigateOffline = (event: MouseEvent) => {
      if (!servedOffline() || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || !isLearnPath(url.pathname) || url.hash) return;
      event.preventDefault();
      const destination = childLearnHref(`${url.pathname}${url.search}`);
      if (!continueOfflineChildPractice(destination)) location.assign(destination);
    };
    const watchPurge = subscribeOfflineState(() => { if (purgeGeneration() !== generation) { forgetChildPracticeLease(); expired(); } });
    const generation = purgeGeneration();
    if (!selection) {
      if (!servedOffline()) { watchPurge(); end(); return; }
      setUnavailable(false);
      void openOffline();
      window.addEventListener("online", end);
      document.addEventListener("click", navigateOffline, true);
      return () => {
        live = false; watchPurge(); clearTimeout(offlineExpiry);
        window.removeEventListener("online", end); document.removeEventListener("click", navigateOffline, true);
        for (const action of close) action();
        setOffline(null);
      };
    }
    if (Date.parse(selection.context.expiresAt) <= Date.now()) { watchPurge(); end(); return; }
    const { studentId, expiresAt } = selection.context;
    const assigned = () => workspaceApi.reading("child-practice", studentId, selection, abort.signal);
    const confirm = () => {
      if (!current() || document.visibilityState !== "visible") return;
      void assigned().catch(error => { if (error instanceof PortalRequestError && denied(error.status)) end(); });
    };
    let openedOnline = false;
    const reconnect = () => { if (openedOnline) confirm(); else if (current()) setRetry(value => value + 1); };
    const expiry = setTimeout(end, Math.max(0, Date.parse(expiresAt) - Date.now()));
    const refresh = setInterval(confirm, 60_000);
    document.addEventListener("visibilitychange", confirm);
    window.addEventListener("online", reconnect);
    setUnavailable(false);
    void (async () => {
      try {
        const reading = await assigned();
        const partition = await childPracticePartition(studentId);
        if (!current()) return;
        const browser = childStorage(partition);
        stampChildPracticeHistory(partition);
        const verifiedFetch: typeof fetch = async (url, init) => {
          if (!current()) return new Response(null, { status: 404 });
          const headers = new Headers(init?.headers);
          headers.set("X-Practice-Context", selection.handle);
          headers.set(PRACTICE_STUDENT_HEADER, studentId);
          const response = await fetch(url, { ...init, headers });
          if (denied(response.status)) end();
          return current() ? response : new Response(null, { status: 404 });
        };
        openedOnline = true;
        setOffline(null);
        setScope({ selection, assigned: reading, ownerScoped: true, fetch: verifiedFetch, ...browser, onClose: action => { close.add(action); } });
      } catch (error) {
        if (error instanceof PortalRequestError && denied(error.status)) end();
        else if (current()) { if (servedOffline()) void openOffline(); else setUnavailable(true); }
      }
    })();

    // Most public course links are ordinary anchors for the offline reader. In a verified child
    // session, keep same-tab course links in the client router so the handle stays in memory.
    const navigate = (event: MouseEvent) => {
      if (servedOffline()) { navigateOffline(event); return; }
      if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname === route.current && url.hash && url.search === location.search) return;
      const assignedPath = `/workspace/practice/${studentId}`;
      if (url.pathname !== assignedPath && !isLearnPath(url.pathname)) return;
      event.preventDefault();
      const dest = `${url.pathname}${url.search}${url.hash}`;
      router.push(url.pathname === assignedPath ? dest : childLearnHref(dest));
    };
    document.addEventListener("click", navigate, true);
    return () => {
      for (const action of close) action();
      live = false;
      abort.abort();
      clearTimeout(expiry);
      clearInterval(refresh); clearTimeout(offlineExpiry); watchPurge();
      document.removeEventListener("visibilitychange", confirm);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("click", navigate, true);
      setScope(null); setOffline(null);
    };
  }, [child, retry, router]);

  useEffect(() => {
    if (scope) stampChildPracticeHistory(scope.storageKey(""));
  }, [path, search, scope]);

  if (!child) return children;
  if (offline && !scope) return <OfflineContext.Provider value={offline}>
    <p className="workspace-notice" role="status">Offline practice. Reconnect and choose the same child to sync.</p>
    {children}
  </OfflineContext.Provider>;
  if (scope) return <Context.Provider value={scope} key={scope.selection.context.id}>
    <nav className="workspace-notice" aria-label="Child practice">
      <a href={`/workspace/practice/${scope.selection.context.studentId}`}>Back to <bdi dir="auto">{scope.assigned.student.firstName}</bdi>'s reading</a>
    </nav>
    {children}
  </Context.Provider>;
  return <main className="workspace-main"><section className="workspace-state" aria-live="polite" data-testid="child-learn-check">
    <h1>{unavailable ? "Practice is unavailable" : "Checking practice access"}</h1>
    {unavailable && <p>Reconnect and choose a child to resume practice.</p>}
    {unavailable && <button type="button" className="button-secondary" onClick={() => setRetry(n => n + 1)}>Check access again</button>}
    <p><a href={`/mine?${CHILD_LEARN_RESUME}=1`}>Choose a child</a></p>
  </section></main>;
}
