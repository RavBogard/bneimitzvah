"use client";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { COURSE, MELODY_FAMILIES, type Drill, type Melody } from "../../lib/learn/course";
import { drillItems, itemRefs, poolOf, seededRandom, type DrillItem, type Phrase, type Pools } from "../../lib/learn/pools";
import { comesBack, composeReview, emptyProgress, isDone, localDay, recordAnswer, type CardId, type Progress, type ReviewSlot } from "../../lib/learn/progress";
import { dueVerses, type VerseCardId } from "../../lib/learn/verse-review";
import { answerRun, currentItem, runDone, startRun, type Run } from "../../lib/learn/run";
import { useCourseVerses } from "./course-data";
import { icons, LoadFailure, revealAnswer } from "./bits";
import { fromZakef, isHarder } from "../../lib/learn/production";
import { QuickTenLinks } from "./home";
import { HearAndName, SameOrDifferent, TapThePhrase, WhereDoesItEnd } from "./drills";
import { LearnServices, useLearnServices, useProgress } from "./services";
import { useVerseReview } from "./own-verses";
import { VerseReviewStage } from "./verse-run";
import styles from "./learn.module.css";

/** The families a learner has finished in a melody: the review's distractors. */
const learned = (progress: Progress, melody: Melody) => COURSE.lessons.filter(lesson => lesson.melody === melody && lesson.family && isDone(progress, lesson.id)).map(lesson => lesson.family!) as FamilyId[];
/** A finished orientation lesson (no family of its own): its whole-verse examples have played their phrases. */
const orientation = (progress: Progress, melody: Melody) => COURSE.lessons.filter(lesson => lesson.melody === melody && !lesson.family && isDone(progress, lesson.id));
/** The families a learner has been taught in a melody: each finished lesson's own, and every phrase heard in a finished orientation lesson's whole-verse examples (N17a). */
const taught = (progress: Progress, melody: Melody) => [...new Set([...learned(progress, melody), ...orientation(progress, melody).flatMap(lesson => lesson.examples.flatMap(example => (example.phrases ?? []).map(phrase => phrase.family)))])];
/** One item for each slot, by its skill, from a verse other than the last item's. */
export function reviewItems(slots: readonly ReviewSlot[], pools: Pools, progress: Progress, seed: number): { item: DrillItem; slot: ReviewSlot }[] {
  const out: { item: DrillItem; slot: ReviewSlot }[] = [];
  for (const [n, slot] of slots.entries()) {
    const known = [...new Set([slot.family, ...learned(progress, slot.melody)])].filter(family => MELODY_FAMILIES[slot.melody].includes(family));
    // With one family done, the second choice is a family it is confused with that the learner has been taught; with none, the naming slot is skipped, never filled with an untaught family.
    const partner = known.length > 1 ? null : COURSE.families[slot.family].confusedWith.find(other => MELODY_FAMILIES[slot.melody].includes(other) && taught(progress, slot.melody).includes(other));
    // Daniel 2026-10-24: no same-or-different anywhere in Learn; recognition is naming on families the learner has heard.
    // N18: a card in box 3 or higher gets the harder item. A naming card from zakef on is asked from the text, with no recording first; an ending card is asked with no recording first.
    const harder = isHarder(progress.cards[slot.card]?.box ?? 0);
    const name: Drill | null = known.length > 1 || partner ? { type: "hear-and-name", params: { families: known.length > 1 ? known : [slot.family, partner!], items: 1, choices: Math.min(3, Math.max(2, known.length)), weight: {},
      ...(harder && fromZakef(slot.family, slot.melody) ? { mode: "read" as const } : {}) } } : null;
    const own: Drill[] = slot.skill === "find" ? [{ type: "tap-the-phrase", params: { families: [slot.family], items: 1, verseWords: [5, 16] } }]
      : slot.skill === "end" ? [{ type: "where-does-it-end", params: { families: [slot.family], items: 1, audio: !harder, verseWords: [5, 16] } }] : [];
    const choices: Drill[] = name ? [...own, name] : own;
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
  const { progress: loaded, update, until } = useProgress(), progress = loaded ?? emptyProgress();
  const seed = useRef(Math.floor(Math.random() * 2 ** 31)), today = localDay(Date.now());
  // 1.9 N19: a signed-in student's due verse cards follow the phrase items, with no audio. The due list is fixed when the cards arrive.
  const verseCards = useVerseReview(), verseState = verseCards.state, verseReview = verseState.status === "ready" ? verseState.review : null;
  const [verseIds, setVerseIds] = useState<VerseCardId[] | null>(null), [versesDone, setVersesDone] = useState(false);
  useEffect(() => { if (verseIds === null && verseState.status === "ready") setVerseIds(dueVerses(verseState.review, today, verseState.until)); }, [verseState.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => loaded ? composeReview(loaded, today, seededRandom(seed.current), until) : null, [loaded === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const lessons = useMemo(() => plan ? COURSE.lessons.filter(lesson => plan.some(slot => slot.melody === lesson.melody && (lesson.family ? slot.family === lesson.family || learned(progress, slot.melody).includes(lesson.family) : isDone(progress, lesson.id)))) : [], [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const [retry, setRetry] = useState(0), data = useCourseVerses(lessons, retry);
  const frame = (body: ReactNode, footer?: ReactNode) => <div className={`portal-shell ${styles.shell}`}>
    <header className={styles.bar}><a className={styles.close} href="/learn" aria-label="Back to the path">{icons.close}</a><h1 className={styles.barTitle}>Review</h1><span /></header>
    <main className={styles.lesson}>{body}{footer && <div className={styles.footer}><div className={styles.footerInner}>{footer}</div></div>}</main>
  </div>;
  const verseStage = verseIds?.length && !versesDone && verseState.status === "ready"
    ? <VerseReviewStage ids={verseIds} review={verseReview} until={verseState.until} update={verseCards.update} onDone={() => { setVersesDone(true); window.scrollTo({ top: 0 }); }} frame={frame} /> : null;
  /** "Done. These come back on Thursday.": the soonest of the phrase cards asked and the verse cards asked. */
  const finish = (cards: readonly CardId[]) => {
    const asked = [...cards, ...(versesDone && verseIds ? verseIds : [])] as CardId[], all = { ...progress, cards: { ...progress.cards, ...verseReview?.cards } };
    const back = comesBack(all, asked, today);
    return frame(<><div className={styles.doneHead}><p className={styles.doneLine}>{back ? "weekday" in back ? `Done. These come back on ${back.weekday}.` : "Done. These come back next week." : "Done."}</p></div>
      <QuickTenLinks progress={progress} /></>,
    <a className={styles.backLink} href="/learn">Back to the path</a>);
  };
  if (!loaded) return frame(<p role="status" className={styles.state}>Loading the review…</p>);
  if (!plan?.length) return verseStage ?? (versesDone ? finish([]) : frame(<><p className={styles.doneLine} data-testid="review-empty">Nothing to review yet. Finish a lesson and its phrases come back here.</p><QuickTenLinks progress={progress} /></>,
    <a className={styles.backLink} href="/learn">Back to the path</a>));
  if (data.status === "loading") return frame(<p role="status" className={styles.state}>Loading the review…</p>);
  if (data.status === "error" || !data.pools.families.size) return verseStage ?? frame(<LoadFailure rateLimited={data.status === "error" && data.rateLimited} onRetry={() => setRetry(n => n + 1)} />, <a className={styles.backLink} href="/learn">Back to the path</a>);
  return <ReviewRun slots={plan} pools={data.pools} progress={progress} seed={seed.current} today={today} until={until} update={update} frame={frame} after={verseStage} versesDone={versesDone} finish={finish} />;
}
function ReviewRun({ slots, pools, progress, seed, today, until, update, frame, after, versesDone, finish }: { slots: ReviewSlot[]; pools: Pools; progress: Progress; seed: number; today: string; until: string | null;
  update: ReturnType<typeof useProgress>["update"]; frame(body: ReactNode, footer?: ReactNode): ReactElement;
  /** The verse cards' stage, when any are due and not yet asked. */ after: ReactElement | null; versesDone: boolean; finish(cards: readonly CardId[]): ReactElement }) {
  const items = useMemo(() => reviewItems(slots, pools, progress, seed), [slots, pools]); // eslint-disable-line react-hooks/exhaustive-deps
  const slotOf = useMemo(() => new Map(items.map(row => [row.item.key, row.slot])), [items]);
  const [run, setRun] = useState<Run>(() => startRun(items.map(row => row.item))), [shown, setShown] = useState<{ item: DrillItem | null; n: number }>(() => ({ item: items[0]?.item ?? null, n: 0 }));
  const [answered, setAnswered] = useState(false), [finished, setFinished] = useState(false), rng = useRef(seededRandom(seed + 7)), moved = useRef(new Set<string>()), nextButton = useRef<HTMLButtonElement>(null);
  const { player } = useLearnServices();
  if (!items.length) return after ?? (versesDone ? finish([]) : frame(<p className={styles.doneLine}>No supported review questions yet. Revisit a sound or prepare a verse.</p>,
    <a className={styles.backLink} href="/learn">Back to the path</a>));
  if (finished || !shown.item) return after ?? finish(slots.map(slot => slot.card));
  const item = shown.item, slot = slotOf.get(item.key)!;
  const contrast = (family: FamilyId, avoid: readonly string[]): Phrase | null => { const pool = poolOf(pools, family, slot.melody).filter(phrase => !avoid.includes(phrase.ref)); return pool[Math.floor(rng.current() * pool.length)] ?? null; };
  const answer = (right: boolean) => {
    if (answered) return; setAnswered(true); setRun(answerRun(run, right, rng.current));
    revealAnswer(nextButton);
    // One box up per card per review, however often it comes up right; a miss still drops it.
    if (right && moved.current.has(slot.card)) return;
    moved.current.add(slot.card);
    update(value => recordAnswer(value, slot.card, right, today, { until }));
  };
  const advance = () => { player.stop(); if (runDone(run)) { setFinished(true); return; } setShown({ item: currentItem(run), n: shown.n + 1 }); setAnswered(false); window.scrollTo({ top: 0 }); };
  const props = { pools, melody: slot.melody, contrast, onAnswer: answer }, key = `${item.key}:${shown.n}`;
  return frame(item.type === "hear-and-name" ? <HearAndName key={key} item={item} {...props} /> : item.type === "same-or-different" ? <SameOrDifferent key={key} item={item} {...props} />
    : item.type === "tap-the-phrase" ? <TapThePhrase key={key} item={item} {...props} /> : item.type === "where-does-it-end" ? <WhereDoesItEnd key={key} item={item} {...props} /> : null,
    <button ref={nextButton} type="button" className="button-start" disabled={!answered} onClick={advance}>Next</button>);
}
