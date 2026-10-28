"use client";
import type { ReactNode } from "react";
import { ReturnSignInLink } from "../return-sign-in-link";
import styles from "./public-reading.module.css";

/**
 * The reader's one title block (Readings for everyone C1, spec 5b): the reading's name, under it one muted line (the date and the
 * ranges), and on the right the pills that act on the reading as a whole: Change, Save, and on a saved reading Edit. The public
 * reader, a member's saved reading and (later) the workspace reading panel share it, so the three read as one place.
 */
export type Pill = Readonly<{
  key: "change" | "save" | "edit" | "manage";
  label: string;
  /** Set when the visible label is not the whole name ("Save" is "Save to My Readings"). */
  accessibleName?: string;
  icon: "chevron" | "bookmark" | "pencil" | "sliders";
  onClick(): void;
  disabled?: boolean;
  haspopup?: "dialog";
  expanded?: boolean;
  controls?: string;
  /** A pill that is a link to sign in and come back to this reading (the way back is read when it is used). */
  signIn?: () => string | null;
}>;

const paths: Record<Pill["icon"], string> = {
  chevron: "M6 9.5l6 6 6-6",
  bookmark: "M7 4.5h10v15l-5-3.5-5 3.5z",
  pencil: "M5 19l1-4 9.5-9.5 3 3L9 18z M14 7l3 3",
  sliders: "M5 8h14M5 16h14M9 6v4M15 14v4",
};
const icon = (name: Pill["icon"]) => <svg className={styles.pillIcon} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
  <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function ReaderTitle({ name, line, pills, loading, note, headingId = "public-reading-title", level = 1 }: { name: string; line: ReactNode; pills: readonly Pill[]; loading?: boolean;
  /** The heading's id (the workspace reading keeps `reading-heading`), and its level: 2 on a page that already has its own h1 (the practice bar). */ headingId?: string; level?: 1 | 2;
  /** A status line under the title (Saved to My Readings). */ note?: ReactNode }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <div className={styles.titleBlock} aria-busy={loading || undefined}>
    <div className={styles.titleRow}>
      <Heading id={headingId} className={styles.readTitle} tabIndex={-1}>{name}</Heading>
      <div className={styles.tools}>
        {pills.map(pill => pill.signIn
          ? <ReturnSignInLink key={pill.key} className={`button-hero-secondary ${styles.pill}`} back={pill.signIn}>{pill.label}{icon(pill.icon)}</ReturnSignInLink>
          : <button key={pill.key} type="button" className={`button-hero-secondary ${styles.pill}`} data-pill={pill.key} data-more-button={pill.key === "change" ? "" : undefined}
            aria-label={pill.accessibleName} aria-haspopup={pill.haspopup} aria-expanded={pill.expanded} aria-controls={pill.controls} disabled={pill.disabled} onClick={pill.onClick}>{pill.label}{icon(pill.icon)}</button>)}
      </div>
    </div>
    <p className={styles.titleLine} data-reading-ranges="">{line}</p>
    {note}
  </div>;
}
