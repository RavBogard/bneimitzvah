"use client";
import { useEffect, useState } from "react";
import { type ApprovedPortionSummary } from "../../../../lib/portion-summary/credit";
import { sectionLabel } from "../../../../lib/readings/sections";
import { fetchPortionSummary } from "./portion-summary-api";
import { MarkdownLite } from "./markdown-lite";
import styles from "./portion-summary.module.css";

/**
 * The portion summary on screen (1.9 N7, decision 4: "Claude drafts, you approve"). It is only ever an approved revision: the public route
 * serves no other, and this reads that route and nothing else. A parashah with none, a reading that is not a parashah, a failure and
 * a reader who is not in Study all show nothing at all: no heading, no placeholder, no box.
 */

/** The parashah's approved summary while `slug` names one and `active` (Study); null otherwise. The answer is kept for the slug once it has come. */
export function usePortionSummary(slug: string | null, active: boolean): ApprovedPortionSummary | null {
  const [state, setState] = useState<{ slug: string; summary: ApprovedPortionSummary | null } | null>(null);
  useEffect(() => {
    if (!active || !slug || state?.slug === slug) return;
    const controller = new AbortController();
    fetchPortionSummary(slug, controller.signal).then(summary => { if (!controller.signal.aborted) setState({ slug, summary }); },
      () => { if (!controller.signal.aborted) setState({ slug, summary: null }); });
    return () => controller.abort();
  }, [active, slug, state?.slug]);
  return active && slug && state?.slug === slug ? state.summary : null;
}

/** The block for a page that has no hook to spare (the signed-in reading returns early before it knows its kind): asks for `slug`'s summary while `active`, and draws it. */
export function StudySummary({ slug, active, aliyot, onAliyah }: { slug: string | null; active: boolean; aliyot?: readonly string[]; onAliyah?(n: string): void }) {
  const summary = usePortionSummary(slug, active);
  return summary ? <PortionSummaryBlock summary={summary} aliyot={aliyot} onAliyah={onAliyah} /> : null;
}

/**
 * "This portion": the summary, its credit exactly as it was stamped at approval, and the outline, one plain line per aliyah. A line is a
 * button that takes the reader to that aliyah where the page has it as a section (`aliyot` lists the sections it has, `onAliyah` goes);
 * where it does not (a triennial reading, a tutor's own divisions) the line is plain text and promises nothing. The heading is the
 * disclosure's own summary, so a reader on a phone can fold the block away and have the verses back under their thumb.
 */
export function PortionSummaryBlock({ summary, aliyot, onAliyah }: { summary: ApprovedPortionSummary; aliyot?: readonly string[]; onAliyah?(n: string): void }) {
  return <details className={styles.block} open data-portion-summary={summary.reading}>
    <summary className={styles.heading}>This portion</summary>
    <MarkdownLite className={styles.prose} text={summary.summary} />
    <p className={styles.credit} data-portion-summary-credit="">{summary.credit}</p>
    <ol className={styles.outline} data-portion-outline="">{summary.outline.map(row => {
      const n = String(row.aliyah), label = sectionLabel(n), go = onAliyah && aliyot?.includes(n) ? onAliyah : null;
      return <li key={row.aliyah}>{go
        ? <button type="button" className={styles.line} data-outline-aliyah={n} onClick={() => go(n)}><span className={styles.label}>{label}</span><span>{row.line}</span></button>
        : <p className={styles.line} data-outline-aliyah={n}><span className={styles.label}>{label}</span><span>{row.line}</span></p>}</li>;
    })}</ol>
  </details>;
}
