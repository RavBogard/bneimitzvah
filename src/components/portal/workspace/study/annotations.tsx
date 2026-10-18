"use client";
import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { colorStudyVerse, type AssignmentEnding, type ColorResult } from "../../../../lib/hebrew/study-annotations";
import { projectStudyVerse, type DisplayPart } from "../../../../lib/hebrew/study-tokens";
import { PHRASE_FAMILIES } from "../../../../lib/trope/chart-catalog";
import hebrewStyles from "../../../../styles/hebrew-font.module.css";
import { useReadingPrefs } from "../reading-prefs";
import type { StudyVerse } from "./api";
import styles from "./annotations.module.css";
import referenceStyles from "./reference-player.module.css";

const families = new Map(PHRASE_FAMILIES.map(family => [family.id, family]));
type Ready = Extract<ColorResult, { status: "ready" }>;
export function phraseGroups(result: Ready) {
  return [...new Set(result.words.flatMap(word => word.phrase === null ? [] : [word.phrase]))].map(phrase => {
    const words = result.words.filter(word => word.phrase === phrase);
    return { phrase, family: families.get(words[0].family!)!, first: words[0].index + 1, last: words.at(-1)!.index + 1 };
  });
}
const range = (first: number, last: number) => first === last ? `Word ${first}` : `Words ${first}–${last}`;
const unavailableText = (result: ColorResult) => result.status === "unavailable" && result.reason === "unsupported-system"
  ? "Phrase colors aren’t available for Psalms, Proverbs and Job yet." : "Phrase colors aren’t available for this verse.";

/** Phrase analysis runs only when colors are shown; word identity is independent. */
export function useVerseColors(verse: StudyVerse, assignment: AssignmentEnding, enabled: boolean) {
  const { kind, confirmed } = assignment, verses = assignment.verses.join("\n");
  return useMemo(() => enabled ? colorStudyVerse(verse.ref, verse.hebrew, { kind, confirmed, verses: verses ? verses.split("\n") : [] }) : null, [enabled, verse, kind, confirmed, verses]);
}

export function StudyHebrew({ verse, colors, id, className = "", activeWord = null, onWordSelect, inline = false, wordAction = "word" }: { verse: StudyVerse; inline?: boolean; colors: Ready | null; id: string; className?: string; activeWord?: number | null; onWordSelect?(index: number): void; wordAction?: "word" | "verse" }) {
  const projection = useMemo(() => {
    if (colors) return colors.projection;
    const result = projectStudyVerse(verse.ref, verse.hebrew);
    return result.status === "ready" ? result.projection : null;
  }, [colors, verse.ref, verse.hebrew]);
  const Container = inline ? "span" : "p";
  const focusableWords = new Set<number>();
  const parts = (pieces: readonly DisplayPart[]) => pieces.map((part, index) => {
    const word = part.wordIndex === null ? null : colors?.words[part.wordIndex];
    const family = word?.family ? families.get(word.family) : null;
    const active = part.wordIndex !== null && part.wordIndex === activeWord;
    const firstPart = part.wordIndex !== null && !focusableWords.has(part.wordIndex);
    if (part.wordIndex !== null) focusableWords.add(part.wordIndex);
    return <span key={index} role={onWordSelect && firstPart ? "button" : undefined} tabIndex={onWordSelect && firstPart ? 0 : undefined}
      aria-label={onWordSelect && firstPart ? wordAction === "verse" ? `Hear whole verse ${verse.ref}; select word ${part.wordIndex! + 1} for tools` : `Hear word ${part.wordIndex! + 1} of ${verse.ref}` : undefined} data-word-index={part.wordIndex ?? undefined} data-family={family?.id} data-phrase={word?.phrase ?? undefined}
      data-reference-active={active ? "true" : undefined} className={[family ? styles.word : "", active ? referenceStyles.activeWord : ""].filter(Boolean).join(" ") || undefined} style={family ? { "--phrase-color": family.color, "--w": part.wordIndex } as CSSProperties : undefined}
      aria-describedby={!family || word?.phrase === null || word?.phrase === undefined ? undefined : `${id}-phrase-${word.phrase}`}>{part.text}</span>;
  });
  const alternative = (written: string, read: ReactNode) => <><span>{written}</span><span className="study-read-alternative"> [<span className="study-qere-label" lang="en" dir="ltr">read / qere:</span> {read}]</span></>;
  // A paragraph break after the verse is apparatus: the note below names it.
  const trailing = (index: number, count: number, kind: string) => kind === "gap" && verse.hebrew.paragraphAfter !== null && index === count - 1;
  const gap = (kind: "petuchah" | "setumah") => <span className="study-paragraph-gap"><span className={inline ? "sr-only" : undefined} lang="en" dir="ltr">[{kind === "petuchah" ? "open paragraph" : "closed paragraph"}]</span></span>;
  const sign = <span role="img" aria-label="Inverted nun, Masoretic sign">׆</span>;
  return <Container className={`study-hebrew ${hebrewStyles.hebrew} ${inline ? styles.inlineHebrew : ""} ${onWordSelect ? styles.playable : ""} ${className}`.trim()} lang="he" dir="rtl" onKeyDown={onWordSelect ? event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-word-index][role="button"]') : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(target.dataset.wordIndex); if (projection && Number.isSafeInteger(index) && index >= 0 && index < projection.words.length) { event.preventDefault(); event.stopPropagation(); onWordSelect(index); }
  } : undefined} onClick={onWordSelect ? event => {
    if (window.getSelection()?.toString()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-word-index]") : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(target.dataset.wordIndex); if (Number.isSafeInteger(index) && index >= 0 && projection && index < projection.words.length) onWordSelect(index);
  } : undefined}>{projection ? projection.runs.map((run, index) => run.kind === "text" ? <span key={run.segment}>{parts(run.parts)}</span>
    : run.kind === "alternative" ? <span className="study-alternative" key={run.segment}>{alternative(run.written, parts(run.read))}</span>
      : run.kind === "gap" && trailing(index, projection.runs.length, run.kind) ? null : <span key={run.segment}>{run.kind === "gap" ? gap(run.break) : sign}</span>)
    : verse.hebrew.segments.map((segment, index) => segment.kind === "text" ? <span key={index}>{segment.text}</span>
      : segment.kind === "alternative" ? <span className="study-alternative" key={index}>{alternative(segment.written, segment.read)}</span>
        : segment.kind === "gap" && trailing(index, verse.hebrew.segments.length, segment.kind) ? null : <span key={index}>{segment.kind === "gap" ? gap(segment.break) : sign}</span>)}</Container>;
}

