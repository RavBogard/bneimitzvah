"use client";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { markImage, useIdentity } from "../../../site/identity-context";
import type { ApprovedPortionSummary } from "../../../../lib/portion-summary/credit";
import { parashahSlug } from "../../../../lib/portion-summary/reading";
import type { StudyKind } from "./api";
import { guideLabelState, guideLabelText } from "./guide-card";
import type { GuideStore } from "./guide-store";
import { MarkdownLite } from "./markdown-lite";
import { usePortionSummary } from "./portion-summary";
import styles from "./about-card.module.css";

/** The overview split at its first blank line: the lede, and whatever follows it. */
export function splitOverview(text: string): { first: string; rest: string } {
  const parts = text.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  return { first: parts[0] ?? "", rest: parts.slice(1).join("\n\n").trim() };
}

const none = () => () => {}, zero = () => 0;
/** The one card: the mural medallion, the heading, the first paragraph, "Read more" for the rest and a label line. */
function AboutView({ kind, text, label, labelState, source, sheetLink }: { kind: StudyKind; text: string; label: string; labelState?: string; source: "guide" | "summary"; sheetLink?: React.ReactNode }) {
  const id = useId(), [open, setOpen] = useState(false), overview = splitOverview(text), medal = markImage(useIdentity().logo, "large");
  return <section className={styles.about} aria-labelledby={`${id}-title`} data-study-about={source} data-guide-kind={kind} data-open={open || undefined}>
    {medal && <img className={styles.medal} src={medal.src} width={84} height={84} alt="" decoding="async" />}
    <div className={styles.body}>
      <h3 id={`${id}-title`} className={styles.title}>{kind === "torah" ? "About this portion" : "About this haftarah"}</h3>
      <MarkdownLite text={overview.first} className={styles.lede} heClass={styles.he} />
      {overview.rest && <>
        <div className={styles.more} id={`${id}-more`}><div className={styles.moreInner} inert={!open}><MarkdownLite text={overview.rest} className={styles.rest} heClass={styles.he} /></div></div>
        <button type="button" className={styles.readMore} aria-expanded={open} aria-controls={`${id}-more`} onClick={() => setOpen(value => !value)}>{open ? "Show less" : "Read more"}</button>
      </>}
    </div>
    <p className={styles.label} data-guide-label={labelState} data-portion-summary-credit={source === "summary" ? "" : undefined}>{label}</p>
    {sheetLink && <div className={styles.sheetRow}>{sheetLink}</div>}
  </section>;
}

/**
 * Study's About card (Study v6, Daniel 2026-10-28). It takes the place of the old portion-summary block: a reading's base-guide overview when it has one, else the
 * approved portion summary's text (same card, same "Read more", labelled with the summary's credit), else nothing but the haftarah's study-sheet link where the library has
 * one. Never both, and the base guide's themes never appear. `store` is absent where there is no guide to read (a visitor, an admin exploring).
 */
export function AboutCard({ store, kind, readingKey }: { store?: GuideStore; kind: StudyKind; readingKey?: string | null }) {
  useSyncExternalStore(store?.subscribe ?? none, store?.snapshot ?? zero, store?.snapshot ?? zero);
  useEffect(() => { store?.ensure(kind); }, [store, kind]);
  const view = store?.view(kind) ?? null, overview = view?.base?.overview.trim() ? view.base : null;
  const summary = usePortionSummary(!overview && kind === "torah" ? parashahSlug(readingKey) : null, true);
  const sheet = store?.sheet(kind) ?? null;
  const sheetLink = sheet && <p className={styles.sheet}><a href={sheet} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">This week’s haftarah study sheet<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a></p>;
  if (overview) return <AboutView kind={kind} text={overview.overview} label={guideLabelText(overview.label)} labelState={guideLabelState(overview.label)} source="guide" sheetLink={sheetLink} />;
  if (summary) return <AboutView kind={kind} text={summary.summary} label={summary.credit} source="summary" sheetLink={sheetLink} />;
  return sheetLink ? <section className={styles.about} aria-label="Haftarah study sheet" data-study-about="sheet" data-guide-kind={kind}><div className={styles.body}>{sheetLink}</div></section> : null;
}

/** A signed-out reading's card: there is no guide, so it is the approved portion summary's text, or nothing. */
export function PublicAbout({ kind, summary }: { kind: StudyKind; summary: ApprovedPortionSummary | null }) {
  return summary ? <AboutView kind={kind} text={summary.summary} label={summary.credit} source="summary" /> : null;
}
