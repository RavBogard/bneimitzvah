"use client";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Lesson } from "../../../lib/service-course/course";
import { COPY, fill } from "../../../lib/service-course/copy";
import { hebrewWords, plainWord, type ServiceText, type TextLine } from "../../../lib/service-course/text";
import { answerCheck, buildCheck, checkDone, currentCheck, resolveKeyWords, seeded, startCheck, type CheckItem, type CheckRun, type ResolvedKeyWord } from "../../../lib/service-course/check";
import type { WordCardTarget } from "../../../lib/learn/word-tap";
import { PortalRequestError } from "../../portal/api";
import { RATE_LIMITED_MESSAGE } from "../../portal/public-reading/rate-limited";
import { useWordCard } from "../word-card";
import { isDone } from "../../../lib/service-course/progress";
import { useServiceProgress } from "./progress";
import { fetchServiceText, fetchVerse, verseTargets } from "./text-api";
import { icons, LessonSiddurLink } from "./bits";
import learn from "../learn.module.css";
import styles from "./service.module.css";

/**
 * Read it, Key words and Check (2.0 SC2, A4 3, 7, 8.2; A8). The text is the congregation's pinned public build, fetched once per
 * lesson from /api/public/service-text; nothing here holds or caches prayer text beyond the page. A line that is a Bible verse opens
 * the real word card for that verse when its words are found in it; any other key word opens a small glossary card.
 */
export type TextState = Readonly<{ status: "loading" } | { status: "ready"; text: ServiceText } | { status: "error"; rateLimited: boolean }>;
export function useLessonText(lesson: Lesson): { state: TextState; retry(): void } {
  const [state, setState] = useState<TextState>({ status: "loading" }), [attempt, setAttempt] = useState(0);
  const unit = lesson.read?.unit;
  useEffect(() => {
    if (!unit) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchServiceText(unit, controller.signal).then(
      text => { if (!controller.signal.aborted) setState({ status: "ready", text }); },
      error => { if (!controller.signal.aborted) setState({ status: "error", rateLimited: error instanceof PortalRequestError && error.status === 429 }); });
    return () => controller.abort();
  }, [unit, attempt]);
  return { state, retry: useCallback(() => setAttempt(n => n + 1), []) };
}

/** Where a tapped word goes: the verse's own card, or the glossary card for a key word. */
type Opener = (line: number, word: number, trigger: HTMLElement) => void;
type Words = Readonly<{ open: Opener; tappable(line: number, word: number): boolean; full(line: number, word: number): boolean }>;
const WordsContext = createContext<Words | null>(null);
type Gloss = Readonly<{ key: ResolvedKeyWord; line: TextLine; trigger: HTMLElement }>;

/** Inside Learn's WordCardScope: resolves the lesson's verse once, then routes each tap. */
export function LessonWords({ lesson, text, children }: { lesson: Lesson; text: ServiceText | null; children: ReactNode }) {
  const openCard = useWordCard(), ref = lesson.read?.torahRef;
  const [targets, setTargets] = useState<((word: number) => WordCardTarget | null) | null>(null);
  const [gloss, setGloss] = useState<Gloss | null>(null);
  useEffect(() => {
    if (!ref || !text || !text.lines[ref.block]) return;
    const controller = new AbortController();
    // A verse that does not load, or whose words are not found in the line, leaves the line on its glossary cards.
    fetchVerse(ref, controller.signal).then(verse => { if (!controller.signal.aborted) setTargets(() => verseTargets(verse, text.lines[ref.block].he, ref)); }, () => {});
    return () => controller.abort();
  }, [ref, text]);
  const keys = useMemo(() => text ? resolveKeyWords(lesson, text) : [], [lesson, text]);
  const value = useMemo<Words>(() => {
    const target = (line: number, word: number) => ref && targets && line === ref.block ? targets(word) : null;
    const key = (line: number, word: number) => keys.find(row => row.line === line && row.word === word) ?? null;
    return {
      full: (line, word) => !!openCard && !!target(line, word),
      tappable: (line, word) => (!!openCard && !!target(line, word)) || !!key(line, word),
      open(line, word, trigger) {
        const card = target(line, word), row = key(line, word);
        if (card && openCard) openCard(card, trigger);
        else if (row && text) setGloss({ key: row, line: text.lines[line], trigger });
      },
    };
  }, [ref, targets, keys, openCard, text]);
  return <WordsContext.Provider value={value}>{children}{gloss && <GlossCard gloss={gloss} onClose={() => { const back = gloss.trigger; setGloss(null); if (back.isConnected) back.focus({ preventScroll: true }); }} />}</WordsContext.Provider>;
}

