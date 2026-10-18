import { PortalRequestError } from "../../api";
import type { HonorsContextView, HonorsForm, HonorsIntent, HonorsRead } from "../../../../lib/honors/types";
import { HonorsClientError, type HonorsClient } from "./api";
import { captureHonorsForm, emptyHonors, formFingerprint, sameSpans } from "./draft";
export type HonorsPhase = "loading" | "ready" | "saving" | "checking" | "unknown" | "conflict" | "unavailable" | "disposed";
export type HonorsState = Readonly<{ phase: HonorsPhase; current: HonorsRead | null; draft: HonorsForm; draftContext: HonorsContextView | null; baseVersion: number; dirty: boolean; reviewed: boolean; pending: HonorsIntent | null; error: string | null; savedNotice: boolean }>;
/** One family and one base session. No persistence, auto-save, UUID rotation or implicit remapping. */
export function createHonorsOwner(api: HonorsClient, changed: (s: HonorsState) => void, newId = () => crypto.randomUUID()) {
  let state: HonorsState = Object.freeze({ phase: "loading", current: null, draft: emptyHonors(), draftContext: null, baseVersion: 0, dirty: false, reviewed: false, pending: null, error: null, savedNotice: false });
  let disposed = false, turn = 0, read: AbortController | undefined, mutation: AbortController | undefined, settling: Promise<unknown> = Promise.resolve();
  const busy = () => ["saving", "checking"].includes(state.phase);
  function publish(patch: Partial<HonorsState>) { if (!disposed) { state = Object.freeze({ ...state, ...patch }); changed(state); } }
  const uncertain = () => !!state.pending || busy() || state.phase === "unknown";
  function clear() { if (disposed) return; ++turn; read?.abort(); mutation?.abort(); publish({ phase: "disposed", current: null, draft: emptyHonors(), draftContext: null, baseVersion: 0, pending: null, dirty: false, reviewed: false, error: null, savedNotice: false }); disposed = true; }
  const denied = (error: unknown) => { if (error instanceof PortalRequestError && [401, 403, 404].includes(error.status)) { clear(); return true; } return false; };
  function adopt(value: HonorsRead) { publish({ phase: "ready", current: value, draft: value.saved?.form ?? emptyHonors(), draftContext: value.saved?.reviewedContext ?? value.currentContext, baseVersion: value.currentVersion, dirty: false, reviewed: !value.needsReview, pending: null, error: null, savedNotice: false }); }
  async function load(discard = false) {
    if (disposed || busy() || state.pending || discard && uncertain()) return false;
    read?.abort(); const request = new AbortController(), mine = ++turn; read = request;
    if (!state.current) publish({ phase: "loading", error: null });
    try {
      const value = await api.read(request.signal); if (disposed || request.signal.aborted || mine !== turn) return false;
      if (discard || !state.current || !state.dirty && state.current.currentVersion !== value.currentVersion) adopt(value);
      else if (state.baseVersion !== value.currentVersion) publish({ current: value, phase: "conflict", error: "Someone saved another version. Your draft is kept. Reload the saved form before editing again." });
      else publish({ current: value, phase: "ready", reviewed: state.draftContext?.hash === value.currentContext.hash, error: null });
      return true;
    } catch (error) { if (!disposed && !request.signal.aborted && mine === turn && !denied(error)) publish({ phase: "unavailable", error: "Family honors couldn’t be verified. Your draft is kept here." }); return false; }
  }
  function edit(draft: HonorsForm) { if (disposed || state.phase !== "ready" || state.pending || !state.current) return false;
    publish({ draft, dirty: formFingerprint(draft) !== formFingerprint(state.current.saved?.form ?? emptyHonors()) || state.draftContext?.hash !== state.current.saved?.reviewedContext.hash && !!state.current.saved, savedNotice: false, error: null }); return true; }
  function review(mapping: Readonly<Record<string, string | null>>) {
    if (disposed || state.phase !== "ready" || state.pending || !state.current || !state.draftContext) return false;
    const previous = state.draftContext, current = state.current.currentContext, seen = new Set<string>();
    const result: HonorsForm["aliyot"][number][] = [];
    for (const group of state.draft.aliyot) {
      const old = previous.spans.find(s => s.startVerse === group.startVerse), exact = current.spans.some(s => s.startVerse === old?.startVerse && s.endVerse === old.endVerse);
      if (!exact && !Object.hasOwn(mapping, group.startVerse)) { publish({ error: "Choose a current aliyah or explicitly remove every changed group." }); return false; }
      const target = exact ? group.startVerse : mapping[group.startVerse]; if (target === null) continue;
      if (!current.spans.some(s => s.startVerse === target) || seen.has(target)) { publish({ error: "Each group needs a different current aliyah. Combine people explicitly in the form if needed." }); return false; }
      seen.add(target); result.push({ startVerse: target, participants: group.participants });
    }
    result.sort((a, b) => current.spans.findIndex(s => s.startVerse === a.startVerse) - current.spans.findIndex(s => s.startVerse === b.startVerse));
    publish({ draft: { ...state.draft, aliyot: result }, draftContext: current, reviewed: true, dirty: true, savedNotice: false, error: null }); return true;
  }
  async function dispatch(check: boolean) {
    if (disposed || busy() || !state.pending) return false; const intent = state.pending, wasUnknown = state.phase === "unknown", request = new AbortController(); mutation = request;
    publish({ phase: check ? "checking" : "saving", error: null });
    const task = (async () => { try {
      const value = check ? await api.receipt(intent, request.signal) : await api.write(intent, request.signal);
      if (disposed || request.signal.aborted) return false;
      if (value.outcome === "unconfirmed") { publish({ phase: "unknown", error: "No committed receipt was found. The original save may still complete. You can check again or retry that same save." }); return false; }
      if (value.committedVersion !== intent.expectedVersion + 1 || value.currentLatestVersion < value.committedVersion || value.committed.version !== value.committedVersion || value.committed.reviewedContext.hash !== intent.contextHash || formFingerprint(value.committed.form) !== formFingerprint(intent.form)) throw new HonorsClientError();
      if (value.currentLatestVersion > value.committedVersion) { publish({ pending: null, phase: "conflict", dirty: false, error: "Your save was confirmed, then another version was saved. Reload the latest saved form before editing or printing.", savedNotice: true }); return true; }
      adopt({ ok: true, studentId: value.currentContext.snapshot.studentId, currentVersion: value.committedVersion, currentContext: value.currentContext, saved: value.committed, needsReview: value.needsReview }); publish({ savedNotice: true }); return true;
    } catch (error) {
      if (disposed || request.signal.aborted || denied(error)) return false;
      if (!wasUnknown && !check && error instanceof HonorsClientError && error.definite) publish({ pending: null, phase: "conflict", error: error.code === "stale-context" ? "The ceremony or reading changed. Reload the current context to review it; your draft is kept." : "The saved form changed or the save was refused. Your draft is kept. Reload before continuing." });
      else publish({ phase: "unknown", error: "The save outcome couldn’t be confirmed. Keep this sheet open and check the original save." }); return false;
    } finally { if (mutation === request) mutation = undefined; } })(); settling = task; return task;
  }
  async function save() {
    if (disposed || state.phase !== "ready" || !state.current || state.pending || !state.dirty) return false;
    if (!state.reviewed || state.draftContext?.hash !== state.current.currentContext.hash) { publish({ error: "Review the current ceremony and aliyot before saving." }); return false; }
    try {
      const form = captureHonorsForm(state.draft); let previous = -1;
      for (const group of form.aliyot) { const n = state.current.currentContext.spans.findIndex(s => s.startVerse === group.startVerse); if (n <= previous) throw Error("Review the current aliyot before saving."); previous = n; }
      // All nested canonical values are immutable; this is the only UUID allocation.
      publish({ pending: Object.freeze({ expectedVersion: state.baseVersion, mutationId: newId(), contextHash: state.current.currentContext.hash, form }) }); return dispatch(false);
    } catch (error) { publish({ error: error instanceof Error ? error.message : "Check the form before saving." }); return false; }
  }
  return Object.freeze({ get state() { return state; }, load, edit, review, save, sameSpans,
    check() { return state.phase === "unknown" ? dispatch(true) : Promise.resolve(false); }, retry() { return state.phase === "unknown" ? dispatch(false) : Promise.resolve(false); },
    discard() { return load(true); }, hasUnsaved() { return state.dirty || uncertain(); }, uncertain, busy,
    pause() { read?.abort(); ++turn; }, clear, settle() { return settling.then(() => undefined); },
    async quiet(signal: AbortSignal) { if (disposed) return false; const value = await api.read(signal); return !!state.current && value.currentVersion === state.current.currentVersion && value.currentContext.hash === state.current.currentContext.hash; }
  });
}
export type HonorsOwner = ReturnType<typeof createHonorsOwner>;
