import { PortalRequestError } from "../../../api";
import { captureSourceIntent, SourceClientError, type CurrentSources, type SourceAssignmentClient, type SourceCitation, type SourceCommit, type SourceErrorCode, type SourceIntent, type SourcePage } from "./api";

export type SourceSelectionPhase = "closed" | "loading" | "ready" | "saving" | "checking" | "unknown" | "conflict" | "refresh-required" | "unavailable" | "disposed";
export type SourceSelectionState = Readonly<{ scopeKey: string; open: boolean; phase: SourceSelectionPhase; current: CurrentSources | null; draftIds: readonly string[];
  dirty: boolean; page: SourcePage | null; browsing: boolean; catalogChanged: boolean; error: SourceErrorCode | null; pending: SourceIntent | null; lastCommit: SourceCommit | null }>;
export type SourceDeparture = Readonly<{ kind: "none"; actions: readonly ["leave"] }> | Readonly<{ kind: "dirty"; actions: readonly ["keep-editing", "discard"] }>
  | Readonly<{ kind: "uncertain"; actions: readonly ["stay", "abandon"]; saveMayComplete: true }>;

/** One authority/reading/verse owner, no autosave, persistence, background I/O or navigation. */
export function createSourceSelection(input: { scopeKey: string; canEdit: boolean; api: SourceAssignmentClient; onState?(state: SourceSelectionState): void; newMutationId?(): string }) {
  if (!input.scopeKey || input.scopeKey.length > 4096) throw new SourceClientError();
  const scopeKey = input.scopeKey, api = input.api, editable = input.canEdit && api.canEdit, ref = api.ref;
  let state: SourceSelectionState = Object.freeze({ scopeKey, open: false, phase: "closed", current: null, draftIds: Object.freeze([]), dirty: false,
    page: null, browsing: false, catalogChanged: false, error: null, pending: null, lastCommit: null });
  let disposed = false, generation = 0, readTurn = 0, browseTurn = 0;
  let currentRead: AbortController | undefined, browseRead: AbortController | undefined, mutation: AbortController | undefined;
  const candidates = new Map<string, SourceCitation>();
  const busy = () => state.phase === "saving" || state.phase === "checking";
  const currentIds = () => state.current?.citations.map(entry => entry.id) ?? [];
  function publish(patch: Partial<SourceSelectionState>) {
    if (disposed) return;
    const next = { ...state, ...patch }, ids = [...next.draftIds].sort();
    state = Object.freeze({ ...next, draftIds: Object.freeze(ids), dirty: next.current !== null && ids.join("\n") !== next.current.citations.map(entry => entry.id).join("\n") });
    input.onState?.(state);
  }
  const code = (error: unknown): SourceErrorCode => error instanceof SourceClientError ? error.code : "unavailable";
  const alive = (mine: number) => !disposed && generation === mine;
  function departure(): SourceDeparture {
    if (state.pending || busy() || state.phase === "unknown") return Object.freeze({ kind: "uncertain", actions: Object.freeze(["stay", "abandon"] as const), saveMayComplete: true });
    return state.dirty ? Object.freeze({ kind: "dirty", actions: Object.freeze(["keep-editing", "discard"] as const) }) : Object.freeze({ kind: "none", actions: Object.freeze(["leave"] as const) });
  }
  function dispose() {
    if (disposed) return;
    generation++; readTurn++; browseTurn++; currentRead?.abort(); browseRead?.abort(); mutation?.abort(); candidates.clear();
    publish({ open: false, phase: "disposed", current: null, draftIds: [], page: null, browsing: false, catalogChanged: false, error: null, pending: null, lastCommit: null }); disposed = true;
  }
  function denied(error: unknown) { if (error instanceof PortalRequestError && [401, 403, 404].includes(error.status)) { dispose(); return true; } return false; }
  async function load() {
    if (disposed || busy() || state.pending || state.dirty) return false;
    currentRead?.abort(); const request = new AbortController(), turn = ++readTurn, mine = generation; currentRead = request;
    publish({ open: true, phase: "loading", error: null });
    try {
      const value = await api.read(request.signal);
      if (!alive(mine) || request.signal.aborted || turn !== readTurn) return false;
      candidates.clear(); browseRead?.abort(); browseTurn++;
      publish({ phase: "ready", current: value, draftIds: value.citations.map(entry => entry.id), pending: null, page: null, browsing: false, catalogChanged: false, error: null }); return true;
    } catch (error) {
      if (!alive(mine) || request.signal.aborted || turn !== readTurn) return false;
      if (!denied(error)) publish({ phase: "unavailable", error: code(error) }); return false;
    }
  }
  async function browse(next = false) {
    if (disposed || !state.open || !state.current || busy() || state.pending || state.catalogChanged) return false;
    const previous = state.page;
    if (next && (!previous || previous.nextSourceOffset === null)) return false;
    browseRead?.abort(); const request = new AbortController(), turn = ++browseTurn, mine = generation; browseRead = request;
    const selection = previous ? Object.freeze({ sourceOffset: next ? previous.nextSourceOffset! : previous.sourceOffset, catalogHash: previous.catalogHash }) : Object.freeze({ sourceOffset: 0 });
    publish({ browsing: true, error: null });
    try {
      const page = await api.discover(selection, request.signal);
      if (!alive(mine) || request.signal.aborted || turn !== browseTurn) return false;
      if (page.ref !== ref || previous && (page.catalogHash !== previous.catalogHash || page.totalEntries !== previous.totalEntries || page.receivedRows !== previous.receivedRows || page.heldCount !== previous.heldCount || page.duplicateCount !== previous.duplicateCount)) throw new SourceClientError(409, "source-catalog-changed");
      if (next && previous!.entries.length && page.entries.length && previous!.entries.at(-1)!.id >= page.entries[0].id) throw new SourceClientError();
      for (const entry of page.entries) {
        const old = candidates.get(entry.id); if (old && JSON.stringify(old) !== JSON.stringify(entry)) throw new SourceClientError(409, "source-catalog-changed");
      }
      for (const entry of page.entries) candidates.set(entry.id, entry);
      publish({ page, browsing: false }); return true;
    } catch (error) {
      if (!alive(mine) || request.signal.aborted || turn !== browseTurn) return false;
      if (!denied(error)) publish({ browsing: false, catalogChanged: code(error) === "source-catalog-changed", error: code(error) }); return false;
    }
  }
  function select(id: string, selected: boolean) {
    if (disposed || !editable || state.phase !== "ready" || state.pending || !state.current || typeof selected !== "boolean") return false;
    const ids = new Set(state.draftIds);
    if (selected) {
      if (!currentIds().includes(id) && (!candidates.has(id) || state.catalogChanged)) return false;
      ids.add(id); if (ids.size > 32) return false;
    } else ids.delete(id);
    publish({ draftIds: [...ids], error: null }); return true;
  }
  function accepted(value: SourceCommit, intent: SourceIntent) {
    // The actual API validates all leaves; keep protocol validation at the owner boundary too.
    if (value.committedVersion !== intent.expectedVersion + 1 || value.currentLatestVersion < value.committedVersion || value.committed.version !== value.committedVersion
      || value.committed.citations.map(entry => entry.id).join("\n") !== intent.sourceIds.join("\n")) throw new SourceClientError();
    if (value.currentLatestVersion > value.committedVersion) {
      publish({ phase: "refresh-required", current: null, draftIds: [], pending: null, lastCommit: value, error: null });
    } else {
      publish({ phase: "ready", current: Object.freeze({ currentVersion: value.committedVersion, citations: value.committed.citations }), draftIds: intent.sourceIds, pending: null, lastCommit: value, error: null });
    }
  }
  async function dispatch(check: boolean) {
    const intent = state.pending; if (disposed || !editable || !intent || busy()) return false;
    const alreadyUncertain = state.phase === "unknown";
    const request = new AbortController(), mine = generation; mutation = request;
    browseRead?.abort(); browseTurn++; publish({ phase: check ? "checking" : "saving", browsing: false, error: null });
    try {
      const value = check ? await api.receipt(intent, request.signal) : await api.write(intent, request.signal);
      if (!alive(mine) || request.signal.aborted) return false;
      if (value.outcome === "unconfirmed") { publish({ phase: "unknown", error: null }); return false; }
      accepted(value, intent); return true;
    } catch (error) {
      if (!alive(mine) || request.signal.aborted) return false;
      if (denied(error)) return false;
      const fixed = code(error);
      // Only a validated, definite service conflict retires this attempted intent.
      if (!alreadyUncertain && error instanceof SourceClientError && error.definite && (error.status === 409 && ["conflict", "stale-revision", "source-catalog-changed", "no-change"].includes(fixed) || error.status === 400 && fixed === "invalid-request")) {
        publish({ phase: "conflict", error: fixed, pending: null, catalogChanged: state.catalogChanged || fixed === "source-catalog-changed" });
      } else publish({ phase: "unknown", error: fixed });
      return false;
    } finally { if (mutation === request) mutation = undefined; }
  }
  async function save() {
    if (disposed || !editable || state.phase !== "ready" || !state.current || !state.dirty || state.pending || state.browsing) return false;
    const added = state.draftIds.filter(id => !currentIds().includes(id));
    if (added.length && (!state.page || state.catalogChanged || added.some(id => !candidates.has(id)))) { publish({ error: "source-catalog-changed" }); return false; }
    let intent: SourceIntent;
    try { intent = captureSourceIntent({ verseRef: ref, expectedVersion: state.current.currentVersion, mutationId: (input.newMutationId ?? (() => crypto.randomUUID()))(), sourceIds: state.draftIds,
      ...(added.length ? { catalogHash: state.page!.catalogHash } : {}) }, ref); } catch { publish({ error: "invalid-request" }); return false; }
    // Freeze once, before dispatch. Explicit retry/reconciliation use this identical object.
    publish({ pending: intent }); return dispatch(false);
  }
  return Object.freeze({
    get state() { return state; },
    open() { if (disposed || state.open) return Promise.resolve(false); return load(); }, load,
    browse() { return browse(); }, nextPage() { return browse(true); }, select, save,
    reconcile() { return state.phase === "unknown" ? dispatch(true) : Promise.resolve(false); },
    retryExact() { return state.phase === "unknown" ? dispatch(false) : Promise.resolve(false); },
    reviewCatalog() {
      if (disposed || busy() || state.pending || !state.current || state.phase !== "ready") return false;
      browseRead?.abort(); browseTurn++; candidates.clear(); publish({ page: null, browsing: false, catalogChanged: false, error: null }); return true;
    },
    discardAndReload() {
      if (disposed || busy() || state.pending) return Promise.resolve(false);
      publish({ draftIds: currentIds() }); return load();
    },
    close() {
      if (disposed || departure().kind !== "none") return false;
      readTurn++; browseTurn++; currentRead?.abort(); browseRead?.abort(); publish({ open: false, phase: state.current ? "ready" : "closed", browsing: false }); return true;
    },
    departure,
    abandon() { const descriptor = departure(), saveMayComplete = descriptor.kind === "uncertain"; dispose(); return Object.freeze({ abandoned: true as const, saveMayComplete }); },
    dispose, authorityLost: dispose
  });
}
export type SourceSelection = ReturnType<typeof createSourceSelection>;
