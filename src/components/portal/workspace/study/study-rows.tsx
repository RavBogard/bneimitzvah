"use client";
import { useReadingPrefs } from "../reading-prefs";
import type { AssignmentEnding } from "../../../../lib/hebrew/study-annotations";
import { Apparatus, PhraseLegend, StudyHebrew, useVerseColors } from "./annotations";
import { useCommentLink, VerseCommentary, type WorkState } from "./commentary-view";
import type { StudyVerse } from "./api";
import { InlineVersePanel, VerseActions } from "./verse-panel";
import styles from "./commentary.module.css";

/**
 * The Study lens (spec 2026-10-22 §3.2): each verse on its own row with room
 * under it. Hebrew with colors and its verse number (Hear), the English when it
 * is on, then the inline commentary, quieter than scripture and set off by a
 * hairline, and the verse's actions (Compare) under it. No tikkun here: Study is about meaning.
 */
function StudyRow({ verse, assignment, id, onVerse, onWord, activeWord, listening, toolsAvailable, showEnglish, works, label }: {
  verse: StudyVerse; assignment: AssignmentEnding; id: string; onVerse?(): void; onWord?(index: number): void; activeWord: number | null;
  listening: boolean; toolsAvailable: boolean; showEnglish: boolean; works: readonly WorkState[]; label?: string;
}) {
  const prefs = useReadingPrefs(), result = useVerseColors(verse, assignment, prefs.colors), colors = result?.status === "ready" ? result : null;
  const link = useCommentLink(), number = /:([1-9]\d*)$/.exec(verse.ref)?.[1] ?? verse.ref;
  return <>
    {label && <p className="student-aliyah">{label}</p>}
    <article className={styles.row} data-verse-ref={verse.ref} aria-label={verse.ref}>
      <div className={styles.verseHebrew}>
        {onVerse ? <button type="button" className={styles.number} onClick={onVerse} aria-label={`Hear ${verse.ref}`} title={verse.ref}><span>{number}</span></button>
          : <span className={styles.number} title={verse.ref}><span>{number}</span></span>}
        <StudyHebrew verse={verse} colors={colors} id={id} className={styles.hebrew} activeWord={activeWord} onWordSelect={onWord} wordAction={listening ? "verse" : "tools"} toolsAvailable={toolsAvailable} linked={link.marked} />
        {colors && <div className="sr-only"><PhraseLegend colors={colors} id={id} verseRef={verse.ref} /></div>}
        {/* Masoretic apparatus stays out of the Hebrew line, in small muted type under it. */}
        <div className={styles.apparatus}><Apparatus verse={verse} learner /></div>
      </div>
      <div className={styles.verseSide}>
        {showEnglish && <p className={`study-english ${styles.english}`} lang="en" dir="ltr" data-english-ref={verse.ref}>{verse.english ?? "English reference unavailable for this verse."}</p>}
        <VerseCommentary verse={verse} works={works} link={link} />
        <VerseActions verse={verse.ref} />
      </div>
    </article>
    <InlineVersePanel verse={verse.ref} />
  </>;
}

export function StudyRows({ verses, assignment, group, sections = [], onVerse, onWord, activeWord, listening = true, toolsAvailable = true, showEnglish = true, works }: {
  verses: readonly StudyVerse[]; assignment: AssignmentEnding; group: string; sections?: readonly { index: number; label: string }[];
  onVerse?(index: number): void; onWord?(verse: number, word: number): void; activeWord: { verse: number; index: number } | null; listening?: boolean;
  /** False where words have no tools (the proposed portion), so their labels promise none. */
  toolsAvailable?: boolean; showEnglish?: boolean;
  /** Each shown work's state for a verse, in Works order. */
  works(ref: string): readonly WorkState[];
}) {
  return <div className={`study-verses ${styles.rows}`} aria-label="Hebrew reading, verse by verse" tabIndex={-1} data-study-rows="">
    {verses.map((verse, index) => <StudyRow key={verse.ref} verse={verse} assignment={assignment} id={`${group}-row-${index}`}
      label={sections.find(section => section.index === index)?.label}
      onVerse={onVerse ? () => onVerse(index) : undefined} onWord={onWord ? word => onWord(index, word) : undefined}
      activeWord={activeWord?.verse === index ? activeWord.index : null} listening={listening} toolsAvailable={toolsAvailable} showEnglish={showEnglish} works={works(verse.ref)} />)}
  </div>;
}
