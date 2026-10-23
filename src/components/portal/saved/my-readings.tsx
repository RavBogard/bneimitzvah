"use client";
import { useEffect, useId, useState } from "react";
import { fetchSavedReadings, type SavedReading } from "./api";
import styles from "./saved.module.css";

export const MY_READINGS_FIRST = 5;
export type MyReadingsState = Readonly<{ status: "loading" } | { status: "ready"; readings: readonly SavedReading[] } | { status: "failed" } | { status: "hidden" }>;

const displayRange = (ranges: string) => ranges.replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
/** Where a saved reading opens: the reading page with that reading's own header, marks and edits. */
export const savedReadingHref = (id: string) => `/read?saved=${encodeURIComponent(id)}`;

/** The front door's My readings, in each of its states: the five most recent, the rest one press away. */
export function MyReadingsView({ state, expanded, listId, onExpand, onRetry }: { state: MyReadingsState; expanded: boolean; listId: string; onExpand: () => void; onRetry: () => void }) {
  if (state.status === "hidden") return null;
  const readings = state.status === "ready" ? state.readings : [], shown = expanded ? readings : readings.slice(0, MY_READINGS_FIRST);
  return <section className={styles.mine} aria-labelledby="my-readings-title" aria-busy={state.status === "loading"} data-my-readings>
    <h2 id="my-readings-title" className={styles.mineTitle}>My readings</h2>
    {state.status === "loading" && <p className={styles.mineLine}>Finding your readings.</p>}
    {state.status === "failed" && <><p className={styles.mineLine} role="status">Your readings didn’t load.</p>
      <button type="button" className={`button-secondary ${styles.more}`} onClick={onRetry}>Try again</button></>}
    {state.status === "ready" && !readings.length && <p className={styles.mineLine}>Save a reading from This week to see it here.</p>}
    {shown.length > 0 && <ul id={listId} className={styles.list}>
      {shown.map(reading => <li key={reading.id}><a className={styles.item} href={savedReadingHref(reading.id)}>
        <span className={styles.itemName}><bdi>{reading.name}</bdi></span>
        <span className={styles.itemMeta}>{reading.date && <><time dateTime={reading.date}>{longDate(reading.date)}</time> · </>}{reading.kind === "torah" ? "Torah" : "Haftarah"} <bdi dir="ltr">{displayRange(reading.ranges)}</bdi></span>
      </a></li>)}
    </ul>}
    {readings.length > MY_READINGS_FIRST && <button type="button" className={`button-secondary ${styles.more}`} aria-expanded={expanded} aria-controls={listId} onClick={onExpand}>
      {expanded ? "Fewer readings" : "All my readings"}</button>}
  </section>;
}

/** My readings for an account the session says keeps saved readings. Refused or signed out on the way, it disappears. */
export function MyReadings() {
  const [state, setState] = useState<MyReadingsState>({ status: "loading" }), [expanded, setExpanded] = useState(false), [retry, setRetry] = useState(0), listId = useId();
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchSavedReadings(controller.signal).then(list => {
      if (controller.signal.aborted) return;
      setState(list.state === "ready" ? { status: "ready", readings: list.readings } : { status: "hidden" });
    }, () => { if (!controller.signal.aborted) setState({ status: "failed" }); });
    return () => controller.abort();
  }, [retry]);
  return <MyReadingsView state={state} expanded={expanded} listId={listId} onExpand={() => setExpanded(value => !value)} onRetry={() => setRetry(value => value + 1)} />;
}
