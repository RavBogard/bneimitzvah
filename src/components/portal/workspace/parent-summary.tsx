"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Assigned } from "./api";
import { PortalRequestError } from "../api";
import { dayOrdinal, dayString, type PracticeDates } from "./practice-calendar/api";
import { authorName, BeforeNext, type LessonSummarySnapshot } from "./lessons/panel";
import { nextDateLine } from "./parent-week";
import { deviceDate } from "./today/model";
import { gotCount, readMarks } from "./today/today";

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
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// 1970-01-01 was a Thursday.
const weekday = (ordinal: number) => (((ordinal + 4) % 7) + 7) % 7;

/**
 * What the child has got across the whole reading, counted as the shelf's card counts it: every page of the child's marks, read through the
 * parent's own progress read (the same authorized path the card and this page already use; nothing new is asked of the server).
 */
type ProgressRead = Parameters<typeof readMarks>[0];
function useGot(baseline: Assigned | null, live: boolean, readProgress: ProgressRead | undefined) {
  const read = useRef(readProgress); read.current = readProgress;
  const [got, setGot] = useState<{ baseline: Assigned; value: { got: number; total: number } } | null>(null);
  useEffect(() => {
    if (!live || !baseline || !baseline.readings.length || !read.current) return;
    const controller = new AbortController();
    void (async () => {
      const marks = new Map<Assigned["readings"][number]["kind"], Awaited<ReturnType<typeof readMarks>>>();
      for (const reading of baseline.readings) { const progress = read.current; if (!progress) return; marks.set(reading.kind, await readMarks(progress, baseline, reading.kind, controller.signal)); }
      const value = gotCount(baseline.readings, { status: "ready", value: marks });
      if (!controller.signal.aborted && value) setGot({ baseline, value });
    })().catch(() => undefined);
    return () => controller.abort();
  }, [baseline, live]);
  return got?.baseline === baseline ? got.value : null;
}

/** The week's dots as the student's card draws them, for the seven days the read covers (ending today); a practiced day carries its date. Dates only. */
function WeekDots({ serverDay, dates, name }: { serverDay: string; dates: readonly string[]; name: string }) {
  const today = dayOrdinal(serverDay), start = today - 6, practiced = new Set(dates);
  return <ol className="parent-summary-dates parent-week" aria-label={`Days ${name} practiced this week`} data-testid="parent-week">{Array.from({ length: 7 }, (_, index) => {
    const ordinal = start + index, date = dayString(ordinal), done = practiced.has(date);
    return <li key={ordinal} className={`parent-day${done ? " parent-day-done" : ""}${ordinal === today ? " parent-day-today" : ""}`}>
      <span aria-hidden="true" className="parent-day-letter">{weekdays[weekday(ordinal)][0]}</span>
      <span className="parent-day-dot" aria-hidden="true" />
      <span className="sr-only">{done ? <time dateTime={date}>{weekdays[weekday(ordinal)]}</time> : weekdays[weekday(ordinal)]}{ordinal === today ? ", today" : ""}: {done ? "practiced" : "not practiced"}</span>
    </li>;
  })}</ol>;
}

/**
 * The parent's "This week" card (1.9 N13; parent walk 2026-10-28, the whole-screen rethink): the next date in relative words, the tutor's
 * "Before next time" with its date (the note itself when there is none), the week's dots, what the child has got, and Practice with the child.
 * Everything on it is read through reads the parent already has (the child's dates, the practice calendar, the lesson notes, the marks).
 * notice: the congregation's consent notice from its settings (what is stored, who hears it, when it is deleted); nothing when unset.
 */
export function ParentStudySummary({ store, baseline, scope, concealed, notice = null, action, readProgress }: { store: ParentSummaryStore; baseline: Assigned | null; scope: string; concealed: boolean; notice?: string | null; action?: ReactNode;
  /** The parent's own progress read (the provider's), for what the child has got; without it the line is left out. */ readProgress?: ProgressRead }) {
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const live = Boolean(baseline && baseline.mode === "parent" && !concealed && store.matches(baseline, scope)), got = useGot(baseline, live, readProgress);
  if (!baseline || !live) return null;
  const lesson = state.lesson, dates = state.dates, next = nextDateLine(baseline.student, deviceDate()), first = baseline.student.firstName;
  return <section className="parent-study-summary" aria-label="Preparation summary" data-testid="parent-this-week">
    <h2>This week</h2>
    {next && <p className="parent-summary-next">{next}</p>}
    <div className="parent-summary-lesson">
      {lesson.status === "loading" ? <p role="status">Loading the latest lesson…</p> : lesson.status === "unavailable" ? <p>The latest lesson couldn’t be loaded.</p> : !lesson.latest ? <p>No saved lesson yet.</p> : <>
        <p className="parent-summary-from"><time dateTime={lesson.latest.lessonDate}>{label(lesson.latest.lessonDate)}</time> · from <bdi dir="auto">{authorName(lesson.latest.displayName, "parent", first)}</bdi></p>
        {lesson.latest.beforeNext ? <BeforeNext text={lesson.latest.beforeNext} own={false} /> : <p className="parent-summary-note" dir="auto">{lesson.latest.summary}</p>}
      </>}
    </div>
    <div className="parent-summary-practised">
      {dates.status === "loading" ? <p role="status">Loading practice dates…</p> : dates.status === "unavailable" ? <p>Practice dates couldn’t be loaded.</p>
        : dates.dates.length ? <WeekDots serverDay={dates.serverDay} dates={dates.dates} name={first} /> : <p>No practice dates recorded in these seven days.</p>}
    </div>
    {got && <p className="parent-summary-got" data-testid="parent-got">Verses <bdi dir="auto">{first}</bdi> has got: <span>{got.got} of {got.total}</span></p>}
    {action && <div className="parent-summary-action">{action}</div>}
    {notice && <p className="parent-consent-notice" dir="auto">{notice}</p>}
  </section>;
}
