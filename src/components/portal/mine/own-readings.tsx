"use client";
import { useEffect, useId, useState } from "react";
import { fetchSavedReadings } from "../saved/api";
import { sortOwnReadings, type OwnReadingsState } from "./model";
import styles from "../saved/saved.module.css";

export const OWN_READINGS_FIRST = 5;
export type { OwnReadingsState };

const displayRange = (ranges: string) => ranges.replace(/(\d)-(\d)/g, "$1–$2");
export const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
/** Where a saved reading opens: the reading page with that reading's own header, marks and edits. */
export const savedReadingHref = (id: string) => `/read?saved=${encodeURIComponent(id)}`;

/** "Also working on": the readings the person saved themselves, earliest date first, the first five shown and the rest one press away. */
export function OwnReadingsView({ state, expanded, listId, onExpand, onRetry }: { state: OwnReadingsState; expanded: boolean; listId: string; onExpand: () => void; onRetry: () => void }) {
  if (state.status === "hidden") return null;
  const readings = state.status === "ready" ? sortOwnReadings(state.readings) : [], shown = expanded ? readings : readings.slice(0, OWN_READINGS_FIRST);
  return <section className={styles.mine} aria-labelledby="own-readings-title" aria-busy={state.status === "loading"} data-my-readings data-testid="mine-own">
    <h2 id="own-readings-title" className={styles.mineTitle}>Also working on</h2>
    {state.status === "loading" && <p className={styles.mineLine}>Finding your readings.</p>}
    {state.status === "failed" && <><p className={styles.mineLine} role="status">Your readings didn’t load.</p>
      <button type="button" className={`button-secondary ${styles.more}`} onClick={onRetry}>Try again</button></>}
    {shown.length > 0 && <ul id={listId} className={styles.list}>
      {shown.map(reading => <li key={reading.id}><a className={styles.item} href={savedReadingHref(reading.id)}>
        <span className={styles.itemName}><bdi>{reading.name}</bdi></span>
        <span className={styles.itemMeta}>{reading.date ? <time dateTime={reading.date}>{longDate(reading.date)}</time> : "No date"} · {reading.kind === "torah" ? "Torah" : "Haftarah"} <bdi dir="ltr">{displayRange(reading.ranges)}</bdi></span>
      </a></li>)}
    </ul>}
    {readings.length > OWN_READINGS_FIRST && <button type="button" className={`button-secondary ${styles.more}`} aria-expanded={expanded} aria-controls={listId} onClick={onExpand}>
      {expanded ? "Fewer readings" : "All my readings"}</button>}
    {readings.length > 0 && <p className={styles.mineLine}>Open a reading to rename it, change its date or verses, or remove it.</p>}
  </section>;
}

/** The person's own readings, loaded once per page and again when the page comes back from the back-forward cache. Refused or signed out on the way, they are hidden. */
export function useOwnReadings(): { state: OwnReadingsState; retry: () => void } {
  const [state, setState] = useState<OwnReadingsState>({ status: "loading" }), [retry, setRetry] = useState(0);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setRetry(value => value + 1); };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchSavedReadings(controller.signal).then(list => {
      if (controller.signal.aborted) return;
      setState(list.state === "ready" ? { status: "ready", readings: list.readings } : { status: "hidden" });
    }, () => { if (!controller.signal.aborted) setState({ status: "failed" }); });
    return () => controller.abort();
  }, [retry]);
  return { state, retry: () => setRetry(value => value + 1) };
}

export function OwnReadings({ state, onRetry }: { state: OwnReadingsState; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false), listId = useId();
  // A reload of the list (the back-forward cache) closes the long list again, so it never shows more than was asked for.
  useEffect(() => { if (state.status === "loading") setExpanded(false); }, [state.status]);
  return <OwnReadingsView state={state} expanded={expanded} listId={listId} onExpand={() => setExpanded(value => !value)} onRetry={onRetry} />;
}
