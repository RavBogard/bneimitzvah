"use client";

import { useEffect, useRef, useState } from "react";
import { parseAuthResult, parseGoogleChallenge, parseGoogleRedirect, requestPortal, type GoogleChallenge } from "./api";
import { createGoogleAttemptScope, type GoogleIntent, type AuthDestination } from "./sign-in-boundary";

type GoogleIdentity = {
  initialize(options: { client_id: string; nonce: string; ux_mode: "popup"; auto_select: false; callback: (result: { credential?: unknown }) => void }): void;
  renderButton(parent: HTMLElement, options: { type: "standard"; theme: "outline"; size: "large"; text: "continue_with"; shape: "rectangular"; width: number; click_listener: () => void }): void;
};
const identity = () => (window as Window & { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id;
let library: Promise<GoogleIdentity> | undefined;
function loadIdentity(): Promise<GoogleIdentity> {
  const current = identity(); if (current) return Promise.resolve(current);
  if (!library) library = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => { clearTimeout(timeout); script.remove(); library = undefined; reject(new Error("Google unavailable")); };
    const timeout = setTimeout(fail, 12_000);
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onload = () => { clearTimeout(timeout); const client = identity(); if (client) resolve(client); else fail(); };
    script.onerror = fail; document.head.appendChild(script);
  });
  return library;
}

const SIGN_IN_WAITING = "Continue in the Google window. If it did not open, cancel and use email below.";
const SIGN_IN_FAILURE = "Google sign-in is unavailable or this attempt ended. You can use email below.";

/**
 * `waitingText`, `failureText` and `failureHelp` let a page without the email form say what fits there.
 * "Continue with Google in this window" is the redirect-mode fallback for browsers where the GIS popup
 * fails (some phones, in-app browsers): `redirectNext` names where Google returns ("connect" or "account";
 * otherwise the server chooses as for the popup), and `beforeRedirect` runs just before the page leaves.
 */