/** One line of Hebrew as printed, its words counted the course's way; key words and verse words are buttons. */
export function HebrewLine({ he, line, large = true, mark }: { he: string; line: number; large?: boolean; mark?: number }) {
  const words = useContext(WordsContext);
  let index = 0;
  const parts = he.split(/(\s+)/).flatMap((chunk, c) => /^\s+$/.test(chunk) ? [<span key={`s${c}`}>{chunk}</span>] : chunk.split(/(?<=\u05BE)/).map((piece, p) => {
    if (!/[\u05D0-\u05EA]/.test(piece)) return <span key={`${c}.${p}`}>{piece}</span>;
    const word = index++;
    if (mark === word) return <mark key={`${c}.${p}`} className={learn.cardMark}>{piece}</mark>;
    return words && mark === undefined && words.tappable(line, word)
      ? <button key={`${c}.${p}`} type="button" className={styles.word} data-word-card="" data-line={line} data-word={word} onClick={event => words.open(line, word, event.currentTarget)}>{piece}</button>
      : <span key={`${c}.${p}`}>{piece}</span>;
  }));
  return <p className={`${learn.hebrew} ${large ? styles.lineHe : styles.lineHeSmall}`} lang="he" dir="rtl">{parts}</p>;
}

function TextProblem({ state, onRetry }: { state: TextState; onRetry(): void }) {
  if (state.status === "loading") return <p role="status" className={styles.note}>{COPY.state.lessonLoading}</p>;
  if (state.status !== "error") return null;
  return <div role="alert" className={learn.state}><p>{state.rateLimited ? RATE_LIMITED_MESSAGE : COPY.state.textError}</p>
    <button type="button" className="button-secondary" onClick={onRetry}>{COPY.state.retry}</button></div>;
}

/** Step 3: the lines, right to left, with transliteration and English on request (Batch 2 Q8), the credit and the siddur link. */
export function ReadStep({ lesson, state, onRetry }: { lesson: Lesson; state: TextState; onRetry(): void }) {
  const [tr, setTr] = useState(false), [en, setEn] = useState(false);
  const { progress } = useServiceProgress(), letters = !progress || isDone(progress, "f1");
  const words = useContext(WordsContext), read = lesson.read!;
  const text = state.status === "ready" ? state.text : null;
  const lines = text ? text.lines.slice(read.blocks[0], read.blocks[1] + 1) : [];
  const anyCard = !!text && lines.some((line, i) => hebrewWords(line.he).some((_, w) => words?.tappable(read.blocks[0] + i, w)));
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.read}</h1>
    {!text ? <TextProblem state={state} onRetry={onRetry} /> : <>
      <p>{anyCard ? COPY.read.instruction : COPY.read.instructionNoCard}</p>
      <div className={styles.toggles}>
        {lines.some(line => line.tr) && <button type="button" className={styles.toggle} aria-pressed={tr} onClick={() => setTr(on => !on)}>{tr ? COPY.read.translitHide : COPY.read.translitShow}</button>}
        {lines.some(line => line.en) && <button type="button" className={styles.toggle} aria-pressed={en} onClick={() => setEn(on => !on)}>{en ? COPY.read.englishHide : COPY.read.englishShow}</button>}
      </div>
      <ol className={styles.lines}>{lines.map((line, i) => <li key={i} className={styles.line}>
        <HebrewLine he={line.he} line={read.blocks[0] + i} />
        {tr && line.tr && <p className={styles.lineTr}>{line.tr}</p>}
        {en && line.en && <p className={styles.lineEn} lang="en">{line.en}</p>}
      </li>)}</ol>
      <p className={styles.credit}>{fill(COPY.read.credit, { volume: text.credit.title, licence: text.credit.licence })}</p>
    </>}
    <p className={styles.note}>{COPY.read.siddurNote}</p>
    <LessonSiddurLink lessonId={lesson.id} />
    {!letters && <p className={styles.note}><a href="/learn/service/f1">{COPY.read.newToHebrew}</a></p>}
  </>;
}

/** Step 4: three to six words, each with the volume's own transliteration and the course's gloss; tap for the card. */
export function KeyWordsStep({ lesson, text }: { lesson: Lesson; text: ServiceText }) {
  const words = useContext(WordsContext), keys = useMemo(() => resolveKeyWords(lesson, text), [lesson, text]);
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.words}</h1>
    <p>{COPY.words.instruction}</p>
    <ul className={styles.keyWords}>{keys.map(key => <li key={`${key.line}:${key.word}`}>
      <button type="button" className={styles.keyWord} data-word-card="" onClick={event => words?.open(key.line, key.word, event.currentTarget)}>
        <span className={`${learn.hebrew} ${styles.keyHe}`} lang="he" dir="rtl">{key.he}</span>
        {key.translit && <span className={styles.keyTr}>{key.translit}</span>}
        <span className={styles.keyGloss}>{key.gloss}</span>
        {words?.full(key.line, key.word) && <span className={styles.keyMore}>{COPY.words.more}</span>}
      </button>
    </li>)}</ul>
  </>;
}

