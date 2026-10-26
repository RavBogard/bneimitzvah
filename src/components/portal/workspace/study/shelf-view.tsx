"use client";
import { useEffect, useId, useState } from "react";
import { PortalRequestError } from "../../api";
import { compositionDates, isInlineWork, sourceSefariaUrl, type ShelfGroupKey, type ShelfWork } from "../../../../lib/readings/shelf";
import { CommentaryEntry } from "./commentary-view";
import { fetchShelf, fetchSourceText, type ShelfView as ShelfAnswer, type SourceTextAnswer } from "./shelf-api";
import { licenseLabel } from "../../../../lib/readings/edition-credit";
import styles from "./commentary.module.css";

/** One linked text, opened in place: its segments (three lines, then More; Hebrew in place), then its credit. */
function SourceText({ reference, language }: { reference: string; language: "he" | "arc" }) {
  const [state, setState] = useState<{ key: string; value?: SourceTextAnswer; status?: number } | null>(null), [retry, setRetry] = useState(0);
  const key = `${reference}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key });
    fetchSourceText(reference, controller.signal).then(value => { if (!controller.signal.aborted) setState({ key, value }); },
      error => { if (!controller.signal.aborted) setState({ key, status: error instanceof PortalRequestError ? error.status : 503 }); });
    return () => controller.abort();
  }, [reference, key]);
  const current = state?.key === key ? state : null, onSefaria = <a href={sourceSefariaUrl(reference)} target="_blank" rel="noopener noreferrer">Open on Sefaria</a>;
  if (!current || !current.value && current.status === undefined) return <p className={styles.status} role="status">Loading…</p>;
  // A text this page cannot show (Sefaria has no such ref, or it is a whole chapter or more) opens on Sefaria.
  if (!current.value) return current.status === 404 ? <p className={styles.status}>{onSefaria}</p>
    : <p className={styles.status} role="status">This text isn’t available right now. <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></p>;
  const { segments, editions, sefariaUrl } = current.value;
  return <div className={styles.sourceText}>
    {segments.map((segment, index) => <CommentaryEntry key={index} comment={segment} words={[]} verseRef={reference} language={language} englishTag />)}
    <p className={styles.compareCredit}>
      {[...editions].sort((a, b) => Number(b.language === "en") - Number(a.language === "en")).map(edition => <span key={edition.language} className={styles.creditLine}>{edition.language === "he" ? "Hebrew" : "English"}: <a href={edition.url} target="_blank" rel="noopener noreferrer">{edition.credit}</a></span>)}
      <a className={styles.creditLine} href={sefariaUrl} target="_blank" rel="noopener noreferrer"><bdi dir="ltr">{reference}</bdi> on Sefaria</a>
    </p>
  </div>;
}

/** A Targum and the Talmud (Bavli and Yerushalmi) are Aramaic; Mishnah, Tosefta and the rest read as Hebrew. */
export const aramaicText = (category: string) => category === "Targum" || category === "Talmud";
function Work({ value, heading }: { value: ShelfWork; heading: string | null }) {
  const [open, setOpen] = useState<string | null>(null), id = useId(), dates = compositionDates(value.dates);
  return <li className={styles.shelfWork}>
    {heading && <h4 className={styles.panelSubheading}>{heading}</h4>}
    <p className={styles.compareTitle}><bdi dir="ltr">{value.title}</bdi>{value.heTitle && <> <bdi lang="he" dir="rtl" className={styles.shelfHebrewTitle}>{value.heTitle}</bdi></>}</p>
    {dates && <p className={styles.shelfDates}>{dates}</p>}
    <ul className={styles.shelfItems}>
      {value.items.map((item, index) => <li key={item.ref}>
        <button type="button" className={styles.shelfItem} aria-expanded={open === item.ref} aria-controls={`${id}-${index}`} onClick={() => setOpen(current => current === item.ref ? null : item.ref)}>
          <bdi dir="ltr">{item.ref}</bdi>{item.segments > 1 && <span className={styles.shelfSegments}> · {item.segments} comments</span>}</button>
        {open === item.ref && <div id={`${id}-${index}`}><SourceText reference={item.ref} language={aramaicText(value.category) ? "arc" : "he"} /></div>}
      </li>)}
    </ul>
    {value.more > 0 && <p className={styles.shelfDates}>{value.more === 1 ? "1 more on Sefaria" : `${value.more} more on Sefaria`}</p>}
  </li>;
}

/**
 * The links behind More on this verse are Sefaria's links dataset, which is CC BY: credit Sefaria and link the licence.
 * It reuses the credit format Compare and each opened text already use, "Title, via Sefaria (licence)", with the
 * licence linked as the edition credits link theirs. Beside it, the note of changes CC BY asks for (wording Daniel approved
 * 2026-10-23), naming the congregation's own product from the shared reader.
 */
export function ShelfLinksCredit({ productName }: { productName: string }) {
  return <p className={styles.compareCredit}><span className={styles.creditLine}>More on this verse, via Sefaria (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">{licenseLabel("CC-BY")}</a>)</span>
    <span className={styles.creditLine} data-shelf-changes="">Selected and ordered by <bdi dir="auto">{productName}</bdi></span></p>;
}

/**
 * More on this verse (1.3): what Sefaria links to the verse, by kind (pills that wrap), the curated works first.
 * Rows show the work, its composition dates and the citation; a citation opens its text in place. Works already
 * shown inline (Study's Works) are left out here. Loaded only when opened.
 */
export function ShelfView({ verse, inline }: { verse: string; inline: readonly string[] }) {
  const [state, setState] = useState<{ key: string; value?: ShelfAnswer; failed?: true } | null>(null), [retry, setRetry] = useState(0);
  const [chosen, setChosen] = useState<ShelfGroupKey | null>(null), key = `${verse}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key });
    fetchShelf(verse, controller.signal).then(value => { if (!controller.signal.aborted) setState({ key, value }); },
      () => { if (!controller.signal.aborted) setState({ key, failed: true }); });
    return () => controller.abort();
  }, [verse, key]);
  const current = state?.key === key ? state : null;
  if (!current || !current.value && !current.failed) return <p className={styles.status} role="status">Loading…</p>;
  if (!current.value) return <p className={styles.status} role="status">More on this verse isn’t available right now. <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></p>;
  const groups = current.value.groups.map(group => ({ ...group, works: group.works.filter(work => group.key !== "commentary" || !isInlineWork(work.title, inline)) })).filter(group => group.works.length);
  const all = <p className={styles.compareCredit}><a href={current.value.sefariaUrl} target="_blank" rel="noopener noreferrer">All related texts on Sefaria</a></p>;
  if (!groups.length) return <><p className={styles.status}>Sefaria lists nothing more on this verse.</p>{all}</>;
  const shown = groups.find(group => group.key === chosen) ?? groups[0];
  let category = "";
  return <>
    <div className={`study-kind-choice ${styles.shelfPills}`} role="group" aria-label="Kinds of texts">
      {groups.map(group => <button key={group.key} type="button" className="button-secondary" aria-pressed={group.key === shown.key} onClick={() => setChosen(group.key)}>
        <span>{group.label} <span className={styles.shelfCount}>{group.works.length}</span></span></button>)}
    </div>
    <ul className={styles.compareList} aria-label={shown.label}>
      {shown.works.map((work, index) => {
        const heading = shown.key === "other" && work.category !== category ? (category = work.category) : null;
        return <Work key={`${work.category}|${work.title}|${index}`} value={work} heading={heading} />;
      })}
    </ul>
    <ShelfLinksCredit productName={current.value.productName} />
    {all}
  </>;
}
