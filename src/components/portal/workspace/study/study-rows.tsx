"use client";
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import type { AssignmentEnding } from "../../../../lib/hebrew/study-annotations";
import { parseCompareVerse } from "../../../../lib/readings/compare";
import { Apparatus, firstWordKey, StudyHebrew } from "./annotations";
import { WordGroup } from "./word-group";
import { useCommentLink, VerseCommentary, type CommentLink, type WorkState } from "./commentary-view";
import { commentaryCount } from "./commentary-text";
import type { StudyVerse } from "./api";
import { RailSources, useWordCardOpener, VerseActions } from "./verse-panel";
import { useIsAnchor } from "./discussions";
import { tapWord } from "./word-nav";
import { useOwnLayer } from "./own-layer";
import { ChoiceCheck, verseState, type VerseChoiceView } from "./verse-choice";
import { Sheet } from "../../../ui";
import styles from "./study-sheet.module.css";

/**
 * The Study lens as a study sheet (Daniel, 2026-10-28; after the haftarah study sheet): Study is about meaning, so it plays nothing
 * and colours nothing. The Hebrew is plain, with its vowels and cantillation marks in ink; a word opens its card, never audio.
 * From 900px each verse is one row, English · number · Hebrew, aligned at the top with a hairline between verses, and a sticky
 * rail beside them holds what is on the selected verse: the study guide's notes, the commentaries, the verse's sources and its
 * actions. A row's number (or a click on the row) chooses it; the first verse with notes is chosen when the page opens. With
 * nothing chosen the rail says how to choose one and lists the reading's sources. On a phone the verses stack, Hebrew first and
 * English beneath, and a verse's "Notes" opens the same content in the one Sheet.
 */
export const STUDY_SHEET_STRINGS = Object.freeze({ rail: "On this verse", notes: "Notes", empty: "Choose a verse to see its notes." });
/** From 900px the rail is drawn; narrower it is not in the page at all, so a verse's notes are only ever in one place (the rail or its Notes sheet). The server draws the rail. */
const WIDE = "(min-width: 900px)";
const wideNow = () => typeof matchMedia === "function" ? matchMedia(WIDE).matches : true;
const onWide = (change: () => void) => { if (typeof matchMedia !== "function") return () => {}; const query = matchMedia(WIDE); query.addEventListener("change", change); return () => query.removeEventListener("change", change); };
const numberOf = (ref: string) => /:([1-9]\d*)$/.exec(ref)?.[1] ?? ref;

/** What the rail (or the phone's Sheet) holds for one verse, in order: guide notes, commentary, then the verse's sources and actions. */
function VerseNotes({ verse, works, link, notes, onTools }: { verse: StudyVerse; works: readonly WorkState[]; link: CommentLink; notes?: ReactNode; onTools?(opener: HTMLElement): void }) {
  const own = useOwnLayer();
  return <div className={styles.notesBody} data-study-notes={verse.ref}>
    {notes}
    <VerseCommentary verse={verse} works={works} link={link} />
    <VerseActions verse={verse.ref} onTools={onTools} />
    {own?.yours(verse, works)}
  </div>;
}

