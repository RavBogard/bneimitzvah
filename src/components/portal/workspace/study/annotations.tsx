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

export function StudyHebrew({ verse, colors, id, className = "", activeWord = null, onWordSelect }: { verse: StudyVerse; colors: Ready | null; id: string; className?: string; activeWord?: number | null; onWordSelect?(index: number): void }) {
  const projection = useMemo(() => {
    if (colors) return colors.projection;
    const result = projectStudyVerse(verse.ref, verse.hebrew);
    return result.status === "ready" ? result.projection : null;
  }, [colors, verse.ref, verse.hebrew]);
  const parts = (pieces: readonly DisplayPart[]) => pieces.map((part, index) => {
    const word = part.wordIndex === null ? null : colors?.words[part.wordIndex];
    const family = word?.family ? families.get(word.family) : null;
    const active = part.wordIndex !== null && part.wordIndex === activeWord;
    return <span key={index} data-word-index={part.wordIndex ?? undefined} data-family={family?.id} data-phrase={word?.phrase ?? undefined}
      data-reference-active={active ? "true" : undefined} className={[family ? styles.word : "", active ? referenceStyles.activeWord : ""].filter(Boolean).join(" ") || undefined} style={family ? { "--phrase-color": family.color, "--w": part.wordIndex } as CSSProperties : undefined}
      aria-describedby={!family || word?.phrase === null || word?.phrase === undefined ? undefined : `${id}-phrase-${word.phrase}`}>{part.text}</span>;
  });
  const alternative = (written: string, read: ReactNode) => <><span>{written}</span><span className="study-read-alternative"> [<span className="study-qere-label" lang="en" dir="ltr">read / qere:</span> {read}]</span></>;
  // A paragraph break after the verse is apparatus: the note below names it.
  const trailing = (index: number, count: number, kind: string) => kind === "gap" && verse.hebrew.paragraphAfter !== null && index === count - 1;
  const gap = (kind: "petuchah" | "setumah") => <span className="study-paragraph-gap"><span lang="en" dir="ltr">[{kind === "petuchah" ? "open paragraph" : "closed paragraph"}]</span></span>;
  const sign = <span role="img" aria-label="Inverted nun, Masoretic sign">׆</span>;
  return <p className={`study-hebrew ${hebrewStyles.hebrew} ${className}`.trim()} lang="he" dir="rtl" onClick={onWordSelect ? event => {
    if (window.getSelection()?.toString()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-word-index]") : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(target.dataset.wordIndex); if (Number.isSafeInteger(index) && index >= 0 && projection && index < projection.words.length) onWordSelect(index);
  } : undefined}>{projection ? projection.runs.map((run, index) => run.kind === "text" ? <span key={run.segment}>{parts(run.parts)}</span>
    : run.kind === "alternative" ? <span className="study-alternative" key={run.segment}>{alternative(run.written, parts(run.read))}</span>
      : run.kind === "gap" && trailing(index, projection.runs.length, run.kind) ? null : <span key={run.segment}>{run.kind === "gap" ? gap(run.break) : sign}</span>)
    : verse.hebrew.segments.map((segment, index) => segment.kind === "text" ? <span key={index}>{segment.text}</span>
      : segment.kind === "alternative" ? <span className="study-alternative" key={index}>{alternative(segment.written, segment.read)}</span>
        : segment.kind === "gap" && trailing(index, verse.hebrew.segments.length, segment.kind) ? null : <span key={index}>{segment.kind === "gap" ? gap(segment.break) : sign}</span>)}</p>;
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
