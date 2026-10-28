"use client";
import { Fragment, useContext, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { maqafChains } from "../../../../lib/hebrew/mixed-runs";
import { rovingTarget } from "./word-nav";
import { WordGroup, WordGroupContext, wordKey } from "./word-group";
import { colorStudyVerse, type AssignmentEnding, type ColorResult } from "../../../../lib/hebrew/study-annotations";
import { projectStudyVerse, type DisplayPart, type StudyProjection } from "../../../../lib/hebrew/study-tokens";
import { PHRASE_FAMILIES, phraseFill } from "../../../../lib/trope/chart-catalog";
import { INVERTED_NUN, tikkunPieces, tikkunSigns, tikkunText, type TikkunPiece } from "../../../../lib/hebrew/tikkun";
import { studyAtoms, type StudyAtom } from "../../../../lib/hebrew/tikkun-atoms";
import { useTikkunLayout, type TikkunLayout } from "./tikkun-layout";
import hebrewStyles from "../../../../styles/hebrew-font.module.css";
import stamStyles from "../../../../styles/stam-font.module.css";
import { useReadingPrefs, type TikkunView } from "../reading-prefs";
import type { StudyVerse } from "./api";
import { ChoiceCheck, verseState, type VerseChoiceView } from "./verse-choice";
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

/**
 * A maqaf joins words into one chanted unit, so the words and the maqafs between them are set in one no-break span and a line never
 * ends on a maqaf. A separator joins only when it is a maqaf with no space in it; the elements keep their own keys, roles and focus.
 */
function chained(pieces: readonly DisplayPart[], elements: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  let chain: ReactNode[] = [], last: "word" | "joiner" | null = null;
  const flush = () => { if (chain.length > 1) out.push(<span key={`chain-${out.length}`} className={styles.chain}>{chain}</span>); else out.push(...chain); chain = []; last = null; };
  pieces.forEach((piece, index) => {
    const kind = piece.wordIndex !== null ? "word" : piece.text.includes(MAQAF) && !/\s/u.test(piece.text) ? "joiner" : null;
    if (kind === null) { flush(); out.push(elements[index]); return; }
    if (kind === last) flush();
    chain.push(elements[index]); last = kind;
  });
  flush();
  return out;
}
const MAQAF = "\u05be";
/** The letters a Torah scroll writes for a paragraph break: pe for an open one (petuchah), samekh for a closed one (setumah). */
const PARAGRAPH_LETTER = { petuchah: "\u05e4", setumah: "\u05e1" } as const;

/** The first word of a passage that has one: the word the group's single Tab stop starts on (see word-group.tsx). Null when no verse here has a word. */
export function firstWordKey(verses: readonly StudyVerse[]): string | null {
  for (const verse of verses) { const result = projectStudyVerse(verse.ref, verse.hebrew); if (result.status === "ready" && result.projection.words.length > 0) return wordKey(verse.ref, 0); }
  return null;
}

/**
 * Copying Hebrew from the page: the hidden headings and phrase legends are for screen readers, so they never travel with the text.
 * Where verses run together (Lein), each verse in the selection copies as its number, a space, its Hebrew and a newline ("18:1 ...");
 * the number is left off a verse whose start is not in the selection. A selection with nothing hidden in it copies as it is.
 */
export function copyHebrew(event: ClipboardEvent<HTMLElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !event.clipboardData) return;
  const range = selection.getRangeAt(0), root = event.currentTarget;
  const strip = (fragment: DocumentFragment) => { for (const node of fragment.querySelectorAll(".sr-only, [data-copy-skip]")) node.remove(); return fragment; };
  const cells = [...root.querySelectorAll<HTMLElement>("[data-hebrew-ref]")].filter(cell => range.intersectsNode(cell));
  const mixed = [...root.querySelectorAll(".study-english")].some(node => range.intersectsNode(node));
  let text: string;
  if (cells.length && !mixed) {
    text = cells.map(cell => {
      // This verse's part of the selection, and whether it starts where the verse does.
      const part = document.createRange();
      part.selectNodeContents(cell);
      const whole = range.compareBoundaryPoints(Range.START_TO_START, part) <= 0;
      if (!whole) part.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
      const fragment = strip(part.cloneContents());
      for (const node of fragment.querySelectorAll("[data-verse-number]")) node.remove();
      const number = /([1-9]\d*:[1-9]\d*)$/.exec(cell.dataset.hebrewRef ?? "")?.[1];
      return `${whole && number ? `${number} ` : ""}${(fragment.textContent ?? "").replace(/\s+/gu, " ").trim()}\n`;
    }).join("");
  } else {
    const fragment = range.cloneContents();
    if (!fragment.querySelector(".sr-only, [data-copy-skip]")) return;
    text = strip(fragment).textContent ?? "";
  }
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
}

