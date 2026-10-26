"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CRC_TENANT, SERVICE_COURSE, lessonById, presentGoal, type Lesson } from "../../../lib/service-course/course";
import { COPY, fill } from "../../../lib/service-course/copy";
import { CHECK_REASKS, answerCheck, checkDone, currentCheck, seeded, startCheck } from "../../../lib/service-course/check";
import { fluencyIntro, fluencyItems, type ChoiceItem, type IntroRow } from "../../../lib/service-course/reading";
import { lineSteps, wordSteps, type FluencyStep, type ItemStep, type LineStep, type WordStep } from "../../../lib/service-course/words";
import { completeLesson, nextLesson } from "../../../lib/service-course/progress";
import { recordAnswer } from "../../../lib/service-course/cards";
import { localDay } from "../../../lib/learn/progress";
import learn from "../learn.module.css";
import styles from "./service.module.css";
import { ChoiceBlock, Footer, RunBar, TextFailure, useUnitTexts } from "./frame";
import { useServiceProgress } from "./progress";

/**
 * Reading Hebrew (2.0 SC3, A4 4): six short lessons on letters, vowels, dots, words and whole lines. No audio and nothing listens: the
 * learner reads aloud to themselves and the page answers with choices and, on request, the transliteration. A lesson opens on its Intro
 * (what its questions will name, shown first), then asks; a miss comes back a few questions later, at most twice. Nothing counts right
 * answers: the rail shows the place in the lesson, and Done says what the learner can now do.
 */
const asStep = (item: ChoiceItem): ItemStep => Object.freeze({ key: item.key, kind: "item" as const, item });

export function FluencyLesson({ lesson }: { lesson: Lesson }) {
  const corpus = lesson.corpus, units = useMemo(() => (corpus ?? []).map(entry => entry.unit), [corpus]);
  const { state, retry } = useUnitTexts(units);
  // One seed per visit: the order is fixed while the lesson is open and different the next time.
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const plan = useMemo(() => {
    const rng = seeded(seed);
    if (!corpus) return { intro: fluencyIntro(lesson.id), steps: fluencyItems(lesson.id, rng).map(asStep) as readonly FluencyStep[] };
    if (state.status !== "ready") return null;
    return { intro: null, steps: lesson.id === "f5" ? wordSteps(corpus, state.texts, rng) : lineSteps(corpus, state.texts, rng) };
  }, [lesson.id, corpus, state, seed]);
  const frame = (body: ReactNode) => <div className={`portal-shell ${learn.shell}`}><RunBar title={lesson.title} /><main id="lesson-main" tabIndex={-1} className={learn.lesson} data-lesson={lesson.id} data-step="loading">{body}</main></div>;
  if (corpus && state.status === "error") return frame(<TextFailure rateLimited={state.rateLimited} onRetry={retry} />);
  if (!plan) return frame(<p role="status" className={styles.note}>{COPY.state.lessonLoading}</p>);
  if (!plan.steps.length) return frame(<TextFailure rateLimited={false} onRetry={retry} />);
  return <FluencyRun lesson={lesson} intro={plan.intro} steps={plan.steps} seed={seed} />;
}

function FluencyRun({ lesson, intro, steps, seed }: { lesson: Lesson; intro: readonly IntroRow[] | null; steps: readonly FluencyStep[]; seed: number }) {
  const { progress, update } = useServiceProgress();
  const [phase, setPhase] = useState<"intro" | "run" | "done">(intro ? "intro" : "run");
  const [run, setRun] = useState(() => startCheck(steps));
  const rng = useRef(seeded(seed ^ 0x5bd1e995)), moved = useRef(new Set<string>()), main = useRef<HTMLElement>(null);
  const lead = intro ? 1 : 0, base = steps.length, total = lead + base + 1;
  const at = phase === "intro" ? 0 : phase === "done" ? total - 1 : lead + Math.min(run.at, base - 1);
  const step = phase === "run" ? currentCheck(run) : null;
  const move = () => { window.scrollTo({ top: 0 }); main.current?.focus({ preventScroll: true }); };
  const advance = (right: boolean, reasks = CHECK_REASKS) => {
    const next = answerCheck(run, right, rng.current, { reasks });
    setRun(next); if (checkDone(next)) setPhase("done");
    move();
  };
  const record = (item: ChoiceItem, right: boolean) => { if (item.card) update(value => recordAnswer(value, item.card!, right, localDay(Date.now()), moved.current)); };
  return <div className={`portal-shell ${learn.shell}`}>
    <a className="skip-link" href="#lesson-main">{COPY.frame.skip}</a>
    <RunBar title={lesson.title} rail={{ at, total }} />
    <main id="lesson-main" ref={main} tabIndex={-1} className={learn.lesson} data-lesson={lesson.id} data-step={phase === "run" ? step?.kind : phase}>
      {phase === "intro" && intro ? <Intro lesson={lesson} rows={intro} onNext={() => { setPhase("run"); move(); }} />
        : phase === "done" || !step ? <FluencyDone lesson={lesson} complete={() => update(value => completeLesson(value, lesson, Date.now()), lesson.id)}
            nextId={(() => { const order = SERVICE_COURSE.lessons.filter(row => row.kind === "fluency"), after = order[order.findIndex(row => row.id === lesson.id) + 1]; return after?.id ?? (progress ? nextLesson(completeLesson(progress, lesson, Date.now()), CRC_TENANT)?.id ?? null : null); })()} />
        : step.kind === "item" ? <ItemView key={`${step.key}:${run.at}`} step={step} again={(run.misses.get(step.key) ?? 0) < CHECK_REASKS} onAnswer={record} onNext={right => advance(right)} />
        : step.kind === "word" ? <WordView key={`${step.key}:${run.at}`} step={step} onNext={() => advance(true)} />
        : <LineView key={`${step.key}:${run.at}`} step={step} onDone={right => advance(right, 1)} />}
    </main>
  </div>;
}

