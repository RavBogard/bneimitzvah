"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { StudyVerse } from "./api";
import type { WorkState } from "./commentary-view";
import styles from "./commentary.module.css";

/**
 * A member's own layer over a reading (accounts plan §5, Study, PR 3): the Yours row under each Study verse (stored
 * notes and translations, read-only since 1.7) and a star on each inline comment. It is provided only on the
 * member's own saved reading, after the account has answered for itself, so public readings and the student workspace
 * never ask about an account and never show any of it. Nothing here is read by staff: the rows are owner-only (RLS).
 */
export type StarKey = Readonly<{ work: string; verseRef: string; comment: number }>;
/** A comment's star key: works, verses and 1-based comment numbers, as the server stores them. */
export const starKey = (key: StarKey) => `${key.work}|${key.verseRef}|${key.comment}`;
/** The server keeps comments 1 to 60 of a verse; later ones have no star. */
export const STAR_COMMENT_LIMIT = 60;
export type OwnStars = Readonly<{ starred(key: StarKey): boolean; pending(key: StarKey): boolean; notice(key: StarKey): string; toggle(key: StarKey): void }>;
export type OwnLayer = Readonly<{
  /** Null until the member's stars have loaded: no star shows in a state it might not have. */
  stars: OwnStars | null;
  /** Study: the verse's Yours row, closed by default; it shows stored text read-only. */
  yours(verse: StudyVerse, works: readonly WorkState[]): ReactNode;
}>;
const Context = createContext<OwnLayer | null>(null);
export const OwnLayerScope = Context.Provider;
export const useOwnLayer = () => useContext(Context);

/** The plan's two labels; the two notices are proposed wording, not yet approved by Daniel. */
export const STAR_STRINGS = Object.freeze({
  star: "Star comment",
  starred: "Starred",
  failed: "The star didn’t save. Try again.",
  limit: "This account has as many starred comments as it can keep.",
});

const starIcon = (filled: boolean) => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
  <path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
</svg>;
/** A 44 px star on one inline comment, pressed when starred: lake blue, never marigold. */
export function StarButton({ stars, work, verseRef, index }: { stars: OwnStars; work: string; verseRef: string; index: number }) {
  const comment = index + 1;
  if (comment > STAR_COMMENT_LIMIT) return null;
  const key = { work, verseRef, comment }, on = stars.starred(key), pending = stars.pending(key), notice = stars.notice(key);
  return <>
    <button type="button" className={styles.star} aria-pressed={on} aria-label={on ? STAR_STRINGS.starred : STAR_STRINGS.star} aria-disabled={pending || undefined}
      data-star={starKey(key)} onClick={event => { event.stopPropagation(); if (!pending) stars.toggle(key); }}>{starIcon(on)}</button>
    {notice && <span className={styles.starNote} role="status">{notice}</span>}
  </>;
}
