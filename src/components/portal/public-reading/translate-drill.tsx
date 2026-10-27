"use client";
import type { KeyboardEvent, Ref } from "react";
import styles from "./translate-drill.module.css";

/**
 * The translate drill's words, in one place so any line swaps here alone (accounts plan, "Changes from Daniel's
 * 2026-10-23 rulings", Decided here 3). "Translate drill", "Reveal", "Next verse" and "End drill" are the plan's;
 * every other line is the research report's proposal (docs/superpowers/research/2026-10-23-cowork-offload/translate-drill.md),
 * which Daniel has not yet approved. No line may say correct, right, wrong, check, answer, score, try again, nice, great,
 * done, streak or progress, or count verses done.
 */
export const DRILL_STRINGS = Object.freeze({
  control: "Translate drill",
  hidden: "English hidden",
  prompt: "Read the Hebrew aloud in your own English, then reveal.",
  hint: "Tap a word for its meaning. Hear plays the verse.",
  reveal: "Reveal",
  end: "End drill",
  jps: "JPS",
  compare: "Compare it with what you said.",
  next: "Next verse",
  hide: "Hide again",
  last: "That is the last verse of this reading.",
  restart: "Start from the first verse",
  noJps: "No JPS translation is available for this verse.",
  shown: "JPS translation shown.",
  moved: (verse: string) => `Verse ${verse}. English hidden.`,
});

/** Where Next verse goes from the selected verse: the next one on this text page, the first of the next page, or nowhere. */
export function drillNext(index: number, pageLength: number, nextOffset: number | null): "on-page" | "next-page" | "last" {
  if (index + 1 < pageLength) return "on-page";
  return nextOffset === null ? "last" : "next-page";
}


/**
 * The drill on the selected verse in Lein (spec §3.4; Daniel F4: Lein only, never Study). Before the reveal the English
 * is hidden with a one-line placeholder; Reveal shows JPS only.
 * Nothing here plays or stops audio, stores anything or moves on its own; Escape inside it ends the drill.
 */
export function TranslateDrillPanel({ verseRef, english, revealed, hint, last, announce, jpsRef, revealRef, onReveal, onHide, onNext, onRestart, onEnd }: {
  verseRef: string; english: string | null; revealed: boolean; hint: boolean; last: boolean; announce: string;
  jpsRef?: Ref<HTMLHeadingElement>; revealRef?: Ref<HTMLButtonElement>;
  onReveal(): void; onHide(): void; onNext(): void; onRestart(): void; onEnd(): void;
}) {
  const s = DRILL_STRINGS;
  const escape = (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Escape") { event.stopPropagation(); onEnd(); } };
  return <section className={styles.drill} aria-label={`${s.control} on ${verseRef}`} data-translate-drill={verseRef} data-drill-revealed={revealed ? "true" : "false"} onKeyDown={escape}>
    {!revealed ? <>
      <p className={styles.hidden}>{s.hidden}</p>
      <p className={styles.prompt}>{s.prompt}</p>
      {hint && <p className={styles.hint} data-testid="drill-hint">{s.hint}</p>}
      <div className={styles.actions}>
        <button type="button" className="button-primary" ref={revealRef} onClick={onReveal}>{s.reveal}</button>
        <button type="button" className={styles.quiet} onClick={onEnd}>{s.end}</button>
      </div>
    </> : <>
      <h5 className={styles.label} ref={jpsRef} tabIndex={-1}>{s.jps}</h5>
      <p className={`study-english ${styles.english}`} data-testid="drill-english" data-english-available={english ? "true" : "false"} lang="en" dir="ltr">{english ?? s.noJps}</p>
      <p className={styles.line}>{s.compare}</p>
      {last && <p className={styles.line}>{s.last}</p>}
      <div className={styles.actions}>
        {last ? <button type="button" className="button-primary" onClick={onRestart}>{s.restart}</button>
          : <button type="button" className="button-primary" onClick={onNext}>{s.next}</button>}
        <button type="button" className={styles.quiet} onClick={onHide}>{s.hide}</button>
        <button type="button" className={styles.quiet} onClick={onEnd}>{s.end}</button>
      </div>
    </>}
    <p className="sr-only" role="status" aria-live="polite">{announce}</p>
  </section>;
}
