"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COPY } from "../../../lib/service-course/copy";
import { CHECK_REASKS, answerCheck, checkDone, currentCheck, seeded, startCheck } from "../../../lib/service-course/check";
import { QUICK_TEN, quickTenItems, type QuickSource } from "../../../lib/service-course/words";
import { recordAnswer, quickTenOpen, quickTenSources, reviewCards } from "../../../lib/service-course/cards";
import { reviewItems, reviewUnits } from "../../../lib/service-course/practice";
import type { ServiceText } from "../../../lib/service-course/text";
import type { ChoiceItem } from "../../../lib/service-course/reading";
import { localDay } from "../../../lib/learn/progress";
import learn from "../learn.module.css";
import styles from "./service.module.css";
import { ChoiceBlock, Footer, RunBar, TextFailure, useUnitTexts } from "./frame";
import { HebrewLine } from "./read";
import { useServiceProgress } from "./progress";

/**
 * Review and Quick ten (2.0 SC3, A4 8.3 and 8.4). Both are practice runs, never lessons: they move the review cards one box a run and
 * mark nothing done. Nothing here counts right answers or shows a score; a miss comes back, and the card carries it into the next review.
 */
const back = <a className={learn.backLink} href="/learn/service">{COPY.done.back}</a>;
const shell = (title: string, step: string, body: ReactNode, footer?: ReactNode) => <div className={`portal-shell ${learn.shell}`}>
  <RunBar title={title} heading />
  <main id="lesson-main" tabIndex={-1} className={learn.lesson} data-step={step}>{body}{footer && <Footer>{footer}</Footer>}</main>
</div>;
const status = (text: string) => <p role="status" className={learn.state}>{text}</p>;
const seedOf = () => Math.floor(Math.random() * 2 ** 31);

