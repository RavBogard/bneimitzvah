"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { chapterOf, readingChapters } from "./reading-place-model";
import { FOLLOW } from "./rail-follow";
import { useOpenPanelVerse } from "./verse-panel";
import styles from "./commentary.module.css";

/** Brings a verse of the text (Study's rows, or Lein's flowing text) to the top of the screen. */
export function scrollToVerse(ref: string): void {
  try { document.querySelector(`[data-study-rows] [data-verse-ref="${CSS.escape(ref)}"], .study-verses [data-verse-ref="${CSS.escape(ref)}"]`)?.scrollIntoView({ block: "start" }); } catch { /* Stay where the page is. */ }
}

/**
 * Where the reader is in the Study text (release 1.7): the reference of the verse near the top of the screen, which
 * follows scrolling and an open word card, and a chapter jump over every chapter of the loaded reading.
 * `refs` is the whole reading, so a chapter on another text page is offered too; `onJump` takes the chapter's first verse.
 */
export function ReadingPlace({ refs, pageKey, onJump, onHere }: { refs: readonly string[]; pageKey: string; onJump(ref: string): void; onHere?(ref: string): void }) {
  const chapters = useMemo(() => readingChapters(refs), [refs]);
  const [here, setHere] = useState<string | null>(null), openVerse = useOpenPanelVerse();
  // The first verse whose bottom passes the reading line (33% of the viewport): the same line the notes column follows, so the label never lags a verse behind.
  useEffect(() => {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-study-rows] [data-verse-ref]")];
    setHere(rows[0]?.dataset.verseRef ?? null);
    if (!rows.length) return;
    let tick = false;
    const sync = () => { tick = false; const line = window.innerHeight * FOLLOW.line; const row = rows.find(item => item.getBoundingClientRect().bottom > line);
      // Above the text (the title block and its Change button) no verse has reached the line yet: the place the reader was at holds, so Change and Whole portion open there.
      if (row && row.getBoundingClientRect().top <= line) setHere(row.dataset.verseRef!); };
    const onScroll = () => { if (!tick) { tick = true; requestAnimationFrame(sync); } };
    window.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("resize", onScroll);
    sync();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [pageKey]);
  useEffect(() => { if (openVerse) setHere(openVerse); }, [openVerse]);
  // Told to the page as it changes (Choose verses opens the whole portion at this verse, and back).
  const told = useRef(onHere); told.current = onHere;
  const current = here ?? refs[0] ?? null;
  useEffect(() => { if (current) told.current?.(current); }, [current]);
  if (!refs.length) return null;
  const shown = here ?? refs[0], chapter = chapterOf(shown);
  return <div className={styles.place} data-reading-place="">
    <p className={styles.placeRef}><bdi dir="ltr">{shown}</bdi></p>
    {chapters.length > 1 && <label className={styles.placeJump}><span>Chapter</span>
      <select value={chapter ?? ""} onChange={event => { const next = chapters.find(row => row.key === event.target.value); if (next) { setHere(next.first); onJump(next.first); } }}>
        {chapters.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
      </select></label>}
  </div>;
}
