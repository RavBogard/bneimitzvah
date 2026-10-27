"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { chapterOf, readingChapters, topVisible } from "./reading-place-model";
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
  // The verse nearest the top of the screen, from what is on screen after the page's verses render; the top fifth counts, so the line is not late.
  useEffect(() => {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-study-rows] [data-verse-ref]")], order = rows.map(row => row.dataset.verseRef!);
    setHere(order[0] ?? null);
    if (typeof IntersectionObserver === "undefined" || !rows.length) return;
    const visible = new Set<string>();
    const watch = new IntersectionObserver(entries => {
      for (const entry of entries) { const ref = (entry.target as HTMLElement).dataset.verseRef!; if (entry.isIntersecting) visible.add(ref); else visible.delete(ref); }
      const top = topVisible(order, visible); if (top) setHere(top);
    }, { rootMargin: "0px 0px -80% 0px" });
    rows.forEach(row => watch.observe(row));
    return () => watch.disconnect();
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
