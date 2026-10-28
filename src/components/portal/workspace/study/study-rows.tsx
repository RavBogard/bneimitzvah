"use client";
import { memo, useCallback, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { AssignmentEnding } from "../../../../lib/hebrew/study-annotations";
import { Apparatus, firstWordKey, StudyHebrew } from "./annotations";
import { WordGroup } from "./word-group";
import { verseWords, type WorkState } from "./commentary-view";
import type { StudyVerse } from "./api";
import { RailSources, useWordCardOpener } from "./verse-panel";
import { useDiscussionsView } from "./discussions";
import { tapWord } from "./word-nav";
import { useOwnLayer } from "./own-layer";
import { ChoiceCheck, verseState, type VerseChoiceView } from "./verse-choice";
import { fromRabbi, KIND_LABEL, NOTE_KINDS, verseEntries, type GuideAddition, type ThemeHeading, type VerseEntries } from "./notes-model";
import { Dots, VerseNotesBody } from "./study-notes";
import { useRailFollow } from "./rail-follow";
import styles from "./study-sheet.module.css";

/**
 * The Study lens as a study desk (Study v6, Daniel 2026-10-28). Study is about meaning, so it plays nothing and colours nothing: plain Hebrew, a word opens its
 * card, never audio. From 900px the text is one continuous column of rows, English · verse number · Hebrew, with no card per verse; under each number
 * coloured dots say which kinds of notes the verse has. Beside it a sticky column of its own lists only the verses that have entries, each folded to one
 * line, and exactly one is open as a white card, following the text (rail-follow.ts). Narrower, each verse stacks Hebrew first, then English, then its
 * entries inline as clamped cards and the three actions: there is no sheet. The reading's curated sources close the page.
 */
const WIDE = "(min-width: 900px)";
const wideNow = () => typeof matchMedia === "function" ? matchMedia(WIDE).matches : true;
const onWide = (change: () => void) => { if (typeof matchMedia !== "function") return () => {}; const query = matchMedia(WIDE); query.addEventListener("change", change); return () => query.removeEventListener("change", change); };
const numberOf = (ref: string) => /:([1-9]\d*)$/.exec(ref)?.[1] ?? ref;
const chapterVerse = (ref: string) => /(\d+:\d+)$/.exec(ref)?.[1] ?? ref;

type RowProps = {
  verse: StudyVerse; id: string; label?: string; heading?: ThemeHeading; choice?: VerseChoiceView; entries: VerseEntries; current: boolean; wide: boolean;
  toolsAvailable: boolean; showEnglish: boolean; yours?: ReactNode; onSelect(ref: string, shift: boolean): void;
};
const StudyRow = memo(function StudyRow({ verse, id, label, heading, choice, entries, current, wide, toolsAvailable, showEnglish, yours, onSelect }: RowProps) {
  const state = verseState(choice, verse.ref), number = numberOf(verse.ref), has = entries.notes.length > 0;
  // A tap on a word opens its card beside the verse (Study's word card); while choosing verses a word does nothing at all.
  const opener = useWordCardOpener(), card = toolsAvailable && !state.choosing ? opener : null;
  return <>
    {label && <p className="student-aliyah" data-testid="student-aliyah">{label}</p>}
    {heading && <div className={styles.part} data-testid="study-theme-heading" data-theme-heading={heading.id}>
      <h4>{heading.title}</h4>{heading.intro && <p>{heading.intro}</p>}<span className={styles.span} dir="ltr">{heading.span}</span></div>}
    <article className={styles.row} data-verse-ref={verse.ref} aria-label={verse.ref} data-current={current || undefined} data-has-notes={has || undefined}
      data-verse-picked={state.picked || undefined} data-verse-marked={state.marked || undefined}>
      <div className={styles.number}>
        {state.choosing && choice ? <button type="button" className={styles.numberButton} onClick={event => choice.onToggle(verse.ref, event.shiftKey)} aria-pressed={state.picked} aria-label={`Select ${verse.ref}`} lang="en" dir="ltr" data-verse-number="" title={verse.ref}><span>{state.picked && <ChoiceCheck />}{number}</span></button>
          : <button type="button" className={styles.numberButton} data-verse-number="" onClick={event => onSelect(verse.ref, event.shiftKey)} aria-pressed={wide && has ? current : undefined} aria-label={`Choose ${verse.ref}`} lang="en" dir="ltr" title={verse.ref}><span>{state.marked && <ChoiceCheck />}{number}</span></button>}
        <Dots kinds={entries.kinds} />
        {has && <span className="sr-only" lang="en" dir="ltr">(has notes)</span>}
        {state.marked && <span className="sr-only" lang="en" dir="ltr">(selected)</span>}
      </div>
      <div className={styles.hebrewCell}>
        <StudyHebrew verse={verse} colors={null} id={id} className={styles.hebrew} marks={entries.marks}
          onWordSelect={card ? (word, element) => tapWord({ openCard: card, play: () => undefined }, verse.ref, word, element ?? null) : undefined}
          wordAction={card ? "card" : "tools"} toolsAvailable={Boolean(card)} />
        {/* Masoretic apparatus stays out of the Hebrew line, in small muted type under it. */}
        <div className={styles.apparatus}><Apparatus verse={verse} learner /></div>
      </div>
      {showEnglish && <p className={`study-english ${styles.english}`} lang="en" dir="ltr" data-english-ref={verse.ref} data-english-available={verse.english ? "true" : "false"}>{verse.english ?? "English reference unavailable for this verse."}</p>}
      {!wide && has && !state.choosing && <div className={styles.inline} data-inline-notes={verse.ref}><VerseNotesBody verse={verse} entries={entries} phone yours={yours} /></div>}
    </article>
  </>;
});

export function StudyRows({ verses, group, sections = [], toolsAvailable = true, showEnglish = true, works, choice, additions, headings = [], rabbiName, onPick }: {
  verses: readonly StudyVerse[];
  /** Kept for the callers' shape; Study draws no phrase colours, so the assignment's ending is not needed here. */
  assignment?: AssignmentEnding; group: string; sections?: readonly { index: number; label: string }[];
  /** False where words have no tools (the proposed portion), so their labels promise none. */
  toolsAvailable?: boolean; showEnglish?: boolean;
  /** Each shown work's state for a verse, in Commentaries order. Keep it stable between renders: the notes are rebuilt when it changes. */
  works(ref: string): readonly WorkState[];
  /** "Choose verses": while choosing, verse numbers toggle the selection and words are not interactive. */
  choice?: VerseChoiceView;
  /** The rabbi-written notes for this student on a verse (never the Claude-written base guide's), and the headings of that guide's themes. */
  additions?(ref: string): readonly GuideAddition[]; headings?: readonly ThemeHeading[];
  /** The rabbi's display name when the reading's own sources do not carry it. */
  rabbiName?: string | null;
  /** Told when the reader chooses a verse's number, so the page can keep its place. */
  onPick?(ref: string): void;
}) {
  const first = useMemo(() => firstWordKey(verses), [verses]), wide = useSyncExternalStore(onWide, wideNow, () => true);
  const scope = `${verses[0]?.ref}|${verses.length}`, own = useOwnLayer(), discussions = useDiscussionsView();
  const name = discussions?.answer.rabbiName ?? rabbiName ?? null;
  const entries = useMemo(() => new Map(verses.map(verse => [verse.ref, verseEntries({ ref: verse.ref, works: works(verse.ref), discussions: discussions?.forVerse(verse.ref) ?? [], additions: additions?.(verse.ref) ?? [], rabbiName: name, words: verseWords(verse) })] as const)), [verses, works, discussions, additions, name]);
  const refs = useMemo(() => verses.filter(verse => entries.get(verse.ref)!.notes.length > 0).map(verse => verse.ref), [verses, entries]);
  const kinds = NOTE_KINDS.filter(kind => [...entries.values()].some(item => item.kinds.includes(kind)));
  const rows = useRef<HTMLDivElement | null>(null), rail = useRef<HTMLElement | null>(null), railed = wide && refs.length > 0;
  const { current, choose } = useRailFollow({ entries: refs, enabled: railed, rows, rail });
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const noted = useRef<ReadonlySet<string>>(new Set()); noted.current = railed ? new Set(refs) : new Set();
  const select = useCallback((ref: string) => { pickRef.current?.(ref); if (noted.current.has(ref)) choose(ref); }, [choose]);
  const headingAt = useMemo(() => new Map(headings.filter(row => verses.some(verse => verse.ref === row.first)).map(row => [row.first, row] as const)), [headings, verses]);
  const yoursFor = (verse: StudyVerse) => own?.yours(verse, works(verse.ref));
  return <div className={styles.sheet} data-study-sheet="" data-english={showEnglish ? "on" : "off"} data-railed={railed || undefined}>
    {kinds.length > 0 && <p className={styles.key} data-note-key="">{kinds.map(kind => <span key={kind}><i className={styles.dot} data-kind={kind} aria-hidden="true" /> {kind === "rabbi" ? fromRabbi(name) : KIND_LABEL[kind]}</span>)}</p>}
    <div className={styles.flow}>
      <div ref={rows} className={styles.column}>
        <WordGroup scope={scope} first={first} data-testid="study-verses" className={`study-verses ${styles.rows}`} aria-label="Hebrew reading, verse by verse" tabIndex={-1} data-study-rows="">
          {verses.map((verse, index) => <StudyRow key={verse.ref} verse={verse} id={`${group}-row-${index}`} label={sections.find(section => section.index === index)?.label}
            heading={headingAt.get(verse.ref)} choice={choice} entries={entries.get(verse.ref)!} current={railed && current === verse.ref} wide={wide} toolsAvailable={toolsAvailable} showEnglish={showEnglish}
            yours={!wide ? yoursFor(verse) : undefined} onSelect={select} />)}
        </WordGroup>
      </div>
      {railed && <aside ref={rail} className={styles.rail} data-study-rail="" data-rail-verse={current ?? undefined} aria-label="Notes">
        {refs.map(ref => {
          const item = entries.get(ref)!, verse = verses.find(row => row.ref === ref)!, open = current === ref;
          return <section key={ref} className={styles.vapp} data-open={open || undefined} data-rail-item={ref}>
            <button type="button" className={styles.vhead} data-rail-head={ref} aria-expanded={open} onClick={() => choose(ref)}>
              <span className={styles.ref} dir="ltr">{chapterVerse(ref)}</span>
              <span className={styles.who}><Dots kinds={item.kinds} /><span className={styles.names}>{item.names.join(", ")}</span></span>
              <span className={styles.count}>{item.notes.length}<span className="sr-only"> {item.notes.length === 1 ? "note" : "notes"}</span></span>
            </button>
            <div className={styles.fold}><div className={styles.inner} inert={!open}><VerseNotesBody verse={verse} entries={item} phone={false} yours={yoursFor(verse)} /></div></div>
          </section>;
        })}
      </aside>}
    </div>
    {/* The reading's curated sources close the page; where a source belongs to a verse it opens that verse's sources. */}
    <RailSources />
  </div>;
}
