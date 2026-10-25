import { emptyProgress, mergeProgress, parseProgress, serializeProgress, type Progress, type ProgressStore } from "../../lib/learn/progress";

/**
 * Signed-in course progress in the browser (plan, slice 3). The browser's stored copy is the working copy;
 * the account's is fetched once per page and written back after changes.
 * - First sign-in in this browser: its progress is merged into the account's (lessons the union with the
 *   earliest done, cards the higher box), and only the server's answer replaces the local copy.
 * - Afterwards: a change is written under the version last seen; a stale version merges instead.
 * - A change made while a request is out is never overwritten by its answer: it is merged in and sent next.
 * - A browser holding another account's progress (a shared device) takes this account's from the server and
 *   never folds the other's into it.
 * - Signed out (a 401) after a clean sync, the device is cleared: the account holds it all, and the next person
 *   at a shared device starts fresh. Unsent changes are kept for that account. A refusal (a 403) clears nothing
 *   when it names this browser's own account (the learner may still be working here); one that names another
 *   account, or none, is the next person at a shared device and is treated like a sign-out. Any other failure
 *   clears nothing.
 * Signed out, or refused, nothing leaves the browser.
 * - Every put and merge names the account the browser holds progress for, and the server refuses another (a 403
 *   naming the signed-in account). An answer naming another account, a 409's included, is never settled or merged:
 *   another tab may have switched accounts while this one held the first account's changes, which stay here unsent.
 */
export const SYNC_KEY = "crc-torah:learn-sync/v1";
export type Account = Readonly<{ state: "unknown" | "signed-out" | "not-eligible" } | { state: "synced"; until: string | null }>;
type Marker = Readonly<{ owner: string; version: number; dirty: boolean }>;
type Remote = Readonly<{ owner: string; progress: Progress | null; version: number; until: string | null }>;
const OWNER = /^[a-f0-9]{32}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, LIMIT = 128 * 1024;
export const SYNC_DELAY_MS = 1200;

function readMarker(storage: Storage | null): Marker | null {
  try {
    const text = storage?.getItem(SYNC_KEY); if (!text || text.length > 512) return null;
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3 || typeof value.owner !== "string" || !OWNER.test(value.owner)
      || !Number.isSafeInteger(value.version) || (value.version as number) < 0 || typeof value.dirty !== "boolean") return null;
    return { owner: value.owner, version: value.version as number, dirty: value.dirty };
  } catch { return null; }
}
function writeMarker(storage: Storage | null, marker: Marker): boolean { try { storage?.setItem(SYNC_KEY, JSON.stringify(marker)); return !!storage; } catch { return false; } }
function dropMarker(storage: Storage | null) { try { storage?.removeItem(SYNC_KEY); } catch { /* Nothing to clear. */ } }
const same = (a: Progress, b: Progress) => serializeProgress(a) === serializeProgress(b);

/** The account's answer, strictly: anything unexpected is no answer. */
export function parseRemote(value: unknown): Remote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 5 || row.ok !== true || typeof row.owner !== "string" || !OWNER.test(row.owner) || !Number.isSafeInteger(row.version) || (row.version as number) < 0
    || row.until !== null && (typeof row.until !== "string" || !DATE.test(row.until))) return null;
  const progress = row.progress === null ? null : parseProgress(row.progress);
  if (row.progress !== null && !progress || (progress === null) !== (row.version === 0)) return null;
  return { owner: row.owner, progress, version: row.version as number, until: row.until as string | null };
}

/** The owner a 403 names (the refused membership's own), strictly; anything else names nobody. */
function refusedOwner(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 2 && row.error === "forbidden" && typeof row.owner === "string" && OWNER.test(row.owner) ? row.owner : null;
}

