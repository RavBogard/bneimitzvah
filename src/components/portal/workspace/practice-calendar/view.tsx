"use client";
import { useState, useSyncExternalStore } from "react";
import { dayOrdinal, dayString } from "./api";
import type { PracticeCalendar } from "./store";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// 1970-01-01 was a Thursday.
const weekday = (ordinal: number) => (((ordinal + 4) % 7) + 7) % 7;
const parts = (ordinal: number) => { const [year, month, day] = dayString(ordinal).split("-").map(Number); return { year, month, day }; };
const spoken = (ordinal: number) => { const { month, day } = parts(ordinal); return `${weekdays[weekday(ordinal)]}, ${monthNames[month - 1]} ${day}`; };
const check = <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** This week, Sunday to Saturday, with practiced days filled. Dates only; the month view sits behind a disclosure. */
export function PracticeDays({ calendar }: { calendar: PracticeCalendar }) {
  const state = useSyncExternalStore(calendar.subscribe, calendar.snapshot, calendar.snapshot);
  if (state.status === "off" || state.status === "ended") return null;
  if (state.status !== "ready") return <div className="practice-days" aria-busy={state.status === "loading"}>{state.status === "unavailable" && <p className="practice-days-note">Practice days couldn’t be loaded.</p>}</div>;
  const today = dayOrdinal(state.serverDay), start = today - weekday(today), practiced = (ordinal: number) => state.dates.has(dayString(ordinal));
  return <div className="practice-days">
    <ol className="practice-week" aria-label="Practice this week">{Array.from({ length: 7 }, (_, index) => {
      const ordinal = start + index, done = ordinal <= today && practiced(ordinal), future = ordinal > today;
      return <li key={ordinal} className={`practice-day${done ? " practice-day-done" : ""}${ordinal === today ? " practice-day-today" : ""}${future ? " practice-day-future" : ""}`}>
        <span aria-hidden="true" className="practice-day-letter">{weekdays[weekday(ordinal)][0]}</span>
        <span className="practice-day-dot" aria-hidden="true">{done && check}</span>
        <span className="sr-only">{spoken(ordinal)}{ordinal === today ? ", today" : ""}: {future ? "not yet" : done ? "practiced" : "not practiced"}</span>
      </li>;
    })}</ol>
    <PracticeMonths today={today} first={dayOrdinal(state.fromDate)} practiced={practiced} />
  </div>;
}

/**
 * The same dates for an assigned tutor or an admin, on one student's page: no events, counts, times or
 * other students (MISSION ruling 14). Nothing renders until the calendar is configured for a staff view.
 */
export function StaffPracticeDays({ calendar, firstName }: { calendar: PracticeCalendar; firstName: string }) {
  const state = useSyncExternalStore(calendar.subscribe, calendar.snapshot, calendar.snapshot);
  if (state.status === "off" || state.status === "ended") return null;
  return <section className="staff-practice-days" aria-labelledby="staff-practice-days-heading">
    <h3 id="staff-practice-days-heading">Practice days</h3>
    <p className="field-help">Days <bdi dir="auto">{firstName}</bdi> practiced here, alone or with a parent. Dates only.</p>
    <PracticeDays calendar={calendar} />
  </section>;
}

function PracticeMonths({ today, first, practiced }: { today: number; first: number; practiced(ordinal: number): boolean }) {
  const now = parts(today), earliest = parts(first), index = (year: number, month: number) => year * 12 + month - 1;
  const [shown, setShown] = useState(index(now.year, now.month));
  const min = index(earliest.year, earliest.month), max = index(now.year, now.month), at = Math.min(Math.max(shown, min), max);
  const year = Math.floor(at / 12), month = at % 12 + 1, begin = dayOrdinal(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`);
  const length = dayOrdinal(dayString(begin + 31).slice(0, 8) + "01") - begin, lead = weekday(begin);
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, day) => begin + day)];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  return <details className="practice-month">
    <summary>Practice calendar</summary>
    <div className="practice-month-head">
      <button type="button" className="hero-icon" aria-label="Previous month" disabled={at <= min} onClick={() => setShown(at - 1)}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      <p className="practice-month-title" aria-live="polite">{monthNames[month - 1]} {year}</p>
      <button type="button" className="hero-icon" aria-label="Next month" disabled={at >= max} onClick={() => setShown(at + 1)}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
    </div>
    <table className="practice-grid">
      <caption className="sr-only">Practice days in {monthNames[month - 1]} {year}</caption>
      <thead><tr>{weekdays.map(name => <th key={name} scope="col"><span aria-hidden="true">{name[0]}</span><span className="sr-only">{name}</span></th>)}</tr></thead>
      <tbody>{weeks.map((week, row) => <tr key={row}>{Array.from({ length: 7 }, (_, column) => {
        const ordinal = week[column];
        if (ordinal === null || ordinal === undefined) return <td key={column} />;
        const done = ordinal <= today && ordinal >= first && practiced(ordinal);
        return <td key={column} className={`${done ? "practice-cell-done" : ""}${ordinal === today ? " practice-cell-today" : ""}${ordinal > today ? " practice-cell-future" : ""}`.trim() || undefined}>
          <span aria-hidden="true" className="practice-cell-mark">{parts(ordinal).day}</span><span className="sr-only">{spoken(ordinal)}{ordinal === today ? ", today" : ""}{done ? ", practiced" : ""}</span>
        </td>;
      })}</tr>)}</tbody>
    </table>
  </details>;
}
