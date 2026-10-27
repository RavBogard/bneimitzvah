import type { ReactNode } from "react";
import styles from "./public-reading.module.css";

/**
 * The quiet row after the last verse (Readings for everyone C3, spec 6): Print, the trope chart, the siddur blessings, and any rows
 * later areas add (`more`). These left the Change sheet and the top of the reader, so the dock is the one fixed thing on the page.
 */
export function ReadingFoot({ print, tropeChart = true, blessings, more }: { print?: string; tropeChart?: boolean; blessings?: ReactNode; more?: ReactNode }) {
  return <nav className={styles.foot} aria-label="After the reading" data-reading-foot="">
    {print && <a href={print}>Print</a>}
    {tropeChart && <a href="/trope-chart">Trope chart</a>}
    {blessings}
    {more}
  </nav>;
}
