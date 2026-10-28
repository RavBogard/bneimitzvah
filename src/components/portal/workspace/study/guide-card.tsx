"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type { StudyKind } from "./api";
import type { GuideLabel, GuideNote, GuideTheme, StudentGuideView } from "./guide-api";
import type { GuideStore } from "./guide-store";
import { firstLine, MarkdownLite } from "./markdown-lite";
import styles from "./guide.module.css";

/** Exactly the label the spec fixes: what is Claude's and whether the rabbi has reviewed it. */
export function guideLabelText(label: GuideLabel) {
  if (label.reviewed) return `Reviewed by ${label.rabbiName}`;
  // Daniel, 2026-10-21: a draft the rabbi wrote himself is not labelled as Claude's.
  return label.origin === "rabbi" ? `Written by ${label.rabbiName} · draft` : `Written by Claude for CRC · not yet reviewed by ${label.rabbiName}`;
}
/** The review state as a stable word, for a test or a style, whatever the label says. */
export const guideLabelState = (label: GuideLabel) => label.reviewed ? "reviewed" : label.origin === "rabbi" ? "rabbi-draft" : "claude-draft";
export function useGuide(store: GuideStore, kind: StudyKind) {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return store.view(kind);
}
/** The rabbi-written notes on one verse for this student. The Claude-written base guide's verse notes are never drawn (Study v6, Daniel 2026-10-28). */
export function notesFor(view: StudentGuideView | null, verseRef: string): { theme: GuideTheme; note: GuideNote; label: GuideLabel }[] {
  const part = view?.additions;
  return part ? part.themes.flatMap(theme => theme.notes.filter(n => n.verseRef === verseRef).map(note => ({ theme, note, label: part.label }))) : [];
}

/** The themes of a rabbi-written guide for this student: a title and its one line each. Nothing to tick: "I read this" is retired. */
function ThemeRows({ themes }: { themes: GuideTheme[] }) {
  return <ul className={styles.themes}>{themes.map(theme => <li key={theme.id} className={styles.theme}>
    <div className={styles.themeText}><span className={styles.themeTitle} dir="auto">{theme.title}</span><span className={styles.themeIntro} dir="auto">{firstLine(theme.intro)}</span></div>
  </li>)}</ul>;
}

/**
 * The overview card under the hero in Lein: what this reading is about and who wrote it, and a rabbi-written guide's themes for this student when there is one.
 * Absent entirely when there is no guide. Study has its own About card (about-card.tsx).
 */
export function GuideCard({ store, kind, firstName, learner }: { store: GuideStore; kind: StudyKind; firstName: string; learner: boolean }) {
  const view = useGuide(store, kind), id = useId();
  // Hebrew stays first on a phone: the guide opens by default only in the wide layout.
  const [open, setOpen] = useState(() => typeof matchMedia === "function" && matchMedia("(min-width: 1001px)").matches);
  useEffect(() => { store.ensure(kind); }, [store, kind]);
  const sheet = store.sheet(kind), sheetLink = sheet && <p className={styles.sheet}><a className={styles.sourceLink} href={sheet} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">This week’s haftarah study sheet<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a></p>;
  if (!view) return store.failed(kind) ? <p className={styles.notice} role="status">The study guide didn’t load. <button type="button" className={styles.retry} onClick={() => void store.load(kind)}>Try again</button></p>
    : sheetLink ? <section className={styles.card} aria-label="Haftarah study sheet" data-guide-kind={kind}>{sheetLink}</section> : null;
  const themes = view.additions?.themes ?? [];
  if (!view.base?.overview.trim() && themes.length === 0) return sheetLink ? <section className={styles.card} aria-label="Haftarah study sheet" data-guide-kind={kind}>{sheetLink}</section> : null;
  return <section className={styles.card} aria-labelledby={`${id}-title`} data-guide-kind={kind}>
    <details className={styles.fold} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className={styles.foldSummary}><h3 id={`${id}-title`}>{kind === "torah" ? "About this portion" : "About this haftarah"}</h3>
      {themes.length > 0 && <span className={styles.foldMeta}>{themes.length} {themes.length === 1 ? "theme" : "themes"}</span>}</summary>
    {view.base && view.base.overview.trim() && <>
      <MarkdownLite text={view.base.overview} className={styles.prose} heClass={styles.he} />
      <p className={styles.label} data-guide-label={guideLabelState(view.base.label)}>{guideLabelText(view.base.label)}</p>
    </>}
    {view.additions && themes.length > 0 && <div className={styles.additions}>
      <h4>{learner ? "Added for you" : <>Added for <bdi dir="auto">{firstName}</bdi></>}</h4>
      <ThemeRows themes={themes} />
      <p className={styles.label} data-guide-label={guideLabelState(view.additions.label)}>{guideLabelText(view.additions.label)}</p>
    </div>}
    {sheetLink}
    </details>
  </section>;
}

/** "Rashi on Exodus 40:34:1" → sefaria.org/Rashi_on_Exodus.40.34.1; anything else by its plain ref. */
export function sefariaUrl(source: { ref: string; indexTitle: string }) {
  const rest = source.ref.startsWith(source.indexTitle + " ") ? source.ref.slice(source.indexTitle.length + 1) : null;
  const path = rest && /^[0-9:-]+$/.test(rest) ? `${source.indexTitle.replace(/ /g, "_")}.${rest.replace(/:/g, ".")}` : source.ref.replace(/ /g, "_");
  return `https://www.sefaria.org/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The guide's notes for one verse, between the verse and its Sources. Nothing at all for a verse without one. */
export function GuideVerseNotes({ store, kind, verseRef }: { store: GuideStore; kind: StudyKind; verseRef: string }) {
  const view = useGuide(store, kind), notes = notesFor(view, verseRef);
  if (!notes.length) return null;
  const labels = [...new Set(notes.map(n => guideLabelText(n.label)))];
  return <section className={styles.notes} aria-label={`Study notes for ${verseRef}`} data-guide-notes={verseRef} tabIndex={-1}>
    {notes.map(({ theme, note }, i) => <article key={`${theme.id}-${i}`} className={styles.note}>
      <p className={styles.noteTheme} dir="auto">{theme.title}</p>
      <MarkdownLite text={note.body} className={styles.prose} heClass={styles.he} />
      {note.sources.length > 0 && <ul className={styles.sources} aria-label="Sources for this note">{note.sources.map(source => <li key={source.id} className={styles.source}>
        <span className={styles.sourceName} dir="auto">{source.labels.en ?? source.indexTitle}</span>
        <span className={styles.sourceRef} dir="ltr">{source.ref}</span>
        <a className={styles.sourceLink} href={sefariaUrl(source)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">On Sefaria<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a>
      </li>)}</ul>}
    </article>)}
    {labels.map(text => <p key={text} className={styles.noteLabel}>{text}</p>)}
  </section>;
}
