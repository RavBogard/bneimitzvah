"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { parseAcceptance, parseAcknowledgement, parseCodeResult, parseInvitation, parseSession, PortalRequestError, requestPortal, roleNames,
  type InvitationReview, type SessionSummary } from "./api";
import { GoogleContinue } from "./google-sign-in";
import { rememberSignedIn } from "./signed-in-hint";
import { returnAddress, signInAddress } from "../../lib/site/return-address";
import type { GoogleIntent } from "./sign-in-boundary";
import { forgetPendingRequest } from "./pending-request";
import { FrontDoor, type FrontDoorAccount } from "./front-door/front-door";
import { AccountRequest } from "./account-request";
import { purgeOffline } from "../../lib/offline/pack-index";
import { TabBar, TabSkipLink } from "./shell/tab-bar";
import { PracticeDisclosure } from "./practice-visibility/disclosure";

export type View = { kind: "loading" | "unavailable" | "sign-in" | "invalid-invitation" | "forbidden" | "uncertain" }
  | { kind: "accepted"; role: SessionSummary["roles"][number] }
  | { kind: "signed-in"; summary: SessionSummary } | { kind: "invitation"; review: InvitationReview };
/**
 * What the front door app bar shows for an entry state. A refused account is signed in, so Sign in
 * would be wrong, and it has no account page it can use, so the bar stays empty; the door itself offers Sign out.
 */
export const frontDoorAccount = (view: View): FrontDoorAccount => view.kind === "loading" || view.kind === "forbidden" ? null
  : view.kind === "signed-in" ? { kind: "account", role: view.summary.roles.length === 1 ? roleNames[view.summary.roles[0]] : null, saved: view.summary.saved } : { kind: "sign-in" };
type Action = "google" | "email" | "code" | "accept" | "sign-out";
/**
 * Only when this device last asked for a sign-in email, never the code or the address: an installed app that
 * relaunches while the person was in Mail reopens on the code form for the code's 5 minutes (1.5, plan §2.4).
 */
const CODE_REQUESTED_AT = "crc.signin.code-requested-at", CODE_WINDOW_MS = 300_000, RESEND_AFTER_MS = 60_000;
/** When this device last asked for a sign-in email (a time only), or null when it has not or storage is blocked. */
function codeRequestedAt(): number | null {
  try { const at = Number(window.localStorage.getItem(CODE_REQUESTED_AT)); return Number.isSafeInteger(at) && at > 0 ? at : null; } catch { return null; }
}
function codeRequested(): boolean {
  try { const at = Number(window.localStorage.getItem(CODE_REQUESTED_AT)), age = Date.now() - at; return Number.isSafeInteger(at) && at > 0 && age >= 0 && age < CODE_WINDOW_MS; }
  catch { return false; }
}
function rememberCodeRequest(on: boolean) {
  try { if (on) window.localStorage.setItem(CODE_REQUESTED_AT, String(Date.now())); else window.localStorage.removeItem(CODE_REQUESTED_AT); } catch { /* Storage blocked: the form still shows in this tab. */ }
}
/** The code form's words. DRAFT, awaiting Daniel's wording (1.5 popup); the behaviour does not depend on them. */
export const SIGN_IN_CODE_COPY = Object.freeze({
  sent: "If this address can sign in, an email with a sign-in link and a 6-digit code will arrive shortly.",
  label: "Sign-in code",
  help: "Open the link in the email, or type its code here. The code works on this device for 5 minutes.",
  submit: "Sign in", pending: "Signing in…",
  wrong: "That code didn’t match. Check the email and try again.",
  expired: "That code has expired or was used. Request a new email to get a new code.",
});
const rolePath = (role: SessionSummary["roles"][number]) => role === "admin" ? "/workspace/admin/students" : `/workspace/${role}`;
const roleTasks: Record<SessionSummary["roles"][number], string> = { student: "your assigned reading", parent: "your child’s preparation and practice", tutor: "the students you teach", admin: "students, people and setup" };
const failure = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;

/**
 * `frontDoor` puts this same entry task inside the CRC Torah home's Beit Mitzvah door; invitation entry never gets doors.
 * `returnTo` (N20) is where signing in here goes back to: a checked return address, carried by the email code and by
 * Google's stored state. Already signed in, the page goes straight there. A pending invitation always wins on the server.
 */
