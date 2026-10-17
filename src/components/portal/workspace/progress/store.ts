import type { Assigned } from "../api";
import { statusOf } from "../provider";
import type { StudyKind } from "../study/api";
import type { ProgressCounts, ProgressStream, ProgressVerse } from "../../../../lib/progress/types";
import { ProgressError, type ProgressMark, type ProgressOperation, type ProgressRows, type ProgressSaved } from "./api";

type Request = (baseline: Assigned, kind: StudyKind, operation: ProgressOperation, signal: AbortSignal) => Promise<ProgressRows | ProgressSaved>;
type KindState = { from: number; to: number; token: number; loadingAt: number | null; loading: boolean; failed: boolean; stale: boolean; verses: Map<string, ProgressVerse>; counts: ProgressCounts | null; pending: Set<string>; unverified: Map<string, string>; notices: Map<string, string> };
const scopeOf = (value: Assigned) => JSON.stringify([value.mode, value.student.id, value.context?.id ?? null, value.context?.authorityRevision ?? null, value.readings.map(row => [row.kind, row.id, row.revision, row.verses])]);

/**
 * Current verse marks for the shown reading: the student's own self-check and the
 * tutor's assessment, kept as the separate streams the server stores. Writes go one
 * at a time per verse and are never replayed; a conflict re-reads the latest marks.
 */
