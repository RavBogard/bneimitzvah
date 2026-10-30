"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DISCUSSION_LABELS } from "../../../../lib/discussions/labels";
import { shelfSefariaUrl } from "../../../../lib/readings/shelf";
import { Runs, INLINE_COMMENTS } from "./commentary-view";
import { sefariaUrl, guideLabelText } from "./guide-card";
import { useIdentity } from "../../../site/identity-context";
import { MarkdownLite } from "./markdown-lite";
import { StarButton, useOwnLayer, type OwnStars } from "./own-layer";
import { useDiscussionsView } from "./discussions";
import { useVersePanelOpener } from "./verse-panel";
import { workLabel } from "../reading-toolbar";
import type { CommentNote, DiscussionNote, GuideNoteEntry, NoteKind, VerseEntries, VerseNote } from "./notes-model";
import type { StudyVerse } from "./api";
import styles from "./study-sheet.module.css";

/** A clamp that says so: "More" appears only when the text really is longer than its lines at this width. */
function useOverflow(lines: number, deps: readonly unknown[]) {
  const ref = useRef<HTMLParagraphElement | null>(null), [open, setOpen] = useState(false), [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current; if (!node || open) return;
    const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 2);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [open, lines, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ref, open, setOpen, overflows };
}

function MoreButton({ open, onToggle, controls }: { open: boolean; onToggle(): void; controls: string }) {
  return <button type="button" className={styles.more} aria-expanded={open} aria-controls={controls} onClick={onToggle}>{open ? "Show less" : "More"}</button>;
}

function CommentCard({ note, verse, phone, stars }: { note: CommentNote; verse: StudyVerse; phone: boolean; stars: OwnStars | null }) {
  const id = useId(), { parts } = note, lines = phone ? 2 : 6;
  const body = useOverflow(lines, [note]), hq = useOverflow(2, [note]);
  const showHebrew = Boolean(parts.hebrew) && (!phone || body.open || !parts.english);
  const english = parts.english;
  const open = body.open;
  return <article className={styles.note} data-note-kind={note.kind} data-note-work={note.work} data-note-id={note.id} aria-label={`${note.source} on ${verse.ref}`}>
    <header className={styles.noteHead}>
      {note.letter && <span className={styles.let} data-lemma-letter={note.letter}>{note.letter}</span>}
      <span className={styles.src}>{note.source}</span>
      {parts.dibbur && <bdi className={styles.lem} lang="he" dir="rtl">{parts.dibbur}</bdi>}
      {stars && <StarButton stars={stars} work={note.work} verseRef={verse.ref} index={note.index} />}
    </header>
    {showHebrew && parts.hebrew && <p ref={hq.ref} className={styles.hq} lang="he" dir="rtl" data-open={open || hq.open || undefined}
      style={{ ["--lines" as string]: open || hq.open ? "99" : "2" }}><Runs runs={parts.hebrew} /></p>}
    {(english || (!parts.hebrew && parts.dibbur === null)) && <p ref={body.ref} id={`${id}-text`} className={styles.noteText} lang="en" dir="ltr" style={{ ["--lines" as string]: open ? "99" : String(lines) }}>
      {parts.lemma && <span className={styles.noteLemma}>{parts.lemma.text}{english ? " " : ""}</span>}{english && <Runs runs={english} mixed />}</p>}
    {(body.overflows || hq.overflows || open || (phone && Boolean(parts.hebrew) && Boolean(english))) && <MoreButton open={open} onToggle={() => { body.setOpen(value => !value); hq.setOpen(value => !value); }} controls={`${id}-text`} />}
  </article>;
}

function DiscussionCard({ note, verse }: { note: DiscussionNote; verse: StudyVerse }) {
  const open = useVersePanelOpener();
  return <article className={styles.note} data-note-kind="rabbi" data-note-id={note.id} aria-label={`${note.source} on ${verse.ref}`}>
    <header className={styles.noteHead}><span className={styles.src}>{note.source}</span></header>
    <p className={styles.noteText} style={{ ["--lines" as string]: "99" }}><strong><bdi>{note.row.discussion.title}</bdi></strong></p>
    <ul className={styles.sourceList}>{note.row.sources.map(source => <li key={source.position}><bdi dir="ltr">{source.ref}</bdi></li>)}</ul>
    {open && <button type="button" className={styles.more} aria-haspopup="dialog" onClick={event => open(verse.ref, "discussion", event.currentTarget)}>{DISCUSSION_LABELS.marker}</button>}
  </article>;
}

