import { emptyProgress, parseProgress, serializeProgress, type Progress, type ProgressStore } from "../../lib/learn/progress";

/**
 * Signed-in course progress in the browser (plan, slice 3). The browser copy stays the working copy; the
 * account's is fetched once per page and written back after changes.
 * - First sign-in in this browser: its progress is merged into the account's (lessons the union with the
 *   earliest done, cards the higher box), and only the server's answer replaces the local copy.
 * - Afterwards: a change is written under the version last seen; a stale version merges instead.
 * - A browser holding another account's progress (a shared device) takes this account's from the server and
 *   never folds the other's into it.
 * Signed out, or with no live grant, nothing leaves the browser.
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
function writeMarker(storage: Storage | null, marker: Marker) { try { storage?.setItem(SYNC_KEY, JSON.stringify(marker)); } catch { /* The next page load starts over. */ } }

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
      const response = await io.fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = response.headers.get("content-type")?.toLowerCase().startsWith("application/json") ? await response.text() : "";
      if (text.length > LIMIT) return { status: 503, value: null };
      let value: unknown = null; try { value = text ? JSON.parse(text) : null; } catch { value = null; }
      return { status: response.status, value };
    } catch { return { status: 503, value: null }; }
  }
  /** The server's document becomes the browser's, and the marker records whose and which version. */
  function adopt(remote: Remote) {
    const progress = remote.progress ?? emptyProgress();
    io.store.save(progress); owner = remote.owner;
    writeMarker(io.storage(), { owner: remote.owner, version: remote.version, dirty: false });
    io.onProgress(progress); setAccount({ state: "synced", until: remote.until });
  }
  function refused(status: number) {
    if (status === 401) setAccount({ state: "signed-out" });
    else if (status === 403) setAccount({ state: "not-eligible" });
  }
  async function merge(progress: Progress) {
    const answer = await call("/api/learn/progress/merge", { progress });
    const remote = answer.status === 200 ? parseRemote(answer.value) : null;
    if (remote) adopt(remote); else refused(answer.status);
  }
  async function push() {
    if (writing) { again = true; return; }
    const marker = readMarker(io.storage());
    if (!marker || marker.owner !== owner || !marker.dirty || account.state !== "synced") return;
    writing = true;
    try {
      const progress = io.store.load();
      const answer = await call("/api/learn/progress/put", { progress, expectedVersion: marker.version });
      const remote = answer.status === 200 ? parseRemote(answer.value) : null;
      if (remote) {
        // A change made while this write was in flight stays dirty and goes next.
        const changed = serializeProgress(io.store.load()) !== serializeProgress(progress);
        owner = remote.owner; writeMarker(io.storage(), { owner: remote.owner, version: remote.version, dirty: changed });
        if (changed) again = true;
      } else if (answer.status === 409) await merge(progress);
      else refused(answer.status);
    } finally { writing = false; if (again) { again = false; void push(); } }
  }
  return Object.freeze({
    get account() { return account; },
    /** Once per page: learn whose this browser's progress is, and bring the two copies together. */
    async start() {
      const answer = await call("/api/learn/progress");
      if (answer.status !== 200) { refused(answer.status); return; }
      const remote = parseRemote(answer.value); if (!remote) return;
      const marker = readMarker(io.storage()), local = io.store.load();
      if (!marker) { owner = remote.owner; await merge(local); return; }
      if (marker.owner !== remote.owner) { adopt(remote); return; }
      owner = remote.owner;
      if (marker.version !== remote.version) { if (marker.dirty) await merge(local); else adopt(remote); return; }
      setAccount({ state: "synced", until: remote.until });
      if (marker.dirty) await push();
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
