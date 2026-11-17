import { PortalRequestError } from "../api";

/**
 * Whether the held session is confirmed (session.ts). A session read that merely failed (offline, 503) on coming back leaves it
 * unconfirmed: the cookie may by now be another person's (a sign-in in another tab), so until a read confirms the same binding,
 * nothing goes out from this tab's workspace. One shell per tab holds this.
 */
let unconfirmed = false, recheck: () => void = () => undefined;

export function setSessionGate(next: boolean, onRecheck?: () => void) { unconfirmed = next; if (onRecheck) recheck = onRecheck; }
export const sessionConfirmed = () => !unconfirmed;

/** Refuses locally with a 409 (nothing is sent; the existing "try again" handling applies) and asks for a session re-read. */
export function requireConfirmedSession() { if (unconfirmed) { recheck(); throw new PortalRequestError(409); } }

/** `fetch` for workspace clients that write: a write (any method but GET or HEAD) waits for a confirmed session. */
export function gatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") { try { requireConfirmedSession(); } catch (error) { return Promise.reject(error); } }
  return fetch(input, init);
}