/** Masoretic apparatus sits under the line, never inside it. */
export function Apparatus({ verse, learner = false }: { verse: StudyVerse; learner?: boolean }) {
  const alternative = verse.hebrew.segments.some(segment => segment.kind === "alternative");
  if (!alternative && !verse.hebrew.paragraphAfter) return null;
  return <div className="study-apparatus">
    {alternative && <p className="field-help">{learner ? "Read aloud the word in brackets (qere), not the written form (ketiv) before it." : "Written form (ketiv) is followed by the read alternative (qere); neither is silently substituted."}</p>}
    {verse.hebrew.paragraphAfter && <p className="study-paragraph-note">{verse.hebrew.paragraphAfter === "petuchah" ? "Open paragraph (petuchah) after this verse." : "Closed paragraph (setumah) after this verse."}</p>}
  </div>;
}

export function PhraseLegend({ colors, id, verseRef }: { colors: ColorResult | null; id: string; verseRef: string }) {
  if (!colors) return null;
  if (colors.status !== "ready") return <p role="status" className="field-help">{unavailableText(colors)}</p>;
  return <ol className={styles.legend} aria-label={`Phrase families for ${verseRef}`}>{phraseGroups(colors).map(({ phrase, family, first, last }) => <li id={`${id}-phrase-${phrase}`} key={phrase} style={{ "--phrase-color": family.color } as CSSProperties}>
    <span className={styles.chip}>{family.label}</span><span className={styles.wordRange}>{range(first, last)}</span>
  </li>)}</ol>;
}

