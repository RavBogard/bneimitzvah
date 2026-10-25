"use client";
import { useEffect, useState } from "react";
import type { CompareAnswer, CompareEdition } from "../../../../lib/readings/compare";
import { Runs } from "./commentary-view";
import { fetchCompare } from "./translations-api";
import styles from "./commentary.module.css";

/** One edition: its title, the verse in it, and its credit (as Sefaria states it), linked to Sefaria. */
function Edition({ value, language }: { value: CompareEdition; language: "en" | "arc" }) {
  return <li className={styles.compareItem}>
    <p className={styles.compareTitle}><bdi>{value.title}</bdi></p>
    <p className={`${styles.compareText} ${language === "arc" ? styles.aramaic : ""}`} lang={language} dir={language === "arc" ? "rtl" : "ltr"}><Runs runs={value.runs} mixed={language === "en"} /></p>
    <p className={styles.compareCredit}><a href={value.url} target="_blank" rel="noopener noreferrer">{value.credit}</a></p>
  </li>;
}

/**
 * Compare (1.3): every other English translation Sefaria has for the verse, in Sefaria's order, then the
 * verse's Targum in Aramaic and English. Loaded only when opened; a failure is one quiet line with Try again.
 */
export function CompareView({ verse }: { verse: string }) {
  const [state, setState] = useState<{ key: string; answer?: CompareAnswer; failed?: true } | null>(null), [retry, setRetry] = useState(0);
  const key = `${verse}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key });
    fetchCompare(verse, controller.signal).then(answer => { if (!controller.signal.aborted) setState({ key, answer }); },
      () => { if (!controller.signal.aborted) setState({ key, failed: true }); });
    return () => controller.abort();
  }, [verse, key]);
  const current = state?.key === key ? state : null, again = <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>;
  if (!current || !current.answer && !current.failed) return <p className={styles.status} role="status">Loading…</p>;
  if (!current.answer) return <p className={styles.status} role="status">Translations aren’t available right now. {again}</p>;
  const { translations, targum } = current.answer;
  return <>
    {translations === null ? <p className={styles.status} role="status">Other translations aren’t available right now. {again}</p>
      : translations.length === 0 ? <p className={styles.status}>Sefaria has no other English translation of this verse.</p>
        : <ul className={styles.compareList} aria-label="Translations">{translations.map(value => <Edition key={value.title} value={value} language="en" />)}</ul>}
    {targum && <section className={styles.targum} aria-label={targum.work}>
      <h4 className={styles.panelSubheading}>{targum.work}</h4>
      <ul className={styles.compareList}>
        {targum.aramaic && <Edition value={targum.aramaic} language="arc" />}
        {targum.english && <Edition value={targum.english} language="en" />}
      </ul>
    </section>}
  </>;
}