export function GoogleSignIn({ disabled, intent, onBegin, onFinish, onFailed, waitingText = SIGN_IN_WAITING, failureText = SIGN_IN_FAILURE, failureHelp, redirectNext, beforeRedirect }: {
  disabled: boolean; intent?: GoogleIntent; onBegin: () => boolean; onFinish: (next?: AuthDestination) => void;
  waitingText?: string; failureText?: string; failureHelp?: readonly string[];
  redirectNext?: "connect" | "account"; beforeRedirect?: () => void; onFailed?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null), epoch = useRef(0), callbacks = useRef({ onBegin, onFinish });
  callbacks.current = { onBegin, onFinish };
  const currentIntent = useRef(intent); currentIntent.current = intent;
  const [phase, setPhase] = useState<"preparing" | "ready" | "waiting" | "confirming" | "failed">("preparing");
  const cancel = useRef<() => void>(() => {});
  // "Try Google again" starts a fresh attempt in place (a new challenge and nonce); reloading the page
  // would lose the consent page's in-memory request. The old attempt's scope is retired first.
  const [round, setRound] = useState(0);
  const [leaving, setLeaving] = useState(false), leavingRef = useRef(false);
  const before = useRef(beforeRedirect); before.current = beforeRedirect;
  const failed = useRef(onFailed); failed.current = onFailed;
  useEffect(() => { if (phase === "failed") failed.current?.(); }, [phase]);
  const next = redirectNext ?? (intent === "account" ? "account" : undefined);
  useEffect(() => {
    // Back from Google via the back button restores this page from the cache: let it try again.
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted && leavingRef.current) { leavingRef.current = false; setLeaving(false); callbacks.current.onFinish(); }
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  function redirect() {
    if (leavingRef.current || disabled || phase === "confirming") return;
    cancel.current(); // Retire any popup attempt first, so its callback can never post.
    if (!callbacks.current.onBegin()) return;
    leavingRef.current = true; setLeaving(true);
    before.current?.();
    void requestPortal("/api/auth/google/redirect", next ? { next } : {}).then(parseGoogleRedirect)
      .then(url => window.location.assign(url))
      .catch(() => { leavingRef.current = false; setLeaving(false); setPhase("failed"); callbacks.current.onFinish(); });
  }
  useEffect(() => {
    const turn = ++epoch.current, controller = createGoogleAttemptScope(() => turn === epoch.current && currentIntent.current === intent);
    let attempt: GoogleChallenge | undefined, started = false, submitted = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const live = controller.live;
    const invalidate = () => { attempt = undefined; if (expiry) clearTimeout(expiry); };
    const fail = () => { if (!live()) return; invalidate(); setPhase("failed"); if (started) callbacks.current.onFinish(); started = false; };
    const begin = () => {
      if (!live() || !attempt || attempt.expiresAt <= Date.now() || submitted) return false;
      if (!started) { if (!callbacks.current.onBegin()) return false; started = true; setPhase("waiting"); }
      return true;
    };
    cancel.current = () => { if (submitted) return; fail(); epoch.current++; controller.abort(); };
    setPhase("preparing"); container.current?.replaceChildren();
    if (intent !== undefined && intent !== "account") { fail(); return () => { epoch.current++; controller.abort(); }; }
    void Promise.all([requestPortal("/api/auth/google/challenge", intent === "account" ? { intent } : {}, controller.signal).then(parseGoogleChallenge), loadIdentity()]).then(([challenge, client]) => {
      if (!live() || !container.current) return;
      attempt = challenge;
      expiry = setTimeout(fail, Math.max(0, challenge.expiresAt - Date.now()));
      client.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, ux_mode: "popup", auto_select: false,
        callback: result => {
          if (!live() || !attempt || submitted || !begin()) return;
          if (typeof result.credential !== "string" || result.credential.length > 12 * 1024) { fail(); return; }
          submitted = true; setPhase("confirming");
          const body = { credential: result.credential, challengeId: attempt.challengeId, csrfToken: attempt.csrfToken };
          invalidate();
          void requestPortal("/api/auth/sign-in/social", body, controller.signal).then(parseAuthResult).then(next => {
            controller.accept(() => callbacks.current.onFinish(next));
          }).catch(fail);
        } });
      container.current.replaceChildren();
      client.renderButton(container.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular",
        width: Math.max(200, Math.min(400, Math.floor(container.current.getBoundingClientRect().width))), click_listener: () => { begin(); } });
      setPhase("ready");
    }).catch(fail);
    return () => { epoch.current++; invalidate(); controller.abort(); container.current?.replaceChildren(); if (started) callbacks.current.onFinish(); };
  }, [intent, round]);
  return <div className="google-sign-in">
    <div ref={container} inert={disabled || phase !== "ready"} hidden={phase !== "ready"} aria-label="Sign in with Google" />
    {phase === "preparing" && <p className="field-help" role="status">Preparing Google sign-in…</p>}
    {phase === "waiting" && <><p className="field-help" role="status">{waitingText}</p><button type="button" className="button-text" onClick={() => cancel.current()}>Cancel Google sign-in</button></>}
    {phase === "confirming" && <p className="field-help" role="status">Confirming your Google sign-in…</p>}
    {phase === "failed" && <><p className="field-help" role="status">{failureText}</p><button type="button" className="button-text" disabled={disabled || leaving} onClick={() => setRound(value => value + 1)}>Try Google again</button></>}
    {phase !== "confirming" && <p className="google-redirect"><button type="button" className={phase === "failed" ? "button-secondary" : "button-text"} disabled={disabled || leaving} onClick={redirect}>
      {leaving ? "Opening Google…" : "Continue with Google in this window"}</button></p>}
    {phase === "failed" && failureHelp?.map(line => <p key={line} className="field-help">{line}</p>)}
  </div>;
}