const interactive = "a, button, input, textarea, select, summary, details, label, dialog";
/** Presentation state lives only in this authorized, current-page mount. */
export function AnnotatedStudyVerse({ verse, assignment, group, number, showEnglish = true, onLift, learner = false, mark }: {
  verse: StudyVerse; assignment: AssignmentEnding; group: string; number?: number; showEnglish?: boolean; onLift?(): void; learner?: boolean; mark?: ReactNode;
}) {
  const prefs = useReadingPrefs(), id = `${group}-${verse.ref.replace(/[^A-Za-z0-9]+/g, "-")}`;
  const result = useVerseColors(verse, assignment, prefs.colors);
  const colors = result?.status === "ready" ? result : null;
  const lift = onLift ? (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(interactive) || window.getSelection()?.toString()) return;
    onLift();
  } : undefined;
  return <article data-verse-ref={verse.ref} className={`verse-card${onLift ? " verse-card-liftable" : ""}`} onClick={lift}>
    <div className="verse-card-head">
      {number !== undefined && <span className="verse-number" aria-hidden="true">{number}</span>}
      <h4><bdi dir="ltr">{verse.ref}</bdi></h4>
      {mark}
      {onLift && <button type="button" className="verse-lift" onClick={onLift} aria-label={`Practice ${verse.ref} up close`}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>}
    </div>
    <StudyHebrew verse={verse} colors={colors} id={id} />
    {colors && <div className="sr-only"><PhraseLegend colors={colors} id={id} verseRef={verse.ref} /></div>}
    {result && result.status !== "ready" && <p role="status" className="field-help">{unavailableText(result)}</p>}
    {showEnglish && <p className="study-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p>}
    <Apparatus verse={verse} learner={learner} />
  </article>;
}

/** Real verse/chapter/discontinuity boundaries only; no fabricated verse cards. */
export function studyFlowGroups(verses: readonly StudyVerse[], sectionStarts: readonly number[] = []) {
  const groups: number[][] = [];
  for (let index = 0; index < verses.length; index++) {
    const previous = verses[index - 1], current = verses[index];
    const a = previous && /^(.* [1-9]\d*):([1-9]\d*)$/.exec(previous.ref), b = /^(.* [1-9]\d*):([1-9]\d*)$/.exec(current.ref);
    const boundary = !previous || previous.hebrew.paragraphAfter === "petuchah" || !a || !b || a[1] !== b[1] || Number(b[2]) !== Number(a[2]) + 1 || sectionStarts.includes(index);
    if (boundary) groups.push([]); groups.at(-1)!.push(index);
  }
  return groups;
}
function FlowVerse({ verse, assignment, id, onVerse, onWord, activeWord }: {
  verse: StudyVerse; assignment: AssignmentEnding; id: string; onVerse?(): void; onWord?(index: number): void; activeWord: number | null;
}) {
  const prefs = useReadingPrefs(), result = useVerseColors(verse, assignment, prefs.colors), colors = result?.status === "ready" ? result : null;
  const number = /:([1-9]\d*)$/.exec(verse.ref)?.[1];
  return <span data-verse-ref={verse.ref} className={styles.flowVerse}>
    <span className="sr-only" role="heading" aria-level={4} dir="ltr">{verse.ref}</span>
    {onVerse ? <button type="button" className={styles.verseNumber} onClick={onVerse} aria-label={`Hear ${verse.ref}`} title={verse.ref}>{number ?? verse.ref}</button>
      : <sup title={verse.ref}>{number ?? verse.ref}</sup>}{" "}
    <StudyHebrew verse={verse} colors={colors} id={id} inline activeWord={activeWord} onWordSelect={onWord} wordAction="verse" />{" "}
    {verse.hebrew.paragraphAfter === "setumah" && <span className={styles.closedGap} role="img" aria-label="Closed paragraph" />}
    {colors && <span className="sr-only">{phraseGroups(colors).map(row => <span key={row.phrase} id={`${id}-phrase-${row.phrase}`}>{row.family.label}, {range(row.first, row.last)}. </span>)}</span>}
  </span>;
}
export function FlowingStudyText({ verses, assignment, group, sections = [], onVerse, onWord, activeWord }: {
  verses: StudyVerse[]; assignment: AssignmentEnding; group: string; sections?: readonly { index: number; label: string }[];
  onVerse?(index: number): void; onWord?(verse: number, word: number): void; activeWord: { verse: number; index: number } | null;
}) {
  return <div className={`study-verses ${styles.flow}`} aria-label="Hebrew reading">
    {studyFlowGroups(verses, sections.map(section => section.index)).map(indices => <div key={verses[indices[0]].ref}>
      {sections.find(section => section.index === indices[0]) && <p className="student-aliyah">{sections.find(section => section.index === indices[0])!.label}</p>}
      <p className={styles.flowParagraph} lang="he" dir="rtl">{indices.map(index => <FlowVerse key={verses[index].ref} verse={verses[index]} assignment={assignment} id={`${group}-flow-${index}`} onVerse={onVerse ? () => onVerse(index) : undefined} onWord={onWord ? word => onWord(index, word) : undefined} activeWord={activeWord?.verse === index ? activeWord.index : null} />)}</p>
    </div>)}
  </div>;
}
