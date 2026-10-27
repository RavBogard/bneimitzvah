"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { congregationToday, shabbatOnOrAfter } from "../../../lib/readings/public-shabbat";
import type { CalendarRow } from "../../../lib/readings/calendar";
import { addressOf, findReadings, NO_MATCH_LINE, type FindResult } from "../../../lib/readings/find-reading";
import { fetchCalendar } from "../public-reading/calendar-api";
import { goToReading } from "../public-reading/heading-focus";
import { readAddress, saveReturnAddress } from "../public-reading/urls";
import styles from "./find-reading.module.css";

/**
 * Find a reading (Readings for everyone, Area B): one labelled field that answers with a parashah or holiday, the Shabbat on or after a
 * date, or verses; a calendar button for people who think in dates; four "Coming up" chips; and the way to every reading. It is the one
 * way to ask for a reading, on the home, inside the reader's Change sheet and at the top of /readings.
 */
export type FindPlace = "home" | "sheet" | "index";
export type FindCalendar = Readonly<{ status: "loading" } | { status: "failed" } | { status: "ready"; rows: readonly CalendarRow[]; today: string }>;
export const FIND_LABEL = "Find a reading";
export const FIND_PLACEHOLDER = "A parashah, a holiday, a date or verses";
export const FIND_ALL_LINK = "Every parashah, holiday and passage";
export const CHIP_COUNT = 4;

const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

/**
 * The next four Shabbatot from `today`. On the home on a Saturday the hero already leads with next Shabbat and offers This Shabbat,
 * so the chips begin after today.
 */
export function comingUp(rows: readonly CalendarRow[], today: string, place: FindPlace): CalendarRow[] {
  const saturday = shabbatOnOrAfter(today) === today;
  return rows.filter(row => row.date >= today && !(place === "home" && saturday && row.date === today)).slice(0, CHIP_COUNT);
}
/** "This Shabbat" for the Shabbat of this week; otherwise the week's name, or its date when it has none. */
export const chipLabel = (row: CalendarRow, today: string) => row.date === shabbatOnOrAfter(today) ? "This Shabbat" : row.name ?? shortDate(row.date);
/** What one result says in the list: its name and when it is next read, the Shabbat a date lands on, or the verses. */
export function resultLabel(result: FindResult): string {
  if (result.kind === "named") return result.next ? `${result.name} · next ${shortDate(result.next)}` : result.name;
  if (result.kind === "date") return result.name ? `${longDate(result.date)} · ${result.name}` : longDate(result.date);
  return `${result.ref} · ${result.readingKind === "torah" ? "Torah" : "Haftarah"}`;
}
/** Arrow keys move the highlight (it stops at either end); Enter opens the highlighted result, else the first. */
export function keyAction(key: string, active: number, count: number): { active: number; open: number | null } {
  if (!count) return { active: -1, open: null };
  if (key === "ArrowDown") return { active: Math.min(active + 1, count - 1), open: null };
  if (key === "ArrowUp") return { active: Math.max(active - 1, 0), open: null };
  if (key === "Enter") return { active, open: active >= 0 ? active : 0 };
  return { active, open: null };
}

type ViewProps = Readonly<{
  place: FindPlace; study?: boolean; add?: boolean; prepare?: boolean; calendar: FindCalendar; text: string; active: number;
  onText?(text: string): void; onKey?(event: KeyboardEvent<HTMLInputElement>): void; onOpen?(address: string): void; onRetry?(): void;
  onPickDate?(date: string): void; inputRef?: React.Ref<HTMLInputElement>; dateRef?: React.Ref<HTMLInputElement>; onActive?(index: number): void;
}>;