/** The card for a key word on a line that is not a verse (A4 7, W7): the word, its gloss, its root and the line it is in. */
function GlossCard({ gloss, onClose }: { gloss: Gloss; onClose(): void }) {
  const id = useId(), heading = useRef<HTMLHeadingElement>(null), panel = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close.current(); } };
    const down = (event: PointerEvent) => { const node = event.target as Node | null; if (node && !panel.current?.contains(node) && !gloss.trigger.contains(node)) close.current(); };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", down);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", down); };
  }, [gloss.trigger]);
  if (typeof document === "undefined") return null;
  const { key, line } = gloss;
  return createPortal(<>
    <div className={learn.cardScrim} aria-hidden="true" />
    <div ref={panel} role="dialog" aria-modal="false" aria-labelledby={`${id}-heading`} className={learn.card} data-layout="sheet" data-gloss-card="">
      <button type="button" className={learn.cardClose} aria-label="Close" onClick={() => close.current()}>{icons.close}</button>
      <div className={styles.glossBody}>
        <h2 id={`${id}-heading`} ref={heading} tabIndex={-1} className={`${learn.hebrew} ${styles.glossWord}`} lang="he" dir="rtl">{plainWord(key.he)}</h2>
        {key.translit && <p className={styles.glossTr}>{key.translit}</p>}
        <p className={styles.glossMeaning}>{key.gloss}</p>
        {/* TODO(SC2 string gap): the root has no approved label in A7; it shows as the bare root until Daniel approves one. */}
        {key.root && <p className={styles.glossRoot}>{key.root}</p>}
        <HebrewLine he={line.he} line={key.line} large={false} mark={key.word} />
      </div>
    </div>
  </>, document.body);
}

/** Step 5: a few reading and meaning items from the words on screen. Nothing is counted; a miss comes back later. */
export function CheckStep({ items, seed, onFinish, footer }: { items: readonly CheckItem[]; seed: number; onFinish(): void; footer(children: ReactNode): ReactNode }) {
  const rng = useMemo(() => seeded(seed ^ 0x5bd1e995), [seed]);
  const [run, setRun] = useState<CheckRun>(() => startCheck(items));
  const [answer, setAnswer] = useState<{ choice: number; right: boolean } | null>(null);
  const item = currentCheck(run);
  if (!item) return null;
  const rightIndex = item.kind === "what-means" ? item.choices.indexOf(item.target.gloss) : (item.choices as readonly { line: number; word: number }[]).findIndex(choice => choice.line === item.target.line && choice.word === item.target.word);
  const prompt = item.kind === "says" ? fill(COPY.check.whichSays, { translit: item.target.translit ?? "" }) : item.kind === "means-word" ? fill(COPY.check.whichMeans, { gloss: item.target.gloss }) : COPY.check.whatMeans;
  const choose = (choice: number) => { if (!answer) setAnswer({ choice, right: choice === rightIndex }); };
  const next = () => {
    if (!answer) return;
    const after = answerCheck(run, answer.right, rng);
    setAnswer(null);
    if (checkDone(after)) onFinish(); else setRun(after);
  };
  const said = (choice: number): string => {
    if (item.kind === "says") { const word = item.choices[choice]; return answer?.right ? fill(COPY.check.right, { word: word.he, translit: word.translit ?? "" }) : fill(COPY.check.miss, { translit: word.translit ?? "" }); }
    if (item.kind === "means-word") { const word = item.choices[choice]; return answer?.right ? fill(COPY.check.rightMeaning, { word: word.he, gloss: word.gloss }) : fill(COPY.check.missMeaning, { gloss: word.gloss }); }
    return answer?.right ? fill(COPY.check.rightMeaning, { word: item.target.he, gloss: item.target.gloss }) : fill(COPY.check.missMeaning, { gloss: item.choices[choice] });
  };
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.check}</h1>
    {run.at === 0 && !answer && <p>{COPY.check.instruction}</p>}
    <p className={learn.prompt} data-check-kind={item.kind}>{prompt}</p>
    {item.kind === "what-means" && <p className={`${learn.hebrew} ${styles.checkWord}`} lang="he" dir="rtl">{item.target.he}</p>}
    <ul className={`${learn.choices} ${styles.checkChoices}`}>{item.choices.map((choice, i) => {
      const state = !answer ? undefined : i === rightIndex ? "right" : i === answer.choice ? "chosen" : "other";
      return <li key={i}><button type="button" className={learn.choice} disabled={!!answer} data-state={state} onClick={() => choose(i)}>
        {typeof choice === "string" ? <span>{choice}</span> : <span className={`${learn.hebrew} ${styles.choiceHe}`} lang="he" dir="rtl">{choice.he}</span>}
        {state === "right" && <span className={learn.choiceMark}>{icons.check}</span>}
      </button></li>;
    })}</ul>
    <div className={learn.feedback} aria-live="polite">{answer && <><p>{said(answer.choice)}</p>{!answer.right && (run.misses.get(item.key) ?? 0) < 2 && <p>{COPY.check.again}</p>}</>}</div>
    {footer(<button type="button" className="button-start" disabled={!answer} onClick={next}>{COPY.frame.next}</button>)}
  </>;
}
/** The Check's items for a lesson and its text, fixed for the lesson visit by its seed. */
export function useCheckItems(lesson: Lesson, text: ServiceText | null, seed: number): readonly CheckItem[] | null {
  return useMemo(() => text ? buildCheck(lesson, text, seeded(seed)) : null, [lesson, text, seed]);
}