/** Before the questions: what they will name, with names (and, for vowels and dots, how each sounds). */
function Intro({ lesson, rows, onNext }: { lesson: Lesson; rows: readonly IntroRow[]; onNext(): void }) {
  const notes = rows.some(row => row.note);
  return <>
    <h1 className={styles.stepTitle}>{lesson.title}</h1>
    <p className={styles.note}>{lesson.summary}</p>
    <ul className={styles.intro} data-notes={notes || undefined}>{rows.map(row => <li key={row.key} className={styles.introRow}>
      <span className={`${learn.hebrew} ${styles.introHe}`} lang="he" dir="rtl">{row.he}</span>
      <span className={styles.introLabel}>{row.label}</span>
      {row.note && <span className={styles.introNote}>{row.note}</span>}
    </li>)}</ul>
    <Footer><button type="button" className="button-start" onClick={onNext}>{COPY.frame.next}</button></Footer>
  </>;
}

/** A question: choose, hear what it says, then Next. Moves the review card, if the learner has one, once. */
function ItemView({ step, again, onAnswer, onNext }: { step: ItemStep; again: boolean; onAnswer(item: ChoiceItem, right: boolean): void; onNext(right: boolean): void }) {
  const [answer, setAnswer] = useState<number | null>(null), item = step.item;
  const choose = (index: number) => { if (answer !== null) return; setAnswer(index); onAnswer(item, index === item.right); };
  const right = answer === item.right;
  return <>
    <h1 className="sr-only">{COPY.step.check}</h1>
    <ChoiceBlock item={item} answer={answer} again={again && answer !== null && !right} onChoose={choose} />
    <Footer><button type="button" className="button-start" disabled={answer === null} onClick={() => onNext(right)}>{COPY.frame.next}</button></Footer>
  </>;
}

/** f5: a word to read one syllable at a time, and its transliteration on request. */
function WordView({ step, onNext }: { step: WordStep; onNext(): void }) {
  const [shown, setShown] = useState(false), word = step.word;
  return <>
    <h1 className="sr-only">{COPY.step.read}</h1>
    <p>{COPY.fluency.wordInstruction}</p>
    <p className={`${learn.hebrew} ${styles.bigWord}`} lang="he" dir="rtl" data-read-word="">{word.he}</p>
    <div className={styles.toggles} aria-live="polite">
      {shown ? <p className={styles.bigTr} data-translit="">{word.translit}</p>
        : <button type="button" className={styles.toggle} onClick={() => setShown(true)}>{COPY.fluency.wordShow}</button>}
    </div>
    <Footer><button type="button" className="button-start" onClick={onNext}>{COPY.frame.next}</button></Footer>
  </>;
}

/** f6: a whole line to read aloud, its transliteration one word at a time on request, and a self-check that is kept nowhere. */
function LineView({ step, onDone }: { step: LineStep; onDone(right: boolean): void }) {
  const [shown, setShown] = useState(0), words = step.he.length;
  return <>
    <h1 className="sr-only">{COPY.step.read}</h1>
    <p>{COPY.fluency.lineInstruction}</p>
    <p className={`${learn.hebrew} ${styles.lineHe}`} lang="he" dir="rtl" data-read-line="">{step.he.join(" ")}</p>
    <p className={styles.lineTr} aria-live="polite" data-translit="">{step.tr.map((word, i) => i < shown ? <span key={i}>{i ? " " : ""}{word}</span> : <span key={i} aria-hidden="true">{i ? " " : ""}___</span>)}</p>
    {shown < words && <div className={styles.toggles}><button type="button" className={styles.toggle} onClick={() => setShown(n => n + 1)}>{COPY.fluency.lineReveal}</button></div>}
    <Footer>
      <button type="button" className="button-start" onClick={() => onDone(true)}>{COPY.fluency.lineReadIt}</button>
      <button type="button" className="button-secondary" onClick={() => onDone(false)}>{COPY.fluency.lineNotYet}</button>
    </Footer>
  </>;
}

/** End of a fluency lesson: what the learner can now do (when that line is approved), the next lesson, back to the course. */
function FluencyDone({ lesson, complete, nextId }: { lesson: Lesson; complete(): void; nextId: string | null }) {
  useEffect(() => { complete(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const next = nextId ? lessonById(nextId) : null;
  return <>
    <div className={learn.doneHead}><h1 className={learn.doneTitle}>{lesson.title}</h1><p className={learn.doneWord}>{COPY.done.word}</p></div>
    {lesson.goal && <p className={learn.doneLine}>{presentGoal(lesson.goal)}</p>}
    {next && <p className={learn.nextName}>{fill(COPY.done.nextName, { lesson: next.title })}</p>}
    <Footer>
      {next && <a className="button-start" href={`/learn/service/${next.id}`}>{COPY.done.startNext}</a>}
      <a className={learn.backLink} href="/learn/service">{COPY.done.back}</a>
    </Footer>
  </>;
}