/** The field and its answers, with every state passed in: the page's state lives in `FindReading`. */
export function FindReadingView({ place, study, add, prepare, calendar, text, active, onText, onKey, onOpen, onRetry, onPickDate, inputRef, dateRef, onActive }: ViewProps) {
  const id = useId(), list = `${id}-list`, optionId = (i: number) => `${id}-option-${i}`;
  const rows = calendar.status === "ready" ? calendar.rows : [], today = calendar.status === "ready" ? calendar.today : null;
  const results = useMemo(() => text.trim() ? findReadings(text, { calendar: rows, today: today ?? congregationToday() }) : [], [text, rows, today]);
  const open = (address: string) => (event?: { preventDefault(): void }) => { if (onOpen) { event?.preventDefault(); onOpen(address); } };
  const chips = place !== "index" ? today ? comingUp(rows, today, place) : [] : [];
  const noMatch = text.trim() !== "" && results.length === 0;
  const all = add ? "/readings?add=1" : "/readings";
  return <div className={styles.find} data-place={place} data-testid="find-reading">
    <label className={styles.label} htmlFor={`${id}-field`}>{FIND_LABEL}</label>
    <div className={styles.row}>
      <input id={`${id}-field`} ref={inputRef} className={styles.field} type="text" role="combobox" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="go"
        placeholder={FIND_PLACEHOLDER} value={text} aria-expanded={results.length > 0} aria-controls={list} aria-autocomplete="list" aria-activedescendant={active >= 0 && active < results.length ? optionId(active) : undefined}
        onChange={event => onText?.(event.target.value)} onKeyDown={onKey} />
      <button type="button" className={`button-secondary ${styles.pick}`} aria-label="Pick a date" onClick={() => { const input = (dateRef as React.RefObject<HTMLInputElement> | undefined)?.current; try { input?.showPicker(); } catch { input?.focus(); input?.click(); } }}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" focusable="false"><path d="M5 2v2M15 2v2M3 7h14M4 4h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <input ref={dateRef} className={styles.date} type="date" tabIndex={-1} aria-hidden="true" onChange={event => { if (event.target.value) onPickDate?.(event.target.value); }} />
    </div>
    <ul id={list} className={styles.results} role="listbox" aria-label="Readings found" hidden={results.length === 0}>
      {results.map((result, i) => <li key={`${result.kind}-${result.kind === "named" ? result.slug : result.kind === "date" ? result.date : result.ref}`} id={optionId(i)} role="option" aria-selected={i === active}
        className={styles.option} data-active={i === active ? "" : undefined} onMouseEnter={() => onActive?.(i)} onMouseDown={event => event.preventDefault()}
        onClick={() => onOpen?.(addressOf(result, { study, add, prepare }))}>{resultLabel(result)}</li>)}
    </ul>
    <p className={styles.none} role="status">{noMatch ? NO_MATCH_LINE(text.trim()) : ""}</p>
    {place !== "index" && <div className={styles.coming} data-state={calendar.status}>
      <p className={styles.eyebrow} id={`${id}-coming`}>Coming up</p>
      {calendar.status === "failed"
        ? <p className={styles.failed} role="status">Couldn’t load the calendar. <button type="button" className={styles.retry} aria-label="Try again to load the calendar" onClick={onRetry}>Try again</button></p>
        : <ul className={styles.chips} aria-labelledby={`${id}-coming`} aria-busy={calendar.status === "loading"}>
          {calendar.status === "loading" ? Array.from({ length: CHIP_COUNT }, (_, i) => <li key={i} className={styles.chipSkeleton} aria-hidden="true" />)
            : chips.map(row => {
              const address = row.date === shabbatOnOrAfter(calendar.today) ? readAddress({ mode: "week", date: row.date, kind: null }, { today: row.date, study }) : readAddress({ mode: "week", date: row.date, kind: null }, { study });
              const href = add ? saveReturnAddress(address) : address;
              return <li key={row.date}><a className={styles.chip} href={href} data-chip-date={row.date} onClick={open(href)}>{chipLabel(row, calendar.today)}</a></li>;
            })}
        </ul>}
    </div>}
    {place !== "index" && <p className={styles.all}><a href={all}>{FIND_ALL_LINK}</a></p>}
  </div>;
}

/**
 * Opening: `onOpen(address)` when given (the Change sheet closes first), else the browser goes there. `study` keeps the Study lens;
 * `add` carries the save offer to the reading it opens (the way back from "Add a reading" on My Readings).
 */
export function FindReading({ place, study, add, prepare, onOpen }: { place: FindPlace; study?: boolean; add?: boolean; prepare?: boolean; onOpen?(address: string): void }) {
  const [calendar, setCalendar] = useState<FindCalendar>({ status: "loading" }), [text, setText] = useState(""), [active, setActive] = useState(-1);
  const [attempt, setAttempt] = useState(0), dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setCalendar({ status: "loading" });
    fetchCalendar(controller.signal).then(rows => { if (!controller.signal.aborted) setCalendar({ status: "ready", rows, today: congregationToday() }); },
      () => { if (!controller.signal.aborted) setCalendar({ status: "failed" }); });
    return () => controller.abort();
  }, [attempt]);
  const rows = calendar.status === "ready" ? calendar.rows : [], today = calendar.status === "ready" ? calendar.today : null;
  const results = useMemo(() => text.trim() ? findReadings(text, { calendar: rows, today: today ?? congregationToday() }) : [], [text, rows, today]);
  const go = (address: string) => { if (onOpen) onOpen(address); else goToReading(address); };
  return <FindReadingView place={place} study={study} add={add} prepare={prepare} calendar={calendar} text={text} active={active} dateRef={dateRef}
    onText={value => { setText(value); setActive(-1); }} onActive={setActive} onOpen={go} onRetry={() => setAttempt(n => n + 1)}
    onKey={event => {
      if (event.key === "Escape") { setText(""); setActive(-1); return; }
      const action = keyAction(event.key, active, results.length);
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") event.preventDefault();
      setActive(action.active);
      if (action.open !== null) go(addressOf(results[action.open], { study, add, prepare }));
    }}
    onPickDate={value => { try { go(addressOf({ kind: "date", date: shabbatOnOrAfter(value), name: null }, { study, add })); } catch { /* not a date */ } }} />;
}
