"use client";
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { COURSE, MELODY_FAMILIES, type Drill, type Melody } from "../../lib/learn/course";
import { drillItems, itemRefs, poolOf, seededRandom, type DrillItem, type Phrase, type Pools } from "../../lib/learn/pools";
import { comesBack, composeReview, emptyProgress, isDone, localDay, recordAnswer, type Progress, type ReviewSlot } from "../../lib/learn/progress";
import { answerRun, currentItem, runDone, startRun, type Run } from "../../lib/learn/run";
import { useCourseVerses } from "./course-data";
import { icons } from "./bits";
import { HearAndName, SameOrDifferent, TapThePhrase, WhereDoesItEnd } from "./drills";
import { LearnServices, useLearnServices, useProgress } from "./services";
import styles from "./learn.module.css";

/** The families a learner has finished in a melody: the review's distractors. */
const learned = (progress: Progress, melody: Melody) => COURSE.lessons.filter(lesson => lesson.melody === melody && lesson.family && isDone(progress, lesson.id)).map(lesson => lesson.family!) as FamilyId[];
/** One item for each slot, by its skill, from a verse other than the last item's. */
export function reviewItems(slots: readonly ReviewSlot[], pools: Pools, progress: Progress, seed: number): { item: DrillItem; slot: ReviewSlot }[] {
  const out: { item: DrillItem; slot: ReviewSlot }[] = [];
  for (const [n, slot] of slots.entries()) {
    const known = [...new Set([slot.family, ...learned(progress, slot.melody)])].filter(family => MELODY_FAMILIES[slot.melody].includes(family));
    const name: Drill = n % 3 === 2 && known.length > 1 ? { type: "same-or-different", params: { families: known, items: 1 } }
      : { type: "hear-and-name", params: { families: known.length > 1 ? known : [slot.family, ...MELODY_FAMILIES[slot.melody].filter(f => f !== slot.family).slice(0, 1)], items: 1, choices: Math.min(3, Math.max(2, known.length)), weight: {} } };
    const choices: Drill[] = slot.skill === "find" ? [{ type: "tap-the-phrase", params: { families: [slot.family], items: 1, verseWords: [5, 16] } }, name]
      : slot.skill === "end" ? [{ type: "where-does-it-end", params: { families: [slot.family], items: 1, audio: true, verseWords: [5, 16] } }, name] : [name];
    let picked: DrillItem | null = null;
    for (const drill of choices) for (let attempt = 0; attempt < 6 && !picked; attempt++) {
      const [item] = drillItems(drill, pools, { melody: slot.melody, focus: slot.family }, seededRandom(seed + n * 31 + attempt));
      if (item && !(out.at(-1) && itemRefs(item).some(ref => itemRefs(out.at(-1)!.item).includes(ref)))) picked = item;
    }
    if (picked) out.push({ item: { ...picked, key: `slot${n}:${picked.key}` } as DrillItem, slot });
  }
  return out;
}

