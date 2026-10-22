// The consent page's pending OAuth request (Decided here, 2026-10-21; see MCP-DECIDED.md).
// Claude opens /connect#request=<signed request>. The page strips the fragment from the address bar,
// and keeps a copy in this tab's sessionStorage and the origin's localStorage for at most ten minutes,
// so a reload, or Android's "Open in Chrome" from a Custom Tab, can still finish the connection.
// The copy is only a convenience: the server verifies the signature and expiry, and Allow still
// needs a fresh Google sign-in by staff in this browser.

export const PENDING_REQUEST_KEY = "crc.connect.pending-request";
/** The server's TTL.request. */
export const PENDING_REQUEST_TTL_MS = 10 * 60_000;
const REQUEST = /^[A-Za-z0-9_.-]{1,8192}$/;
const FRAGMENT = /^#request=([A-Za-z0-9_.-]{1,8192})$/;

export type PendingStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This tab's and this origin's storage, whichever the browser allows. */
export function browserStores(): PendingStore[] {
  const stores: PendingStore[] = [];
  try { if (typeof sessionStorage !== "undefined") stores.push(sessionStorage); } catch { /* blocked */ }
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

/** Drop every stored copy: after Allow, Cancel, or an expired answer. */
export function forgetPendingRequest(stores: PendingStore[] = browserStores()) {
  for (const store of stores) { try { store.removeItem(PENDING_REQUEST_KEY); } catch { /* blocked */ } }
}

/**
 * The request this page acts on. A fragment wins and is stored (replacing any older copy); only
 * when there is no fragment at all does the page fall back to a stored copy younger than ten minutes.
 * A malformed fragment is never replaced by a stored copy.
 */
export function resolvePendingRequest(hash: string, stores: PendingStore[] = browserStores(), now = Date.now()): string | null {
  if (hash && hash !== "#") {
    const match = FRAGMENT.exec(hash);
    if (!match) return null;
    const stored = JSON.stringify({ request: match[1], storedAt: now });
    for (const store of stores) { try { store.setItem(PENDING_REQUEST_KEY, stored); } catch { /* full or blocked */ } }
    return match[1];
  }
  let found: string | null = null;
  for (const store of stores) { const request = recall(store, now); if (request && !found) found = request; }
  return found;
}
