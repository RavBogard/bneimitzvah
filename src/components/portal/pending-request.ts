// The consent page's pending OAuth request (Decided here, 2026-10-21; see MCP-DECIDED.md).
// Claude opens /connect#request=<signed request>. The page strips the fragment from the address bar
// and keeps a copy in this tab's sessionStorage, so a reload or a redirect-mode Google round trip in
// this tab can still finish. Only once Google sign-in has failed on the page does it also copy the
// request to the origin's localStorage, so Android's "Open in Chrome" from a Custom Tab finds it.
// A copy is used only while it is under ten minutes old and is removed when found stale, on Allow,
// Cancel, an expired answer and sign-out. It is only a convenience: the server verifies signature and
// expiry, and Allow still needs a staff session that Google created in this browser.

export const PENDING_REQUEST_KEY = "crc.connect.pending-request";
/** The server's TTL.request. */
export const PENDING_REQUEST_TTL_MS = 10 * 60_000;
const REQUEST = /^[A-Za-z0-9_.-]{1,8192}$/;
const FRAGMENT = /^#request=([A-Za-z0-9_.-]{1,8192})$/;

export type PendingStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This tab's storage, whichever the browser allows. */
export function tabStores(): PendingStore[] {
  try { if (typeof sessionStorage !== "undefined") return [sessionStorage]; } catch { /* blocked */ }
  return [];
}
/** This tab's and this origin's storage, whichever the browser allows. */
export function browserStores(): PendingStore[] {
  const stores = tabStores();
  try { if (typeof localStorage !== "undefined") stores.push(localStorage); } catch { /* blocked */ }
  return stores;
}

function recall(store: PendingStore, now: number): string | null {
  let raw: string | null;
  try { raw = store.getItem(PENDING_REQUEST_KEY); } catch { return null; }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const { request, storedAt } = value as { request?: unknown; storedAt?: unknown };
      const age = typeof storedAt === "number" && Number.isFinite(storedAt) ? now - storedAt : NaN;
      if (typeof request === "string" && REQUEST.test(request) && age >= 0 && age < PENDING_REQUEST_TTL_MS) return request;
    }
  } catch { /* malformed */ }
  try { store.removeItem(PENDING_REQUEST_KEY); } catch { /* blocked */ }
  return null;
}

/** Store the copy (this tab only by default; the consent page widens it once Google has failed). */
export function rememberPendingRequest(request: string, stores: PendingStore[] = tabStores(), now = Date.now()) {
  if (!REQUEST.test(request)) return;
  const stored = JSON.stringify({ request, storedAt: now });
  for (const store of stores) { try { store.setItem(PENDING_REQUEST_KEY, stored); } catch { /* full or blocked */ } }
}

/** Drop every stored copy: after Allow, Cancel, an expired answer or sign-out. */
export function forgetPendingRequest(stores: PendingStore[] = browserStores()) {
  for (const store of stores) { try { store.removeItem(PENDING_REQUEST_KEY); } catch { /* blocked */ } }
}

/**
 * The request this page acts on. A fragment wins: it is stored in `write` (this tab) and any other
 * copy is dropped. Only when there is no fragment at all does the page fall back to a stored copy
 * under ten minutes old, this tab's first. A malformed fragment is never replaced by a stored copy.
 */
export function resolvePendingRequest(hash: string, read: PendingStore[] = browserStores(), now = Date.now(), write: PendingStore[] = tabStores()): string | null {
  if (hash && hash !== "#") {
    const match = FRAGMENT.exec(hash);
    if (!match) return null;
    forgetPendingRequest(read.filter(store => !write.includes(store)));
    rememberPendingRequest(match[1], write, now);
    return match[1];
  }
  let found: string | null = null;
  for (const store of read) { const request = recall(store, now); if (request && !found) found = request; }
  return found;
}
