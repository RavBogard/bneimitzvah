"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleSignIn } from "./google-sign-in";

// The portal MCP consent page (Decided here, 2026-10-21). Claude sends the staff member here with
// a signed request in the URL fragment; Google sign-in proves who they are; Allow returns Claude a code.
type Account = { name: string; google: boolean; role: "admin" | "tutor" | null; scopes: string[] };
type View = { kind: "loading" } | { kind: "expired" } | { kind: "unavailable" }
  | { kind: "ready"; clientName: string; destination: string; account: Account | null };
type Endpoint = "/api/oauth/consent/view" | "/api/oauth/consent/approve" | "/api/oauth/consent/deny";

async function post(endpoint: Endpoint, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    // same-origin, not no-referrer: Firefox sends Origin: null for a no-referrer POST.
    referrerPolicy: "same-origin", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("unavailable");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unavailable");
  return value as Record<string, unknown>;
}
const safeRedirect = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.origin === "https://claude.ai" || url.origin === "https://claude.com" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ? url.toString() : null;
  } catch { return null; }
};

export function ConnectClaude() {
  const request = useRef<string | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [unattended, setUnattended] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!request.current) { setView({ kind: "expired" }); return; }
    try {
      const value = await post("/api/oauth/consent/view", { request: request.current });
      if (value.error === "expired") { setView({ kind: "expired" }); return; }
      const account = value.account as Account | null;
      setView({ kind: "ready", clientName: String(value.clientName ?? "Claude"), destination: String(value.destination ?? ""), account });
    } catch { setView({ kind: "unavailable" }); }
  }, []);
  useEffect(() => {
    const match = /^#request=([A-Za-z0-9_.-]{1,8192})$/.exec(window.location.hash);
    request.current = match ? match[1] : null;
    // The signed request leaves the address bar at once; it lives only in this page's memory.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    void load();
  }, [load]);

  async function decide(allow: boolean) {
    if (!request.current || busy) return;
    setBusy(true); setMessage("");
    try {
      const value = allow ? await post("/api/oauth/consent/approve", { request: request.current, unattended })
        : await post("/api/oauth/consent/deny", { request: request.current });
      const target = safeRedirect(value.redirect);
      if (target) { window.location.assign(target); return; }
      if (value.error === "google") setMessage("Sign in with Google first; Claude connects only from a Google sign-in.");
      else if (value.error === "staff") setMessage("Only CRC clergy, staff and tutors can connect Claude.");
      else if (value.error === "expired") setView({ kind: "expired" });
      else setMessage("That didn’t go through. Try again.");
    } catch { setMessage("That didn’t go through. Try again."); }
    setBusy(false);
  }

  const ready = view.kind === "ready" ? view : null, account = ready?.account ?? null;
  const signedInWithGoogle = !!account?.google, staff = !!account?.role;
  return <div className="portal-shell">
    <header className="portal-header"><a className="portal-brand" href="/" aria-label="CRC Beit Mitzvah home">CRC Beit Mitzvah</a><span>Central Reform Congregation</span></header>
    <main id="portal-main" className="entry-layout">
      <div className="entry-introduction">
        <h1>Connect Claude</h1>
        <p>Let Claude work in the portal as you, with exactly your access, for up to 30 days.</p>
        <div className="entry-notes"><p>For CRC clergy, staff and tutors.</p><p>You can disconnect it any time in Claude’s connector settings.</p></div>
      </div>
      <section className="entry-task" aria-labelledby="connect-title" aria-busy={view.kind === "loading" || busy}>
        {view.kind === "loading" && <h2 id="connect-title">Checking this request…</h2>}
        {view.kind === "expired" && <><h2 id="connect-title">This request has expired</h2><p className="field-help">Start again from Claude: open the connector and choose Connect.</p></>}
        {view.kind === "unavailable" && <><h2 id="connect-title">The portal isn’t answering</h2><button type="button" className="button-secondary" onClick={() => void load()}>Try again</button></>}
        {ready && <>
          <h2 id="connect-title">{ready.clientName} wants to connect</h2>
          {message && <p className="request-error" role="alert">{message}</p>}
          {!signedInWithGoogle && <>
            <p className="field-help">{account ? "Confirm it’s you with Google to continue." : "Sign in with your CRC Google account to continue."}</p>
            <GoogleSignIn disabled={busy} onBegin={() => true} onFinish={() => { setMessage(""); void load(); }} />
          </>}
          {signedInWithGoogle && !staff && <p className="field-help">Only CRC clergy, staff and tutors can connect Claude. You’re signed in as {account!.name}.</p>}
          {signedInWithGoogle && staff && <>
            <p>Signed in as <strong>{account!.name}</strong>. Claude will be able to:</p>
            <ul className="role-list">
              {account!.role === "admin" ? <li>See every student’s preparation summary</li> : <li>See your own students’ preparation summaries</li>}
              {account!.scopes.includes("portal:study") && <li>Draft, review and publish the study guides students read</li>}
            </ul>
            {account!.scopes.includes("portal:study") && <label className="field-help">
              <input type="checkbox" checked={unattended} disabled={busy} onChange={event => setUnattended(event.target.checked)} />{" "}
              This is a scheduled routine that runs on its own. It can draft guides but can never mark them reviewed.
            </label>}
            <p className="field-help">When you allow it, you return to {ready.destination}.</p>
            <button type="button" className="button-primary" disabled={busy} onClick={() => void decide(true)}>Allow</button>{" "}
          </>}
          <button type="button" className="button-secondary" disabled={busy} onClick={() => void decide(false)}>Cancel</button>
        </>}
      </section>
    </main>
    <footer className="portal-footer"><span>Learning at Central Reform Congregation</span><span>Your account and reading stay private.</span></footer>
  </div>;
}
