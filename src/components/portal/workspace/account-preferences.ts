import { changedFields, EMPTY_PREFERENCES, overlayPreferences, parsePreferences, PREFERENCE_FIELDS, PREFERENCE_TEXT_SIZES, PREFERENCE_TIKKUN_VIEWS, PREFERENCE_WORKS,
  PREFERENCE_MAX_WORKS, samePreferences, type PreferenceField, type Preferences } from "../../../lib/account-preferences/document";

/**
 * The account keeps a signed-in person's preferred commentaries and reading settings (release 1.7 M3b).
 * This browser's copy (the personal reader's two keys below) is the working copy and the signed-out and offline
 * fallback; the account's is the truth once signed in.
 * - The front door starts the sync for a signed-in account that keeps saved readings (its session's `saved` flag),
 *   and marks this browser active. /read starts it only while this browser is active, so a visitor who never
 *   signed in here never asks a signed-in route.
 * - First sign-in, with no account copy yet: this browser's remembered choices are copied up.
 * - An account copy: it wins and is written back into this browser exactly (a field it lacks is no longer remembered).
 *   Unsent changes this browser made while signed in to the same account are laid over it and sent.
 * - Another account's copy in this browser (a shared device): never copied up; this account's replaces it.
 * - While signed in, a change is saved to this browser at once and to the account shortly after, under the revision
 *   last seen; a stale revision lays the changed fields over the account's current copy and sends again.
 * - Signed out (401) or refused (403): this browser becomes inactive and keeps what it has. Any other failure keeps
 *   the change unsent and tries again later.
 * Turning every commentary off is a choice and is kept as one: the account never puts the default back.
 */
export const PREFERENCES_SYNC_KEY = "crc-torah:preferences-sync/v1";
/** The personal reader's keys: study-lens.ts LENS_STORAGE.weekly and reading-prefs.ts scopeKey(null) (a test holds both). */
export const BROWSER_PREFERENCE_KEYS = Object.freeze({ lens: "crc-torah-lens-v1:weekly", reading: "crc-bm-reading-prefs-v2:shared" });
export const PREFERENCES_SYNC_DELAY_MS = 1200;
export const PREFERENCES_PATHS = Object.freeze({ get: "/api/saved/preferences", put: "/api/saved/preferences/put" });
export type PreferencesAccount = "unknown" | "signed-out" | "not-eligible" | "synced";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Marker = Readonly<{ owner: string; revision: number; changed: readonly PreferenceField[]; active: boolean }>;
export type RemotePreferences = Readonly<{ owner: string; preferences: Preferences | null; revision: number }>;
const OWNER = /^[a-f0-9]{32}$/, LIMIT = 16 * 1024, MAX_REVISION = 2147483647;