/** Phrase analysis runs only when colors are shown; word identity is independent. */
export function useVerseColors(verse: StudyVerse, assignment: AssignmentEnding, enabled: boolean) {
  const { kind, confirmed } = assignment, verses = assignment.verses.join("\n");
  return useMemo(() => enabled ? colorStudyVerse(verse.ref, verse.hebrew, { kind, confirmed, verses: verses ? verses.split("\n") : [] }) : null, [enabled, verse, kind, confirmed, verses]);
}

export function StudyHebrew({ verse, colors, id, className = "", activeWord = null, onWordSelect, inline = false, wordAction = "word", toolsAvailable = true, linked = null, atoms = null, layout = null }: { verse: StudyVerse; inline?: boolean; colors: Ready | null; id: string; className?: string; activeWord?: number | null;
  /** Side-by-side tikkun: the verse as aligned atoms, set in the rows `layout` gives (the same rows as the scroll column). */
  atoms?: readonly StudyAtom[] | null; layout?: TikkunLayout | null;
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
  // One Tab stop: inside a passage's WordGroup it is the whole passage's (the word the reader last landed on, else the passage's first word);
  // alone (the up-close verse) it is this verse's. Arrows move among the others.
  const group = useContext(WordGroupContext), [stop, setStop] = useState<number | null>(null);
  let first: number | null = null;
  // Each word is named by its Hebrew; what a tap does is its description, one line shared by the verse's words (the old label without the word's number and verse,
  // which the reader now has from the Hebrew word and the verse's own heading). Kept beside the verse, so the text stays clean and the page small.
  const actionId = `${id}-act`, action = wordAction === "card" ? "Open word" : wordAction === "tools" ? "Select word for tools" : wordAction === "phrase" ? "Focus phrase"
    : wordAction === "verse" ? toolsAvailable ? "Hear whole verse; select word for tools" : "Hear whole verse" : "Hear word";
  let described = false;
  // G18: the colour of a phrase is never the only sign of where it ends: its last word also carries a bar at its end (left) edge.
  const phraseEnds = useMemo(() => colors ? new Set(phraseGroups(colors).map(group => group.last - 1)) : null, [colors]);
  const parts = (pieces: readonly DisplayPart[]) => chained(pieces, pieces.map((part, index) => {
    const word = part.wordIndex === null ? null : colors?.words[part.wordIndex];
    const family = word?.family ? families.get(word.family) : null;
    const active = part.wordIndex !== null && part.wordIndex === activeWord;
    const quoted = linked !== null && part.wordIndex !== null && part.wordIndex >= linked.first && part.wordIndex <= linked.last;
    const firstPart = part.wordIndex !== null && !focusableWords.has(part.wordIndex);
    if (part.wordIndex !== null) focusableWords.add(part.wordIndex);
    if (firstPart && first === null) first = part.wordIndex;
    const button = Boolean(onWordSelect && firstPart), localStop = stop !== null && projection && stop < projection.words.length ? stop : first;
    const tabStop = button && (group ? (group.stop ?? group.first) === wordKey(verse.ref, part.wordIndex!) : part.wordIndex === localStop);
    const phraseId = !family || word?.phrase === null || word?.phrase === undefined ? undefined : `${id}-phrase-${word.phrase}`;
    if (button) described = true;
    return <span key={index} role={button ? "button" : undefined} tabIndex={button ? tabStop ? 0 : -1 : undefined}
      data-word-index={part.wordIndex ?? undefined} data-family={family?.id} data-phrase={word?.phrase ?? undefined}
      data-phrase-end={family && part.wordIndex !== null && phraseEnds?.has(part.wordIndex) ? "" : undefined} data-reference-active={active ? "true" : undefined} data-linked={quoted ? "true" : undefined} className={[family ? styles.word : "", active ? referenceStyles.activeWord : "", quoted ? styles.linked : ""].filter(Boolean).join(" ") || undefined} style={family ? { "--phrase-color": phraseFill(family.id), "--w": part.wordIndex } as CSSProperties : undefined}
      aria-describedby={[button ? actionId : undefined, phraseId].filter(Boolean).join(" ") || undefined}>{part.text}</span>;
  }));
  // G18: the qere is what is chanted, so it is set full size (and is the tap target); the chip says so, and the ketiv, which the scroll writes, follows small.
  const alternative = (written: string, read: ReactNode) => <><span className="study-read-alternative">{read}</span> <span className="study-read-chip" lang="en" dir="ltr" data-copy-skip="">read<span className="sr-only">. Chant this word (qere). The scroll writes it differently (ketiv).</span></span> <span className="study-ketiv" data-testid="study-ketiv">{maqafChains(written).map((run, at) => run.chain ? <span key={at} className={styles.chain}>{run.text}</span> : run.text)}</span></>;
  // A paragraph break after the verse is apparatus: the note below names it.
  const trailing = (index: number, count: number, kind: string) => kind === "gap" && verse.hebrew.paragraphAfter !== null && index === count - 1;
  const gap = (kind: "petuchah" | "setumah") => <span className="study-paragraph-gap"><span className="study-paragraph-mark" lang="he" aria-hidden="true" data-copy-skip="">{PARAGRAPH_LETTER[kind]}</span><span className="sr-only" lang="en" dir="ltr">[{kind === "petuchah" ? "open paragraph" : "closed paragraph"}]</span></span>;
  const sign = <span role="img" aria-label="Inverted nun, Masoretic sign">׆</span>;
  const container = <Container data-testid="study-hebrew" className={`study-hebrew ${hebrewStyles.reading} ${inline ? styles.inlineHebrew : ""} ${onWordSelect ? styles.playable : ""} ${className}`.trim()} lang="he" dir="rtl" onKeyDown={onWordSelect ? event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-word-index][role="button"]') : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(target.dataset.wordIndex);
    if (event.key !== "Enter" && event.key !== " ") {
      // Roving focus, right to left in Hebrew order: ArrowLeft reads on, ArrowRight goes back, across every verse of the passage; Home and End stay in this verse.
      const scoped = event.key === "Home" || event.key === "End" ? event.currentTarget : target.closest("[data-word-group]") ?? event.currentTarget;
      const words = [...scoped.querySelectorAll<HTMLElement>('[data-word-index][role="button"]')], to = rovingTarget(words.indexOf(target), words.length, event.key);
      if (to === null || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); words[to]?.focus(); return;
    }
    if (projection && Number.isSafeInteger(index) && index >= 0 && index < projection.words.length) { event.preventDefault(); event.stopPropagation(); onWordSelect(index, target); }
  } : undefined} onFocus={onWordSelect ? event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-word-index][role="button"]') : null;
    const index = Number(target?.dataset.wordIndex); if (target && Number.isSafeInteger(index)) { if (group) group.setStop(wordKey(verse.ref, index)); else setStop(index); }
  } : undefined} onClick={onWordSelect ? event => {
    if (window.getSelection()?.toString()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-word-index]") : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(target.dataset.wordIndex); if (Number.isSafeInteger(index) && index >= 0 && projection && index < projection.words.length) onWordSelect(index, event.currentTarget.querySelector<HTMLElement>(`[data-word-index="${index}"][role="button"]`) ?? target);
  } : undefined} {...(atoms && projection ? { "data-tk-side": "pointed" } : {})}>{atoms && projection ? (layout?.rows ?? [[0, atoms.length] as const]).map(([from, to], line) =>
    <span key={line} className={`${styles.tkLine} ${layout?.rows ? "" : styles.tkLineOpen}`.trim()} data-tk-line={line}>{atoms.slice(from, to).map((atom, offset) => {
      const gapRun = (at: number) => { const run = projection.runs[at]; return run.kind === "gap" && !trailing(at, projection.runs.length, run.kind) ? <span key={`gap-${at}`}>{gap(run.break)}</span> : null; };
      return <Fragment key={from + offset}><span className={styles.tkAtom} data-tk-atom={from + offset} data-joined={atom.joined ? "" : undefined}>
        {atom.before.map(gapRun)}
        {atom.kind === "alternative" && atom.run ? <span className="study-alternative">{alternative(atom.run.written, parts(atom.run.read))}</span> : atom.kind === "sign" ? sign : null}
        {atom.parts.length ? parts(atom.parts) : null}
        {atom.after.map(gapRun)}
      </span>{from + offset < atoms.length - 1 && !atoms[from + offset + 1].joined && " "}</Fragment>;
    })}</span>)
    : projection ? projection.runs.map((run, index) => run.kind === "text" ? <span key={run.segment}>{parts(run.parts)}</span>
    : run.kind === "alternative" ? <span className="study-alternative" key={run.segment}>{alternative(run.written, parts(run.read))}</span>
      : run.kind === "gap" && trailing(index, projection.runs.length, run.kind) ? null : <span key={run.segment}>{run.kind === "gap" ? gap(run.break) : sign}</span>)
    : verse.hebrew.segments.map((segment, index) => segment.kind === "text" ? <span key={index}>{segment.text}</span>
      : segment.kind === "alternative" ? <span className="study-alternative" key={index}>{alternative(segment.written, segment.read)}</span>
        : segment.kind === "gap" && trailing(index, verse.hebrew.segments.length, segment.kind) ? null : <span key={index}>{segment.kind === "gap" ? gap(segment.break) : sign}</span>)}</Container>;
  return <>{container}{described && <span hidden id={actionId} className="sr-only" lang="en" dir="ltr">{action}</span>}</>;
}

