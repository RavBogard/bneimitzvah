"use client";
import { useEffect, useRef, useState } from "react";
import { unsubscribe, type EmailKind } from "./workspace/email/api";
import { PortalRequestError } from "./api";

const names: Record<EmailKind, string> = { "tutor-draft": "draft notices", "weekly-digest": "weekly updates", "practice-reminder": "practice reminders" };
type View = { kind: "ready" | "missing" | "pending" | "invalid" | "unavailable" } | { kind: "done"; stopped: EmailKind };

/**
 * The page an email's "stop" link opens. The capability arrives in the fragment (never sent to the
 * server by the browser), is taken off the address bar at once, and nothing changes until the
 * reader confirms.
 */
export function UnsubscribePage() {
  const token = useRef<string | null>(null), [view, setView] = useState<View>({ kind: "ready" }), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("t");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    token.current = value; if (!value) setView({ kind: "missing" });
  }, []);
  useEffect(() => { if (view.kind !== "ready" && view.kind !== "pending") heading.current?.focus(); }, [view]);
  async function confirm() {
    if (!token.current || view.kind === "pending") return;
    setView({ kind: "pending" });
    try { setView({ kind: "done", stopped: await unsubscribe(token.current) }); }
    catch (error) { setView({ kind: error instanceof PortalRequestError && error.status === 404 ? "invalid" : "unavailable" }); }
  }
  const title = view.kind === "done" ? "You’re unsubscribed" : view.kind === "missing" || view.kind === "invalid" ? "This link doesn’t work" : view.kind === "unavailable" ? "Something went wrong" : "Stop these emails?";
  return <div className="portal-shell">
    <header className="portal-header"><a className="portal-brand" href="/">CRC Torah</a><span>Central Reform Congregation</span></header>
    <main id="portal-main" className="entry-layout">
      <section className="entry-task" aria-labelledby="unsubscribe-title" aria-busy={view.kind === "pending"}>
        <h2 id="unsubscribe-title" ref={heading} tabIndex={-1}>{title}</h2>
        {(view.kind === "ready" || view.kind === "pending") && <><p>You’ll stop getting this kind of email from the portal. Other portal emails, and sign-in links you ask for, are not affected.</p>
          <button type="button" className="button-primary" disabled={view.kind === "pending"} onClick={() => void confirm()}>{view.kind === "pending" ? "Unsubscribing…" : "Unsubscribe"}</button></>}
        {view.kind === "done" && <p role="status">You won’t get {names[view.stopped]} any more. You can turn them back on any time in your email settings after you sign in.</p>}
        {(view.kind === "missing" || view.kind === "invalid") && <p>Open the link from the email again, or sign in and change your email settings.</p>}
        {view.kind === "unavailable" && <><p>We couldn’t unsubscribe you just now. Please try the link again in a few minutes.</p></>}
        {view.kind !== "ready" && view.kind !== "pending" && <a className="button-secondary" href="/workspace/email">Email settings</a>}
      </section>
    </main>
    <div className="portal-footer"><span>Central Reform Congregation</span></div>
  </div>;
}