export function PortalEntry({ invitation = false, authenticationError = false, autoEnterStudent = true, inlineGoogle = false, googleIntent, frontDoor = false, after, returnTo = null }: { invitation?: boolean; authenticationError?: boolean; autoEnterStudent?: boolean; inlineGoogle?: boolean; googleIntent?: GoogleIntent; frontDoor?: boolean; after?: ReactNode; returnTo?: string | null }) {
  const back = invitation ? null : returnAddress(returnTo);
  const resumesSave = back !== null && new URLSearchParams(back.slice(back.indexOf("?") + 1 || back.length)).get("save") === "1";
  const [view, setView] = useState<View>({ kind: "loading" });
  const [pending, setPending] = useState<Action | null>(null), [message, setMessage] = useState("");
  const [email, setEmail] = useState(""), [linkRequested, setLinkRequested] = useState(false), [code, setCode] = useState("");
  const [attemptedSignIn, setAttemptedSignIn] = useState(false);
  // "Send a new code" shows a minute after the last request. The address is kept in memory only, for that one resend: never in storage.
  const [resendReady, setResendReady] = useState(false), [codeRound, setCodeRound] = useState(0), lastEmail = useRef("");
  const [authGeneration, setAuthGeneration] = useState(0);
  const gate = useRef<Action | null>(null), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), focusNext = useRef(false);

  const refresh = useCallback(() => {
    if (gate.current) return;
    const turn = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setView({ kind: "loading" }); setMessage(""); setLinkRequested(codeRequested()); setCode("");
    void requestPortal(invitation ? "/api/invitations/pending" : "/api/session", undefined, request.signal)
      .then(value => {
        const next: View = invitation ? { kind: "invitation", review: parseInvitation(value) } : { kind: "signed-in", summary: parseSession(value) };
        if (next.kind === "signed-in") { rememberCodeRequest(false); rememberSignedIn(true); }
        // Signed in already: only Save's way back (`save=1`) goes straight back to its reading; any other visitor who is
        // already signed in sees the roles and Account here, as before (a member's Sign in on /read must still reach them).
        if (resumesSave && turn === generation.current && next.kind === "signed-in" && back !== window.location.pathname + window.location.search) { window.location.replace(back!); return; }
        if (autoEnterStudent && turn === generation.current && next.kind === "signed-in" && next.summary.roles.length === 1 && next.summary.roles[0] === "student") { window.location.replace("/workspace/student"); return; }
        if (turn === generation.current) setView(next);
      }).catch(error => {
        if (turn !== generation.current || request.signal.aborted) return;
        const status = failure(error);
        if (status === 401 && !invitation) rememberSignedIn(false);
        setView({ kind: status === 401 ? "sign-in" : status === 403 ? "forbidden" : invitation && status === 404 ? "invalid-invitation" : "unavailable" });
      });
  }, [invitation, autoEnterStudent, back, resumesSave]);

  useEffect(() => {
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    // A page restored from the back-forward cache (after signing out on a shared device) checks its session again.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible); window.addEventListener("pageshow", restored);
    return () => { generation.current++; controller.current?.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); window.removeEventListener("pageshow", restored); };
  }, [refresh]);
  useEffect(() => {
    if (view.kind !== "loading" && focusNext.current) { heading.current?.focus(); focusNext.current = false; }
  }, [view, linkRequested]);
  useEffect(() => {
    setResendReady(false); if (!linkRequested) return;
    const wait = Math.max(0, (codeRequestedAt() ?? Date.now()) + RESEND_AFTER_MS - Date.now()), timer = window.setTimeout(() => setResendReady(true), wait);
    return () => window.clearTimeout(timer);
  }, [linkRequested, codeRound]);

  function retry() { focusNext.current = true; refresh(); }
  async function action(kind: Exclude<Action, "google">, to?: string) {
    // React state alone cannot prevent two submissions in the same event turn.
    if (gate.current) return;
    gate.current = kind; setPending(kind); setMessage("");
    if (kind === "email" || kind === "code") setAttemptedSignIn(true);
    try {
      if (kind === "email") {
        parseAcknowledgement(await requestPortal("/api/auth/sign-in/magic-link", back ? { email: (to ?? email).trim(), return: back } : { email: (to ?? email).trim() }), "requested");
        lastEmail.current = (to ?? email).trim(); setEmail(""); setCode(""); setLinkRequested(true); rememberCodeRequest(true); setCodeRound(value => value + 1); focusNext.current = true;
      } else if (kind === "code") {
        // The code goes only in this POST body; the input is cleared whatever the answer.
        const typed = code; setCode("");
        const next = parseCodeResult(await requestPortal("/api/auth/sign-in/code", { code: typed }));
        rememberCodeRequest(false); rememberSignedIn(true);
        window.location.replace(next);
        return;
      } else if (kind === "sign-out") {
        // Saved readings leave the device before the session does (1.5 A1, §3.4). This never throws.
        await purgeOffline();
        parseAcknowledgement(await requestPortal("/api/auth/sign-out", {}), "ok");
        forgetPendingRequest(); // A Connect Claude request never outlives the account that started it.
        rememberSignedIn(false);
        setAuthGeneration(value => value + 1);
        lastEmail.current = ""; setEmail(""); setLinkRequested(false); rememberCodeRequest(false); setView({ kind: "sign-in" }); focusNext.current = true;
      } else {
        if (view.kind !== "invitation") return;
        // The raw invitation lives only in its HttpOnly pending cookie. The
        // reviewed binding is transient memory and never a URL/storage value.
        parseAcceptance(await requestPortal("/api/invitations/accept", { reviewBinding: view.review.reviewBinding }));
        setView({ kind: "accepted", role: view.review.role }); focusNext.current = true;
      }
    } catch (error) {
      const status = failure(error);
      if (kind === "accept") {
        setView({ kind: status === 401 ? "sign-in" : status === 403 ? "forbidden" : status === 404 ? "invalid-invitation" : "uncertain" });
        if (status === 404) setMessage("The invitation review changed or expired. Review the current invitation before accepting.");
        focusNext.current = true;
      } else if (kind === "code" && (status === 400 || status === 409)) {
        if (status === 409) { lastEmail.current = ""; setLinkRequested(false); rememberCodeRequest(false); focusNext.current = true; }
        setMessage(status === 400 ? SIGN_IN_CODE_COPY.wrong : SIGN_IN_CODE_COPY.expired);
      } else if (kind === "sign-out" && status === 401) {
        setView({ kind: "sign-in" }); focusNext.current = true;
      } else setMessage(status === 429 ? "Too many sign-in requests. Wait a minute, then try again."
        : kind === "sign-out" ? "We couldn’t sign you out. Try again before leaving a shared device."
          : kind === "code" ? "Sign-in could not be completed. Please try again shortly." : "Sign-in could not be started. Please try again shortly.");
    } finally {
      gate.current = null; setPending(null);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void action("email"); }
  /** Asks for another email and code with the address just used; with none in memory (the form was reopened later), back to the address field. */
  function sendNewCode() {
    if (lastEmail.current) { void action("email", lastEmail.current); return; }
    focusNext.current = true; setLinkRequested(false); setCode(""); rememberCodeRequest(false); setMessage("");
  }
  function submitCode(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (/^\d{6}$/.test(code)) void action("code"); }
  const title = view.kind === "loading" ? "Checking your access" : view.kind === "unavailable" ? "Sign-in is unavailable" : view.kind === "sign-in" ? linkRequested ? "Check your email" : "Sign in"
    : view.kind === "signed-in" ? autoEnterStudent ? "You’re signed in" : "Your account" : view.kind === "invitation" ? "Review your invitation" : view.kind === "accepted" ? "Invitation accepted"
      : view.kind === "invalid-invitation" ? "Invitation unavailable" : view.kind === "uncertain" ? "We couldn’t confirm the result" : "Access is unavailable";

  const doors = frontDoor && !invitation, TaskHeading = doors ? "h3" : "h2";
  const task = <section className="entry-task" data-entry-state={view.kind} aria-labelledby="entry-title" aria-busy={view.kind === "loading" || pending !== null}>
        <TaskHeading id="entry-title" ref={heading} tabIndex={-1} aria-live="polite" aria-atomic="true">{title}</TaskHeading>
        {view.kind === "sign-in" && authenticationError && !attemptedSignIn && <p className="request-error" role="alert">That sign-in attempt couldn’t be verified. Please try again.</p>}
        {message && <p className="request-error" role="alert">{message}</p>}
        {view.kind === "loading" && <p role="status">One moment while we check your access.</p>}
        {view.kind === "unavailable" && <><p>The portal isn’t ready to sign you in right now. Your reading remains private.</p><p>Please try again shortly. If this continues, ask your tutor or the congregation for help.</p><button type="button" className="button-primary" onClick={retry}>Try again</button></>}
        {view.kind === "sign-in" && (linkRequested ? <><p role="status">{SIGN_IN_CODE_COPY.sent}</p>
            <form method="post" onSubmit={submitCode}>
              <label htmlFor="entry-code">{SIGN_IN_CODE_COPY.label}</label>
              <input id="entry-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" minLength={6} maxLength={6} required spellCheck={false}
                value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={pending !== null} aria-describedby="entry-code-help" />
              <p className="field-help" id="entry-code-help">{SIGN_IN_CODE_COPY.help}</p>
              <button type="submit" className="button-primary" disabled={pending !== null}>{pending === "code" ? SIGN_IN_CODE_COPY.pending : SIGN_IN_CODE_COPY.submit}</button>
            </form>
            <p>Don’t see it? Check your spam folder, or wait a minute before requesting another link.</p>{resendReady && <button type="button" className="button-secondary" disabled={pending !== null} onClick={sendNewCode}>{pending === "email" ? "Sending link…" : "Send a new code"}</button>}<button type="button" className="button-secondary" disabled={pending !== null} onClick={() => { lastEmail.current = ""; focusNext.current = true; setLinkRequested(false); setCode(""); rememberCodeRequest(false); setMessage(""); }}>Use a different email</button></>
          : <><p>{invitation ? "Sign in with the email address that received this invitation." : "Use Google, or get a sign-in link by email. No password needed."}</p>
            {inlineGoogle ? <GoogleContinue key={authGeneration} next={googleIntent === "account" ? "account" : undefined} returnTo={back} disabled={pending !== null} onBegin={() => {
              if (gate.current) return false;
              gate.current = "google"; setPending("google"); setMessage(""); setAttemptedSignIn(true); return true;
            }} onFinish={() => {
              if (gate.current !== "google") return;
              gate.current = null; setPending(null);
            }} /> : <a className="button-secondary" href={!invitation && !autoEnterStudent ? "/sign-in?intent=account" : "/sign-in"} referrerPolicy="no-referrer" aria-disabled={pending !== null} tabIndex={pending !== null ? -1 : undefined} onClick={event => { if (pending !== null) event.preventDefault(); }}>Continue with Google</a>}
            <div className="form-divider"><span>or use email</span></div>
            <form onSubmit={submit}>
              <label htmlFor="entry-email">Email address</label>
              <input id="entry-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={pending !== null} aria-describedby="entry-email-help" />
              <p className="field-help" id="entry-email-help">Use the address on your invitation.</p>
              <button type="submit" className="button-primary" disabled={pending !== null}>{pending === "email" ? "Sending link…" : "Email me a sign-in link"}</button>
            </form>
            {/* F3: the way to the account request, which opens on Account once signed in. Not on the page that is already that way. */}
            {!invitation && !(inlineGoogle && (back === "/account" || googleIntent === "account")) && <p className="entry-ask"><a href={signInAddress("/account")}>Ask for an account</a></p>}</>)}
        {view.kind === "signed-in" && <>
          {view.summary.roles.length ? <><p>{view.summary.roles.length === 1 ? "Continue to your work." : "This account has more than one role. Choose what you want to do now; you can switch later from the top of the page."}</p><ul className="role-list" aria-label="Available roles">{view.summary.roles.map(role => <li key={role}><a href={rolePath(role)}>{roleNames[role]}</a><span className="field-help"> · {roleTasks[role]}</span></li>)}</ul><p><a href="/workspace/email">Email settings</a><span className="field-help"> · choose which portal emails you get</span></p>
            {view.summary.roles.some(role => role === "admin" || role === "tutor") && <p><a href="/workspace/claude">Claude connections</a><span className="field-help"> · see and end Claude’s access to the portal</span></p>}
            {view.summary.approver && <p><a href="/workspace/accounts">Account requests</a><span className="field-help"> · approve accounts for people who ask</span></p>}
            {/* 1.9 N11: a student's way to help, the congregation's own preparation guide (the link the reading page already carries). */}
            {/* 1.9 N23: the student is told what the tutor sees, behind the same release gate as every tutor and parent line. */}
            {view.summary.roles.includes("student") && <PracticeDisclosure place="account" />}
            {view.summary.roles.includes("student") && <p><a href="https://www.centralreform.org/beit-mitzvah/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Need help?</a></p>}
            {/* Never offered to a student, who already has an account (G20, 1.9 N20); other accounts without saved readings may ask. */}
            {!view.summary.saved && !view.summary.roles.includes("student") && <AccountRequest level={doors ? 4 : 3} />}</>
            : <><AccountRequest level={doors ? 4 : 3} />{!view.summary.saved && <p className="field-help">Received an invitation to a Beit Mitzvah? Open its email link while signed in.</p>}</>}
          <p className="field-help">Signing out removes your private reading and notes from this device’s screen. Use it on a shared phone or computer.</p>
          <button type="button" className="button-secondary" disabled={pending !== null} onClick={() => void action("sign-out")}>{pending === "sign-out" ? "Signing out…" : "Sign out"}</button>
        </>}
        {view.kind === "invitation" && <><p>Check the details before joining. Accepting adds this access to your signed-in account.</p>
          <dl className="invitation-details"><div><dt>Access</dt><dd>{roleNames[view.review.role]}</dd></div>{view.review.student && <div><dt>Student</dt><dd><bdi dir="auto">{view.review.student.firstName} {view.review.student.lastName}</bdi></dd></div>}</dl>
          {view.review.role === "parent" && view.review.student && <p>You'll be able to follow <bdi dir="auto">{view.review.student.firstName}</bdi>'s reading and practise with <bdi dir="auto">{view.review.student.firstName}</bdi>.</p>}
          <p className="field-help">This invitation expires <time dateTime={view.review.expiresAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(view.review.expiresAt))}</time>.</p>
          <button type="button" className="button-primary" disabled={pending !== null} onClick={() => void action("accept")}>{pending === "accept" ? "Accepting invitation…" : "Accept invitation"}</button>
          <button type="button" className="button-text" disabled={pending !== null} onClick={() => void action("sign-out")}>Sign out to use another account</button>
        </>}
        {view.kind === "accepted" && <><p role="status">Your invitation has been accepted.</p><a className="button-primary" href={rolePath(view.role)}>Continue</a></>}
        {view.kind === "invalid-invitation" && <><p>This invitation may have changed, expired, already been accepted, or belong to another account. No new access has been added by this request.</p><p>Open the latest invitation email, or ask the congregation for a new invitation.</p><button type="button" className="button-primary" onClick={retry}>{message ? "Review invitation again" : "Check invitation again"}</button><a className="button-text" href="/">Check my access</a></>}
        {view.kind === "uncertain" && <><p>The request was interrupted. Your invitation may have been accepted. Check your access before trying again.</p><a className="button-primary" href="/">Check my access</a><button type="button" className="button-text" onClick={retry}>Review invitation again</button></>}
        {view.kind === "forbidden" && <><p>This account can’t use the requested access right now. Ask the congregation for help, or sign in with a different account.</p><button type="button" className="button-secondary" disabled={pending !== null} onClick={() => void action("sign-out")}>{pending === "sign-out" ? "Signing out…" : "Sign out"}</button></>}
        {after}
      </section>;
  if (doors) {
    return <FrontDoor account={frontDoorAccount(view)} onSignIn={() => heading.current?.focus({ preventScroll: true })}>{task}</FrontDoor>;
  }

  // Signed in on Account (1.9 N10): the same tab bar the workspace has, so Account is a tab and not a dead end.
  const shellRoles = !invitation && !autoEnterStudent && view.kind === "signed-in" ? view.summary.roles : [];
  return <div className="portal-shell">
    <a className="skip-link" href="#portal-main">Skip to sign-in and access</a>
    <TabSkipLink roles={shellRoles} />
    <header className="portal-header app-bar"><a className="portal-brand" href="/" aria-label="CRC Torah home">CRC Torah</a><span>Central Reform Congregation</span></header>
    <main id="portal-main" className="entry-layout">
      <div className="entry-introduction">
        <h1>{invitation ? "Join your congregation’s practice" : "Open your reading"}</h1>
        <p>{invitation ? "Review the access you’ve been invited to use. You choose whether to accept it." : "Your assigned passage is the starting point. Sign in with the account on your invitation."}</p>
        <div className="entry-notes"><p>For students, parents and the people who teach them.</p><p>Parents use their own account to reach a linked child’s practice.</p></div>
        {!invitation && <div className="hero-actions"><a className="button-hero-secondary" href="/read">Read this week’s Torah and haftarah</a><span className="field-help">Open to everyone, no sign-in needed.</span></div>}
      </div>
      {task}
    </main>
    <div className="portal-footer"><span>Learning at Central Reform Congregation</span><span>Your account and reading stay private.</span></div>
    <TabBar roles={shellRoles} />
  </div>;
}
