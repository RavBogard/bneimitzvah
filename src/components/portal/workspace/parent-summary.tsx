"use client";
import { useSyncExternalStore } from "react";
import type { Assigned } from "./api";
import { PortalRequestError } from "../api";
import { dayOrdinal, dayString, type PracticeDates } from "./practice-calendar/api";
import type { LessonSummarySnapshot } from "./lessons/panel";

type CalendarRead = (mode: "parent", studentId: string, operation: { type: "calendar"; fromDate: string; throughDate: string }, signal: AbortSignal) => Promise<PracticeDates>;
type Lesson = LessonSummarySnapshot["lesson"];
type Dates = { status: "loading" } | { status: "unavailable" } | { status: "ready"; serverDay: string; dates: readonly string[] };
const empty = () => ({ lesson: { status: "loading" } as Lesson, dates: { status: "loading" } as Dates });
function today() { const now = new Date(); return dayOrdinal(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`); }

/** Parent-only projection: never owns lesson history, visit reporting or write capabilities. */
export class ParentSummaryStore {
  private active: { baseline: Assigned; scope: string } | null = null;
  private generation = 0; private controller = new AbortController();
  private listeners = new Set<() => void>(); private state = empty();
  constructor(private read: CalendarRead, private live: (scope: string) => boolean, private denied: (status: number) => void, private deviceDay = today) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private emit() { for (const listener of this.listeners) listener(); }
  matches(baseline: Assigned, scope: string) { return this.active?.baseline === baseline && this.active.scope === scope && this.live(scope); }
  pause = () => { if (this.active) this.active = { ...this.active }; this.generation++; this.controller.abort(); this.controller = new AbortController(); this.state = empty(); this.emit(); };
  clear = () => { this.active = null; this.pause(); };
  configure(baseline: Assigned | null, scope: string) {
    this.active = baseline?.mode === "parent" ? { baseline, scope } : null; this.pause();
  }
  receiver() {
    const active = this.active; let generation = -1;
    return (value: LessonSummarySnapshot) => {
      if (!active || this.active !== active || value.baseline !== active.baseline || value.scope !== active.scope || !this.live(active.scope) || value.generation < generation) return;
      generation = value.generation; this.state = { ...this.state, lesson: value.lesson }; this.emit();
    };
  }
  async loadDates() {
    const active = this.active; if (!active || !this.live(active.scope)) return;
    const turn = ++this.generation; this.controller.abort(); const request = new AbortController(); this.controller = request;
    const current = () => this.active === active && turn === this.generation && !request.signal.aborted && this.live(active.scope);
    try {
      const initial = this.deviceDay();
      let window = { fromDate: dayString(initial - 7), throughDate: dayString(initial + 1) };
      let page: PracticeDates | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        page = await this.read("parent", active.baseline.student.id, { type: "calendar", ...window }, request.signal);
        if (!current()) return;
        if (page.studentId !== active.baseline.student.id || page.mode !== "parent" || page.fromDate !== window.fromDate || page.throughDate !== window.throughDate) throw new Error("Practice dates unavailable");
        const end = dayOrdinal(page.serverDay), start = end - 6;
        if (dayOrdinal(window.fromDate) <= start && dayOrdinal(window.throughDate) >= end) {
          this.state = { ...this.state, dates: { status: "ready", serverDay: page.serverDay, dates: page.dates.filter(date => dayOrdinal(date) >= start && dayOrdinal(date) <= end) } }; this.emit(); return;
        }
        // One server-day correction, never an uncovered interval labeled empty.
        window = { fromDate: dayString(start), throughDate: page.serverDay };
      }
      throw new Error("Practice interval changed");
    } catch (error) {
      if (!current()) return;
      if (error instanceof PortalRequestError && [401, 403, 404].includes(error.status)) { this.clear(); this.denied(error.status); return; }
      this.state = { ...this.state, dates: { status: "unavailable" } }; this.emit();
    }
  }
}
const label = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
export function ParentStudySummary({ store, baseline, scope, concealed }: { store: ParentSummaryStore; baseline: Assigned | null; scope: string; concealed: boolean }) {
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  if (!baseline || baseline.mode !== "parent" || concealed || !store.matches(baseline, scope)) return null;
  const lesson = state.lesson, dates = state.dates;
  return <section className="parent-study-summary" aria-label="Preparation summary">
    <div><h3>Latest saved lesson</h3>
      {lesson.status === "loading" ? <p role="status">Loading the latest lesson…</p> : lesson.status === "unavailable" ? <p>The latest lesson couldn’t be loaded.</p> : !lesson.latest ? <p>No saved lesson yet.</p> : <>
        <p><time dateTime={lesson.latest.lessonDate}>{label(lesson.latest.lessonDate)}</time> · Lesson author: <bdi dir="auto">{lesson.latest.displayName}</bdi></p>
        <details key={JSON.stringify([scope, lesson.latest])}><summary>Read saved lesson note</summary><p className="parent-summary-note" dir="auto">{lesson.latest.summary}</p></details>
      </>}
    </div>
    <div><h3>Recorded practice dates</h3>
      {dates.status === "loading" ? <p role="status">Loading practice dates…</p> : dates.status === "unavailable" ? <p>Practice dates couldn’t be loaded.</p> : <>
        <p>Seven days ending <time dateTime={dates.serverDay}>{label(dates.serverDay)}</time>.</p>
        {dates.dates.length ? <ul className="parent-summary-dates">{dates.dates.map(date => <li key={date}><time dateTime={date}>{label(date)}</time></li>)}</ul> : <p>No practice dates recorded in these seven days.</p>}
      </>}
    </div>
  </section>;
}
