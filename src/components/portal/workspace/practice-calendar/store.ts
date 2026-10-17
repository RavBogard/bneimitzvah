import type { Assigned, ReadingMode } from "../api";
import type { StudyKind } from "../study/api";
import type { ServicePlan } from "../service-learning/api";
import type { PracticeTarget } from "../../../../lib/practice-calendar/types";
import { dayOrdinal, dayString, PracticeCalendarError, type PracticeAck, type PracticeDates, type PracticeOperation } from "./api";

type Request = (mode: ReadingMode, studentId: string, operation: PracticeOperation, signal: AbortSignal) => Promise<PracticeDates | PracticeAck>;
export type PracticeCalendarState = { status: "off" | "loading" | "unavailable" | "ended" } | { status: "ready"; serverDay: string; fromDate: string; throughDate: string; dates: ReadonlySet<string> };
const scopeOf = (value: Assigned) => JSON.stringify([value.mode, value.student.id, value.context?.id ?? null, value.context?.authorityRevision ?? null]);
const materialOf = (target: PracticeTarget) => JSON.stringify(target.type === "verse"
  ? [target.type, target.kind, target.assignmentId, target.assignmentRevision]
  : [target.type, target.catalogId, target.catalogIdentity, target.planId, target.planRevision]);
// The read window only: a year of dates ending a day after the browser's date, so any Chicago day is inside it. Writes never use it.
function windowAround(today: number) { return { fromDate: dayString(today - 364), throughDate: dayString(today + 1) }; }
function browserToday() { const now = new Date(); return dayOrdinal(`${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`); }

/**
 * The quiet practice calendar for the student or an explicitly selected child practice: dates only.
 * A visit is reported only for an explicit open of a confirmed verse or a chosen service part, against
 * the day the server last said it was. Nothing is queued or retried; a stale day or reading re-reads first.
 */
export class PracticeCalendar {
  private listeners = new Set<() => void>(); private current: PracticeCalendarState = { status: "off" };
  private baseline: Assigned | null = null; private scope = ""; private generation = 0; private controller = new AbortController();
  private sent = new Set<string>(); private staleReloaded = new Set<string>();
  constructor(private request: Request, private onStale: () => void, private today: () => number = browserToday) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.current;
  private set(next: PracticeCalendarState) { this.current = next; for (const listener of this.listeners) listener(); }
  /** Forget everything: on every reload, access check, session, student or context change. */
  clear() { this.generation++; this.controller.abort(); this.controller = new AbortController(); this.sent.clear(); this.set({ status: this.baseline ? "loading" : "off" }); }
  /** Only the student's own view and an explicitly selected child practice show the calendar. */
  configure(baseline: Assigned | null) {
    const on = baseline && (baseline.mode === "student" || baseline.mode === "child-practice") ? baseline : null, scope = on ? scopeOf(on) : "";
    if (scope !== this.scope) this.staleReloaded.clear();
    this.baseline = on; this.scope = scope; this.clear();
  }
  async load(signal?: AbortSignal) {
    const baseline = this.baseline; if (!baseline) return;
    const turn = this.generation, controller = this.controller, abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    if (this.current.status !== "loading") this.set({ status: "loading" });
    try {
      let window = windowAround(this.today());
      let page = await this.request(baseline.mode, baseline.student.id, { type: "calendar", ...window }, controller.signal) as PracticeDates;
      const day = dayOrdinal(page.serverDay);
      // A badly set device clock can put the server's day outside the first window; read once more around it.
      if (turn === this.generation && (day < dayOrdinal(window.fromDate) || day > dayOrdinal(window.throughDate))) {
        window = { fromDate: dayString(day - 365), throughDate: page.serverDay };
        page = await this.request(baseline.mode, baseline.student.id, { type: "calendar", ...window }, controller.signal) as PracticeDates;
      }
      if (turn !== this.generation || controller.signal.aborted) return;
      this.set({ status: "ready", serverDay: page.serverDay, fromDate: page.fromDate, throughDate: page.throughDate, dates: new Set(page.dates) });
    } catch { if (turn === this.generation && !controller.signal.aborted) this.set({ status: "unavailable" }); }
    finally { signal?.removeEventListener("abort", abort); }
  }
  visitVerse(kind: StudyKind, verseRef: string) {
    const reading = this.baseline?.readings.find(row => row.kind === kind);
    if (!reading || !reading.verses.includes(verseRef)) return;
    void this.visit({ type: "verse", kind, assignmentId: reading.id, assignmentRevision: reading.revision, verseRef });
  }
  visitUnit(plan: ServicePlan, unitId: string) {
    void this.visit({ type: "service-unit", catalogId: plan.catalogId, catalogIdentity: plan.catalogIdentity, planId: plan.id, planRevision: plan.revision, unitId });
  }
  private async visit(target: PracticeTarget) {
    const baseline = this.baseline, state = this.current; if (!baseline || state.status !== "ready") return;
    // Opening the same thing again on the same day adds nothing to a dates-only calendar.
    const key = JSON.stringify([state.serverDay, target]); if (this.sent.has(key)) return;
    const turn = this.generation, controller = this.controller; this.sent.add(key);
    try {
      const ack = await this.request(baseline.mode, baseline.student.id, { type: "visit", eventId: crypto.randomUUID(), expectedDay: state.serverDay, target }, controller.signal) as PracticeAck;
      if (turn !== this.generation || controller.signal.aborted || this.current !== state) return;
      if (!state.dates.has(ack.practiceDay)) this.set({ ...state, dates: new Set([...state.dates, ack.practiceDay]) });
    } catch (error) {
      if (turn !== this.generation || controller.signal.aborted) return;
      this.sent.delete(key);
      // A definite denial ends this local selection immediately. Abort all
      // sibling requests and discard private dates without a refresh/retry loop.
      if (error instanceof PracticeCalendarError && [401, 403, 404].includes(error.status)) { this.configure(null); return; }
      const code = error instanceof PracticeCalendarError ? error.code : undefined;
      // A new day or changed material needs a fresh read; the visit itself is never resent.
      if (code === "stale-day") void this.load();
      else if (code === "stale-material") {
        // One reload per actual material version, across same-scope refreshes.
        // A service-plan/catalog change is independent of verse assignments.
        const material = materialOf(target);
        if (!this.staleReloaded.has(material)) { this.staleReloaded.add(material); this.onStale(); }
      }
      else if (code === "retention-expired") { this.generation++; this.set({ status: "ended" }); }
    }
  }
}
