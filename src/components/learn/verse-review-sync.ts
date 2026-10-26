import { emptyVerseReview, mergeVerseReview, parseVerseReview, serializeVerseReview, type VerseReview } from "../../lib/learn/verse-review";

/**
 * A student's own verse cards in the browser (1.9 N19). Unlike Learn's phrase progress there is no copy on the device: the
 * account's document is fetched once per page, changed in memory and written back under the version last seen, so a shared
 * device never holds one student's verse list for the next person. A stale version (another device wrote first) merges
 * the two, each card at the higher box, and writes again. A change made while a write is out is never overwritten by its
 * answer. Signed out or refused (anyone but a student with a live grant), nothing is kept and nothing is sent.
 *
 * Every write names the owner the cards were read from, and every answer names the owner it is for. If the person signed in
 * changes under an open page (a sibling signs in in another tab), the server refuses the write, the page drops the cards it
 * holds and sends nothing more: one student's cards are never merged or written into another student's account.
 */
export type VerseState = Readonly<{ status: "unknown" } | { status: "unavailable" } | { status: "ready"; review: VerseReview; until: string | null }>;
type Remote = Readonly<{ owner: string; review: VerseReview | null; version: number; until: string | null }>;
const DATE = /^\d{4}-\d{2}-\d{2}$/, OWNER = /^[a-f0-9]{32}$/, LIMIT = 96 * 1024, CONFLICTS = 3;
export const VERSE_SYNC_DELAY_MS = 800;

/** The account's answer, strictly: anything unexpected is no answer. */
export function parseVerseRemote(value: unknown): Remote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 5 || row.ok !== true || typeof row.owner !== "string" || !OWNER.test(row.owner) || !Number.isSafeInteger(row.version) || (row.version as number) < 0
    || row.until !== null && (typeof row.until !== "string" || !DATE.test(row.until))) return null;
  const review = row.review === null ? null : parseVerseReview(row.review);
  if (row.review !== null && !review || (review === null) !== (row.version === 0)) return null;
  return { owner: row.owner, review, version: row.version as number, until: row.until as string | null };
}
function parseConflict(value: unknown): Remote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && row.ok === false && row.code === "conflict" ? parseVerseRemote(row.current) : null;
}
const same = (a: VerseReview, b: VerseReview) => serializeVerseReview(a) === serializeVerseReview(b);

export type VerseSyncIo = Readonly<{ fetch: typeof fetch; onState(state: VerseState): void; timer?: (callback: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void }>;
export function createVerseReviewSync(io: VerseSyncIo) {
  let state: VerseState = { status: "unknown" }, owner: string | null = null, version = 0, writing = false, again = false, conflicts = 0, pending: unknown = null;
  let started: Promise<void> | null = null, generation = 0;
  const set = (next: VerseState) => { state = next; io.onState(next); };
  const cancel = () => { if (pending !== null) { (io.clearTimer ?? clearTimeout)(pending as ReturnType<typeof setTimeout>); pending = null; } };
  /** Drop every card held in memory and send nothing more until a new start. */
  const drop = (next: VerseState) => { generation++; cancel(); owner = null; version = 0; again = false; conflicts = 0; started = null; set(next); };
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
  async function push() {
    if (state.status !== "ready" || owner === null) return;
    if (writing) { again = true; return; }
    writing = true;
    const mine = generation;
    try {
      const sent = state.review;
      const answer = await call("/api/learn/verses/put", { review: sent, expectedVersion: version, expectedOwner: owner });
      if (mine !== generation || state.status !== "ready") return;
      if (answer.status === 200 || answer.status === 409) {
        const remote = answer.status === 200 ? parseVerseRemote(answer.value) : parseConflict(answer.value); if (!remote) return;
        // An answer for anyone else: the person signed in changed. Nothing is merged; the cards held here are dropped.
        if (remote.owner !== owner) { drop({ status: "unavailable" }); return; }
        version = remote.version;
        if (answer.status === 200) {
          conflicts = 0;
          // A change made while this write was out is kept and sent next.
          if (same(state.review, sent)) set({ status: "ready", review: remote.review ?? emptyVerseReview(), until: remote.until }); else again = true;
        } else if (conflicts < CONFLICTS) {
          conflicts++;
          set({ status: "ready", review: mergeVerseReview(remote.review ?? emptyVerseReview(), state.review), until: remote.until });
          again = true;
        }
      } else if (answer.status === 401 || answer.status === 403) drop({ status: "unavailable" });
    } finally { writing = false; if (again && mine === generation) { again = false; void push(); } }
  }
  return Object.freeze({
    get state() { return state; },
    /** Once per page (or after a reset): the account's cards. 401 or 403 (anyone but a student with a live grant) is unavailable, and nothing is kept. */
    start(): Promise<void> {
      started ??= (async () => {
        const mine = generation;
        const answer = await call("/api/learn/verses");
        if (mine !== generation) return;
        const remote = answer.status === 200 ? parseVerseRemote(answer.value) : null;
        if (!remote) { set({ status: "unavailable" }); return; }
        owner = remote.owner; version = remote.version;
        set({ status: "ready", review: remote.review ?? emptyVerseReview(), until: remote.until });
      })();
      return started;
    },
    /** Change the cards in memory and write them back shortly. Nothing happens before the account has answered. */
    update(change: (review: VerseReview) => VerseReview) {
      if (state.status !== "ready") return;
      const next = change(state.review);
      if (same(next, state.review) || serializeVerseReview(next) === null) return;
      conflicts = 0;
      set({ status: "ready", review: next, until: state.until });
      cancel();
      pending = (io.timer ?? setTimeout)(() => { pending = null; void push(); }, VERSE_SYNC_DELAY_MS);
    },
    /** Write now (the page is hiding). */
    flush() { if (pending !== null) { cancel(); void push(); } },
    /** The page is no longer signed in as a student: drop the cards, write nothing, and read afresh on the next start. */
    reset() { if (state.status !== "unknown" || started) drop({ status: "unknown" }); },
  });
}
export type VerseReviewSync = ReturnType<typeof createVerseReviewSync>;