export type SyncIo = Readonly<{
  fetch: typeof fetch; storage(): Storage | null; store: ProgressStore;
  onProgress(progress: Progress): void; onAccount(account: Account): void;
  timer?: (callback: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void;
}>;
export function createProgressSync(io: SyncIo) {
  let account: Account = { state: "unknown" }, owner: string | null = null, pending: unknown = null, writing = false, again = false;
  const setAccount = (next: Account) => { account = next; io.onAccount(next); };
  async function call(path: string, body?: unknown): Promise<{ status: number; value: unknown }> {
    try {
      // keepalive lets the last write leave as the page hides; the body is bounded well under its 64 KB.
      const response = await io.fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        keepalive: body !== undefined, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const text = response.headers.get("content-type")?.toLowerCase().startsWith("application/json") ? await response.text() : "";
      if (text.length > LIMIT) return { status: 503, value: null };
      let value: unknown = null; try { value = text ? JSON.parse(text) : null; } catch { value = null; }
      return { status: response.status, value };
    } catch { return { status: 503, value: null }; }
  }
  /**
   * The server answered `remote` to a request that carried `sent` (null when nothing was sent). Whatever the
   * learner changed in this browser meanwhile is folded in and left to send, never overwritten; otherwise the
   * server's copy becomes the browser's. The marker is written only once the copy is saved.
   */
  function settle(remote: Remote, sent: Progress | null) {
    if (remote.owner !== owner) { otherAccount(remote.owner); return; }
    const server = remote.progress ?? emptyProgress(), now = io.store.load(), moved = sent !== null && !same(now, sent);
    const progress = moved ? mergeProgress(server, now) : server;
    if (!io.store.save(progress) || !writeMarker(io.storage(), { owner: remote.owner, version: remote.version, dirty: moved })) { setAccount({ state: "unknown" }); return; }
    io.onProgress(progress); setAccount({ state: "synced", until: remote.until });
    if (moved) queueMicrotask(() => { void push(); });
  }
  /**
   * Signed out, or refused as someone else: after a clean sync the device is cleared (the account has it all);
   * unsent changes stay. Refused as this browser's own account (403 naming it): nothing is cleared.
   */
  function refused(status: number, value: unknown) {
    if (status !== 401 && status !== 403) return;
    const marker = readMarker(io.storage());
    if (marker && !marker.dirty && !(status === 403 && refusedOwner(value) === marker.owner)) { io.store.save(emptyProgress()); dropMarker(io.storage()); io.onProgress(emptyProgress()); }
    setAccount({ state: status === 401 ? "signed-out" : "not-eligible" });
  }
  /** An answer for another account than the one this browser writes for: treated as that account's refusal, never folded in. */
  function otherAccount(name: string) { refused(403, { error: "forbidden", owner: name }); }
  async function merge(progress: Progress) {
    if (owner === null) return;
    const answer = await call("/api/learn/progress/merge", { progress, owner });
    const remote = answer.status === 200 ? parseRemote(answer.value) : null;
    if (remote) settle(remote, progress); else refused(answer.status, answer.value);
  }
  async function push() {
    if (writing) { again = true; return; }
    const marker = readMarker(io.storage());
    if (!marker || marker.owner !== owner || !marker.dirty || account.state !== "synced") return;
    writing = true;
    try {
      const progress = io.store.load();
      const answer = await call("/api/learn/progress/put", { progress, expectedVersion: marker.version, owner });
      const remote = answer.status === 200 ? parseRemote(answer.value) : null;
      if (remote) settle(remote, progress);
      // Another device wrote first: merge what this browser has now, including anything made since, unless the answer is another account's.
      else if (answer.status === 409) {
        const current = answer.value && typeof answer.value === "object" ? parseRemote((answer.value as { current?: unknown }).current) : null;
        if (current && current.owner !== owner) otherAccount(current.owner); else await merge(io.store.load());
      }
      else refused(answer.status, answer.value);
    } finally { writing = false; if (again) { again = false; void push(); } }
  }
  return Object.freeze({
    get account() { return account; },
    /** Once per page: learn whose this browser's progress is, and bring the two copies together. */
    async start() {
      const answer = await call("/api/learn/progress");
      if (answer.status !== 200) { refused(answer.status, answer.value); return; }
      const remote = parseRemote(answer.value); if (!remote) return;
      // The account signed in now is the one this page writes for, until the next start.
      owner = remote.owner;
      const marker = readMarker(io.storage());
      // First sign-in in this browser: merge its progress into the account's.
      if (!marker) { await merge(io.store.load()); return; }
      // Another account's copy (a shared device): take this account's, fold nothing in.
      if (marker.owner !== remote.owner) { settle(remote, null); return; }
      if (marker.dirty) {
        if (marker.version === remote.version) { setAccount({ state: "synced", until: remote.until }); await push(); }
        else await merge(io.store.load());
        return;
      }
      // Nothing unsent: the account's copy is the truth, whichever version this browser last saw.
      settle(remote, null);
    },
    /** After every local save: mark it, and write it back shortly when this browser is synced. */
    changed() {
      const marker = readMarker(io.storage());
      if (marker && !marker.dirty) writeMarker(io.storage(), { ...marker, dirty: true });
      if (account.state !== "synced") return;
      if (pending !== null) (io.clearTimer ?? clearTimeout)(pending as ReturnType<typeof setTimeout>);
      pending = (io.timer ?? setTimeout)(() => { pending = null; void push(); }, SYNC_DELAY_MS);
    },
    /** Write now (the page is hiding). */
    flush() { if (pending !== null) { (io.clearTimer ?? clearTimeout)(pending as ReturnType<typeof setTimeout>); pending = null; void push(); } },
  });
}
export type ProgressSync = ReturnType<typeof createProgressSync>;
