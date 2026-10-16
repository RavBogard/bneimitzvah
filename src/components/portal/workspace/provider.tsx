"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { parseSession, PortalRequestError, requestPortal, roleNames, type SessionSummary } from "../api";
import { workspaceApi, type Assigned, type Context, type ReadingMode } from "./api";
import { PracticeCoordinator } from "./practice";
import { fetchStudyPage, type StudyKind, type StudyPage } from "./study/api";
import { fetchWork, type WorkOperation, type WorkPage, type WorkHistory, type WorkReceipt, type WorkRecovery } from "./work/api";

export const rolePaths = { student: "/workspace/student", parent: "/workspace/parent", tutor: "/workspace/tutor", admin: "/workspace/admin/students" } as const;
type WorkLifecycle = { pause(): void; clear(): void; settle(): Promise<void>; hasUnsaved(): boolean; reveal(): void };
type Workspace = {
  summary: SessionSummary; context: Context | null; epoch: number; busy: boolean; notice: string;
  selectChild(id: string): Promise<void>; exitPractice(): Promise<void>; refresh(): void;
  read(mode: ReadingMode, id: string, signal: AbortSignal): Promise<Assigned>;
  readVerified(mode: ReadingMode, id: string, signal: AbortSignal): Promise<Assigned>;
  readStudy(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal): Promise<StudyPage>;
  readWork(baseline: Assigned, kind: StudyKind, operation: WorkOperation, signal: AbortSignal): Promise<WorkPage | WorkHistory | WorkReceipt | WorkRecovery>;
  registerWork(value: WorkLifecycle): () => void;
  completeWork(value: WorkLifecycle): void;
  registerDeparture(guard: () => Promise<boolean>): () => void;
  guardDeparture(): Promise<boolean>;
  registerReload(reload: () => Promise<void>): () => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error("Workspace unavailable"); return value; }
