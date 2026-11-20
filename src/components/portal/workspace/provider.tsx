"use client";
import { createDepartureGuards, type DeparturePurpose } from "./departure-guards";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { SessionSummary } from "../api";
import type { Context } from "./api";
import { createWorkspaceReads, statusOf, type WorkspaceReads } from "./workspace-reads";
import { useHeldSession } from "./session";
import { isParentPath, PRACTICE_ACCESS_CHANGED, usePracticeMode } from "./practice-mode";
import { TabBar, TabSkipLink } from "../shell/tab-bar";
import { adminArea } from "../shell/tabs";
import { SiteBar } from "../../site/site-bar";
import { rememberSignedIn } from "../signed-in-hint";
import { rolePaths } from "../shell/role-home";
import { StaffNav } from "../shell/staff-nav";

export { rolePaths, statusOf };
type WorkLifecycle = { pause(): void; clear(): void; settle(): Promise<void>; hasUnsaved(): boolean; reveal(): void };
type Workspace = WorkspaceReads & {
  summary: SessionSummary; context: Context | null;
  /** The view version: it changes whenever private state is dropped or a practice sitting changes. Pages key their loads on it. */
  epoch: number; busy: boolean; notice: string;
  selectChild(id: string): Promise<void>; exitPractice(child?: { id: string; firstName: string }): Promise<void>;
  /** Re-read the session, then have each registered page reload its data once. */
  refresh(): void;
  /** A page that made its own request reports a 401/403/404 here: the central handling in session.ts `denied`. */
  serviceAuthorityFailed(status: number): void;
  registerWork(value: WorkLifecycle): () => void;
  registerDeparture(guard: () => Promise<boolean>, purpose?: DeparturePurpose): () => void;
  guardDeparture(purpose?: DeparturePurpose): Promise<boolean>;
  registerReload(reload: () => Promise<void>): () => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error("Workspace unavailable"); return value; }
