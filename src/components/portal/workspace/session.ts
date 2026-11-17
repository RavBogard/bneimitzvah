"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSession, PortalRequestError, requestPortal, type SessionSummary } from "../api";
import { setSessionGate } from "./session-gate";

/**
 * - checking: no session is held yet (first load, or after a refusal or Check access again): nothing private is mounted.
 * - ready: the held session; the signed-in pages render with it.
 * - signed-out / access-changed / unavailable: the private subtree is unmounted and the shell says why.
 */
export type SessionPhase = "checking" | "ready" | "signed-out" | "access-changed" | "unavailable";
/** Coming back to a tab that was hidden or unfocused at least this long re-reads the session (a sign-out or role change in another tab). */
export const RETURN_RECHECK_MS = 2_000;
type Cause = "mount" | "return" | "denied" | "retry" | "refresh";
const phaseOf = (status: number): SessionPhase => status === 401 ? "signed-out" : status === 403 || status === 404 ? "access-changed" : "unavailable";

/**
 * The signed-in shell's one held session. It is read once when the shell mounts and again only when something calls for it:
 * - coming back to the tab after it was hidden or unfocused for RETURN_RECHECK_MS or more (focus, visibilitychange);
 * - a page restored from the back-forward cache (pageshow with persisted), always;
 * - a 401/403 from any read or write (`denied`), and Check access again (`retry`) or a page's explicit refresh (`refresh`).
 * Never on a client route change and never around a read: the server decides every read on its own.
 *
 * `clearPrivate` runs whenever what is held stops being this person's view: a refusal, a sign-out or another person's session.
 */
export function useHeldSession(clearPrivate: () => void) {
  const [held, setHeld] = useState<{ summary: SessionSummary | null; phase: SessionPhase }>({ summary: null, phase: "checking" });
  const binding = useRef<string | null>(null), request = useRef<AbortController | null>(null), phase = useRef<SessionPhase>("checking");
  const clear = useRef(clearPrivate); clear.current = clearPrivate;
  const show = useCallback((summary: SessionSummary | null, next: SessionPhase) => { phase.current = next; setHeld({ summary, phase: next }); }, []);

  /**
   * Unconfirmed: a read on coming back failed without a refusal (offline, 503), so the cookie may now be another person's. The
   * view stays (it was this person's), but session-gate.ts refuses every write and live owner until a read confirms the binding.
   */
  const unconfirmed = useRef(false);
  const confirm = useCallback((value: boolean) => { unconfirmed.current = value; setSessionGate(value); }, []);
  /** Resolves true when the same session is held and ready afterwards. */
  const read = useCallback((cause: Cause) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    // A sign-in with no membership yet gets one here (plan D1): the workspace never shows a person without a shelf.
    return fetchSession(requestPortal, controller.signal).then(next => {
      if (controller.signal.aborted) return false;
      if (request.current === controller) request.current = null;
      confirm(false);
      const otherPerson = binding.current !== null && binding.current !== next.sessionBinding;
      // Another person's session in this browser (a sign-out and sign-in in another tab): drop everything of the first one.
      if (otherPerson) clear.current();
      binding.current = next.sessionBinding;
      // After a refusal, the same person sees "Access has changed" until they ask again or open another page. The view is
      // not mounted again by itself, so a refusal that repeats can never turn into a request loop.
      show(next, cause === "denied" && !otherPerson ? "access-changed" : "ready");
      return cause !== "denied" && !otherPerson;
    }, (error: unknown) => {
      if (controller.signal.aborted) return false;
      if (request.current === controller) request.current = null;
      const status = error instanceof PortalRequestError ? error.status : 503;
      // A check on coming back that merely fails (offline, 503) keeps what was already shown, unconfirmed; only a refusal clears it.
      if ((cause === "return" || cause === "refresh") && ![401, 403, 404].includes(status)) { if (phase.current === "ready") confirm(true); return false; }
      confirm(false); clear.current(); binding.current = null;
      show(null, phaseOf(status));
      return false;
    });
  }, [show]);

  /**
   * The central 401/403 handling. Every refusal of a read or write ends here (workspace-reads.ts `refused`, and pages that
   * report one through serviceAuthorityFailed). Private state is dropped and the subtree unmounted at once, then the
   * session is read: signed out shows "Sign in to continue"; the same person shows "Access has changed"; another person
   * starts afresh as that person.
   */
  const denied = useCallback(() => {
    if (phase.current !== "ready") return; // A check is already under way, or the view is already gone.
    clear.current(); show(null, "checking"); void read("denied");
  }, [read, show]);
  /** Check access again (and opening another page from a failure state): read the session and mount the pages afresh. */
  const retry = useCallback(() => { clear.current(); show(null, "checking"); void read("retry"); }, [read, show]);
  /**
   * A page asking to re-check (its own refusal, or Refresh): the view stays while the session is read. When the view is
   * already gone or a check is under way it does nothing, so a refusal that reported `denied` and then asks to refresh
   * cannot bring the pages back by itself: only "Check access again" (`retry`) leaves a failure state.
   */
  const refresh = useCallback(() => phase.current === "ready" ? read("refresh") : Promise.resolve(false), [read]);

  /** While unconfirmed, any reason to look again (a write that was refused locally, coming online, coming back) reads the session once. */
  const recheck = useCallback(() => { if (unconfirmed.current && phase.current === "ready" && !request.current) void read("return"); }, [read]);

  useEffect(() => {
    setSessionGate(false, recheck);
    void read("mount");
    let awayAt: number | null = null;
    const away = () => { awayAt ??= Date.now(); };
    const back = () => {
      const since = awayAt; awayAt = null;
      if (unconfirmed.current) { recheck(); return; }
      if (since !== null && Date.now() - since >= RETURN_RECHECK_MS && phase.current === "ready") void read("return");
    };
    const online = () => recheck();
    const visibility = () => { if (document.visibilityState === "visible") back(); else away(); };
    // bfcache: a page restored from the back-forward cache may belong to a session that ended while it was away (signed out
    // in this or another tab). Always re-read; a 401 unmounts the private subtree at once.
    const restored = (event: PageTransitionEvent) => { if (event.persisted && phase.current === "ready") void read("return"); };
    window.addEventListener("blur", away); window.addEventListener("focus", back); window.addEventListener("pageshow", restored); window.addEventListener("online", online); document.addEventListener("visibilitychange", visibility);
    return () => {
      request.current?.abort(); request.current = null; unconfirmed.current = false; setSessionGate(false);
      window.removeEventListener("blur", away); window.removeEventListener("focus", back); window.removeEventListener("pageshow", restored); window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visibility);
    };
  }, [read, recheck]);

  return { summary: held.summary, phase: held.phase, binding: () => binding.current, denied, retry, refresh };
}
