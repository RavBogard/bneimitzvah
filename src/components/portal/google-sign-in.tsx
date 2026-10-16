"use client";

import { useEffect, useRef, useState } from "react";
import { parseAuthResult, parseGoogleChallenge, requestPortal, type GoogleChallenge } from "./api";

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
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.referrerPolicy = "no-referrer";
    script.onload = () => { clearTimeout(timeout); const client = identity(); if (client) resolve(client); else fail(); };
    script.onerror = fail; document.head.appendChild(script);
  });
  return library;
}

export function GoogleSignIn({ disabled, onBegin, onFinish }: { disabled: boolean; onBegin: () => boolean; onFinish: (next?: "/" | "/invitations/accept") => void }) {
  const container = useRef<HTMLDivElement>(null), epoch = useRef(0), callbacks = useRef({ onBegin, onFinish });
  callbacks.current = { onBegin, onFinish };
  const [phase, setPhase] = useState<"preparing" | "ready" | "waiting" | "confirming" | "failed">("preparing");
  const cancel = useRef<() => void>(() => {});
  useEffect(() => {
    const turn = ++epoch.current, controller = new AbortController();
    let attempt: GoogleChallenge | undefined, started = false, submitted = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const live = () => turn === epoch.current && !controller.signal.aborted;
    const invalidate = () => { attempt = undefined; if (expiry) clearTimeout(expiry); };
    const fail = () => { if (!live()) return; invalidate(); setPhase("failed"); if (started) callbacks.current.onFinish(); started = false; };
    const begin = () => {
      if (!live() || !attempt || attempt.expiresAt <= Date.now() || submitted) return false;
      if (!started) { if (!callbacks.current.onBegin()) return false; started = true; setPhase("waiting"); }
      return true;
    };
    cancel.current = () => { if (submitted) return; fail(); epoch.current++; controller.abort(); };
    void Promise.all([requestPortal("/api/auth/google/challenge", {}, controller.signal).then(parseGoogleChallenge), loadIdentity()]).then(([challenge, client]) => {
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
            if (live()) callbacks.current.onFinish(next);
          }).catch(fail);
        } });
      container.current.replaceChildren();
      client.renderButton(container.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular",
        width: Math.max(200, Math.min(400, Math.floor(container.current.getBoundingClientRect().width))), click_listener: () => { begin(); } });
      setPhase("ready");
    }).catch(fail);
    return () => { epoch.current++; invalidate(); controller.abort(); };
  }, []);
  return <div className="google-sign-in">
    <div ref={container} inert={disabled || phase !== "ready"} hidden={phase !== "ready"} aria-label="Sign in with Google" />
    {phase === "preparing" && <p className="field-help" role="status">Preparing Google sign-in…</p>}
    {phase === "waiting" && <><p className="field-help" role="status">Continue in the Google window. If it did not open, cancel and use email below.</p><button type="button" className="button-text" onClick={() => cancel.current()}>Cancel Google sign-in</button></>}
    {phase === "confirming" && <p className="field-help" role="status">Confirming your Google sign-in…</p>}
    {phase === "failed" && <><p className="field-help" role="status">Google sign-in is unavailable or this attempt ended. You can use email below.</p><button type="button" className="button-text" disabled={disabled} onClick={() => window.location.reload()}>Try Google again</button></>}
  </div>;
}