/** The review: the cards due today, one question each, a miss back a few questions later. */
export function ReviewScreen() {
  const { progress: loaded } = useServiceProgress();
  const seed = useRef(seedOf()), today = localDay(Date.now());
  // Drawn once when the progress first loads, so the run does not change under the learner when another tab saves.
  const cards = useMemo(() => loaded ? reviewCards(loaded, today, seeded(seed.current)) : null, [loaded === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const units = useMemo(() => cards ? reviewUnits(cards) : [], [cards]);
  const { state, retry } = useUnitTexts(units);
  const title = COPY.review.title;
  if (!loaded || !cards) return shell(title, "review", status(COPY.review.loading));
  if (!cards.length) return shell(title, "review", <p className={learn.doneLine}>{COPY.review.empty}</p>, back);
  if (state.status === "loading") return shell(title, "review", status(COPY.review.loading));
  if (state.status === "error") return shell(title, "review", <TextFailure rateLimited={state.rateLimited} onRetry={retry} />, back);
  return <ReviewRun cards={cards} texts={state.texts} seed={seed.current} />;
}
function ReviewRun({ cards, texts, seed }: { cards: readonly string[]; texts: ReadonlyMap<string, ServiceText>; seed: number }) {
  const { progress, update } = useServiceProgress(), moved = useRef(new Set<string>());
  const owned = useMemo(() => new Set(Object.keys(progress?.cards ?? {})), []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => reviewItems(cards, owned, texts, seeded(seed + 1)), [cards, owned, texts, seed]);
  if (!items.length) return shell(COPY.review.title, "review", <p className={learn.doneLine}>{COPY.review.empty}</p>, back);
  // One box up per card per review, however often it comes up right; a miss still drops it (Learn's rule).
  return <Run title={COPY.review.title} step="review" items={items} seed={seed} end="soon" onAnswer={(item, right) => { if (item.card) update(value => recordAnswer(value, item.card!, right, localDay(Date.now()), moved.current)); }}
    finish={() => <p className={learn.doneLine}>{COPY.review.done}</p>} />;
}

/** Quick ten: ten words from the prayers the learner has read, named by sound; a short look at the word in its line after each answer. */
export function QuickTenScreen() {
  const { progress: loaded } = useServiceProgress();
  const seed = useRef(seedOf());
  const open = !!loaded && quickTenOpen(loaded);
  // The sources are fixed when the page opens, so the ten do not change under the learner.
  const sources = useMemo(() => open && loaded ? quickTenSources(loaded, seeded(seed.current), QUICK_TEN.sources) : [], [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const units = useMemo(() => [...new Set(sources.map(source => source.unit))], [sources]);
  const { state, retry } = useUnitTexts(units);
  const title = COPY.quickTen.title;
  if (!loaded) return shell(title, "quick-ten", status(COPY.quickTen.loading));
  if (!open) return shell(title, "quick-ten", <p className={learn.doneLine}>{COPY.quickTen.empty}</p>, back);
  if (state.status === "loading") return shell(title, "quick-ten", status(COPY.quickTen.loading));
  if (state.status === "error") return shell(title, "quick-ten", <TextFailure rateLimited={state.rateLimited} onRetry={retry} />, back);
  return <QuickTenRun sources={sources.flatMap((source): QuickSource[] => { const text = state.texts.get(source.unit); return text ? [{ ...source, text }] : []; })} seed={seed.current} retry={retry} />;
}
function QuickTenRun({ sources, seed, retry }: { sources: readonly QuickSource[]; seed: number; retry(): void }) {
  const { update } = useServiceProgress();
  const items = useMemo(() => quickTenItems(sources, seeded(seed + 1)), [sources, seed]);
  const done = useRef(new Set<string>());
  if (!items.length) return shell(COPY.quickTen.title, "quick-ten", <TextFailure rateLimited={false} onRetry={retry} />, back);
  return <Run title={COPY.quickTen.title} step="quick-ten" items={items} seed={seed} end="end" auto
    onAnswer={(item, right) => { if (item.card) update(value => recordAnswer(value, item.card!, right, localDay(Date.now()), done.current)); }}
    finish={missed => <div className={learn.doneHead}><h2 className={learn.doneTitle}>{COPY.quickTen.title}</h2><p className={learn.doneLine}>{missed ? COPY.quickTen.endMissed : COPY.quickTen.endClean}</p></div>} />;
}

/**
 * One run of questions. `auto` is Quick ten: no Next button, the word shows in its line for 1.5 seconds and the next question follows
 * on its own, with "Stop here" to end. Otherwise (Review) the learner presses Next. `end` is where a miss comes back.
 */
function Run({ title, step, items, seed, end, auto = false, onAnswer, finish }: { title: string; step: string; items: readonly ChoiceItem[]; seed: number; end: "soon" | "end"; auto?: boolean;
  onAnswer(item: ChoiceItem, right: boolean): void; finish(missed: boolean): ReactNode }) {
  const [run, setRun] = useState(() => startCheck(items)), [answer, setAnswer] = useState<number | null>(null), [stopped, setStopped] = useState(false);
  const rng = useRef(seeded(seed + 7)), main = useRef<HTMLElement>(null);
  const item = currentCheck(run), finished = stopped || checkDone(run);
  const advance = () => {
    if (!item || answer === null) return;
    setRun(answerCheck(run, answer === item.right, rng.current, { at: end })); setAnswer(null);
    window.scrollTo({ top: 0 }); main.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!auto || answer === null || finished) return;
    const timer = setTimeout(advance, QUICK_TEN.showMs);
    return () => clearTimeout(timer);
  }, [auto, answer, finished]); // eslint-disable-line react-hooks/exhaustive-deps
  if (finished || !item) return shell(title, step, finish(run.misses.size > 0), back);
  const choose = (index: number) => { if (answer === null) { setAnswer(index); onAnswer(item, index === item.right); } };
  const right = answer === item.right;
  return <div className={`portal-shell ${learn.shell}`}>
    <RunBar title={title} heading />
    <main id="lesson-main" ref={main} tabIndex={-1} className={learn.lesson} data-step={step}>
      <ChoiceBlock key={`${item.key}:${run.at}`} item={item} answer={answer} again={!auto && answer !== null && !right && (run.misses.get(item.key) ?? 0) < CHECK_REASKS} onChoose={choose} />
      {auto && answer !== null && item.context && <HebrewLine he={item.context.he} line={0} large={false} mark={item.context.mark} />}
      <Footer>
        {auto ? <button type="button" className={learn.stopLink} onClick={() => setStopped(true)}>{COPY.quickTen.stop}</button>
          : <button type="button" className="button-start" disabled={answer === null} onClick={advance}>{COPY.frame.next}</button>}
      </Footer>
    </main>
  </div>;
}