export const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;
const isParentPath = (path: string) => path === rolePaths.parent || path.startsWith("/workspace/practice/");

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter(), pathname = usePathname();
  const coordinator = useRef<PracticeCoordinator | null>(null);
  if (!coordinator.current) coordinator.current = new PracticeCoordinator();
  const practice = coordinator.current;
  const [summary, setSummary] = useState<SessionSummary | null>(null), [failure, setFailure] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const checkingRef = useRef(true);
  const [context, setContext] = useState<Context | null>(null), [busy, setBusy] = useState(false), [epoch, setEpoch] = useState(0), [notice, setNotice] = useState("");
  const [workNotice, setWorkNotice] = useState("");
  const sequence = useRef(0), currentPath = useRef(pathname), routeRevision = useRef(0), sessionAbort = useRef<AbortController | null>(null);
  const binding = useRef<string | null>(null), reloaders = useRef(new Set<() => Promise<void>>());
  const work = useRef(new Set<WorkLifecycle>()), departures = useRef(new Set<() => Promise<boolean>>());
  const completeWork = useCallback((value: WorkLifecycle) => { if (!checkingRef.current && work.current.has(value)) value.reveal(); }, []);
  const registerWork = useCallback((value: WorkLifecycle) => { work.current.add(value); return () => {
    if (value.hasUnsaved()) setWorkNotice("The view changed unexpectedly. Unsent work in the previous view was discarded; an unconfirmed request may have saved. Work cannot be restored after leaving the tab.");
    work.current.delete(value);
  }; }, []);
  const registerDeparture = useCallback((guard: () => Promise<boolean>) => { departures.current.add(guard); return () => { departures.current.delete(guard); }; }, []);
  const guardDeparture = useCallback(async () => { for (const guard of departures.current) if (!await guard()) return false; return true; }, []);
  const clearWork = useCallback(() => { work.current.forEach(value => value.clear()); }, []);
  const registerReload = useCallback((reload: () => Promise<void>) => { reloaders.current.add(reload); return () => { reloaders.current.delete(reload); }; }, []);
  if (currentPath.current !== pathname) { currentPath.current = pathname; routeRevision.current++; }
  const visibleNotice = isParentPath(pathname) ? notice : "";

  const refresh = useCallback(() => {
    const turn = ++sequence.current;
    sessionAbort.current?.abort();
    const request = new AbortController(); sessionAbort.current = request;
    checkingRef.current = true; practice.pause(); work.current.forEach(value => value.pause()); setChecking(true); setFailure(null);
    void (async () => {
      const next = parseSession(await requestPortal("/api/session", undefined, request.signal));
      if (request.signal.aborted || turn !== sequence.current) return;
      const sameBinding = binding.current === next.sessionBinding;
      if (binding.current && !sameBinding) {
        clearWork();
        practice.invalidate(); setContext(null);
        if (!practice.pending) try { await practice.exit(); } catch { /* Exact stale-session cleanup only; never restore the old subtree. */ }
      }
      const active = practice.selection;
      if (active) {
        const matchingPath = currentPath.current === `/workspace/practice/${active.context.studentId}`;
        if (!matchingPath || !next.roles.includes("parent")) {
          practice.invalidate();
          try { await practice.exit(); } catch {
            if (!request.signal.aborted && turn === sequence.current && isParentPath(currentPath.current)) setNotice("Practice was closed in this tab. Its server outcome could not be confirmed; other tabs were not changed.");
          }
        } else {
          const practiceGeneration = practice.generation, practicePath = `/workspace/practice/${active.context.studentId}`;
          try {
            await workspaceApi.reading("child-practice", active.context.studentId, active, request.signal);
            if (Date.parse(active.context.expiresAt) <= Date.now()) throw new PortalRequestError(404);
          } catch (error) {
            if (![403, 404].includes(statusOf(error))) throw error;
            if (request.signal.aborted || turn !== sequence.current || practice.generation !== practiceGeneration || practice.selection?.context.id !== active.context.id || currentPath.current !== practicePath) return;
            clearWork(); practice.invalidate(); setContext(null); setEpoch(value => value + 1);
            setNotice("Practice access changed. Choose an available child again.");
            // Keep checking/hidden until this route's fresh session and roster finish.
            router.replace("/workspace/parent"); return;
          }
        }
      }
      if (request.signal.aborted || turn !== sequence.current) return;
      if (sameBinding) { await Promise.all([...work.current].map(value => value.settle())); await Promise.all([...reloaders.current].map(reload => reload())); }
      if (request.signal.aborted || turn !== sequence.current) return;
      binding.current = next.sessionBinding;
      checkingRef.current = false; work.current.forEach(value => value.reveal());
      setContext(practice.selection?.context ?? null); setSummary(next); setChecking(false);
    })().catch(error => {
      if (request.signal.aborted || turn !== sequence.current) return;
      clearWork(); practice.invalidate(); binding.current = null; setSummary(null); setContext(null); setChecking(false); setFailure(statusOf(error));
    });
  }, [practice, clearWork, router]);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
      else { sequence.current++; sessionAbort.current?.abort(); checkingRef.current = true; practice.pause(); work.current.forEach(value => value.pause()); setChecking(true); }
    };
    const shown = () => refresh();
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", shown); document.addEventListener("visibilitychange", visible);
    return () => {
      sequence.current++; sessionAbort.current?.abort(); clearWork(); practice.invalidate();
      if (!practice.pending) void practice.exit().catch(() => undefined);
      window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", shown); document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, practice, clearWork]);
  useEffect(() => { if (!isParentPath(pathname)) setNotice(""); refresh(); }, [pathname, refresh]);
  useEffect(() => {
    if (!context) return;
    const remaining = Math.max(0, Date.parse(context.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      if (practice.selection?.context.id !== context.id) return;
      clearWork(); practice.invalidate(); setContext(null); setEpoch(value => value + 1);
      if (currentPath.current === `/workspace/practice/${context.studentId}`) { setNotice("This practice session expired. Choose a child to enter again."); router.replace("/workspace/parent"); }
    }, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [context, practice, router, clearWork]);

  async function selectChild(id: string) {
    if (practice.pending) return;
    if (!await guardDeparture()) return;
    clearWork();
    const route = routeRevision.current;
    setBusy(true); setContext(null); setNotice(""); setEpoch(value => value + 1);
    try {
      const next = await practice.select(id);
      if (next && route === routeRevision.current) { setContext(next); router.push(`/workspace/practice/${next.studentId}`); }
    } catch {
      if (route === routeRevision.current) {
        setNotice("Practice selection couldn’t be confirmed. Choose a child again; no previous practice view has been restored.");
        router.replace("/workspace/parent");
      }
    } finally { setBusy(false); }
  }
  async function exitPractice() {
    if (practice.pending) return;
    if (!await guardDeparture()) return;
    clearWork();
    const route = routeRevision.current;
    setBusy(true); setContext(null); setEpoch(value => value + 1);
    try { await practice.exit(); if (route === routeRevision.current) setNotice("You’re back in your read-only parent view."); }
    catch { if (route === routeRevision.current) setNotice("This tab no longer has an active practice view. Its server closure could not be confirmed; choose a child again if needed."); }
    finally { setBusy(false); if (route === routeRevision.current) router.replace("/workspace/parent"); }
  }
  const read = useCallback(async (mode: ReadingMode, id: string, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection;
    if (mode === "child-practice" && (!active || active.context.studentId !== id)) throw new PortalRequestError(404);
    try {
      const value = await workspaceApi.reading(mode, id, mode === "child-practice" ? active! : undefined, signal);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error))) {
        practice.invalidate(); setContext(null); setNotice("Practice access changed. Choose an available child again."); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router]);
  const verifyWorkSession = useCallback(async (signal: AbortSignal) => {
    const expected = binding.current;
    const fresh = parseSession(await requestPortal("/api/session", undefined, signal));
    if (signal.aborted) throw new PortalRequestError(409);
    if (!expected || binding.current !== expected || fresh.sessionBinding !== expected) { clearWork(); throw new PortalRequestError(401); }
  }, [clearWork]);
  const readVerified = useCallback(async (mode: ReadingMode, id: string, signal: AbortSignal) => {
    await verifyWorkSession(signal);
    const value = await read(mode, id, signal);
    await verifyWorkSession(signal);
    return value;
  }, [read, verifyWorkSession]);
  const readStudy = useCallback(async (baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection, mode = baseline.mode, id = baseline.student.id;
    if (mode === "child-practice" && (!active || active.context.studentId !== id)) throw new PortalRequestError(404);
    try {
      const value = await fetchStudyPage(baseline, kind, offset, signal, mode === "child-practice" ? active! : undefined);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error))) {
        practice.invalidate(); setContext(null); setNotice("Practice access changed. Choose an available child again."); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router]);

  const readWork = useCallback(async (baseline: Assigned, kind: StudyKind, operation: WorkOperation, signal: AbortSignal) => {
    const generation = practice.generation, active = practice.selection, mode = baseline.mode, id = baseline.student.id;
    if (mode === "child-practice" && (!active || active.context.studentId !== id || active.context.id !== baseline.context?.id)) throw new PortalRequestError(404);
    try {
      if (operation.type === "recovery") await verifyWorkSession(signal);
      const value = await fetchWork(baseline, kind, operation, signal, mode === "child-practice" ? active! : undefined);
      if (operation.type === "recovery") await verifyWorkSession(signal);
      if (generation !== practice.generation || signal.aborted) throw new PortalRequestError(409);
      return value;
    } catch (error) {
      if (!signal.aborted && generation === practice.generation && mode === "child-practice" && currentPath.current === `/workspace/practice/${id}` && [401, 403, 404].includes(statusOf(error)) && !(operation.type === "receipt" && statusOf(error) === 404)) {
        clearWork(); practice.invalidate(); setContext(null); setNotice("Practice access changed. Choose an available child again."); setEpoch(value => value + 1); router.replace("/workspace/parent");
      }
      throw error;
    }
  }, [practice, router, clearWork, verifyWorkSession]);
  const controlledLink = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); void guardDeparture().then(leave => { if (leave) { clearWork(); router.push(href); } });
  };

  return <div className="portal-shell workspace-shell">
    <a className="skip-link" href="#workspace-main">Skip to workspace</a>
    <header className="portal-header"><Link className="portal-brand" href="/" onClick={event => controlledLink(event, "/")}>CRC B’nei Mitzvah</Link><Link href="/account" onClick={event => controlledLink(event, "/account")}>Account and sign out</Link></header>
    <main id="workspace-main" className="workspace-main">
      {(checking || !summary) && <section className="workspace-state" aria-live="polite"><h1>{failure === null ? "Checking your access" : failure === 401 ? "Sign in to continue" : failure === 403 || failure === 404 ? "Access has changed" : "Workspace unavailable"}</h1>
        <p>{failure === null ? "Your student information is hidden until access has been checked." : failure === 401 ? "Use the account on your invitation." : failure === 403 || failure === 404 ? "The requested access is not available. Your previous student view has been cleared." : "We couldn’t load the workspace. Please try again shortly."}</p>
        {failure === 401 ? <a className="button-primary" href="/sign-in">Sign in</a> : failure !== null && <button className="button-primary" onClick={refresh}>Check access again</button>}</section>
      }
      {summary && <div hidden={checking || failure !== null} inert={checking || failure !== null} aria-hidden={checking || failure !== null}>
        <WorkspaceContext.Provider key={summary.sessionBinding} value={{ summary, context, epoch, busy, notice: visibleNotice, selectChild, exitPractice, refresh, read, readVerified, readStudy, readWork, registerWork, completeWork, registerDeparture, guardDeparture, registerReload }}>
          <nav className="workspace-role-nav" aria-label="Workspace roles">{summary.roles.map(role => <Link key={role} href={rolePaths[role]} onClick={event => controlledLink(event, rolePaths[role])} aria-current={pathname === rolePaths[role] ? "page" : undefined}>{roleNames[role]}</Link>)}</nav>
          {visibleNotice && <p className="workspace-notice" role="status">{visibleNotice}</p>}
          {workNotice && <p className="workspace-notice" role="status">{workNotice}</p>}
          {children}
        </WorkspaceContext.Provider></div>}
    </main>
    <footer className="portal-footer"><span>Learning at Central Reform Congregation</span><span>Access is checked for each request.</span></footer>
  </div>;
}

export function WorkspaceLink({ href, children }: { href: string; children: ReactNode }) {
  const { guardDeparture } = useWorkspace(), router = useRouter();
  return <Link href={href} onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void guardDeparture().then(leave => { if (leave) router.push(href); }); }}>{children}</Link>;
}

export function RequireRole({ role, children }: { role: keyof typeof rolePaths; children: ReactNode }) {
  const { summary } = useWorkspace();
  return summary.roles.includes(role) ? children : <section className="workspace-state"><h1>Role unavailable</h1><p>This account doesn’t have that access. Choose one of your available roles.</p><a href="/workspace">Choose a role</a></section>;
}