/** Shows a modal dialog while `open`. The private subtree is unmounted, never hidden, when access fails, so a modal goes with it. */
export function useWorkspaceModal(dialog: RefObject<HTMLDialogElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const node = dialog.current; if (!node) return;
    if (open) { if (!node.open) node.showModal(); }
    else if (node.open) node.close();
  }, [dialog, open]);
  return open;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter(), pathname = usePathname();
  const currentPath = useRef<string | null>(pathname); currentPath.current = pathname;
  // Leaving the workspace altogether (the Account page sits outside it): a late answer must not navigate from a page that is gone.
  useEffect(() => () => { currentPath.current = null; }, []);
  const version = useRef(0), [epoch, setEpoch] = useState(0);
  const bump = useCallback(() => { version.current++; setEpoch(version.current); }, []);

  // Pages register what must be dropped when the view's access ends (unsent work, open audio, drafts) and what to reload on refresh.
  const work = useRef(new Set<WorkLifecycle>()), departures = useRef(createDepartureGuards()), reloaders = useRef(new Set<() => Promise<void>>());
  const [workNotice, setWorkNotice] = useState("");
  const clearWork = useCallback(() => { work.current.forEach(value => value.clear()); }, []);
  const registerWork = useCallback((value: WorkLifecycle) => { work.current.add(value); return () => {
    if (value.hasUnsaved()) setWorkNotice("The view changed unexpectedly. Unsent work in the previous view was discarded; an unconfirmed request may have saved. Work cannot be restored after leaving the tab.");
    work.current.delete(value);
  }; }, []);
  const registerDeparture = useCallback((guard: () => Promise<boolean>, purpose?: DeparturePurpose) => departures.current.register(guard, purpose), []);
  const guardDeparture = useCallback((purpose?: DeparturePurpose) => departures.current.check(purpose), []);
  const registerReload = useCallback((reload: () => Promise<void>) => { reloaders.current.add(reload); return () => { reloaders.current.delete(reload); }; }, []);

  const practiceMode = usePracticeMode({ router, pathname, currentPath, clearWork, bump, guardDeparture });
  const { practice, close: closePractice } = practiceMode;
  /** Everything private in this tab goes: unsent work, the practice sitting (closed on the server too), and every keyed view. */
  const clearPrivate = useCallback(() => { clearWork(); closePractice(); bump(); }, [clearWork, closePractice, bump]);
  const session = useHeldSession(clearPrivate);
  const { summary, phase } = session;
  const sessionRef = useRef(session); sessionRef.current = session;

  // The reads are made once; they reach the current session and sitting through these getters.
  const reads = useRef<WorkspaceReads | null>(null), practiceRefused = useRef(practiceMode.practiceRefused); practiceRefused.current = practiceMode.practiceRefused;
  if (!reads.current) reads.current = createWorkspaceReads({ practice, version: () => version.current, sessionBinding: () => sessionRef.current.binding(),
    denied: () => sessionRef.current.denied(), practiceRefused: id => practiceRefused.current(id), clearWork: () => clearWork() });
  const serviceAuthorityFailed = useCallback((status: number) => { if ([401, 403, 404].includes(status)) sessionRef.current.denied(); }, []);
  const refresh = useCallback(() => {
    void sessionRef.current.refresh().then(same => {
      if (!same) return;
      for (const reload of [...reloaders.current]) reload().catch(error => { if ([401, 403].includes(statusOf(error))) sessionRef.current.denied(); });
    });
  }, []);

  // A parent without the parent role any more has no sitting.
  useEffect(() => { if (summary && !summary.roles.includes("parent") && practice.selection) closePractice(); }, [summary, practice, closePractice]);
  // From a failure state ("Access has changed", "Sign in to continue"), opening another page in the workspace checks again.
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    if (phase !== "ready" && phase !== "checking") sessionRef.current.retry();
  }, [pathname, phase]);
  const controlledLink = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); void guardDeparture().then(leave => { if (leave) { clearWork(); router.push(href); } });
  };

  const shellShown = Boolean(summary) && phase === "ready";
  // A held session is what the site bar on the public pages remembers (the same hint the reader's Save uses).
  useEffect(() => { if (shellShown) rememberSignedIn(true); }, [shellShown]);
  // Every sign-in (email link, code, Google) ends on /mine. An admin whose tab opens there from outside the site, or from the sign-in page, starts on This week instead;
  // My Readings stays one click away in the site bar, and a client-side move to /mine never redirects (only the tab's first page is judged).
  const firstPath = useRef(pathname), landingJudged = useRef(false);
  useEffect(() => {
    if (!shellShown || landingJudged.current) return;
    landingJudged.current = true;
    if (firstPath.current === "/mine" && summary!.roles.includes("admin") && !arrivedWithinSite()) router.replace(rolePaths.admin);
  }, [shellShown, summary, router]);
  const visibleNotice = isParentPath(pathname) ? practiceMode.notice : "";
  const failure = phase === "signed-out" ? 401 : phase === "access-changed" ? 403 : phase === "unavailable" ? 503 : null;
  return <div className="portal-shell workspace-shell" data-rail-pending={phase === "checking" && pathname !== "/mine" && adminArea(pathname) ? "" : undefined}>
    <a className="skip-link" href="#workspace-main">{pathname.startsWith("/mine") ? "Skip to main content" : "Skip to workspace"}</a>
    {shellShown && <TabSkipLink roles={summary!.roles} />}
    <SiteBar signedIn onNavigate={controlledLink} />
    <main id="workspace-main" className="workspace-main">
      {!shellShown && <section className="workspace-state" data-testid="workspace-state" data-workspace-state={phase} aria-live="polite"><h1>{failure === null ? "Checking your access" : failure === 401 ? "Sign in to continue" : failure === 403 ? "Access has changed" : "Workspace unavailable"}</h1>
        <p>{failure === null ? "Your student information is hidden until access has been checked." : failure === 401 ? "Sign in with the email address your invitation was sent to." : failure === 403 ? "The requested access is not available. Your previous student view has been cleared." : "We couldn’t load the workspace. Please try again shortly."}</p>
        {failure === 401 ? <a className="button-primary" href="/sign-in">Sign in</a> : failure !== null && <button className="button-primary" onClick={() => session.retry()}>Check access again</button>}
        {/* A parent who lands here from a child's page or a sitting keeps a way back to the shelf (finding 7). */}
        {failure !== null && failure !== 401 && isParentPath(pathname) && <a className="button-text" href="/mine">My Readings</a>}</section>
      }
      {/* The private subtree exists only while a session is held and ready. Any refusal or sign-out unmounts it at once. */}
      {shellShown && <WorkspaceContext.Provider key={summary!.sessionBinding} value={{ ...reads.current, summary: summary!, context: practiceMode.context, epoch, busy: practiceMode.busy, notice: visibleNotice,
        selectChild: practiceMode.selectChild, exitPractice: practiceMode.exitPractice, refresh, serviceAuthorityFailed, registerWork, registerDeparture, guardDeparture, registerReload }}>
        {visibleNotice && <p className="workspace-notice" role="status" data-testid="workspace-notice" data-notice-kind={visibleNotice === PRACTICE_ACCESS_CHANGED ? "practice-access-changed" : undefined}>{visibleNotice}</p>}
        {workNotice && <p className="workspace-notice" role="status">{workNotice}</p>}
        <StaffNav summary={summary!} epoch={epoch} Link={WorkspaceLink} />{children}
      </WorkspaceContext.Provider>}
    </main>
    {shellShown && <TabBar roles={summary!.roles} onNavigate={controlledLink} />}
  </div>;
}

/** True when this page load followed a link or form inside the site (not the sign-in page); false from an email link, another site, a bookmark or the sign-in page. */
function arrivedWithinSite() {
  try { const from = document.referrer ? new URL(document.referrer) : null; return !!from && from.origin === window.location.origin && from.pathname !== "/sign-in"; } catch { return false; }
}

export function WorkspaceLink({ href, children, onAccepted, fullDocument, prefetch, ...rest }: { href: string; children: ReactNode; onAccepted?: () => void; fullDocument?: boolean; prefetch?: boolean } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const { guardDeparture } = useWorkspace(), router = useRouter();
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void guardDeparture().then(leave => {
      if (!leave) return;
      onAccepted?.();
      if (fullDocument) window.location.assign(href);
      else router.push(href);
    });
  };
  return fullDocument ? <a {...rest} href={href} onClick={navigate}>{children}</a>
    : <Link {...rest} href={href} prefetch={prefetch} onClick={navigate}>{children}</Link>;
}

export function RequireRole({ role, children }: { role: keyof typeof rolePaths; children: ReactNode }) {
  const { summary } = useWorkspace();
  return summary.roles.includes(role) ? children : <section className="workspace-state" data-testid="role-unavailable"><h1>Role unavailable</h1><p>This account doesn’t have that access.</p><a href="/workspace">Go to your home page</a></section>;
}