function readJson(storage: Store | null, key: string): Record<string, unknown> {
  try {
    const text = storage?.getItem(key); if (!text || text.length > 4096) return {};
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

/** What this browser remembers for the personal reader, as a document: only the fields the person chose. */
export function browserPreferences(storage: Store | null): Preferences {
  const lens = readJson(storage, BROWSER_PREFERENCE_KEYS.lens), reading = readJson(storage, BROWSER_PREFERENCE_KEYS.reading);
  const out: Record<string, unknown> = { version: 1 };
  // The Study lens keeps registered works in registry order, at most three (normalizeWorks); [] is "none", a choice.
  if (Array.isArray(lens.works)) out.works = PREFERENCE_WORKS.filter(work => (lens.works as unknown[]).includes(work)).slice(0, PREFERENCE_MAX_WORKS);
  if (typeof lens.english === "boolean") out.studyEnglish = lens.english;
  if (typeof reading.colors === "boolean") out.colors = reading.colors;
  if (typeof reading.translation === "boolean") out.translation = reading.translation;
  if ((PREFERENCE_TEXT_SIZES as readonly unknown[]).includes(reading.size)) out.size = reading.size;
  // The earlier on/off tikkun control carries over as reading-prefs.ts reads it: on was the column beside the text.
  if ((PREFERENCE_TIKKUN_VIEWS as readonly unknown[]).includes(reading.tikkunView)) out.tikkunView = reading.tikkunView;
  else if (typeof reading.tikkun === "boolean") out.tikkunView = reading.tikkun ? "beside" : "off";
  return parsePreferences(out) ?? EMPTY_PREFERENCES;
}

/** Write a document into this browser exactly; the lens key keeps its last-used lens, which stays this browser's own. */
export function writeBrowserPreferences(storage: Store | null, value: Preferences): boolean {
  if (!storage) return false;
  const lens = readJson(storage, BROWSER_PREFERENCE_KEYS.lens), nextLens: Record<string, unknown> = {}, nextReading: Record<string, unknown> = {};
  if (lens.lens === "lein" || lens.lens === "study") nextLens.lens = lens.lens;
  if (value.works) nextLens.works = [...value.works];
  if (value.studyEnglish !== undefined) nextLens.english = value.studyEnglish;
  for (const field of ["colors", "translation", "size", "tikkunView"] as const) if (value[field] !== undefined) nextReading[field] = value[field];
  try {
    for (const [key, next] of [[BROWSER_PREFERENCE_KEYS.lens, nextLens], [BROWSER_PREFERENCE_KEYS.reading, nextReading]] as const)
      if (Object.keys(next).length) storage.setItem(key, JSON.stringify(next)); else storage.removeItem(key);
    return true;
  } catch { return false; }
}

function readMarker(storage: Store | null): Marker | null {
  const value = readJson(storage, PREFERENCES_SYNC_KEY);
  if (Object.keys(value).length !== 4 || typeof value.owner !== "string" || !OWNER.test(value.owner) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || (value.revision as number) > MAX_REVISION || typeof value.active !== "boolean" || !Array.isArray(value.changed)
    || value.changed.some(field => !(PREFERENCE_FIELDS as readonly unknown[]).includes(field))) return null;
  return { owner: value.owner, revision: value.revision as number, changed: [...new Set(value.changed as PreferenceField[])], active: value.active };
}
function writeMarker(storage: Store | null, marker: Marker) { try { storage?.setItem(PREFERENCES_SYNC_KEY, JSON.stringify(marker)); } catch { /* Kept for this page only. */ } }

/** The account's answer, strictly: anything unexpected is no answer. */
export function parseRemotePreferences(value: unknown): RemotePreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 4 || row.ok !== true || typeof row.owner !== "string" || !OWNER.test(row.owner) || !Number.isSafeInteger(row.revision)
    || (row.revision as number) < 0 || (row.revision as number) > MAX_REVISION) return null;
  const preferences = row.preferences === null ? null : parsePreferences(row.preferences);
  if (row.preferences !== null && !preferences || (preferences === null) !== (row.revision === 0)) return null;
  return { owner: row.owner, preferences, revision: row.revision as number };
}
/** A 409's current copy, strictly. */
function conflictCurrent(value: unknown): RemotePreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && row.ok === false && row.code === "conflict" ? parseRemotePreferences(row.current) : null;
}

