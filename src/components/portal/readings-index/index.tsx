"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { congregationToday, shabbatOnOrAfter } from "../../../lib/readings/public-shabbat";
import type { CalendarRow } from "../../../lib/readings/calendar";
import { normalizeName, preparePassageHref } from "../../../lib/readings/find-reading";
import { NAMED_READINGS, type NamedReading } from "../../../lib/readings/named-readings";
import { customRef, OCCASIONS, parashotByBook } from "../../../lib/readings/named-groups";
import { preparationHref } from "../../../lib/learn/passage-preparation";
import { PageHeader } from "../../ui";
import { SiteBar } from "../../site/site-bar";
import { FindReading, type FindCalendar } from "../find-reading/find-reading";
import { fetchCalendar } from "../public-reading/calendar-api";
import { goToReading } from "../public-reading/heading-focus";
import { readAddress, saveReturnAddress } from "../public-reading/urls";
import { ReadingPassageSelect } from "../workspace/reading-passage-select";
import type { StudyKind } from "../workspace/study/api";
import styles from "./index.module.css";

/**
 * /readings, the index of every reading (Readings for everyone, Area B): the field, six Shabbatot coming up, every parashah in Torah
 * order with the Shabbat it is next read, the holidays and special Shabbatot, and any verses. Every row is a link to the reader.
 * `add` (from "Add a reading") carries the save offer to the reading opened; `prepare` (from Learn) opens the preparation page instead.
 */
export type IndexMode = Readonly<{ add: boolean; prepare: boolean }>;
export const COMING_UP_ROWS = 6;
export const HEBCAL_CREDIT = "Reading list from";

const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

/** `?add=1` and `?for=prepare`, read once in the browser. */
export function parseIndexMode(search: string): IndexMode {
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return { add: false, prepare: false }; }
  return { add: params.getAll("add").length === 1 && params.get("add") === "1", prepare: params.getAll("for").length === 1 && params.get("for") === "prepare" };
}
/** Where one named reading opens: the reader (with the save offer when adding), or the preparation page for its first passage that can be prepared. */
export function namedHref(reading: NamedReading, mode: IndexMode): string {
  if (mode.prepare) {
    const href = preparePassageHref(reading);
    if (href) return href;
  }
  const address = readAddress({ mode: "named", slug: reading.slug, passage: 1 });
  return mode.add ? saveReturnAddress(address) : address;
}
function weekHref(date: string, today: string, name: string | null, mode: IndexMode): string {
  if (mode.prepare) {
    const reading = name ? NAMED_READINGS.find(row => normalizeName(row.name) === normalizeName(name)) : undefined;
    if (reading) return namedHref(reading, mode);
    if (date === shabbatOnOrAfter(today)) return "/learn/prepare";
  }
  const address = readAddress({ mode: "week", date, kind: null }, { today: shabbatOnOrAfter(today) });
  return mode.add ? saveReturnAddress(address) : address;
}
const refHref = (ref: string, kind: StudyKind, mode: IndexMode) => {
  if (mode.prepare) return preparationHref(ref, kind);
  const address = readAddress({ mode: "ref", ref, kind });
  return mode.add ? saveReturnAddress(address) : address;
};

/** The "next {date}" for each named reading that the calendar lists on or after today. */
export function nextDates(rows: readonly CalendarRow[], today: string): ReadonlyMap<string, string> {
  const next = new Map<string, string>();
  for (const row of rows) if (row.date >= today && row.name !== null && !next.has(normalizeName(row.name))) next.set(normalizeName(row.name), row.date);
  return next;
}

/** A row: a plain link that, for a reading, asks the next page to land focus on its heading (a modified click opens as any link does). */
function RowLink({ href, tall, children }: { href: string; tall?: boolean; children: ReactNode }) {
  return <a className={tall ? `${styles.row} ${styles.rowTall}` : styles.row} href={href} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(href === "/read" || href.startsWith("/read?"))) return;
    event.preventDefault(); goToReading(href);
  }}>{children}</a>;
}

function Verses({ mode }: { mode: IndexMode }) {
  const field = useId();
  const [corpus, setCorpus] = useState<StudyKind>("torah"), [custom, setCustom] = useState("");
  const ref = customRef(custom, corpus), chosen = custom.trim() !== "";
  return <form onSubmit={event => { event.preventDefault(); if (ref) goToReading(refHref(ref, corpus, mode)); }}>
    <div className="study-kind-choice" role="group" aria-label="Kind of passage">
      {(["torah", "haftarah"] as const).map(kind => <button key={kind} type="button" className="button-secondary" aria-pressed={corpus === kind}
        onClick={() => { if (kind !== corpus) { setCorpus(kind); setCustom(""); } }}>{kind === "torah" ? "Torah" : "Prophets"}</button>)}
    </div>
    <ReadingPassageSelect key={corpus} custom={custom} kind={corpus} neviim={corpus === "haftarah"} idPrefix={`${field}-custom`} legend="Verses" disabled={false} onChange={setCustom} />
    {chosen && !ref && <p className="field-help" role="status">{corpus === "torah" ? "These verses can’t be opened together. Keep Torah passages in one book, in order, and under 1,000 verses." : "These verses can’t be opened together. Keep them under 1,000 verses, with no verse twice."}</p>}
    <button type="submit" className="button-secondary" disabled={!ref}>Open</button>
  </form>;
}

