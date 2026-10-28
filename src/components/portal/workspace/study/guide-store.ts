import type { Assigned, Selection } from "../api";
import type { StudyKind } from "./api";
import { GuideError, type GuideFetch, type GuideOperation, type StudentGuideView } from "./guide-api";

type Request = (baseline: Assigned, kind: StudyKind, operation: GuideOperation, signal: AbortSignal, selection?: Selection) => Promise<GuideFetch>;
type KindState = { token: number; loading: boolean; failed: boolean; loaded: boolean; view: StudentGuideView | null; sheet: string | null };
const scopeOf = (value: Assigned) => JSON.stringify([value.mode, value.student.id, value.context?.id ?? null, value.context?.authorityRevision ?? null,
  value.readings.map(row => [row.kind, row.id, row.revision, row.readingKey ?? null])]);

/**
 * The study guide for each shown reading, as the server projects it for this viewer: the base guide's overview, and a rabbi-written guide for this student when there
 * is one. ("I read this" ticks are retired, 2026-10-28: nothing here writes.)
 */
export class GuideStore {
  private listeners = new Set<() => void>(); private version = 0;
  private baseline: Assigned | null = null; private selection: Selection | undefined; private scope = ""; private generation = 0; private controller = new AbortController();
  private kinds = new Map<StudyKind, KindState>();
  constructor(private request: Request, private onDenied: (status: number) => void = () => {}) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private emit() { this.version++; for (const listener of this.listeners) listener(); }
  configure(baseline: Assigned | null, selection?: Selection) {
    const scope = baseline ? scopeOf(baseline) : "";
    if (scope !== this.scope) { this.generation++; this.controller.abort(); this.controller = new AbortController(); this.kinds.clear(); }
    this.baseline = baseline; this.selection = selection; this.scope = scope; this.emit();
  }
  dispose() { this.generation++; this.controller.abort(); this.listeners.clear(); }
  private state(kind: StudyKind) {
    let state = this.kinds.get(kind);
    if (!state) { state = { token: 0, loading: false, failed: false, loaded: false, view: null, sheet: null }; this.kinds.set(kind, state); }
    return state;
  }
  view(kind: StudyKind) { return this.kinds.get(kind)?.view ?? null; }
  sheet(kind: StudyKind) { return this.kinds.get(kind)?.sheet ?? null; }
  loaded(kind: StudyKind) { return Boolean(this.kinds.get(kind)?.loaded); }
  failed(kind: StudyKind) { return Boolean(this.kinds.get(kind)?.failed); }
  /** Loads once per scope; call again after a failure to retry. */
  ensure(kind: StudyKind) { const state = this.kinds.get(kind); if (!state || (!state.loaded && !state.loading)) void this.load(kind); }
  async load(kind: StudyKind) {
    const baseline = this.baseline; if (!baseline || !baseline.readings.some(row => row.kind === kind)) return;
    const generation = this.generation, state = this.state(kind), token = ++state.token; state.loading = true; state.failed = false; this.emit();
    try {
      const result = await this.request(baseline, kind, { type: "view" }, this.controller.signal, this.selection) as GuideFetch;
      if (generation !== this.generation || token !== state.token) return;
      state.view = result.view; state.sheet = result.sheet; state.loaded = true;
    } catch (error) {
      if (generation !== this.generation || token !== state.token) return;
      state.failed = true;
      if (error instanceof GuideError && [401, 403, 404].includes(error.status)) this.onDenied(error.status);
    } finally { if (generation === this.generation && token === state.token) { state.loading = false; this.emit(); } }
  }
}