function StudyRow({ verse, id, label, choice, selected, noted, linked, toolsAvailable, showEnglish, works, notesHere, onSelect, onNotes }: {
  verse: StudyVerse; id: string; label?: string; choice?: VerseChoiceView; selected: boolean; noted: boolean; linked: CommentLink["marked"];
  toolsAvailable: boolean; showEnglish: boolean; works: readonly WorkState[]; notesHere: boolean; onSelect(): void; onNotes(opener: HTMLElement): void;
}) {
  const state = verseState(choice, verse.ref), number = numberOf(verse.ref);
  // A tap on a word opens its card beside the verse (Study's word card); while choosing verses a word does nothing at all.
  const opener = useWordCardOpener(), card = toolsAvailable && !state.choosing ? opener : null;
  // The row's marker: the guide has notes on it, or the reading's sources are anchored on it.
  const anchored = useIsAnchor(verse.ref), marked = noted || anchored;
  // Whether the phone's "Notes" has anything to open: notes, a commentary, the verse's sources, or its actions.
  const hasContent = noted || notesHere || anchored || works.some(row => commentaryCount(row.state) > 0) || Boolean(parseCompareVerse(verse.ref));
  // A click anywhere on the row chooses it for the rail, except on its own controls and words, and never while text is being selected.
  const choose = (event: MouseEvent<HTMLElement>) => {
    if (state.choosing || (event.target as Element).closest("button, a, [role='button'], input, select, textarea") || window.getSelection()?.toString()) return;
    onSelect();
  };
  return <>
    {label && <p className="student-aliyah" data-testid="student-aliyah">{label}</p>}
    <article className={styles.row} data-verse-ref={verse.ref} aria-label={verse.ref} data-selected={selected || undefined} data-has-notes={marked || undefined}
      data-verse-picked={state.picked || undefined} data-verse-marked={state.marked || undefined} onClick={choose}>
      <div className={styles.number}>
        {state.choosing && choice ? <button type="button" className={styles.numberButton} onClick={event => choice.onToggle(verse.ref, event.shiftKey)} aria-pressed={state.picked} aria-label={`Select ${verse.ref}`} lang="en" dir="ltr" data-verse-number="" title={verse.ref}><span>{state.picked && <ChoiceCheck />}{number}</span></button>
          : <button type="button" className={styles.numberButton} data-verse-number="" onClick={onSelect} aria-pressed={selected} aria-label={`Choose ${verse.ref}`} lang="en" dir="ltr" title={verse.ref}><span>{state.marked && <ChoiceCheck />}{number}</span></button>}
        {marked && <span className={styles.noteMark} data-note-mark="" aria-hidden="true" />}
        {marked && <span className="sr-only" lang="en" dir="ltr">(has notes)</span>}
        {state.marked && <span className="sr-only" lang="en" dir="ltr">(selected)</span>}
      </div>
      <div className={styles.hebrewCell}>
        <StudyHebrew verse={verse} colors={null} id={id} className={styles.hebrew} linked={linked}
          onWordSelect={card ? (word, element) => tapWord({ openCard: card, play: () => undefined }, verse.ref, word, element ?? null) : undefined}
          wordAction={card ? "card" : "tools"} toolsAvailable={Boolean(card)} />
        {/* Masoretic apparatus stays out of the Hebrew line, in small muted type under it. */}
        <div className={styles.apparatus}><Apparatus verse={verse} learner /></div>
      </div>
      {showEnglish && <p className={`study-english ${styles.english}`} lang="en" dir="ltr" data-english-ref={verse.ref} data-english-available={verse.english ? "true" : "false"}>{verse.english ?? "English reference unavailable for this verse."}</p>}
      {hasContent && !state.choosing && <div className={styles.notesOpen}>
        <button type="button" className={styles.notesButton} data-testid="study-notes-open" data-has-notes={marked || undefined} aria-haspopup="dialog" aria-label={`${STUDY_SHEET_STRINGS.notes} on ${verse.ref}`}
          onClick={event => onNotes(event.currentTarget)}>{marked && <span className={styles.noteDot} aria-hidden="true" />}{STUDY_SHEET_STRINGS.notes}</button>
      </div>}
    </article>
  </>;
}

