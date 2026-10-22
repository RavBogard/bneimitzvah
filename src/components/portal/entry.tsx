"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { parseAcceptance, parseAcknowledgement, parseInvitation, parseSession, PortalRequestError, requestPortal, roleNames,
  type InvitationReview, type SessionSummary } from "./api";
import { GoogleSignIn } from "./google-sign-in";
import type { GoogleIntent } from "./sign-in-boundary";
import { forgetPendingRequest } from "./pending-request";

type View = { kind: "loading" | "unavailable" | "sign-in" | "invalid-invitation" | "forbidden" | "accepted" | "uncertain" }
  | { kind: "signed-in"; summary: SessionSummary } | { kind: "invitation"; review: InvitationReview };
type Action = "google" | "email" | "accept" | "sign-out";
const rolePath = (role: SessionSummary["roles"][number]) => role === "admin" ? "/workspace/admin/students" : `/workspace/${role}`;
const roleTasks: Record<SessionSummary["roles"][number], string> = { student: "your assigned reading", parent: "your child’s preparation and practice", tutor: "the students you teach", admin: "students, people and setup" };
const failure = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;

export function PortalEntry({ invitation = false, authenticationError = false, autoEnterStudent = true, inlineGoogle = false, googleIntent }: { invitation?: boolean; authenticationError?: boolean; autoEnterStudent?: boolean; inlineGoogle?: boolean; googleIntent?: GoogleIntent }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [pending, setPending] = useState<Action | null>(null), [message, setMessage] = useState("");
  const [email, setEmail] = useState(""), [linkRequested, setLinkRequested] = useState(false);
  const [attemptedSignIn, setAttemptedSignIn] = useState(false);
  const [authGeneration, setAuthGeneration] = useState(0);
  const gate = useRef<Action | null>(null), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), focusNext = useRef(false);

  const refresh = useCallback(() => {
    if (gate.current) return;
    const turn = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setView({ kind: "loading" }); setMessage(""); setLinkRequested(false);
    void requestPortal(invitation ? "/api/invitations/pending" : "/api/session", undefined, request.signal)
      .then(value => {
        const next: View = invitation ? { kind: "invitation", review: parseInvitation(value) } : { kind: "signed-in", summary: parseSession(value) };
        if (autoEnterStudent && turn === generation.current && next.kind === "signed-in" && next.summary.roles.length === 1 && next.summary.roles[0] === "student") { window.location.replace("/workspace/student"); return; }
        if (turn === generation.current) setView(next);
      }).catch(error => {
        if (turn !== generation.current || request.signal.aborted) return;
        const status = failure(error);
        setView({ kind: status === 401 ? "sign-in" : status === 403 ? "forbidden" : invitation && status === 404 ? "invalid-invitation" : "unavailable" });
      });
  }, [invitation, autoEnterStudent]);

  useEffect(() => {
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    return () => { generation.current++; controller.current?.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => {
    if (view.kind !== "loading" && focusNext.current) { heading.current?.focus(); focusNext.current = false; }
  }, [view, linkRequested]);

  function retry() { focusNext.current = true; refresh(); }
  async function action(kind: Exclude<Action, "google">) {
    // React state alone cannot prevent two submissions in the same event turn.
    if (gate.current) return;
    gate.current = kind; setPending(kind); setMessage("");
    if (kind === "email") setAttemptedSignIn(true);
    try {
      if (kind === "email") {
        parseAcknowledgement(await requestPortal("/api/auth/sign-in/magic-link", { email: email.trim() }), "requested");
        setEmail(""); setLinkRequested(true); focusNext.current = true;
      } else if (kind === "sign-out") {
        parseAcknowledgement(await requestPortal("/api/auth/sign-out", {}), "ok");
        forgetPendingRequest(); // A Connect Claude request never outlives the account that started it.
        setAuthGeneration(value => value + 1);
        setEmail(""); setLinkRequested(false); setView({ kind: "sign-in" }); focusNext.current = true;
      } else {
        if (view.kind !== "invitation") return;
        // The raw invitation lives only in its HttpOnly pending cookie. The
        // reviewed binding is transient memory and never a URL/storage value.
        parseAcceptance(await requestPortal("/api/invitations/accept", { reviewBinding: view.review.reviewBinding }));
        setView({ kind: "accepted" }); focusNext.current = true;
      }
    } catch (error) {
      const status = failure(error);
      if (kind === "accept") {
        setView({ kind: status === 401 ? "sign-in" : status === 403 ? "forbidden" : status === 404 ? "invalid-invitation" : "uncertain" });
        if (status === 404) setMessage("The invitation review changed or expired. Review the current invitation before accepting.");
        focusNext.current = true;
      } else if (kind === "sign-out" && status === 401) {
        setView({ kind: "sign-in" }); focusNext.current = true;
      } else setMessage(status === 429 ? "Too many sign-in requests. Wait a minute, then try again."
        : kind === "sign-out" ? "We couldn’t sign you out. Try again before leaving a shared device."
          : "Sign-in could not be started. Please try again shortly.");
    } finally {
      gate.current = null; setPending(null);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void action("email"); }
  const title = view.kind === "loading" ? "Checking your access" : view.kind === "unavailable" ? "Sign-in is unavailable" : view.kind === "sign-in" ? linkRequested ? "Check your email" : "Sign in"
    : view.kind === "signed-in" ? autoEnterStudent ? "You’re signed in" : "Your account" : view.kind === "invitation" ? "Review your invitation" : view.kind === "accepted" ? "Invitation accepted"
      : view.kind === "invalid-invitation" ? "Invitation unavailable" : view.kind === "uncertain" ? "We couldn’t confirm the result" : "Access is unavailable";

  return <div className="portal-shell">
    <a className="skip-link" href="#portal-main">Skip to sign-in and access</a>
    <header className="portal-header"><a className="portal-brand" href="/" aria-label="CRC Beit Mitzvah home">CRC Beit Mitzvah</a><span>Central Reform Congregation</span></header>
    <main id="portal-main" className="entry-layout">
      <div className="entry-introduction">
        <h1>{invitation ? "Join your congregation’s practice" : "Open your reading"}</h1>
        <p>{invitation ? "Review the access you’ve been invited to use. You choose whether to accept it." : "Your assigned passage is the starting point. Sign in with the account on your invitation."}</p>
        <div className="entry-notes"><p>For students, parents and the people who teach them.</p><p>Parents use their own account to reach a linked child’s practice.</p></div>
        {!invitation && <div className="hero-actions"><a className="button-hero-secondary" href="/read">Read this week’s Torah and haftarah</a><span className="field-help">Open to everyone, no sign-in needed.</span></div>}
      </div>
      <section className="entry-task" aria-labelledby="entry-title" aria-busy={view.kind === "loading" || pending !== null}>
        <h2 id="entry-title" ref={heading} tabIndex={-1} aria-live="polite" aria-atomic="true">{title}</h2>
        {view.kind === "sign-in" && authenticationError && !attemptedSignIn && <p className="request-error" role="alert">That sign-in attempt couldn’t be verified. Please try again.</p>}
        {message && <p className="request-error" role="alert">{message}</p>}
        {view.kind === "loading" && <p role="status">One moment while we check your access.</p>}
        {view.kind === "unavailable" && <><p>The portal isn’t ready to sign you in right now. Your reading remains private.</p><p>Please try again shortly. If this continues, ask your tutor or the congregation for help.</p><button type="button" className="button-primary" onClick={retry}>Try again</button></>}
        {view.kind === "sign-in" && (linkRequested ? <><p role="status">If this address can sign in, an email link will arrive shortly. Open the link on this device to continue.</p><p>Don’t see it? Check your spam folder, or wait a minute before requesting another link.</p><button type="button" className="button-secondary" onClick={() => { focusNext.current = true; setLinkRequested(false); setMessage(""); }}>Use a different email</button></>
          : <><p>{invitation ? "Sign in with the email address that received this invitation." : "Use Google, or get a sign-in link by email. No password needed."}</p>
            {inlineGoogle ? <GoogleSignIn key={authGeneration} intent={googleIntent} disabled={pending !== null} onBegin={() => {
              if (gate.current) return false;
              gate.current = "google"; setPending("google"); setMessage(""); setAttemptedSignIn(true); return true;
            }} onFinish={next => {
              if (gate.current !== "google") return;
              gate.current = null; setPending(null);
              if (next) window.location.replace(next);
            }} /> : <a className="button-secondary" href={!invitation && !autoEnterStudent ? "/sign-in?intent=account" : "/sign-in"} referrerPolicy="no-referrer" aria-disabled={pending !== null} tabIndex={pending !== null ? -1 : undefined} onClick={event => { if (pending !== null) event.preventDefault(); }}>Continue to Google sign-in</a>}
            <div className="form-divider"><span>or use email</span></div>
            <form onSubmit={submit}>
              <label htmlFor="entry-email">Email address</label>
              <input id="entry-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={pending !== null} aria-describedby="entry-email-help" />
              <p className="field-help" id="entry-email-help">Use the address on your invitation.</p>
              <button type="submit" className="button-primary" disabled={pending !== null}>{pending === "email" ? "Sending link…" : "Email me a sign-in link"}</button>
            </form></>)}
        {view.kind === "signed-in" && <>
          {view.summary.roles.length ? <><p>{view.summary.roles.length === 1 ? "Continue to your work." : "This account has more than one role. Choose what you want to do now; you can switch later from the top of the page."}</p><ul className="role-list" aria-label="Available roles">{view.summary.roles.map(role => <li key={role}><a href={rolePath(role)}>{roleNames[role]}</a><span className="field-help"> · {roleTasks[role]}</span></li>)}</ul><p><a href="/workspace/email">Email settings</a><span className="field-help"> · choose which portal emails you get</span></p></>
            : <><p>No congregation role is linked to this account yet.</p><p>If you received an invitation, open its email link while signed in. Otherwise, ask your tutor or the congregation for an invitation.</p></>}
          <p className="field-help">Signing out removes your private reading and notes from this device’s screen. Use it on a shared phone or computer.</p>
          <button type="button" className="button-secondary" disabled={pending !== null} onClick={() => void action("sign-out")}>{pending === "sign-out" ? "Signing out…" : "Sign out"}</button>
        </>}
        {view.kind === "invitation" && <><p>Check the details before joining. Accepting adds this access to your signed-in account.</p>
          <dl className="invitation-details"><div><dt>Access</dt><dd>{roleNames[view.review.role]}</dd></div>{view.review.student && <div><dt>Student</dt><dd><bdi dir="auto">{view.review.student.firstName} {view.review.student.lastName}</bdi></dd></div>}</dl>
          {view.review.role === "parent" && <p>Your parent view is read-only. Child practice is entered separately.</p>}
          <p className="field-help">This invitation expires <time dateTime={view.review.expiresAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(view.review.expiresAt))}</time>.</p>
          <button type="button" className="button-primary" disabled={pending !== null} onClick={() => void action("accept")}>{pending === "accept" ? "Accepting invitation…" : "Accept invitation"}</button>
          <button type="button" className="button-text" disabled={pending !== null} onClick={() => void action("sign-out")}>Sign out to use another account</button>
        </>}
        {view.kind === "accepted" && <><p role="status">Your invitation has been accepted.</p><a className="button-primary" href="/">Continue</a></>}
        {view.kind === "invalid-invitation" && <><p>This invitation may have changed, expired, already been accepted, or belong to another account. No new access has been added by this request.</p><p>Open the latest invitation email, or ask the congregation for a new invitation.</p><button type="button" className="button-primary" onClick={retry}>{message ? "Review invitation again" : "Check invitation again"}</button><a className="button-text" href="/">Check my access</a></>}
        {view.kind === "uncertain" && <><p>The request was interrupted. Your invitation may have been accepted. Check your access before trying again.</p><a className="button-primary" href="/">Check my access</a><button type="button" className="button-text" onClick={retry}>Review invitation again</button></>}
        {view.kind === "forbidden" && <><p>This account can’t use the requested access right now. Ask the congregation for help, or sign in with a different account.</p><button type="button" className="button-secondary" disabled={pending !== null} onClick={() => void action("sign-out")}>{pending === "sign-out" ? "Signing out…" : "Sign out"}</button></>}
      </section>
    </main>
    <footer className="portal-footer"><span>Learning at Central Reform Congregation</span><span>Your account and reading stay private.</span></footer>
  </div>;
}
