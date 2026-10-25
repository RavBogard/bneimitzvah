"use client";
import { useMemo } from "react";
import { useReadingPrefs } from "../reading-prefs";
import type { AssignmentEnding } from "../../../../lib/hebrew/study-annotations";
import { Apparatus, firstWordKey, PhraseLegend, StudyHebrew, useVerseColors } from "./annotations";
import { WordGroup } from "./word-group";
import { useCommentLink, VerseCommentary, type WorkState } from "./commentary-view";
import type { StudyVerse } from "./api";
import { useWordCardOpener, VerseActions } from "./verse-panel";
import { tapWord } from "./word-nav";
import { useOwnLayer } from "./own-layer";
import { ChoiceCheck, verseState, type VerseChoiceView } from "./verse-choice";
import styles from "./commentary.module.css";

/**
 * The Study lens (spec 2026-10-22 §3.2): each verse on its own row with room
 * under it. Hebrew with colors and its verse number (Hear), the English when it
 * is on, then the inline commentary, quieter than scripture and set off by a
 * hairline, and the verse's actions (Compare) under it, then, on a member's own saved reading only, the closed
 * Yours row (spec §3.2 item 5). No tikkun here: Study is about meaning.
 */
function StudyRow({ verse, assignment, id, onVerse, onWord, onTools, activeWord, listening, toolsAvailable, showEnglish, works, label, choice }: {
  verse: StudyVerse; assignment: AssignmentEnding; id: string; onVerse?(): void; onWord?(index: number): void; onTools?(opener: HTMLElement): void; activeWord: number | null;
  listening: boolean; toolsAvailable: boolean; showEnglish: boolean; works: readonly WorkState[]; label?: string; choice?: VerseChoiceView;
}) {
  const state = verseState(choice, verse.ref);
  const prefs = useReadingPrefs(), result = useVerseColors(verse, assignment, prefs.colors), colors = result?.status === "ready" ? result : null;
  const link = useCommentLink(), number = /:([1-9]\d*)$/.exec(verse.ref)?.[1] ?? verse.ref, own = useOwnLayer();
  // In Study a tap on a word opens its card beside the verse; where there is no card (no text page registered, or words have no tools) it does what it did.
  // While choosing verses a tap on a word does nothing at all (no card, no playback); the row is as it was once choosing ends.
  const opener = useWordCardOpener(), card = toolsAvailable && !state.choosing ? opener : null;
  return <>
    {label && <p className="student-aliyah">{label}</p>}
    <article className={styles.row} data-verse-ref={verse.ref} aria-label={verse.ref} data-verse-picked={state.picked || undefined} data-verse-marked={state.marked || undefined}>
      <div className={styles.verseHebrew}>
        {state.choosing && choice ? <button type="button" className={styles.number} onClick={event => choice.onToggle(verse.ref, event.shiftKey)} aria-pressed={state.picked} aria-label={`Select ${verse.ref}`} title={verse.ref}><span>{state.picked && <ChoiceCheck />}{number}</span></button>
          : onVerse ? <button type="button" className={styles.number} onClick={onVerse} aria-label={`Hear ${verse.ref}`} title={verse.ref}><span>{state.marked && <ChoiceCheck />}{number}</span></button>
            : <span className={styles.number} title={verse.ref}><span>{state.marked && <ChoiceCheck />}{number}</span></span>}
        {state.marked && <span className="sr-only">(selected)</span>}
        <StudyHebrew verse={verse} colors={colors} id={id} className={styles.hebrew} activeWord={activeWord} onWordSelect={!state.choosing && (card || onWord) ? (word, element) => tapWord({ openCard: card, play: chosen => onWord?.(chosen) }, verse.ref, word, element ?? null) : undefined} wordAction={card ? "card" : listening ? "verse" : "tools"} toolsAvailable={toolsAvailable} linked={link.marked} />
        {colors && <div className="sr-only"><PhraseLegend colors={colors} id={id} verseRef={verse.ref} /></div>}
        {/* Masoretic apparatus stays out of the Hebrew line, in small muted type under it. */}
        <div className={styles.apparatus}><Apparatus verse={verse} learner /></div>
      </div>
      <div className={styles.verseSide}>
        {showEnglish && <p className={`study-english ${styles.english}`} lang="en" dir="ltr" data-english-ref={verse.ref}>{verse.english ?? "English reference unavailable for this verse."}</p>}
        <VerseCommentary verse={verse} works={works} link={link} />
        <VerseActions verse={verse.ref} onTools={onTools} />
        {own?.yours(verse, works)}
      </div>
    </article>
  </>;
}

export function StudyRows({ verses, assignment, group, sections = [], onVerse, onWord, onTools, activeWord, listening = true, toolsAvailable = true, showEnglish = true, works, choice }: {
  verses: readonly StudyVerse[]; assignment: AssignmentEnding; group: string; sections?: readonly { index: number; label: string }[];
  onVerse?(index: number): void; onWord?(verse: number, word: number): void;
  /** Where the workspace offers a verse's tools (its Sheet): each row then has a "Verse tools" action, handing over the ref and the button to return focus to. */
  onTools?(ref: string, opener: HTMLElement): void; activeWord: { verse: number; index: number } | null; listening?: boolean;
  /** False where words have no tools (the proposed portion), so their labels promise none. */
  toolsAvailable?: boolean; showEnglish?: boolean;
  /** Each shown work's state for a verse, in Works order. */
  works(ref: string): readonly WorkState[];
  /** "Choose verses": while choosing, verse numbers toggle the selection and words are not interactive. */
  choice?: VerseChoiceView;
}) {
  const first = useMemo(() => firstWordKey(verses), [verses]);
  return <WordGroup scope={`${verses[0]?.ref}|${verses.length}`} first={first} className={`study-verses ${styles.rows}`} aria-label="Hebrew reading, verse by verse" tabIndex={-1} data-study-rows="">
    {verses.map((verse, index) => <StudyRow key={verse.ref} verse={verse} assignment={assignment} id={`${group}-row-${index}`}
      label={sections.find(section => section.index === index)?.label}
      onVerse={onVerse ? () => onVerse(index) : undefined} onWord={onWord ? word => onWord(index, word) : undefined} onTools={onTools ? opener => onTools(verse.ref, opener) : undefined}
      activeWord={activeWord?.verse === index ? activeWord.index : null} listening={listening} toolsAvailable={toolsAvailable} showEnglish={showEnglish} works={works(verse.ref)} choice={choice} />)}
  </WordGroup>;
}
