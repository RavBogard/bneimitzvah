import { useEffect, useRef, useState } from "react";
import { parseSession, PortalRequestError, requestPortal } from "../api";

type Access = "checking" | "ready" | "denied" | "expired" | "unavailable";
const RECHECK_MS = 60_000;

/** A read-only check. fetchSession can establish membership, so the preview must never use it. */
export function usePreviewAccess() {
  const [access, setAccess] = useState<Access>("checking");
  const retry = useRef(() => {});
  const binding = useRef<string | null>(null);

  useEffect(() => {
    let pending: AbortController | null = null;
    let closed = false;

    async function check() {
      if (closed || pending || document.visibilityState === "hidden") return;
      const controller = new AbortController();
      pending = controller;
      try {
        const summary = parseSession(await requestPortal("/api/session", undefined, controller.signal));
        if (controller.signal.aborted) return;
        if (!summary.membershipAvailable || !summary.roles.includes("admin") || (binding.current && binding.current !== summary.sessionBinding)) {
          close();
          return;
        }
        binding.current = summary.sessionBinding;
        setAccess("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof PortalRequestError && (error.status === 401 || error.status === 403)) close();
        else setAccess("unavailable");
      } finally {
        if (pending === controller) pending = null;
      }
    }

    function close() {
      closed = true;
      setAccess(binding.current ? "expired" : "denied");
    }

    function pause() {
      pending?.abort();
      pending = null;
      if (!closed) setAccess("checking");
    }

    function visibility() {
      if (document.visibilityState === "hidden") pause();
      else void check();
    }

    function restored(event: PageTransitionEvent) {
      if (!event.persisted) return;
      pause();
      void check();
    }

    function retryNow() {
      if (closed) return;
      setAccess("checking");
      void check();
    }

    const recheck = () => { void check(); };
    retry.current = retryNow;
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", restored);
    document.addEventListener("visibilitychange", visibility);
    const interval = window.setInterval(recheck, RECHECK_MS);
    recheck();

    return () => {
      pending?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("pageshow", restored);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return { access, opened: binding.current !== null, retry: () => retry.current() };
}