function GuideCard({ note, verse, phone }: { note: GuideNoteEntry; verse: StudyVerse; phone: boolean }) {
  const shortName = useIdentity().shortName;
  const [open, setOpen] = useState(false), id = useId();
  return <article className={styles.note} data-note-kind="rabbi" data-note-id={note.id} data-guide-notes={verse.ref} aria-label={`${note.source} on ${verse.ref}`}>
    <header className={styles.noteHead}><span className={styles.src}>{note.source}</span></header>
    <div id={`${id}-text`} className={styles.guideBody} data-clamped={phone && !open ? "" : undefined}><MarkdownLite text={note.note.body} className={styles.prose} heClass={styles.hebrewIn} />
      {(!phone || open) && note.note.sources.length > 0 && <ul className={styles.sourceList} aria-label="Sources for this note">{note.note.sources.map(source => <li key={source.id}>
        <span>{source.labels.en ?? source.indexTitle}</span> <bdi dir="ltr">{source.ref}</bdi>{" "}
        <a href={sefariaUrl(source)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">On Sefaria<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>}
    </div>
    {phone && <MoreButton open={open} onToggle={() => setOpen(value => !value)} controls={`${id}-text`} />}
    <p className={styles.noteLabel}>{guideLabelText(note.label, shortName)}</p>
  </article>;
}

/** A busy verse shows INLINE_COMMENTS comments of a work at once; the rest open from one row, as the inline commentary always did. */
function Cards({ entries, verse, phone }: { entries: VerseEntries; verse: StudyVerse; phone: boolean }) {
  const stars = useOwnLayer()?.stars ?? null, [all, setAll] = useState<ReadonlySet<string>>(new Set());
  const shown = (note: VerseNote) => note.type !== "comment" || all.has(note.work) || note.index < INLINE_COMMENTS;
  const hidden = new Map<string, number>();
  for (const note of entries.notes) if (note.type === "comment" && !shown(note)) hidden.set(note.work, (hidden.get(note.work) ?? 0) + 1);
  return <>
    {entries.notes.filter(shown).map(note => note.type === "comment" ? <CommentCard key={note.id} note={note} verse={verse} phone={phone} stars={stars} />
      : note.type === "discussion" ? <DiscussionCard key={note.id} note={note} verse={verse} /> : <GuideCard key={note.id} note={note} verse={verse} phone={phone} />)}
    {[...hidden.keys()].map(work => <button key={work} type="button" className={styles.moreWork} onClick={() => setAll(current => new Set([...current, work]))}>{workLabel(work)}: {hidden.get(work)} more</button>)}
  </>;
}

/** Everything on this verse (More on this verse, the verse panel's shelf), Copy, and Open on Sefaria: the three actions under a verse's notes. */
export function NoteActions({ verse }: { verse: StudyVerse }) {
  const open = useVersePanelOpener(), [copied, setCopied] = useState(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    const text = [verse.ref, verse.hebrew.text, verse.english ?? ""].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); } catch { /* The clipboard refused; nothing else to do. */ }
  };
  return <p className={styles.acts} data-note-actions={verse.ref}>
    {open && <button type="button" className={styles.act} aria-haspopup="dialog" onClick={event => open(verse.ref, "shelf", event.currentTarget)}>Everything on this verse</button>}
    <button type="button" className={styles.act} onClick={() => void copy()}>Copy{copied && <span className="sr-only"> (copied)</span>}</button>
    <a className={styles.act} href={shelfSefariaUrl(verse.ref)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open on Sefaria<span className="sr-only"> (opens in a new tab)</span></a>
  </p>;
}

/** One verse's notes: its tinted cards, then the account's own layer if it has one, then the actions. The same in the column and inline on a phone. */
export function VerseNotesBody({ verse, entries, phone, yours }: { verse: StudyVerse; entries: VerseEntries; phone: boolean; yours?: ReactNode }) {
  return <div className={styles.notesBody} data-study-notes={verse.ref}>
    <Cards entries={entries} verse={verse} phone={phone} />
    {yours}
    <NoteActions verse={verse} />
  </div>;
}

export const KIND_ORDER: readonly NoteKind[] = ["classic", "modern", "rabbi"];
export function Dots({ kinds }: { kinds: readonly NoteKind[] }) {
  return kinds.length ? <span className={styles.dots} aria-hidden="true" data-note-dots={kinds.join(" ")}>{kinds.map(kind => <i key={kind} className={styles.dot} data-kind={kind} />)}</span> : null;
}