/** Masoretic apparatus sits under the line, never inside it. */
export function Apparatus({ verse, learner = false }: { verse: StudyVerse; learner?: boolean }) {
  const alternative = verse.hebrew.segments.some(segment => segment.kind === "alternative");
  if (!alternative && !verse.hebrew.paragraphAfter) return null;
  return <div className="study-apparatus">
    {alternative && <p className="field-help">Chant this word (qere). The scroll writes it differently (ketiv).</p>}
    {verse.hebrew.paragraphAfter && <p className="study-paragraph-note" data-testid="paragraph-note" data-paragraph={verse.hebrew.paragraphAfter}>{verse.hebrew.paragraphAfter === "petuchah" ? "Open paragraph (petuchah) after this verse." : "Closed paragraph (setumah) after this verse."}</p>}
  </div>;
}

export function PhraseLegend({ colors, id, verseRef }: { colors: ColorResult | null; id: string; verseRef: string }) {
  if (!colors) return null;
  if (colors.status !== "ready") return <p role="status" className="field-help">{unavailableText(colors)}</p>;
  return <ol className={styles.legend} aria-label={`Phrase families for ${verseRef}`}>{phraseGroups(colors).map(({ phrase, family, first, last }) => <li id={`${id}-phrase-${phrase}`} key={phrase} style={{ "--phrase-color": phraseFill(family.id) } as CSSProperties}>
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
  return <article data-verse-ref={verse.ref} className={`verse-card${onLift ? " verse-card-liftable" : ""}`} onClick={lift} onCopy={copyHebrew}>
    <div className="verse-card-head">
      {number !== undefined && <span className="verse-number" aria-hidden="true">{number}</span>}
      <h4><bdi dir="ltr">{verse.ref}</bdi></h4>
      {mark}
      {onLift && <button type="button" className="verse-lift" onClick={onLift} aria-label={`Practice ${verse.ref} up close`}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>}
    </div>
    <StudyHebrew verse={verse} colors={colors} id={id} />
    {colors && <div className="sr-only" lang="en" dir="ltr"><PhraseLegend colors={colors} id={id} verseRef={verse.ref} /></div>}
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
export function TikkunVerse({ verse, className = "", projection = null, colors = null, activeWord = null, atoms = null, layout = null, ...rest }: {
  verse: StudyVerse; className?: string; projection?: StudyProjection | null; colors?: Ready | null; activeWord?: number | null; "aria-hidden"?: boolean;
  /** Side-by-side tikkun: the verse as aligned atoms, set in the rows `layout` gives (the same rows as the pointed column). */
  atoms?: readonly StudyAtom[] | null; layout?: TikkunLayout | null;
}) {
  const text = useMemo(() => projection ? null : tikkunText(verse.hebrew.text), [projection, verse.hebrew.text]);
  const signs = useMemo(() => tikkunSigns(verse.hebrew.segments), [verse.hebrew.segments]);
  const pieces = useMemo(() => projection ? tikkunPieces(projection.runs) : null, [projection]);
  const phraseEnds = useMemo(() => colors ? new Set(phraseGroups(colors).map(group => group.last - 1)) : new Set<number>(), [colors]);
  // The scroll writes the inverted nuns (Numbers 10:35-36), so they stay; every other mark is gone.
  const sign = (key?: number) => <span key={key} role="img" aria-label="Inverted nun, Masoretic sign">{INVERTED_NUN}</span>;
  const render = (piece: TikkunPiece, index: number) => {
    if (piece.sign) return sign(index);
    if (piece.wordIndex === null) return piece.text;
    // A ketiv stands for every word of its qere, so it lights up while any of them plays.
    const word = colors?.words[piece.wordIndex], family = word?.family ? families.get(word.family) : null, active = activeWord !== null && piece.words.includes(activeWord);
    return <span key={index} data-tikkun-word={piece.wordIndex} data-family={family?.id} data-phrase-end={family && piece.wordIndex !== null && phraseEnds.has(piece.wordIndex) ? "" : undefined} data-reference-active={active ? "true" : undefined}
      className={[family ? styles.word : "", active ? referenceStyles.activeWord : ""].filter(Boolean).join(" ") || undefined}
      style={family ? { "--phrase-color": phraseFill(family.id) } as CSSProperties : undefined}>{piece.text}</span>;
  };
  const words = pieces?.map(render);
  if (atoms && projection) return <span className={`${stamStyles.stam} ${className}`.trim()} lang="he" dir="rtl" data-tikkun-ref={verse.ref} data-tk-side="tikkun" {...rest}>
    {(layout?.rows ?? [[0, atoms.length] as const]).map(([from, to], line) => <span key={line} className={`${styles.tkLine} ${layout?.rows ? "" : styles.tkLineOpen}`.trim()} data-tk-line={line}>
      {atoms.slice(from, to).map((atom, offset) => <Fragment key={from + offset}><span className={styles.tkAtom} data-tk-atom={from + offset}>{atom.tikkun.map(render)}</span>{from + offset < atoms.length - 1 && " "}</Fragment>)}
    </span>)}
  </span>;
  return <span className={`${stamStyles.stam} ${className}`.trim()} lang="he" dir="rtl" data-tikkun-ref={verse.ref} {...rest}>
    {words ?? <>{signs.before && <>{sign()}{text && " "}</>}{text}{signs.after && <> {sign()}</>}</>}
  </span>;
}

function FlowVerse({ verse, assignment, id, onVerse, onNumber, gotIt = false, onWord, activeWord, toolsAvailable, listening, showEnglish, englishHidden, tikkun, linked, choice }: {
  verse: StudyVerse; assignment: AssignmentEnding; id: string; onVerse?(): void; onNumber?(opener: HTMLElement): void; gotIt?: boolean; onWord?(index: number): void; activeWord: number | null; toolsAvailable: boolean; listening: boolean; showEnglish: boolean;
  englishHidden?: string; tikkun: TikkunView; linked: DibburMatch | null; choice?: VerseChoiceView;
}) {
  const state = verseState(choice, verse.ref);
  // Daniel (2026-10-22): trope colors show on both texts whenever Colors is on, in every tikkun view.
  const prefs = useReadingPrefs(), replaced = tikkun === "only", result = useVerseColors(verse, assignment, prefs.colors), colors = result?.status === "ready" ? result : null;
  const projection = useMemo(() => {
    if (tikkun === "off") return null;
    if (colors) return colors.projection;
    const value = projectStudyVerse(verse.ref, verse.hebrew);
    return value.status === "ready" ? value.projection : null;
  }, [tikkun, colors, verse.ref, verse.hebrew]);
  const number = /:([1-9]\d*)$/.exec(verse.ref)?.[1];
  // Side by side, both columns are set from one list of lines, so a row holds the same words on each side (a printed tikkun).
  const host = useRef<HTMLSpanElement>(null), atoms = useMemo(() => tikkun === "beside" && projection ? studyAtoms(projection.runs) : null, [tikkun, projection]);
  const layout = useTikkunLayout(host, atoms, `${prefs.size}|${prefs.colors}`);
  const aligned = atoms !== null && atoms.length > 0;
  return <span ref={host} data-verse-ref={verse.ref} data-tk-rows={aligned ? "" : undefined} className={styles.flowVerse} data-verse-picked={state.picked || undefined} data-verse-marked={state.marked || undefined}>
    <span className={styles.flowHebrew} data-hebrew-ref={verse.ref}>
    <span className="sr-only" role="heading" aria-level={4} lang="en" dir="ltr">{verse.ref}</span>
    {state.choosing && choice ? <button type="button" className={`${styles.verseNumber} ${styles.chooseNumber}`} onClick={event => choice.onToggle(verse.ref, event.shiftKey)} aria-pressed={state.picked} aria-label={`Select ${verse.ref}`} lang="en" dir="ltr" data-verse-number title={verse.ref}>{state.picked && <ChoiceCheck />}{number ?? verse.ref}</button>
      : onNumber ? <><button type="button" className={styles.verseNumber} onClick={event => onNumber(event.currentTarget)} aria-haspopup="dialog" aria-label={`Verse tools · ${verse.ref}`} lang="en" dir="ltr" data-verse-number data-verse-got-it={gotIt || undefined} title={verse.ref}>{gotIt && <span className={styles.gotIt} data-testid="verse-got-it" aria-hidden="true"><ChoiceCheck /></span>}{number ?? verse.ref}</button>{gotIt && <span className="sr-only" lang="en" dir="ltr"> (Got it)</span>}</>
      : onVerse ? <button type="button" className={styles.verseNumber} onClick={onVerse} aria-label={`Hear ${verse.ref}`} lang="en" dir="ltr" data-verse-number title={verse.ref}>{state.marked && <ChoiceCheck />}{number ?? verse.ref}</button>
        : <sup title={verse.ref} lang="en" dir="ltr" data-verse-number>{state.marked && <ChoiceCheck />}{number ?? verse.ref}</sup>}{state.marked && <span className="sr-only" lang="en" dir="ltr"> (selected)</span>}{aligned ? " " : "\u00a0"}
    {replaced ? <TikkunVerse verse={verse} className={styles.flowTikkunInline} projection={projection} colors={colors} activeWord={activeWord} /> : <StudyHebrew verse={verse} colors={colors} id={id} inline activeWord={activeWord} onWordSelect={state.choosing ? undefined : onWord} wordAction={listening ? "verse" : "tools"} toolsAvailable={toolsAvailable} linked={linked} atoms={aligned ? atoms : null} layout={layout} />}{" "}
    {verse.hebrew.paragraphAfter && <span className={verse.hebrew.paragraphAfter === "setumah" ? styles.closedGap : styles.openMark} role="img" aria-label={verse.hebrew.paragraphAfter === "setumah" ? "Closed paragraph" : "Open paragraph"}><span className="study-paragraph-mark" lang="he" aria-hidden="true" data-copy-skip="">{PARAGRAPH_LETTER[verse.hebrew.paragraphAfter]}</span></span>}
    {colors && <span className="sr-only" lang="en" dir="ltr">{phraseGroups(colors).map(row => <span key={row.phrase} id={`${id}-phrase-${row.phrase}`}>{row.family.label}, {range(row.first, row.last)}. </span>)}</span>}
    </span>
    {tikkun === "beside" && <TikkunVerse verse={verse} className={styles.flowTikkun} projection={projection} colors={colors} activeWord={activeWord} atoms={aligned ? atoms : null} layout={layout} aria-hidden />}
    {showEnglish && (englishHidden ? <span className={`study-english ${styles.flowEnglish} ${styles.flowEnglishHidden}`} lang="en" dir="ltr" data-english-hidden={verse.ref}>{englishHidden}</span>
      : <span className={`study-english ${styles.flowEnglish}`} lang="en" dir="ltr" data-english-ref={verse.ref} data-english-available={verse.english ? "true" : "false"}>{verse.english ?? "English reference unavailable for this verse."}</span>)}
  </span>;
}
/** "beside" sets the tikkun in a column next to the pointed text on every screen width; "only" shows it instead. */
export function FlowingStudyText({ verses, assignment, group, sections = [], onVerse, onNumber, gotIt, onWord, activeWord, toolsAvailable = true, listening = true, showEnglish = false, englishHidden, tikkun = "off", linked = null, choice }: {
  verses: StudyVerse[]; assignment: AssignmentEnding; group: string; sections?: readonly { index: number; label: string }[];
  onVerse?(index: number): void;
  /** A learner's verse number opens that verse's sheet (its mark, Up close and tools) instead of playing it; `gotIt` puts a small check beside the number. */
  onNumber?(index: number, opener: HTMLElement): void; gotIt?(ref: string): boolean;
  onWord?(verse: number, word: number): void; activeWord: { verse: number; index: number } | null; toolsAvailable?: boolean; listening?: boolean; showEnglish?: boolean;
  /** Lein's translate drill: while set, each verse's English shows this placeholder instead. A view state only; the English preference is untouched. */
  englishHidden?: string;
  /** Torah only: the caller decides, so a haftarah never shows scroll lettering. */
  tikkun?: TikkunView;
  /** The verse (page index) and words a pointed-at comment quotes. */
  linked?: (DibburMatch & { verse: number }) | null;
  /** "Choose verses": while choosing, verse numbers toggle the selection and words are not interactive. */
  choice?: VerseChoiceView;
}) {
  const first = useMemo(() => firstWordKey(verses), [verses]);
  return <WordGroup scope={`${verses[0]?.ref}|${verses.length}`} first={first} data-testid="study-verses" className={`study-verses ${styles.flow}`} aria-label="Hebrew reading" tabIndex={-1} data-tikkun={tikkun === "off" ? undefined : tikkun} onCopy={copyHebrew}>
    {studyFlowGroups(verses, sections.map(section => section.index)).map(indices => <div key={verses[indices[0]].ref}>
      {sections.find(section => section.index === indices[0]) && <p className="student-aliyah" data-testid="student-aliyah">{sections.find(section => section.index === indices[0])!.label}</p>}
      <p className={styles.flowParagraph} lang="he" dir="rtl">{indices.map(index => <FlowVerse key={verses[index].ref} verse={verses[index]} assignment={assignment} id={`${group}-flow-${index}`} onVerse={onVerse ? () => onVerse(index) : undefined} onNumber={onNumber ? opener => onNumber(index, opener) : undefined} gotIt={gotIt?.(verses[index].ref)} onWord={onWord ? word => onWord(index, word) : undefined} activeWord={activeWord?.verse === index ? activeWord.index : null} toolsAvailable={toolsAvailable} listening={listening} showEnglish={showEnglish} englishHidden={englishHidden} tikkun={tikkun} linked={linked?.verse === index ? linked : null} choice={choice} />)}</p>
    </div>)}
  </WordGroup>;
}