export function ReviewScreen() { return <LearnServices><Review /></LearnServices>; }
function Review() {
  const { progress: loaded, update } = useProgress(), progress = loaded ?? emptyProgress();
  const seed = useRef(Math.floor(Math.random() * 2 ** 31)), today = localDay(Date.now());
  const plan = useMemo(() => loaded ? composeReview(loaded, today, seededRandom(seed.current)) : null, [loaded === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const lessons = useMemo(() => plan ? COURSE.lessons.filter(lesson => lesson.family && plan.some(slot => slot.melody === lesson.melody && (slot.family === lesson.family || learned(progress, slot.melody).includes(lesson.family!)))) : [], [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const [retry, setRetry] = useState(0), data = useCourseVerses(lessons, retry);
  const frame = (body: ReactNode, footer?: ReactNode) => <div className={`portal-shell ${styles.shell}`}>
    <header className={styles.bar}><a className={styles.close} href="/learn" aria-label="Back to the path">{icons.close}</a><p className={styles.barTitle}>Review</p><span /></header>
    <main className={styles.lesson}>{body}</main>{footer && <div className={styles.footer}><div className={styles.footerInner}>{footer}</div></div>}
  </div>;
  if (!loaded) return frame(<p role="status" className={styles.state}>Loading the review…</p>);
  if (!plan?.length) return frame(<p className={styles.doneLine}>Nothing to review yet. Finish a lesson and its phrases come back here.</p>, <a className={styles.backLink} href="/learn">Back to the path</a>);
  if (data.status === "loading") return frame(<p role="status" className={styles.state}>Loading the review…</p>);
  if (data.status === "error" || !data.pools.families.size) return frame(<div role="status" className={styles.state}><p>The recording did not load. Try again.</p>
    <button type="button" className="button-secondary" onClick={() => setRetry(n => n + 1)}>Try again</button></div>, <a className={styles.backLink} href="/learn">Back to the path</a>);
  return <ReviewRun slots={plan} pools={data.pools} progress={progress} seed={seed.current} today={today} update={update} frame={frame} />;
}
function ReviewRun({ slots, pools, progress, seed, today, update, frame }: { slots: ReviewSlot[]; pools: Pools; progress: Progress; seed: number; today: string;
  update: ReturnType<typeof useProgress>["update"]; frame(body: ReactNode, footer?: ReactNode): ReactElement }) {
  const items = useMemo(() => reviewItems(slots, pools, progress, seed), [slots, pools]); // eslint-disable-line react-hooks/exhaustive-deps
  const slotOf = useMemo(() => new Map(items.map(row => [row.item.key, row.slot])), [items]);
  const [run, setRun] = useState<Run>(() => startRun(items.map(row => row.item))), [shown, setShown] = useState<{ item: DrillItem | null; n: number }>(() => ({ item: items[0]?.item ?? null, n: 0 }));
  const [answered, setAnswered] = useState(false), [finished, setFinished] = useState(false), rng = useRef(seededRandom(seed + 7)), moved = useRef(new Set<string>()), nextButton = useRef<HTMLButtonElement>(null);
  const { player } = useLearnServices();
  if (finished || !shown.item) {
    const back = comesBack(progress, slots.map(slot => slot.card), today);
    return frame(<div className={styles.doneHead}><p className={styles.doneLine}>{back ? "weekday" in back ? `Done. These come back on ${back.weekday}.` : "Done. These come back next week." : "Done."}</p></div>,
      <a className={styles.backLink} href="/learn">Back to the path</a>);
  }
  const item = shown.item, slot = slotOf.get(item.key)!;
  const contrast = (family: FamilyId, avoid: readonly string[]): Phrase | null => { const pool = poolOf(pools, family, slot.melody).filter(phrase => !avoid.includes(phrase.ref)); return pool[Math.floor(rng.current() * pool.length)] ?? null; };
  const answer = (right: boolean) => {
    if (answered) return; setAnswered(true); setRun(answerRun(run, right, rng.current));
    requestAnimationFrame(() => nextButton.current?.focus({ preventScroll: true }));
    // One box up per card per review, however often it comes up right; a miss still drops it.
    if (right && moved.current.has(slot.card)) return;
    moved.current.add(slot.card);
    update(value => recordAnswer(value, slot.card, right, today));
  };
  const advance = () => { player.stop(); if (runDone(run)) { setFinished(true); return; } setShown({ item: currentItem(run), n: shown.n + 1 }); setAnswered(false); window.scrollTo({ top: 0 }); };
  const props = { pools, melody: slot.melody, contrast, onAnswer: answer }, key = `${item.key}:${shown.n}`;
  return frame(item.type === "hear-and-name" ? <HearAndName key={key} item={item} {...props} /> : item.type === "same-or-different" ? <SameOrDifferent key={key} item={item} {...props} />
    : item.type === "tap-the-phrase" ? <TapThePhrase key={key} item={item} {...props} /> : item.type === "where-does-it-end" ? <WhereDoesItEnd key={key} item={item} {...props} /> : null,
    <button ref={nextButton} type="button" className="button-start" disabled={!answered} onClick={advance}>Next</button>);
}
