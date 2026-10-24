"use client";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { COURSE, practiceById, type Practice } from "../../lib/learn/course";
import { drillItems, itemCard, poolOf, seededRandom, type DrillItem, type NameItem, type Phrase, type Pools } from "../../lib/learn/pools";
import { heardFamilies, practiceOpen, quickTenDrill } from "../../lib/learn/practice";
import { cardId, localDay, recordAnswer } from "../../lib/learn/progress";
import { answerRun, currentItem, runDone, startRun, type Run } from "../../lib/learn/run";
import { DRAFTED, NEW } from "./activity-copy";
import { icons, LoadFailure, revealAnswer } from "./bits";
import { useCourseVerses } from "./course-data";
import { HearAndName } from "./drills";
import { useWordCardOpen } from "./word-card";
import { LearnServices, useLearnServices, usePlayerState, useProgress } from "./services";
import styles from "./learn.module.css";

/**
 * Quick ten (ACTIVITIES.md #13): ten hear-and-name items over the families heard, one after another. After each
 * answer the phrase shows in its verse for about a second and a half, then the next one plays on its own: there is
 * no Next button and no timer. "Stop here" ends it at any point. A miss comes back after the ten; every answer
 * moves the family's name card, as hear-and-name does.
 */
export function QuickTenScreen({ id }: { id: string }) {
  return <LearnServices><QuickTen practice={practiceById(id)!} /></LearnServices>;
}
const copy = DRAFTED.quickTen;
function QuickTen({ practice }: { practice: Practice }) {
  const { progress: loaded } = useProgress(), [retry, setRetry] = useState(0);
  // The families heard are fixed when the page opens, so the run does not change under the learner.
  const open = !!loaded && practiceOpen(loaded, practice);
  // Worked out when it first opens: a signed-in device may first show this browser's copy, then the account's.
  const families = useMemo(() => open && loaded ? heardFamilies(loaded, practice.melody) : [], [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const lessons = useMemo(() => open ? COURSE.lessons.filter(lesson => lesson.melody === practice.melody && lesson.family && families.includes(lesson.family)) : [], [open, families, practice.melody]);
  const data = useCourseVerses(lessons, retry);
  const main = useRef<HTMLElement>(null);
  const frame = (body: ReactNode, footer?: ReactNode) => <div className={`portal-shell ${styles.shell}`}>
    <header className={styles.bar}><a className={styles.close} href="/learn" aria-label="Back to the path">{icons.close}</a><p className={styles.barTitle}>{copy.title}</p><span /></header>
    <main ref={main} tabIndex={-1} className={styles.lesson} data-step="quick-ten">{body}</main>{footer && <div className={styles.footer}><div className={styles.footerInner}>{footer}</div></div>}
  </div>;
  const back = <a className={styles.backLink} href="/learn">Back to the path</a>;
  if (!loaded) return frame(<p role="status" className={styles.state}>{NEW.quickTenLoading}</p>);
  if (!open) return frame(<p className={styles.doneLine}>{copy.empty}</p>, back);
  if (data.status === "loading") return frame(<p role="status" className={styles.state}>{NEW.quickTenLoading}</p>);
  if (data.status === "error" || !data.pools.families.size) return frame(<LoadFailure rateLimited={data.status === "error" && data.rateLimited} onRetry={() => setRetry(n => n + 1)} />, back);
  return <QuickTenRun practice={practice} families={families} pools={data.pools} frame={frame} main={main} back={back} />;
}

function QuickTenRun({ practice, families, pools, frame, main, back }: { practice: Practice; families: readonly FamilyId[]; pools: Pools;
  frame(body: ReactNode, footer?: ReactNode): ReactElement; main: RefObject<HTMLElement | null>; back: ReactNode }) {
  const { update, until } = useProgress(), { player } = useLearnServices(), state = usePlayerState(), cardOpen = useWordCardOpen();
  const seed = useRef(Math.floor(Math.random() * 2 ** 31));
  const items = useMemo(() => drillItems(quickTenDrill(practice, families), pools, { melody: practice.melody, focus: null }, seededRandom(seed.current)), [practice, families, pools]);
  const [run, setRun] = useState<Run>(() => startRun(items)), [shown, setShown] = useState<{ item: DrillItem | null; n: number }>(() => ({ item: items[0] ?? null, n: 0 }));
  const [answered, setAnswered] = useState(false), [finished, setFinished] = useState(false);
  const rng = useRef(seededRandom(seed.current + 1)), moved = useRef(new Set<string>()), none = useRef<HTMLButtonElement>(null);
  const advance = () => {
    player.stop();
    if (runDone(run)) { setFinished(true); return; }
    setShown(value => ({ item: currentItem(run), n: value.n + 1 })); setAnswered(false);
    window.scrollTo({ top: 0 }); main.current?.focus({ preventScroll: true });
  };
  // The next phrase follows on its own once the answer's playback (a miss plays two phrases) has finished and the
  // verse has been on screen for autoAdvanceMs. A replay the learner starts holds it.
  const busy = state.status === "playing" || state.status === "loading" || cardOpen;
  useEffect(() => {
    if (!answered || finished || busy) return;
    const timer = setTimeout(advance, practice.activity.params.autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [answered, finished, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  if (finished || !shown.item) {
    return frame(<div className={styles.doneHead}><h1 className={styles.doneTitle}>{copy.title}</h1>
      <p className={styles.doneLine}>{run.missed.size ? copy.endMissed : copy.endClean}</p></div>, back);
  }
  const item = shown.item as NameItem;
  const contrast = (family: FamilyId, avoid: readonly string[]): Phrase | null => { const pool = poolOf(pools, family, practice.melody).filter(phrase => !avoid.includes(phrase.ref)); return pool[Math.floor(rng.current() * pool.length)] ?? null; };
  const answer = (right: boolean) => {
    if (answered) return; setAnswered(true); setRun(answerRun(run, right, rng.current, { reask: "end" }));
    revealAnswer(none);
    const card = itemCard(item); if (!card) return;
    const id = cardId(card.family, card.melody, "name");
    // One box up per card per run, however often it comes up right; a miss still drops it.
    if (right && moved.current.has(id)) return;
    moved.current.add(id);
    update(value => recordAnswer(value, id, right, localDay(Date.now()), { until }));
  };
  return frame(<HearAndName key={`${item.key}:${shown.n}`} item={item} pools={pools} melody={practice.melody} contrast={contrast} onAnswer={answer} />,
    <button ref={none} type="button" className={styles.stopLink} onClick={() => { player.stop(); setFinished(true); }}>{copy.stop}</button>);
}
