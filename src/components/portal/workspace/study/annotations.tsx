"use client";
import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { rovingTarget } from "./word-nav";
import { colorStudyVerse, type AssignmentEnding, type ColorResult } from "../../../../lib/hebrew/study-annotations";
import { projectStudyVerse, type DisplayPart, type StudyProjection } from "../../../../lib/hebrew/study-tokens";
import { PHRASE_FAMILIES } from "../../../../lib/trope/chart-catalog";
import { INVERTED_NUN, tikkunPieces, tikkunSigns, tikkunText } from "../../../../lib/hebrew/tikkun";
import hebrewStyles from "../../../../styles/hebrew-font.module.css";
import stamStyles from "../../../../styles/stam-font.module.css";
import { useReadingPrefs, type TikkunView } from "../reading-prefs";
import type { StudyVerse } from "./api";
import type { DibburMatch } from "../../../../lib/hebrew/dibbur";
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

export function StudyHebrew({ verse, colors, id, className = "", activeWord = null, onWordSelect, inline = false, wordAction = "word", toolsAvailable = true, linked = null }: { verse: StudyVerse; inline?: boolean; colors: Ready | null; id: string; className?: string; activeWord?: number | null;
  /** `element` is the word that was chosen, so a card opened from it can hand focus back. */
  onWordSelect?(index: number, element?: HTMLElement): void; wordAction?: "word" | "verse" | "tools" | "phrase" | "card"; toolsAvailable?: boolean;
  /** Words a commentary quotes, underlined while its comment is pointed at (the comment-to-word link). */
  linked?: DibburMatch | null }) {
  const projection = useMemo(() => {
    if (colors) return colors.projection;
    const result = projectStudyVerse(verse.ref, verse.hebrew);
    return result.status === "ready" ? result.projection : null;
  }, [colors, verse.ref, verse.hebrew]);
  const Container = inline ? "span" : "p";
  const focusableWords = new Set<number>();
  // One Tab stop per verse: the word the reader last landed on, else the first. Arrows move among the others.
  const [stop, setStop] = useState<number | null>(null);
  let first: number | null = null;
  const parts = (pieces: readonly DisplayPart[]) => pieces.map((part, index) => {
    const word = part.wordIndex === null ? null : colors?.words[part.wordIndex];
    const family = word?.family ? families.get(word.family) : null;
    const active = part.wordIndex !== null && part.wordIndex === activeWord;
    const quoted = linked !== null && part.wordIndex !== null && part.wordIndex >= linked.first && part.wordIndex <= linked.last;
    const firstPart = part.wordIndex !== null && !focusableWords.has(part.wordIndex);
    if (part.wordIndex !== null) focusableWords.add(part.wordIndex);
    if (firstPart && first === null) first = part.wordIndex;
    const tabStop = stop !== null && projection && stop < projection.words.length ? stop : first;
    return <span key={index} role={onWordSelect && firstPart ? "button" : undefined} tabIndex={onWordSelect && firstPart ? part.wordIndex === tabStop ? 0 : -1 : undefined}
      aria-label={onWordSelect && firstPart ? wordAction === "card" ? `Open word ${part.wordIndex! + 1} of ${verse.ref}` : wordAction === "tools" ? `Select word ${part.wordIndex! + 1} of ${verse.ref} for tools` : wordAction === "phrase" ? `Focus phrase at word ${part.wordIndex! + 1} of ${verse.ref}` : wordAction === "verse" ? toolsAvailable ? `Hear whole verse ${verse.ref}; select word ${part.wordIndex! + 1} for tools` : `Hear whole verse ${verse.ref}` : `Hear word ${part.wordIndex! + 1} of ${verse.ref}` : undefined} data-word-index={part.wordIndex ?? undefined} data-family={family?.id} data-phrase={word?.phrase ?? undefined}
      data-reference-active={active ? "true" : undefined} data-linked={quoted ? "true" : undefined} className={[family ? styles.word : "", active ? referenceStyles.activeWord : "", quoted ? styles.linked : ""].filter(Boolean).join(" ") || undefined} style={family ? { "--phrase-color": family.color, "--w": part.wordIndex } as CSSProperties : undefined}
      aria-describedby={!family || word?.phrase === null || word?.phrase === undefined ? undefined : `${id}-phrase-${word.phrase}`}>{part.text}</span>;
  });
  const alternative = (written: string, read: ReactNode) => <><span>{written}</span><span className="study-read-alternative"> [<span className="study-qere-label" lang="en" dir="ltr">read / qere:</span> {read}]</span></>;
  // A paragraph break after the verse is apparatus: the note below names it.
  const trailing = (index: number, count: number, kind: string) => kind === "gap" && verse.hebrew.paragraphAfter !== null && index === count - 1;
  const gap = (kind: "petuchah" | "setumah") => <span className="study-paragraph-gap"><span className={inline ? "sr-only" : undefined} lang="en" dir="ltr">[{kind === "petuchah" ? "open paragraph" : "closed paragraph"}]</span></span>;
  const sign = <span role="img" aria-label="Inverted nun, Masoretic sign">׆</span>;
  return <Container className={`study-hebrew ${hebrewStyles.hebrew} ${inline ? styles.inlineHebrew : ""} ${onWordSelect ? styles.playable : ""} ${className}`.trim()} lang="he" dir="rtl" onKeyDown={onWordSelect ? event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-word-index][role="button"]') : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(target.dataset.wordIndex);
    if (event.key !== "Enter" && event.key !== " ") {
      // Roving focus, right to left in Hebrew order: ArrowLeft reads on, ArrowRight goes back.
      const words = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-word-index][role="button"]')], to = rovingTarget(words.indexOf(target), words.length, event.key);
      if (to === null || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); words[to]?.focus(); return;
    }
    if (projection && Number.isSafeInteger(index) && index >= 0 && index < projection.words.length) { event.preventDefault(); event.stopPropagation(); onWordSelect(index, target); }
  } : undefined} onFocus={onWordSelect ? event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-word-index][role="button"]') : null;
    const index = Number(target?.dataset.wordIndex); if (target && Number.isSafeInteger(index)) setStop(index);
  } : undefined} onClick={onWordSelect ? event => {
    if (window.getSelection()?.toString()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-word-index]") : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(target.dataset.wordIndex); if (Number.isSafeInteger(index) && index >= 0 && projection && index < projection.words.length) onWordSelect(index, event.currentTarget.querySelector<HTMLElement>(`[data-word-index="${index}"][role="button"]`) ?? target);
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
/** Scroll lettering for one verse: consonants only, in the STaM face, never interactive.
 *  Given the verse's projection, each written word carries its pointed word's phrase color (when colors
 *  are on) and the playing-word highlight; the letters are the same either way (tikkunPieces). */
export function TikkunVerse({ verse, className = "", projection = null, colors = null, activeWord = null, ...rest }: {
  verse: StudyVerse; className?: string; projection?: StudyProjection | null; colors?: Ready | null; activeWord?: number | null; "aria-hidden"?: boolean;
}) {
  const text = useMemo(() => projection ? null : tikkunText(verse.hebrew.text), [projection, verse.hebrew.text]);
  const signs = useMemo(() => tikkunSigns(verse.hebrew.segments), [verse.hebrew.segments]);
  const pieces = useMemo(() => projection ? tikkunPieces(projection.runs) : null, [projection]);
  // The scroll writes the inverted nuns (Numbers 10:35-36), so they stay; every other mark is gone.
  const sign = (key?: number) => <span key={key} role="img" aria-label="Inverted nun, Masoretic sign">{INVERTED_NUN}</span>;
  const words = pieces?.map((piece, index) => {
    if (piece.sign) return sign(index);
    if (piece.wordIndex === null) return piece.text;
    // A ketiv stands for every word of its qere, so it lights up while any of them plays.
    const word = colors?.words[piece.wordIndex], family = word?.family ? families.get(word.family) : null, active = activeWord !== null && piece.words.includes(activeWord);
    return <span key={index} data-tikkun-word={piece.wordIndex} data-family={family?.id} data-reference-active={active ? "true" : undefined}
      className={[family ? styles.word : "", active ? referenceStyles.activeWord : ""].filter(Boolean).join(" ") || undefined}
      style={family ? { "--phrase-color": family.color } as CSSProperties : undefined}>{piece.text}</span>;
  });
  return <span className={`${stamStyles.stam} ${className}`.trim()} lang="he" dir="rtl" data-tikkun-ref={verse.ref} {...rest}>
    {words ?? <>{signs.before && <>{sign()}{text && " "}</>}{text}{signs.after && <> {sign()}</>}</>}
  </span>;
}

function FlowVerse({ verse, assignment, id, onVerse, onWord, activeWord, toolsAvailable, listening, showEnglish, englishHidden, tikkun, linked }: {
  verse: StudyVerse; assignment: AssignmentEnding; id: string; onVerse?(): void; onWord?(index: number): void; activeWord: number | null; toolsAvailable: boolean; listening: boolean; showEnglish: boolean;
  englishHidden?: string; tikkun: TikkunView; linked: DibburMatch | null;
}) {
  // Daniel (2026-10-22): trope colors show on both texts whenever Colors is on, in every tikkun view.
  const prefs = useReadingPrefs(), replaced = tikkun === "only", result = useVerseColors(verse, assignment, prefs.colors), colors = result?.status === "ready" ? result : null;
  const projection = useMemo(() => {
    if (tikkun === "off") return null;
    if (colors) return colors.projection;
    const value = projectStudyVerse(verse.ref, verse.hebrew);
    return value.status === "ready" ? value.projection : null;
  }, [tikkun, colors, verse.ref, verse.hebrew]);
  const number = /:([1-9]\d*)$/.exec(verse.ref)?.[1];
  return <span data-verse-ref={verse.ref} className={styles.flowVerse}>
    <span className={styles.flowHebrew} data-hebrew-ref={verse.ref}>
    <span className="sr-only" role="heading" aria-level={4} dir="ltr">{verse.ref}</span>
    {onVerse ? <button type="button" className={styles.verseNumber} onClick={onVerse} aria-label={`Hear ${verse.ref}`} title={verse.ref}>{number ?? verse.ref}</button>
      : <sup title={verse.ref}>{number ?? verse.ref}</sup>}{" "}
    {replaced ? <TikkunVerse verse={verse} className={styles.flowTikkunInline} projection={projection} colors={colors} activeWord={activeWord} /> : <StudyHebrew verse={verse} colors={colors} id={id} inline activeWord={activeWord} onWordSelect={onWord} wordAction={listening ? "verse" : "tools"} toolsAvailable={toolsAvailable} linked={linked} />}{" "}
    {verse.hebrew.paragraphAfter === "setumah" && <span className={styles.closedGap} role="img" aria-label="Closed paragraph" />}
    {colors && <span className="sr-only">{phraseGroups(colors).map(row => <span key={row.phrase} id={`${id}-phrase-${row.phrase}`}>{row.family.label}, {range(row.first, row.last)}. </span>)}</span>}
    </span>
    {tikkun === "beside" && <TikkunVerse verse={verse} className={styles.flowTikkun} projection={projection} colors={colors} activeWord={activeWord} aria-hidden />}
    {showEnglish && (englishHidden ? <span className={`study-english ${styles.flowEnglish} ${styles.flowEnglishHidden}`} lang="en" dir="ltr" data-english-hidden={verse.ref}>{englishHidden}</span>
      : <span className={`study-english ${styles.flowEnglish}`} lang="en" dir="ltr" data-english-ref={verse.ref}>{verse.english ?? "English reference unavailable for this verse."}</span>)}
  </span>;
}
/** "beside" sets the tikkun in a column next to the pointed text on every screen width; "only" shows it instead. */
export function FlowingStudyText({ verses, assignment, group, sections = [], onVerse, onWord, activeWord, toolsAvailable = true, listening = true, showEnglish = false, englishHidden, tikkun = "off", linked = null }: {
  verses: StudyVerse[]; assignment: AssignmentEnding; group: string; sections?: readonly { index: number; label: string }[];
  onVerse?(index: number): void; onWord?(verse: number, word: number): void; activeWord: { verse: number; index: number } | null; toolsAvailable?: boolean; listening?: boolean; showEnglish?: boolean;
  /** Lein's translate drill: while set, each verse's English shows this placeholder instead. A view state only; the English preference is untouched. */
  englishHidden?: string;
  /** Torah only: the caller decides, so a haftarah never shows scroll lettering. */
  tikkun?: TikkunView;
  /** The verse (page index) and words a pointed-at comment quotes. */
  linked?: (DibburMatch & { verse: number }) | null;
}) {
  return <div className={`study-verses ${styles.flow}`} aria-label="Hebrew reading" tabIndex={-1} data-tikkun={tikkun === "off" ? undefined : tikkun}>
    {studyFlowGroups(verses, sections.map(section => section.index)).map(indices => <div key={verses[indices[0]].ref}>
      {sections.find(section => section.index === indices[0]) && <p className="student-aliyah">{sections.find(section => section.index === indices[0])!.label}</p>}
      <p className={styles.flowParagraph} lang="he" dir="rtl">{indices.map(index => <FlowVerse key={verses[index].ref} verse={verses[index]} assignment={assignment} id={`${group}-flow-${index}`} onVerse={onVerse ? () => onVerse(index) : undefined} onWord={onWord ? word => onWord(index, word) : undefined} activeWord={activeWord?.verse === index ? activeWord.index : null} toolsAvailable={toolsAvailable} listening={listening} showEnglish={showEnglish} englishHidden={englishHidden} tikkun={tikkun} linked={linked?.verse === index ? linked : null} />)}</p>
    </div>)}
  </div>;
}
