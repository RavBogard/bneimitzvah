import type { Assigned, Selection } from "../api";
import { PortalRequestError } from "../../api";
import type { StudyKind } from "./api";
import { GuideError, type GuideFetch, type GuideOperation, type GuideTheme, type StudentGuideView, type ThemeReadResult } from "./guide-api";

type Request = (baseline: Assigned, kind: StudyKind, operation: GuideOperation, signal: AbortSignal, selection?: Selection) => Promise<GuideFetch | ThemeReadResult>;
type KindState = { token: number; loading: boolean; failed: boolean; loaded: boolean; view: StudentGuideView | null; sheet: string | null; pending: Set<string>; notices: Map<string, string> };
const scopeOf = (value: Assigned) => JSON.stringify([value.mode, value.student.id, value.context?.id ?? null, value.context?.authorityRevision ?? null,
  value.readings.map(row => [row.kind, row.id, row.revision, row.readingKey ?? null])]);

/**
 * The study guide for each shown reading, as the server projects it for this viewer, plus the
 * learner's own "I read this" ticks. A tick shows at once, is sent once with the version it was
 * based on, and is never replayed; a conflict or stale reading re-reads the guide.
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
    if (!state) { state = { token: 0, loading: false, failed: false, loaded: false, view: null, sheet: null, pending: new Set(), notices: new Map() }; this.kinds.set(kind, state); }
    return state;
  }
  view(kind: StudyKind) { return this.kinds.get(kind)?.view ?? null; }
  sheet(kind: StudyKind) { return this.kinds.get(kind)?.sheet ?? null; }
  loaded(kind: StudyKind) { return Boolean(this.kinds.get(kind)?.loaded); }
  failed(kind: StudyKind) { return Boolean(this.kinds.get(kind)?.failed); }
  pending(kind: StudyKind, themeId: string) { return Boolean(this.kinds.get(kind)?.pending.has(themeId)); }
  notice(kind: StudyKind, themeId: string) { return this.kinds.get(kind)?.notices.get(themeId) ?? ""; }
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
  /** Ticks or unticks a theme. Only a tickable view offers this; parents and staff never see the control. */
  async tick(kind: StudyKind, themeId: string, read: boolean) {
    const baseline = this.baseline, state = this.kinds.get(kind), view = state?.view;
    if (!baseline || !state || !view || !view.tickable || !view.readingKey || state.pending.has(themeId)) return;
    const find = (v: StudentGuideView) => [...(v.base?.themes ?? []), ...(v.additions?.themes ?? [])].filter(t => t.id === themeId);
    const current = find(view)[0]; if (!current || current.read === read) return;
    const generation = this.generation, before = { read: current.read, version: current.readVersion };
    const apply = (value: { read: boolean; version: number }) => {
      const v = state.view; if (!v) return;
      const patch = (themes: GuideTheme[]) => themes.map(t => t.id === themeId ? { ...t, read: value.read, readVersion: value.version } : t);
      state.view = { ...v, base: v.base ? { ...v.base, themes: patch(v.base.themes) } : null, additions: v.additions ? { ...v.additions, themes: patch(v.additions.themes) } : null };
    };
    state.pending.add(themeId); state.notices.delete(themeId); apply({ read, version: before.version }); this.emit();
    try {
      const saved = await this.request(baseline, kind, { type: "theme-read", readingKey: view.readingKey, themeId, read, expectedVersion: before.version }, this.controller.signal, this.selection) as ThemeReadResult;
      if (generation !== this.generation) return;
      apply({ read: saved.read, version: saved.version });
    } catch (error) {
      if (generation !== this.generation) return;
      apply(before);
      if (error instanceof PortalRequestError && error.status === 409) { state.notices.set(themeId, "This changed somewhere else. Showing the latest."); state.pending.delete(themeId); await this.load(kind); return; }
      state.notices.set(themeId, "Couldn't save that. Try again.");
      if (error instanceof GuideError && [401, 403, 404].includes(error.status)) this.onDenied(error.status);
    } finally { if (generation === this.generation) { state.pending.delete(themeId); this.emit(); } }
  }
}
