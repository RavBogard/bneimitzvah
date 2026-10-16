"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { parseSession, PortalRequestError, requestPortal, roleNames, type SessionSummary } from "../api";
import { workspaceApi, type Assigned, type Context, type ReadingMode } from "./api";
import { PracticeCoordinator } from "./practice";
import { fetchStudyPage, type StudyKind, type StudyPage } from "./study/api";

export const rolePaths = { student: "/workspace/student", parent: "/workspace/parent", tutor: "/workspace/tutor", admin: "/workspace/admin/students" } as const;
type Workspace = {
  summary: SessionSummary; context: Context | null; epoch: number; busy: boolean; notice: string;
  selectChild(id: string): Promise<void>; exitPractice(): Promise<void>; refresh(): void;
  read(mode: ReadingMode, id: string, signal: AbortSignal): Promise<Assigned>;
  readStudy(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal): Promise<StudyPage>;
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
  const [context, setContext] = useState<Context | null>(null), [busy, setBusy] = useState(false), [epoch, setEpoch] = useState(0), [notice, setNotice] = useState("");
  const sequence = useRef(0), currentPath = useRef(pathname), routeRevision = useRef(0), sessionAbort = useRef<AbortController | null>(null);
  const binding = useRef<string | null>(null), reloaders = useRef(new Set<() => Promise<void>>());
  const registerReload = useCallback((reload: () => Promise<void>) => { reloaders.current.add(reload); return () => { reloaders.current.delete(reload); }; }, []);
  if (currentPath.current !== pathname) { currentPath.current = pathname; routeRevision.current++; }
  const visibleNotice = isParentPath(pathname) ? notice : "";

  const refresh = useCallback(() => {
    const turn = ++sequence.current;
    sessionAbort.current?.abort();
    const request = new AbortController(); sessionAbort.current = request;
    practice.pause(); setChecking(true); setFailure(null);
    void (async () => {
      const next = parseSession(await requestPortal("/api/session", undefined, request.signal));
      if (request.signal.aborted || turn !== sequence.current) return;
      const sameBinding = binding.current === next.sessionBinding;
      if (binding.current && !sameBinding) {
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
          await workspaceApi.reading("child-practice", active.context.studentId, active, request.signal);
          if (Date.parse(active.context.expiresAt) <= Date.now()) throw new PortalRequestError(404);
        }
      }
      if (request.signal.aborted || turn !== sequence.current) return;
      if (sameBinding) await Promise.all([...reloaders.current].map(reload => reload()));
      if (request.signal.aborted || turn !== sequence.current) return;
      binding.current = next.sessionBinding;
      setContext(practice.selection?.context ?? null); setSummary(next); setChecking(false);
    })().catch(error => {
      if (request.signal.aborted || turn !== sequence.current) return;
      practice.invalidate(); binding.current = null; setSummary(null); setContext(null); setChecking(false); setFailure(statusOf(error));
    });
  }, [practice]);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
      else { sequence.current++; sessionAbort.current?.abort(); practice.pause(); setChecking(true); }
    };
    const shown = () => refresh();
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", shown); document.addEventListener("visibilitychange", visible);
    return () => {
      sequence.current++; sessionAbort.current?.abort(); practice.invalidate();
      if (!practice.pending) void practice.exit().catch(() => undefined);
      window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", shown); document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, practice]);
  useEffect(() => { if (!isParentPath(pathname)) setNotice(""); refresh(); }, [pathname, refresh]);
  useEffect(() => {
    if (!context) return;
    const remaining = Math.max(0, Date.parse(context.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      if (practice.selection?.context.id !== context.id) return;
      practice.invalidate(); setContext(null); setEpoch(value => value + 1);
      if (currentPath.current === `/workspace/practice/${context.studentId}`) { setNotice("This practice session expired. Choose a child to enter again."); router.replace("/workspace/parent"); }
    }, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [context, practice, router]);

  async function selectChild(id: string) {
    if (practice.pending) return;
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

  return <div className="portal-shell workspace-shell">
    <a className="skip-link" href="#workspace-main">Skip to workspace</a>
    <header className="portal-header"><Link className="portal-brand" href="/">CRC B’nei Mitzvah</Link><Link href="/">Account and sign out</Link></header>
    <main id="workspace-main" className="workspace-main">
      {(checking || !summary) && <section className="workspace-state" aria-live="polite"><h1>{failure === null ? "Checking your access" : failure === 401 ? "Sign in to continue" : failure === 403 || failure === 404 ? "Access has changed" : "Workspace unavailable"}</h1>
        <p>{failure === null ? "Your student information is hidden until access has been checked." : failure === 401 ? "Use the account on your invitation." : failure === 403 || failure === 404 ? "The requested access is not available. Your previous student view has been cleared." : "We couldn’t load the workspace. Please try again shortly."}</p>
        {failure === 401 ? <a className="button-primary" href="/sign-in">Sign in</a> : failure !== null && <button className="button-primary" onClick={refresh}>Check access again</button>}</section>
      }
      {summary && <div hidden={checking || failure !== null} inert={checking || failure !== null} aria-hidden={checking || failure !== null}>
        <WorkspaceContext.Provider key={summary.sessionBinding} value={{ summary, context, epoch, busy, notice: visibleNotice, selectChild, exitPractice, refresh, read, readStudy, registerReload }}>
          <nav className="workspace-role-nav" aria-label="Workspace roles">{summary.roles.map(role => <Link key={role} href={rolePaths[role]} aria-current={pathname === rolePaths[role] ? "page" : undefined}>{roleNames[role]}</Link>)}</nav>
          {visibleNotice && <p className="workspace-notice" role="status">{visibleNotice}</p>}
          {children}
        </WorkspaceContext.Provider></div>}
    </main>
    <footer className="portal-footer"><span>Learning at Central Reform Congregation</span><span>Access is checked for each request.</span></footer>
  </div>;
}

export function RequireRole({ role, children }: { role: keyof typeof rolePaths; children: ReactNode }) {
  const { summary } = useWorkspace();
  return summary.roles.includes(role) ? children : <section className="workspace-state"><h1>Role unavailable</h1><p>This account doesn’t have that access. Choose one of your available roles.</p><a href="/workspace">Choose a role</a></section>;
}