/** The index with its calendar and mode passed in; `ReadingsIndex` keeps both. */
export function ReadingsIndexView({ calendar, mode }: { calendar: FindCalendar; mode: IndexMode }) {
  const books = useMemo(parashotByBook, []);
  const rows = calendar.status === "ready" ? calendar.rows : [], today = calendar.status === "ready" ? calendar.today : null;
  const next = useMemo(() => today ? nextDates(rows, today) : new Map<string, string>(), [rows, today]);
  const coming = today ? rows.filter(row => row.date >= today).slice(0, COMING_UP_ROWS) : [];
  // The book of the parashah read next is the one that opens.
  const current = useMemo(() => {
    if (!today) return null;
    const row = rows.find(item => item.date >= today && item.kind === "regular" && item.name);
    const reading = row?.name ? NAMED_READINGS.find(item => item.group === "parashah" && normalizeName(item.name) === normalizeName(row.name!)) : undefined;
    return reading ? books.find(group => group.readings.includes(reading))?.book ?? null : null;
  }, [rows, today, books]);
  return <>
    <PageHeader title="Readings" />
    <FindReading place="index" add={mode.add} prepare={mode.prepare} />
    <section className={styles.section} aria-labelledby="readings-coming-up" data-testid="readings-coming-up">
      <h2 id="readings-coming-up">Coming up</h2>
      {calendar.status === "failed" ? <p className="field-help" role="status">Couldn’t load the calendar. Every reading is still listed below.</p>
        : <ul className={styles.list} aria-busy={calendar.status === "loading"}>
          {calendar.status === "loading" ? Array.from({ length: COMING_UP_ROWS }, (_, i) => <li key={i} className={`${styles.rowSkeleton} ${styles.rowTall}`} aria-hidden="true" />)
            : coming.map(row => <li key={row.date}><RowLink tall href={weekHref(row.date, calendar.today, row.name, mode)}>
              <span className={styles.rowText}><span className={styles.rowDate}><time dateTime={row.date}>{longDate(row.date)}</time></span>
                <span className={styles.rowName}>{row.name ?? "Shabbat reading"}</span></span>
              {row.date === shabbatOnOrAfter(calendar.today) ? <span className={styles.note}>This Shabbat</span> : row.kind === "holiday" ? <span className={styles.note}>Holiday</span> : null}
            </RowLink></li>)}
        </ul>}
    </section>
    <section className={styles.section} aria-labelledby="readings-torah">
      <h2 id="readings-torah">The Torah, in order</h2>
      {books.map(group => <details key={group.book} className={styles.book} open={group.book === current ? true : undefined} data-book={group.book}>
        <summary>{group.book}</summary>
        <ul className={styles.list}>
          {group.readings.map(reading => { const date = next.get(normalizeName(reading.name));
            return <li key={reading.slug}><RowLink href={namedHref(reading, mode)}><span className={styles.rowName}>{reading.name}</span>{date ? <span className={styles.note}>next {shortDate(date)}</span> : calendar.status === "loading" ? <span className={`${styles.note} ${styles.pending}`} aria-hidden="true">next Nov 14</span> : null}</RowLink></li>; })}
        </ul>
      </details>)}
    </section>
    <section className={styles.section} aria-labelledby="readings-holidays">
      <h2 id="readings-holidays">Holidays and special Shabbatot</h2>
      {OCCASIONS.map(occasion => <div key={occasion.group} className={styles.occasion}>
        <h3>{occasion.label}</h3>
        <ul className={styles.list}>
          {NAMED_READINGS.filter(reading => reading.group === occasion.group).map(reading => { const date = next.get(normalizeName(reading.name));
            return <li key={reading.slug}><RowLink href={namedHref(reading, mode)}><span className={styles.rowName}>{reading.name}</span>{date ? <span className={styles.note}>next {shortDate(date)}</span> : calendar.status === "loading" ? <span className={`${styles.note} ${styles.pending}`} aria-hidden="true">next Nov 14</span> : null}</RowLink></li>; })}
        </ul>
      </div>)}
    </section>
    <section className={styles.section} aria-labelledby="readings-verses">
      <h2 id="readings-verses">Any verses</h2>
      <Verses mode={mode} />
    </section>
    <p className={styles.credit}>{HEBCAL_CREDIT} <a href="https://www.hebcal.com/" target="_blank" rel="noreferrer">Hebcal</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.</p>
  </>;
}

export function ReadingsIndex() {
  const [mode, setMode] = useState<IndexMode>({ add: false, prepare: false }), [calendar, setCalendar] = useState<FindCalendar>({ status: "loading" });
  useEffect(() => { setMode(parseIndexMode(window.location.search)); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchCalendar(controller.signal).then(rows => { if (!controller.signal.aborted) setCalendar({ status: "ready", rows, today: congregationToday() }); },
      () => { if (!controller.signal.aborted) setCalendar({ status: "failed" }); });
    return () => controller.abort();
  }, []);
  return <div className={`portal-shell ${styles.shell}`}>
    <a className="skip-link" href="#readings-main">Skip to main content</a>
    <SiteBar />
    <main id="readings-main" className={styles.main}>
      <ReadingsIndexView calendar={calendar} mode={mode} />
    </main>
  </div>;
}
