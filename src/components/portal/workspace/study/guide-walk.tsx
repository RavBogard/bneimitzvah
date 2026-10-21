"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceModal } from "../provider";
import { useReadingPrefs } from "../reading-prefs";
import type { StudyVerse } from "./api";
import type { GuideNote, GuideTheme, StudentGuideView } from "./guide-api";
import { guideLabelText, sefariaUrl } from "./guide-card";
import { icons } from "./lift";
import { StudyHebrew } from "./annotations";
import { MarkdownLite } from "./markdown-lite";
import styles from "./guide.module.css";

type Step = { kind: "theme"; theme: GuideTheme; label: string } | { kind: "verse"; theme: GuideTheme; note: GuideNote; label: string };
export function walkSteps(view: StudentGuideView): Step[] {
  const parts = [view.base, view.additions].filter(part => part !== null);
  return parts.flatMap(part => part.themes.flatMap(theme => [
    { kind: "theme" as const, theme, label: guideLabelText(part.label) },
    ...theme.notes.map(note => ({ kind: "verse" as const, theme, note, label: guideLabelText(part.label) })),
  ]));
}

/**
 * The optional Study walk: each theme, then each of its verses (Hebrew, English, the note and its
 * sources), then the next theme. A sibling of the lifted line; the continuous reader stays primary.
 */
export function GuideWalk({ view, lookup, onClose }: { view: StudentGuideView; lookup(ref: string): StudyVerse | null; onClose(lastVerse: string | null): void }) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId(), prefs = useReadingPrefs();
  const steps = useMemo(() => walkSteps(view), [view]), [index, setIndex] = useState(0), step = steps[Math.min(index, steps.length - 1)];
  const lastVerse = useRef<string | null>(null);
  if (step?.kind === "verse") lastVerse.current = step.note.verseRef;
  useLayoutEffect(() => { const node = dialog.current; return () => { if (node?.open) node.close(); }; }, []);
  useWorkspaceModal(dialog, true);
  if (!step) return null;
  const close = () => onClose(lastVerse.current);
  const verse = step.kind === "verse" ? lookup(step.note.verseRef) : null;
  const themeNumber = steps.slice(0, index + 1).filter(s => s.kind === "theme").length, themeCount = steps.filter(s => s.kind === "theme").length;
  return <dialog ref={dialog} className="lift guide-walk" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => { if (event.target instanceof HTMLElement && event.target.closest("a, button")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); setIndex(i => Math.min(i + 1, steps.length - 1)); }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); setIndex(i => Math.max(i - 1, 0)); } }}>
    <div className="lift-bar">
      <button type="button" className="lift-icon" onClick={close} aria-label="Close study">{icons.close}</button>
      <p className="lift-count" aria-live="polite">Theme {themeNumber} of {themeCount}</p>
      <span />
    </div>
    <div className="lift-stage">
      {step.kind === "theme" ? <>
        <h2 id={`${id}-title`} className="lift-ref" dir="auto">{step.theme.title}</h2>
        <MarkdownLite text={step.theme.intro} className={styles.prose} heClass={styles.he} />
      </> : <>
        <p className={styles.noteTheme} dir="auto">{step.theme.title}</p>
        <h2 id={`${id}-title`} className="lift-ref"><bdi dir="ltr">{step.note.verseRef}</bdi></h2>
        {verse && <StudyHebrew key={verse.ref} verse={verse} colors={null} id={`${id}-v`} activeWord={null} toolsAvailable={false} className="lift-hebrew" />}
        {verse && prefs.translation && <p className="lift-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p>}
        <MarkdownLite text={step.note.body} className={styles.prose} heClass={styles.he} />
        {step.note.sources.length > 0 && <ul className={styles.sources} aria-label="Sources for this note">{step.note.sources.map(source => <li key={source.id} className={styles.source}>
          <span className={styles.sourceName} dir="auto">{source.labels.en ?? source.indexTitle}</span><span className={styles.sourceRef} dir="ltr">{source.ref}</span>
          <a className={styles.sourceLink} href={sefariaUrl(source)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">On Sefaria<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>}
      </>}
      <p className={styles.label}>{step.label}</p>
    </div>
    <div className="lift-nav">
      <button type="button" className="lift-step" onClick={() => setIndex(i => Math.max(i - 1, 0))} disabled={index === 0}>{icons.up}<span>Back</span></button>
      {index < steps.length - 1
        ? <button type="button" className="lift-step lift-step-next" onClick={() => setIndex(i => i + 1)} autoFocus>{icons.down}<span>Next</span></button>
        : <button type="button" className="lift-step lift-step-next" onClick={close} autoFocus>{icons.close}<span>Done</span></button>}
    </div>
  </dialog>;
}
