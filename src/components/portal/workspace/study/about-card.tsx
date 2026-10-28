"use client";
import { useEffect, useId, useState } from "react";
import type { StudyKind } from "./api";
import { guideLabelState, guideLabelText, useGuide } from "./guide-card";
import type { GuideStore } from "./guide-store";
import { MarkdownLite } from "./markdown-lite";
import styles from "./about-card.module.css";

/** The overview split at its first blank line: the lede, and whatever follows it. */
export function splitOverview(text: string): { first: string; rest: string } {
  const parts = text.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  return { first: parts[0] ?? "", rest: parts.slice(1).join("\n\n").trim() };
}

/**
 * Study's About card (Study v6, Daniel 2026-10-28): the mural medallion, "About this portion" or "About this haftarah", the overview's first paragraph, "Read more" for the
 * rest, and the review label. The Claude-written base guide's themes never appear here, and neither do links to them. Nothing without an overview (a rabbi-written guide for this
 * student shows only as headings in the text); the haftarah's study-sheet link, where the library has one, still has its small card.
 */
export function AboutCard({ store, kind }: { store: GuideStore; kind: StudyKind }) {
  const view = useGuide(store, kind), id = useId(), [open, setOpen] = useState(false);
  useEffect(() => { store.ensure(kind); }, [store, kind]);
  const sheet = store.sheet(kind);
  const sheetLink = sheet && <p className={styles.sheet}><a href={sheet} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">This week’s haftarah study sheet<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a></p>;
  const base = view?.base, overview = base?.overview.trim() ? splitOverview(base.overview) : null;
  if (!base || !overview) return sheetLink ? <section className={styles.about} aria-label="Haftarah study sheet" data-study-about="" data-guide-kind={kind}><div className={styles.body}>{sheetLink}</div></section> : null;
  return <section className={styles.about} aria-labelledby={`${id}-title`} data-study-about="" data-guide-kind={kind} data-open={open || undefined}>
    <img className={styles.medal} src="/brand/mural-512.png" width={84} height={84} alt="" decoding="async" />
    <div className={styles.body}>
      <h3 id={`${id}-title`} className={styles.title}>{kind === "torah" ? "About this portion" : "About this haftarah"}</h3>
      <MarkdownLite text={overview.first} className={styles.lede} heClass={styles.he} />
      {overview.rest && <>
        <div className={styles.more} id={`${id}-more`}><div className={styles.moreInner} inert={!open}><MarkdownLite text={overview.rest} className={styles.rest} heClass={styles.he} /></div></div>
        <button type="button" className={styles.readMore} aria-expanded={open} aria-controls={`${id}-more`} onClick={() => setOpen(value => !value)}>{open ? "Show less" : "Read more"}</button>
      </>}
    </div>
    <p className={styles.label} data-guide-label={guideLabelState(base.label)}>{guideLabelText(base.label)}</p>
    {sheetLink && <div className={styles.sheetRow}>{sheetLink}</div>}
  </section>;
}