export class ProgressStore {
  private listeners = new Set<() => void>(); private version = 0;
  private baseline: Assigned | null = null; private scope = ""; private generation = 0; private controller = new AbortController();
  private kinds = new Map<StudyKind, KindState>();
  private staleReloaded = false;
  constructor(private request: Request, private onStale: () => void, private onDenied: (status: number) => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private emit() { this.version++; for (const listener of this.listeners) listener(); }
  /** The stream this viewer may write: students mark themselves, tutors and admins assess, parents only read. */
  get stream(): ProgressStream | null {
    const mode = this.baseline?.mode;
    return mode === "student" || mode === "child-practice" ? "self-check" : mode === "tutor" || mode === "admin" ? "assessment" : null;
  }
  /** Every reload re-reads marks; a different student, context or assignment starts empty. */
  configure(baseline: Assigned | null) {
    const scope = baseline ? scopeOf(baseline) : "";
    if (scope !== this.scope) { this.generation++; this.controller.abort(); this.controller = new AbortController(); this.kinds.clear(); this.staleReloaded = false; }
    else for (const state of this.kinds.values()) state.stale = true;
    this.baseline = baseline; this.scope = scope; this.emit();
  }
  private state(kind: StudyKind) {
    let state = this.kinds.get(kind);
    if (!state) { state = { from: 0, to: 0, token: 0, loadingAt: null, loading: false, failed: false, stale: false, verses: new Map(), counts: null, pending: new Set(), unverified: new Map(), notices: new Map() }; this.kinds.set(kind, state); }
    return state;
  }
  verse(kind: StudyKind, ref: string) { return this.kinds.get(kind)?.verses.get(ref) ?? null; }
  counts(kind: StudyKind) { return this.kinds.get(kind)?.counts ?? null; }
  failed(kind: StudyKind) { return Boolean(this.kinds.get(kind)?.failed); }
  pending(kind: StudyKind, ref: string) { const state = this.kinds.get(kind); return Boolean(state && (state.pending.has(ref) || state.unverified.has(ref))); }
  unverified(kind: StudyKind, ref: string) { return Boolean(this.kinds.get(kind)?.unverified.has(ref)); }
  loading(kind: StudyKind) { return Boolean(this.kinds.get(kind)?.loading); }
  /** Explicit recovery reads the affected verse's current page, never a POST. */
  retry(kind: StudyKind, ref: string) {
    const index = this.baseline?.readings.find(row => row.kind === kind)?.verses.indexOf(ref) ?? -1;
    if (index >= 0) void this.load(kind, Math.floor(index / 100) * 100);
  }
  /** A message about the last mark on this verse, if any. */
  notice(kind: StudyKind, ref: string) { return this.kinds.get(kind)?.notices.get(ref) ?? ""; }
  /** Loads the marks covering a shown text page unless they are already current. */
  ensure(kind: StudyKind, offset: number, length: number) {
    const state = this.kinds.get(kind);
    if (state && !state.stale && !state.failed && (state.loading ? state.loadingAt === offset : offset >= state.from && offset + length <= state.to)) return;
    void this.load(kind, offset);
  }
  async load(kind: StudyKind, offset: number) {
    const baseline = this.baseline; if (!baseline || !baseline.readings.some(row => row.kind === kind)) return;
    const generation = this.generation, state = this.state(kind), token = ++state.token; state.loading = true; state.loadingAt = offset; state.failed = false; state.stale = false; this.emit();
    try {
      const rows = await this.request(baseline, kind, { type: "page", offset }, this.controller.signal) as ProgressRows;
      if (generation !== this.generation || token !== state.token) return;
      // Versions only grow, so a read that raced a save never puts back an older mark.
      // A mark being saved keeps its local value until its own answer arrives.
      for (const row of rows.verses) {
        const known = state.verses.get(row.verseRef);
        if (state.pending.has(row.verseRef) && known) continue;
        state.verses.set(row.verseRef, known ? { verseRef: row.verseRef, selfCheck: known.selfCheck.version > row.selfCheck.version ? known.selfCheck : row.selfCheck, assessment: known.assessment.version > row.assessment.version ? known.assessment : row.assessment } : row);
        const recovery = state.unverified.get(row.verseRef);
        if (recovery !== undefined) { state.unverified.delete(row.verseRef); state.notices.set(row.verseRef, `${recovery} The latest mark is shown.`); }
      }
      // Counts are only ever the server's; each save is followed by its own re-read.
      state.from = offset; state.to = offset + rows.verses.length; if (!state.pending.size) state.counts = rows.counts;
    } catch (error) {
      if (generation !== this.generation || token !== state.token) return;
      state.failed = true; state.counts = null;
      for (const [ref, recovery] of state.unverified) state.notices.set(ref, `${recovery} The saved mark couldn’t be checked. Check it before changing this verse’s mark.`);
      this.fail(error);
    } finally { if (generation === this.generation && token === state.token) { state.loading = false; state.loadingAt = null; this.emit(); } }
  }
  private fail(error: unknown) {
    const status = statusOf(error);
    // One reload per assignment: if the marks still disagree afterwards, they stay unavailable.
    if (error instanceof ProgressError && error.code === "stale-assignment") { if (!this.staleReloaded) { this.staleReloaded = true; this.onStale(); } }
    else if ([401, 403, 404].includes(status)) this.onDenied(status);
  }
  async set(kind: StudyKind, ref: string, next: ProgressMark) {
    const baseline = this.baseline, stream = this.stream, state = this.kinds.get(kind), verse = state?.verses.get(ref);
    if (!baseline || !stream || !state || !verse || state.pending.has(ref) || state.unverified.has(ref)) return;
    const key = stream === "self-check" ? "selfCheck" : "assessment", before = verse[key], generation = this.generation;
    if (before.state === next) return;
    state.pending.add(ref); state.notices.delete(ref);
    state.verses.set(ref, { ...verse, [key]: { state: next, version: before.version } });
    this.emit();
    try {
      const saved = await this.request(baseline, kind, { type: stream, verseRef: ref, state: next, expectedVersion: before.version }, this.controller.signal) as ProgressSaved;
      if (generation !== this.generation) return;
      const current = state.verses.get(ref)!;
      state.verses.set(ref, { ...current, [key]: { state: saved.state, version: saved.version } });
    } catch (error) {
      if (generation !== this.generation) return;
      state.verses.set(ref, verse);
      const status = statusOf(error), conflict = error instanceof ProgressError && error.code === "conflict";
      const recovery = conflict ? "This verse was marked somewhere else." : status === 429 ? "Too many changes at once." : "That mark may not have saved.";
      state.unverified.set(ref, recovery); state.counts = null;
      if (!(error instanceof ProgressError && error.code === "stale-assignment") && ![401, 403, 404].includes(status))
        state.notices.set(ref, `${recovery} Checking the saved mark…`);
      if (!conflict) this.fail(error);
    } finally {
      // Re-read (never resend) so the mark and the counts are the server's.
      // configure() may supply a fresh object for the exact same valid scope.
      // Generation fences changed assignments/contexts; object identity must not
      // suppress reconciliation after a same-scope refresh skipped this write.
      if (generation === this.generation) { state.pending.delete(ref); this.emit(); this.retry(kind, ref); }
    }
  }
}
