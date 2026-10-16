"use client";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { colorStudyVerse, type AssignmentEnding, type ColorResult } from "../../../../lib/hebrew/study-annotations";
import type { DisplayPart } from "../../../../lib/hebrew/study-tokens";
import { PHRASE_FAMILIES } from "../../../../lib/trope/chart-catalog";
import hebrewStyles from "../../../../styles/hebrew-font.module.css";
import type { StudyVerse } from "./api";
import styles from "./annotations.module.css";

const families = new Map(PHRASE_FAMILIES.map(family => [family.id, family]));
type Ready = Extract<ColorResult, { status: "ready" }>;
function phraseGroups(result: Ready) {
  return [...new Set(result.words.flatMap(word => word.phrase === null ? [] : [word.phrase]))].map(phrase => {
    const words = result.words.filter(word => word.phrase === phrase);
    return { phrase, family: families.get(words[0].family!)!, first: words[0].index + 1, last: words.at(-1)!.index + 1 };
  });
}
const range = (first: number, last: number) => first === last ? `Word ${first}` : `Words ${first}–${last}`;

function Hebrew({ verse, colors, enabled, id }: { verse: StudyVerse; colors: Ready | null; enabled: boolean; id: string }) {
  const parts = (pieces: readonly DisplayPart[]) => pieces.map((part, index) => {
    const word = part.wordIndex === null ? null : colors?.words[part.wordIndex];
    const family = enabled && word?.family ? families.get(word.family) : null;
    return <span key={index} data-word-index={part.wordIndex ?? undefined} data-family={family?.id} data-phrase={word?.phrase ?? undefined}
      className={family ? styles.word : undefined} style={family ? { "--phrase-color": family.color } as CSSProperties : undefined}
      aria-describedby={!family || word?.phrase === null || word?.phrase === undefined ? undefined : `${id}-phrase-${word.phrase}`}>{part.text}</span>;
  });
  const alternative = (written: string, read: ReactNode) => <><span>{written}</span><span className="study-read-alternative"> [<span lang="en" dir="ltr">read / qere:</span> {read}]</span></>;
  const gap = (kind: "petuchah" | "setumah") => <span className="study-paragraph-gap"><span lang="en" dir="ltr">[{kind === "petuchah" ? "open paragraph" : "closed paragraph"}]</span></span>;
  const sign = <span role="img" aria-label="Inverted nun, Masoretic sign">׆</span>;
  return <><p className={`study-hebrew ${hebrewStyles.hebrew}`} lang="he" dir="rtl">{colors ? colors.projection.runs.map(run => run.kind === "text" ? <span key={run.segment}>{parts(run.parts)}</span>
    : run.kind === "alternative" ? <span className="study-alternative" key={run.segment}>{alternative(run.written, parts(run.read))}</span>
      : <span key={run.segment}>{run.kind === "gap" ? gap(run.break) : sign}</span>)
    : verse.hebrew.segments.map((segment, index) => segment.kind === "text" ? <span key={index}>{segment.text}</span>
      : segment.kind === "alternative" ? <span className="study-alternative" key={index}>{alternative(segment.written, segment.read)}</span>
        : <span key={index}>{segment.kind === "gap" ? gap(segment.break) : sign}</span>)}</p>
    {verse.hebrew.segments.some(segment => segment.kind === "alternative") && <p className="field-help">Written form (ketiv) is followed by the read alternative (qere); neither is silently substituted.</p>}
    {verse.hebrew.paragraphAfter && <p className="study-paragraph-note">{verse.hebrew.paragraphAfter === "petuchah" ? "Open paragraph (petuchah) after this verse." : "Closed paragraph (setumah) after this verse."}</p>}
  </>;
}

/** Presentation state lives only in this authorized, current-page mount. */
export function AnnotatedStudyVerse({ verse, assignment, group }: { verse: StudyVerse; assignment: AssignmentEnding; group: string }) {
  const id = useId(), [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<ColorResult | null>(null);
  const colors = result?.status === "ready" ? result : null;
  return <article data-verse-ref={verse.ref}>
    <h4><bdi dir="ltr">{verse.ref}</bdi></h4>
    <Hebrew verse={verse} colors={colors} enabled={enabled} id={id} />
    <p className="study-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p>
    <details className={styles.aids} name={group}>
      <summary aria-label={`Reading aids for ${verse.ref}`}>Reading aids</summary>
      <label className={styles.toggle}><input type="checkbox" checked={enabled} onChange={event => {
        const checked = event.currentTarget.checked;
        if (checked && !result) setResult(colorStudyVerse(verse.ref, verse.hebrew, assignment));
        setEnabled(checked);
      }} aria-describedby={`${id}-help`} />Color phrases<span className={styles.srOnly}> for {verse.ref}</span></label>
      <p id={`${id}-help`} className="field-help">Colors group words by their closing trope family. Word numbers count the read form (qere), including each word joined by maqaf.</p>
      <p className="field-help">A munach before a vertical divider is grouped with revia here. Check unusual markings with your tutor.</p>
      {enabled && colors && <ol className={styles.legend} aria-label={`Phrase families for ${verse.ref}`}>{phraseGroups(colors).map(({ phrase, family, first, last }) => <li id={`${id}-phrase-${phrase}`} key={phrase}>
        <span className={styles.swatch} style={{ backgroundColor: family.color }} aria-hidden="true" /><span>{family.label} <span className={styles.wordRange}>· {range(first, last)}</span></span>
      </li>)}</ol>}
      {enabled && result?.status === "unavailable" && <p role="status" className="field-help">{result.reason === "unsupported-system" ? "Phrase colors are unavailable for Psalms, Proverbs and Job in this version." : "Phrase colors are unavailable for this verse. The Hebrew remains available."}</p>}
      <p className={styles.reference}>See the <a href="/trope-chart" target="_blank" rel="noopener noreferrer">trope chart (opens in a new tab)</a>.</p>
    </details>
  </article>;
}