export type PreferencesSyncIo = Readonly<{
  fetch: typeof fetch; storage(): Store | null;
  /** The account's copy was written into this browser: the reader shows it. */
  onApplied(): void;
  timer?: (callback: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void;
}>;
export function createPreferencesSync(io: PreferencesSyncIo) {
  let account: PreferencesAccount = "unknown", owner: string | null = null, base: Preferences = EMPTY_PREFERENCES, revision = 0;
  let pending: unknown = null, writing = false, again = false, starting: Promise<void> | null = null;
  const marker = (changed: readonly PreferenceField[]) => writeMarker(io.storage(), { owner: owner!, revision, changed: [...new Set(changed)], active: true });
  const apply = (value: Preferences) => { writeBrowserPreferences(io.storage(), value); io.onApplied(); };
  async function call(path: string, body?: unknown): Promise<{ status: number; value: unknown }> {
    try {
      const response = await io.fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        keepalive: body !== undefined, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const text = response.headers.get("content-type")?.toLowerCase().startsWith("application/json") ? await response.text() : "";
      if (text.length > LIMIT) return { status: 503, value: null };
      let value: unknown = null; try { value = text ? JSON.parse(text) : null; } catch { value = null; }
      return { status: response.status, value };
    } catch { return { status: 503, value: null }; }
  }
  /** Signed out or refused: this browser stops asking until the front door sees the account again, and keeps what it has. */
  function refused(status: number) {
    if (status !== 401 && status !== 403) return false;
    account = status === 401 ? "signed-out" : "not-eligible";
    const current = readMarker(io.storage());
    if (current) writeMarker(io.storage(), { ...current, active: false });
    return true;
  }
  function adopt(remote: RemotePreferences) { owner = remote.owner; revision = remote.revision; base = remote.preferences ?? EMPTY_PREFERENCES; account = "synced"; }
  /**
   * Send `value` under the revision last seen. `copy`: the first copy-up, where an account copy found already there
   * wins outright. Otherwise a stale revision lays this browser's changed fields over the current copy and sends again.
   */
  async function send(value: Preferences, copy: boolean, attempt = 0): Promise<void> {
    // `owner` names the account this browser synced with: if the session became another account meanwhile, nothing is written.
    const answer = await call(PREFERENCES_PATHS.put, { preferences: JSON.parse(JSON.stringify(value)), expectedRevision: revision, owner });
    const remote = answer.status === 200 ? parseRemotePreferences(answer.value) : null;
    if (remote && remote.owner === owner) {
      adopt(remote);
      // Whatever changed in this browser while the request was out stays changed and is sent next.
      const moved = changedFields(value, browserPreferences(io.storage()));
      marker(moved);
      if (moved.length) schedule();
      return;
    }
    const current = answer.status === 409 ? conflictCurrent(answer.value) : null;
    if (current && current.owner === owner) {
      const changed = copy ? [] : readMarker(io.storage())?.changed ?? [];
      adopt(current);
      const next = overlayPreferences(base, browserPreferences(io.storage()), changed);
      apply(next); marker(changed);
      if (changed.length && !samePreferences(next, base) && attempt < 2) await send(next, false, attempt + 1);
      return;
    }
    // Another account answered (the session changed): stop here; the next page start sorts out whose browser this is.
    if (remote || current) { account = "unknown"; return; }
    refused(answer.status);
  }
  async function push() {
    if (writing) { again = true; return; }
    const current = readMarker(io.storage());
    if (account !== "synced" || !current || current.owner !== owner || !current.changed.length) return;
    writing = true;
    try { await send(overlayPreferences(base, browserPreferences(io.storage()), current.changed), false); }
    finally { writing = false; if (again) { again = false; void push(); } }
  }
  function schedule() {
    if (pending !== null) (io.clearTimer ?? clearTimeout)(pending as ReturnType<typeof setTimeout>);
    pending = (io.timer ?? setTimeout)(() => { pending = null; void push(); }, PREFERENCES_SYNC_DELAY_MS);
  }
  async function begin(activate: boolean) {
    const known = readMarker(io.storage());
    // /read asks only while this browser is active for an account; the front door asks for a signed-in account.
    if (!activate && !known?.active) return;
    const answer = await call(PREFERENCES_PATHS.get);
    if (answer.status !== 200) { refused(answer.status); return; }
    const remote = parseRemotePreferences(answer.value); if (!remote) return;
    if (known && known.owner !== remote.owner) {
      // Another account's choices (a shared device): never copied up. This account's copy, or none, replaces them.
      adopt(remote); apply(base); marker([]);
      return;
    }
    adopt(remote);
    const local = browserPreferences(io.storage());
    if (!remote.preferences) {
      // First sign-in: this browser's remembered choices become the account's.
      marker([]);
      if (changedFields(EMPTY_PREFERENCES, local).length) await send(local, true);
      return;
    }
    // The account wins; this account's own unsent changes from this browser are laid over it.
    const changed = known?.changed ?? [], next = overlayPreferences(base, local, changed);
    apply(next); marker(changed);
    if (changed.length && !samePreferences(next, base)) await push();
  }
  return Object.freeze({
    get account() { return account; },
    /** Once per page (again when back online). `activate`: the page knows the session keeps saved readings. */
    start(activate: boolean): Promise<void> {
      if (!starting) starting = begin(activate).finally(() => { starting = null; });
      return starting;
    },
    /** After this browser saved a personal-reader choice: mark what changed, and save it to the account shortly. */
    changed() {
      if (account !== "synced" || owner === null) return;
      const current = readMarker(io.storage());
      if (!current || current.owner !== owner) return;
      const fields = changedFields(base, browserPreferences(io.storage()));
      if (!fields.length && !current.changed.length) return;
      marker([...current.changed, ...fields]);
      schedule();
    },
    /** Write now (the page is hiding). */
    flush() { if (pending !== null) { (io.clearTimer ?? clearTimeout)(pending as ReturnType<typeof setTimeout>); pending = null; void push(); } },
  });
}
export type PreferencesSync = ReturnType<typeof createPreferencesSync>;

// One sync per page, shared by the front door, the personal reader's lens and its reading settings.
let shared: PreferencesSync | null = null, startedWith: boolean | null = null;
const appliers = new Set<() => void>();
/** Called whenever the account's copy is written into this browser. */
export function onPreferencesApplied(listener: () => void): () => void { appliers.add(listener); return () => { appliers.delete(listener); }; }
/** Start (or join) this page's sync. `activate`: a signed-in account that keeps saved readings is known to be here. */
export function startAccountPreferences(activate: boolean) {
  if (typeof window === "undefined") return;
  if (!shared) {
    const sync = createPreferencesSync({ fetch: (...args) => fetch(...args), storage: () => { try { return window.localStorage; } catch { return null; } },
      onApplied: () => { for (const listener of [...appliers]) listener(); } });
    shared = sync;
    const hide = () => { if (document.visibilityState !== "visible") sync.flush(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", () => sync.flush());
    window.addEventListener("online", () => { void sync.start(false); });
  }
  // Once per page; again only when the front door learns of the account after a start that could not ask.
  if (startedWith === true || startedWith === activate) return;
  startedWith = activate;
  void shared.start(activate);
}
/** A personal-reader choice was just saved in this browser. */
export function notePreferencesChanged() { shared?.changed(); }
