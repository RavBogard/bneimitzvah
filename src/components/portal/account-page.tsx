"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSession, PortalRequestError, requestPortal, roleNames, roleTasks, type Role, type SessionSummary } from "./api";
import { PortalEntry } from "./entry";
import { AccountRequest } from "./account-request";
import { InstallHint } from "./offline/install-hint";
import { ParentAccountDisclosure, PracticeDisclosure } from "./practice-visibility/disclosure";
import { rememberSignedIn } from "./signed-in-hint";
import { signOutOfPortal } from "./sign-out";
import { homeRole, rolePaths } from "./shell/role-home";
import { rememberedRole, rememberRole } from "./shell/role-memory";
import { TabBar, TabSkipLink } from "./shell/tab-bar";
import { workspaceApi } from "./workspace/api";
import { SiteBar } from "../site/site-bar";
import { Chip, List, ListRow, PageHeader } from "../ui";

/** 1.9 N23: the parent's own linked children, for the parent's practice-visibility line (asked only once the gate is open). */
const parentChildren = () => workspaceApi.students("parent");
const GUIDE = "https://www.centralreform.org/beit-mitzvah/";

type State = Readonly<{ kind: "loading" } | { kind: "signed-out" } | { kind: "ready"; summary: SessionSummary }>;

/** The signed-in Account, as a list: who is signed in, the roles (the current one marked), the rows that belong to the account, Sign out. */
export function AccountView({ summary, current, signingOut, problem, onRole, onSignOut }: { summary: SessionSummary; current: Role | null; signingOut: boolean; problem: string; onRole: (role: Role) => void; onSignOut: () => void }) {
  const { roles } = summary, staff = roles.includes("admin") || roles.includes("tutor"), student = roles.includes("student");
  return <>
    <PageHeader title="Account" description="You’re signed in" />
    {roles.length > 0 && <section className="account-section" aria-labelledby="account-roles">
      <h2 id="account-roles">Roles</h2>
      <List label="Roles">{roles.map(role => <ListRow key={role} title={roleNames[role]} meta={roleTasks[role]} href={rolePaths[role]} onNavigate={() => onRole(role)} trailing={role === current ? <Chip tone="info">Current</Chip> : undefined} />)}</List>
    </section>}
    {roles.length > 0 && <section className="account-section">
      <List label="Your account">
        <ListRow title="Email settings" meta="choose which portal emails you get" href="/workspace/email" />
        {staff && <ListRow title="Claude connections" meta="see and end Claude’s access to the portal" href="/workspace/claude" />}
        {summary.approver && <ListRow title="Account requests" meta="approve accounts for people who ask" href="/workspace/accounts" />}
      </List>
    </section>}
    <InstallHint place="account" />
    {student && <PracticeDisclosure place="account" />}
    {roles.includes("parent") && <ParentAccountDisclosure load={parentChildren} />}
    {student && <section className="account-section"><List label="Help"><ListRow title="Need help?" href={GUIDE} external /></List></section>}
    {/* Never offered to a student, who already has an account (G20, 1.9 N20); an account with no role asks for one here. */}
    {roles.length === 0 && <section className="account-section" aria-labelledby="account-none"><h2 id="account-none">Your account</h2><AccountRequest level={3} />{!summary.saved && <p className="field-help">Received an invitation to a Beit Mitzvah? Open its email link while signed in.</p>}</section>}
    {roles.length > 0 && !summary.saved && !student && <section className="account-section"><AccountRequest level={3} /></section>}
    <section className="account-section">
      {problem && <p className="request-error" role="alert">{problem}</p>}
      <p className="field-help">Signing out removes your private reading and notes from this device’s screen. Use it on a shared phone or computer.</p>
      <button type="button" className="button-secondary" disabled={signingOut} onClick={onSignOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
    </section>
  </>;
}

/**
 * Account (`/account`). Signed in it is a list page, the home of roles: choosing a role remembers it (in page memory only) and opens its home.
 * Anything else, signed out or an access problem, is the sign-in form, which comes back here.
 */
export function AccountPage() {
  const [state, setState] = useState<State>({ kind: "loading" }), [signingOut, setSigningOut] = useState(false), [problem, setProblem] = useState("");
  const [current, setCurrent] = useState<Role | null>(null), controller = useRef<AbortController | null>(null), gate = useRef(false);
  const check = useCallback(() => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    void requestPortal("/api/session", undefined, request.signal).then(value => {
      if (request.signal.aborted) return;
      const summary = parseSession(value);
      rememberSignedIn(true); setCurrent(homeRole(summary.roles, rememberedRole())); setState({ kind: "ready", summary });
    }).catch(error => {
      if (request.signal.aborted) return;
      if (error instanceof PortalRequestError && error.status === 401) rememberSignedIn(false);
      setState({ kind: "signed-out" });
    });
  }, []);
  useEffect(() => {
    check();
    const visible = () => { if (document.visibilityState === "visible" && !gate.current) check(); };
    // A page restored from the back-forward cache (after signing out on a shared device) checks its session again.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    // Returning to the window checks too (a sign-out made in another window leaves this one visible), as the sign-in page always has.
    document.addEventListener("visibilitychange", visible); window.addEventListener("focus", visible); window.addEventListener("pageshow", restored);
    return () => { controller.current?.abort(); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); window.removeEventListener("pageshow", restored); };
  }, [check]);

  if (state.kind === "signed-out") return <PortalEntry returnTo="/account" after={<InstallHint place="account" />} />;
  const roles = state.kind === "ready" ? state.summary.roles : [];
  async function signOut() {
    if (gate.current) return;
    gate.current = true; setSigningOut(true); setProblem("");
    try { await signOutOfPortal(); setState({ kind: "signed-out" }); }
    catch (error) {
      if (error instanceof PortalRequestError && error.status === 401) setState({ kind: "signed-out" });
      else setProblem("We couldn’t sign you out. Try again before leaving a shared device.");
    } finally { gate.current = false; setSigningOut(false); }
  }
  return <div className="portal-shell">
    <a className="skip-link" href="#account-main">Skip to main content</a>
    {state.kind === "ready" && <TabSkipLink roles={roles} />}
    <SiteBar signedIn={state.kind === "ready" ? true : undefined} />
    <main id="account-main" className="workspace-main account-main" aria-busy={state.kind === "loading"}>
      {state.kind === "loading" ? <><PageHeader title="Account" /><p role="status">One moment while we check your access.</p></>
        : <AccountView summary={state.summary} current={current} signingOut={signingOut} problem={problem} onRole={role => { rememberRole(role); setCurrent(role); }} onSignOut={() => void signOut()} />}
    </main>
    {state.kind === "ready" && <TabBar roles={roles} />}
  </div>;
}