export function StudyRows({ verses, group, sections = [], onTools, toolsAvailable = true, showEnglish = true, works, choice, notes, hasNotes, onPick }: {
  verses: readonly StudyVerse[];
  /** Kept for the callers' shape; Study draws no phrase colours, so the assignment's ending is not needed here. */
  assignment?: AssignmentEnding; group: string; sections?: readonly { index: number; label: string }[];
  /** Where the workspace offers a verse's tools (its Sheet): the rail then has a "Verse tools" action, handing over the ref and the button to return focus to. */
  onTools?(ref: string, opener: HTMLElement): void;
  /** False where words have no tools (the proposed portion), so their labels promise none. */
  toolsAvailable?: boolean; showEnglish?: boolean;
  /** Each shown work's state for a verse, in Works order. */
  works(ref: string): readonly WorkState[];
  /** "Choose verses": while choosing, verse numbers toggle the selection and words are not interactive. */
  choice?: VerseChoiceView;
  /** The study guide's notes on a verse (the rail's first part), and whether a verse has any (its marker, and the verse chosen first). */
  notes?(ref: string): ReactNode; hasNotes?(ref: string): boolean;
  /** Told when the reader chooses a verse, so the page can keep its place. */
  onPick?(ref: string): void;
}) {
  const first = useMemo(() => firstWordKey(verses), [verses]), base = useId(), wide = useSyncExternalStore(onWide, wideNow, () => true);
  const scope = `${verses[0]?.ref}|${verses.length}`;
  // The reader's own choice for this page of verses; until there is one, the first verse with notes (or none).
  const [chosen, setChosen] = useState<{ scope: string; ref: string | null } | null>(null);
  const [sheet, setSheet] = useState<{ ref: string; opener: HTMLElement } | null>(null);
  const firstNoted = verses.find(verse => hasNotes?.(verse.ref))?.ref ?? null;
  const selectedRef = chosen && chosen.scope === scope ? chosen.ref : firstNoted;
  const selected = verses.find(verse => verse.ref === selectedRef) ?? null;
  // One comment-to-word link for the page: the rail's commentary underlines words in its own verse's row.
  const link = useCommentLink(), clearLink = link.clear;
  useEffect(() => { clearLink(); }, [selectedRef, clearLink]);
  useEffect(() => { setSheet(null); }, [scope]);
  const pick = (ref: string, toggle: boolean) => { const next = toggle && ref === selectedRef ? null : ref; setChosen({ scope, ref: next }); if (next) onPick?.(next); };
  const linkedRef = link.markedKey ? link.markedKey.slice(0, link.markedKey.indexOf("|")) : null;
  const sheetVerse = sheet ? verses.find(verse => verse.ref === sheet.ref) ?? null : null;
  const railNotes = (verse: StudyVerse) => <VerseNotes verse={verse} works={works(verse.ref)} link={link} notes={notes?.(verse.ref)} onTools={onTools ? opener => onTools(verse.ref, opener) : undefined} />;
  return <div className={styles.sheet} data-study-sheet="" data-english={showEnglish ? "on" : "off"}>
    <WordGroup scope={scope} first={first} data-testid="study-verses" className={`study-verses ${styles.rows}`} aria-label="Hebrew reading, verse by verse" tabIndex={-1} data-study-rows="">
      {verses.map((verse, index) => <StudyRow key={verse.ref} verse={verse} id={`${group}-row-${index}`} label={sections.find(section => section.index === index)?.label} choice={choice}
        selected={verse.ref === selectedRef} noted={Boolean(hasNotes?.(verse.ref))} linked={linkedRef === verse.ref ? link.marked : null} toolsAvailable={toolsAvailable} showEnglish={showEnglish}
        works={works(verse.ref)} notesHere={Boolean(onTools)} onSelect={() => pick(verse.ref, true)}
        onNotes={opener => { pick(verse.ref, false); setSheet({ ref: verse.ref, opener }); }} />)}
    </WordGroup>
    {wide && <aside className={styles.rail} data-study-rail="" data-rail-verse={selected?.ref} aria-labelledby={`${base}-rail`}>
      <h3 id={`${base}-rail`} className={styles.railHeading}>{STUDY_SHEET_STRINGS.rail}{selected && <> <bdi dir="ltr" className={styles.railRef}>{selected.ref}</bdi></>}</h3>
      {selected ? railNotes(selected) : <><p className={styles.railEmpty} data-testid="study-rail-empty">{STUDY_SHEET_STRINGS.empty}</p><RailSources /></>}
    </aside>}
    {sheetVerse && sheet && <Sheet open onClose={() => setSheet(null)} title={`${STUDY_SHEET_STRINGS.rail} · ${sheetVerse.ref}`} closeLabel="Close" returnFocusTo={() => sheet.opener.isConnected ? sheet.opener : null}>
      <div data-testid="study-notes-sheet" data-notes-ref={sheetVerse.ref}>{railNotes(sheetVerse)}</div>
    </Sheet>}
  </div>;
}
