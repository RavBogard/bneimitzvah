"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { ALWAYS_RUN, drillSkill, isDrill, lessonById, presentGoal, type Drill, type Lesson, type Melody, type ThisWeek as ThisWeekActivity } from "../../lib/learn/course";
import { tropeLabel, tropeSample } from "../../lib/learn/marks";
import { drillItems, itemCard, phraseAt, poolOf, seededRandom, type DrillItem, type Phrase } from "../../lib/learn/pools";
import { cardId, completeLesson, localDay, nextLesson, recordAnswer } from "../../lib/learn/progress";
import { answerRun, currentItem, freshPace, mayStopEarly, pace, runDone, startRun, type LessonPace, type Run } from "../../lib/learn/run";
import { lessonExtraRefs, lessonSources, useCourseVerses, type CourseVerses, type ExampleVerse } from "./course-data";
import { AudioError, FamilyChip, icons, LoadFailure, phraseRequest, PlayTile, revealAnswer, UnitsText } from "./bits";
import { BuildThePhrase, HearAndName, LookAlikes, SameOrDifferent, TapThePhrase, WhereDoesItEnd, WhichHalf } from "./drills";
import { FirstVerse } from "./first-verse";
import { ThisWeekSection } from "./this-week";
import { LearnServices, useLearnServices, usePlayerState, useProgress } from "./services";
import styles from "./learn.module.css";

type Step = Readonly<{ kind: "hear" } | { kind: "verses" } | { kind: "drill"; activity: Drill; index: number } | { kind: "first-verse" } | { kind: "done" }>;
export function lessonSteps(lesson: Lesson): Step[] {
  if (lesson.activities.some(activity => activity.type === "first-verse")) return [{ kind: "first-verse" }, { kind: "done" }];
  return [{ kind: "hear" }, { kind: "verses" }, ...lesson.activities.filter(isDrill).map((activity, index) => ({ kind: "drill" as const, activity, index })), { kind: "done" }];
}
type Ready = Extract<CourseVerses, { status: "ready" }>;

/** Lesson frame: close, title and segment rail on the lake bar; the step; one forward action at the thumb. */
export function LessonScreen({ id }: { id: string }) {
  return <LearnServices><LessonFlow id={id} /></LearnServices>;
}
function LessonFlow({ id }: { id: string }) {
  const lesson = lessonById(id)!;
  const steps = useMemo(() => lessonSteps(lesson), [lesson]);
  const [at, setAt] = useState(0), [retry, setRetry] = useState(0), [paceState, setPace] = useState<LessonPace>(freshPace);
  const sources = useMemo(() => lessonSources(lesson), [lesson]), extra = useMemo(() => lessonExtraRefs(lesson).map(ref => ({ kind: lesson.melody, ref })), [lesson]);
  const data = useCourseVerses(steps[0].kind === "first-verse" ? [] : sources, retry, extra);
  const { player } = useLearnServices();
  const { progress, update, until } = useProgress();
  const main = useRef<HTMLElement>(null), moved = useRef(new Set<string>()), stopped = useRef(false);
  const go = useCallback((next: number) => { player.stop(); setAt(next); window.scrollTo({ top: 0 }); main.current?.focus({ preventScroll: true }); }, [player]);
  const step = steps[at];
  const onAnswered = useCallback((item: DrillItem, activity: Drill, right: boolean) => {
    setPace(value => pace(value, right));
    // Look-alikes and which-half move no card: they teach marks and halves, not families.
    const card = itemCard(item), skill = drillSkill(activity); if (!card || !skill) return;
    const id = cardId(card.family, card.melody, skill);
    // A card goes up at most one box in a lesson, however often its family comes up right; a miss still drops it.
    if (right && moved.current.has(id)) return;
    moved.current.add(id);
    update(value => recordAnswer(value, id, right, localDay(Date.now()), { until }));
  }, [update, until]);
  const doneIndex = steps.length - 1;
  /** Where eight right in a row goes from step `from`: past the other drills, but never past a look-alikes or which-half step not yet run. */
  const afterEarlyStop = (from: number) => { const next = steps.findIndex((row, i) => i > from && row.kind === "drill" && ALWAYS_RUN.has(row.activity.type)); return next < 0 ? doneIndex : next; };
  return <div className={`portal-shell ${styles.shell}`}>
    <a className="skip-link" href="#lesson-main">Skip to the lesson</a>
    <header className={styles.bar}>
      <a className={styles.close} href="/learn" aria-label="Back to the path">{icons.close}</a>
      <p className={styles.barTitle}>{lesson.title}</p>
      <ol className={styles.rail} aria-label={`Step ${at + 1} of ${steps.length}`}>{steps.map((_, i) => <li key={i} data-state={i < at ? "past" : i === at ? "current" : undefined} />)}</ol>
    </header>
    <main id="lesson-main" ref={main} tabIndex={-1} className={styles.lesson} data-step={step.kind}>
      {step.kind === "first-verse" ? <FirstVerse lesson={lesson} onDone={() => go(doneIndex)} />
        : step.kind === "done" ? <Done lesson={lesson} fallback={data.status === "ready" ? data.examples.get(lesson.id) ?? [] : []} complete={() => update(value => completeLesson(value, lesson, Date.now(), until))} nextId={progress ? nextLesson(completeLesson(progress, lesson, Date.now()))?.id ?? null : null} />
        : data.status === "loading" ? <p role="status" className={styles.state}>Loading the lesson…</p>
        : data.status === "error" || !(data.examples.get(lesson.id)?.length) ? <LoadFailure rateLimited={data.status === "error" && data.rateLimited} onRetry={() => setRetry(n => n + 1)} />
        : step.kind === "hear" ? <HearIt lesson={lesson} examples={data.examples.get(lesson.id) ?? []} onNext={() => go(at + 1)} />
        : step.kind === "verses" ? <InVerses lesson={lesson} examples={data.examples.get(lesson.id) ?? []} onNext={() => go(at + 1)} />
        : <DrillStep key={`${at}`} lesson={lesson} activity={step.activity} data={data} stopEarly={!ALWAYS_RUN.has(step.activity.type) && mayStopEarly(paceState)}
          onAnswered={onAnswered} onDone={() => { if (mayStopEarly(paceState)) stopped.current = true; go(stopped.current ? afterEarlyStop(at) : at + 1); }} />}
    </main>
  </div>;
}
function Footer({ children }: { children: ReactNode }) {
  return <div className={styles.footer}><div className={styles.footerInner}>{children}</div></div>;
}
function Marks({ lesson }: { lesson: Lesson }) {
  if (!lesson.accents.length) return null;
  return <section aria-labelledby="lesson-marks"><h2 id="lesson-marks" className={styles.sectionTitle}>Marks</h2>
    <ul className={styles.marks}>{lesson.accents.map(accent => <li key={accent} className={styles.mark}>
      <span className={`${styles.hebrew} ${styles.markSample}`} lang="he" dir="rtl" aria-hidden="true">{tropeSample(accent)}</span><span className={styles.markName}>{tropeLabel(accent)}</span>
    </li>)}</ul></section>;
}
function Legend({ verse, melody }: { verse: ExampleVerse["verse"]; melody: Melody }) {
  return <div className={styles.answerHead}>{verse.phrases.map(phrase => <FamilyChip key={phrase.index} family={phrase.family} melody={melody} />)}</div>;
}

/** Hear it: the family, the phrase at Large over its colour, the play tile, what to listen for. */
function HearIt({ lesson, examples, onNext }: { lesson: Lesson; examples: readonly ExampleVerse[]; onNext(): void }) {
  const first = examples[0], [heard, setHeard] = useState(false);
  const words = first ? first.example.words : null, id = `hear:${lesson.id}`;
  const requests = first && words ? [phraseRequest(first.verse, words)] : [];
  return <>
    <div className={styles.stage}>
      {lesson.family && <FamilyChipLive id={id} family={lesson.family} melody={lesson.melody} />}
      {first && words && <UnitsText verse={first.verse} units={words} className={styles.phraseLarge} look={() => "inked"} />}
      {first && !lesson.family && <Legend verse={first.verse} melody={lesson.melody} />}
      <PlayTile id={id} requests={requests} onPlayed={() => setHeard(true)} />
      <AudioError id={id} />
      {first && <span className={styles.ref}><bdi dir="ltr">{first.verse.ref}</bdi></span>}
    </div>
    <p className={styles.listen}>{lesson.listenFor}</p>
    <div className={styles.body}>{lesson.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>
    <Marks lesson={lesson} />
    <Footer><button type="button" className="button-start" onClick={onNext} data-heard={heard || undefined}>Next</button></Footer>
  </>;
}
/** The chip whose contour draws itself while the Hear it tile plays. */
function FamilyChipLive({ id, family, melody }: { id: string; family: FamilyId; melody: Melody }) {
  const state = usePlayerState();
  return <FamilyChip family={family} melody={melody} large drawSeconds={state.id === id && state.status === "playing" ? state.seconds : undefined} />;
}

/** In verses: every example, its reference and a play tile. */
function InVerses({ lesson, examples, onNext }: { lesson: Lesson; examples: readonly ExampleVerse[]; onNext(): void }) {
  return <>
    <h2 className={styles.prompt}>In verses</h2>
    <ol className={styles.verses}>{examples.map(({ example, verse }) => {
      const id = `verse:${lesson.id}:${example.ref}`;
      return <li key={id} className={styles.verseRow}>
        <PlayTile id={id} iconOnly label={`Hear ${example.ref}`} requests={[phraseRequest(verse, example.words)]} />
        <div>
          <UnitsText verse={verse} units={example.words} className={styles.phraseStandard} look={() => "inked"} />
          <p className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></p>
          <p className={styles.why}>{example.why}</p>
          <AudioError id={id} />
        </div>
      </li>;
    })}</ol>
    <Footer><button type="button" className="button-start" onClick={onNext}>Next</button></Footer>
  </>;
}

/** One drill run: items answered before anything is shown; misses come back; Next after each answer. */
function DrillStep({ lesson, activity, data, stopEarly, onAnswered, onDone }: { lesson: Lesson; activity: Drill; data: Ready; stopEarly: boolean;
  onAnswered(item: DrillItem, activity: Drill, right: boolean): void; onDone(): void }) {
  const { audio } = useLearnServices();
  const melody = lesson.melody;
  const seed = useRef(Math.floor(Math.random() * 2 ** 31));
  const items = useMemo(() => drillItems(activity, data.pools, { melody, focus: lesson.family }, seededRandom(seed.current)), [activity, data.pools, melody, lesson.family]);
  const [run, setRun] = useState<Run>(() => startRun(items)), [shown, setShown] = useState<{ item: DrillItem; n: number } | null>(() => items[0] ? { item: items[0], n: 0 } : null);
  const [answered, setAnswered] = useState(false), rng = useRef(seededRandom(seed.current + 1)), nextButton = useRef<HTMLButtonElement>(null);
  const { player } = useLearnServices();
  useEffect(() => { if (!items.length) onDone(); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  const contrast = (family: FamilyId, avoid: readonly string[]): Phrase | null => {
    const pool = poolOf(data.pools, family, shown.item.type === "hear-and-name" ? shown.item.answer.kind : melody).filter(phrase => !avoid.includes(phrase.ref));
    return pool.length ? pool[Math.floor(rng.current() * pool.length)] : null;
  };
  const answer = (right: boolean) => {
    if (answered) return; setAnswered(true);
    const next = answerRun(run, right, rng.current); setRun(next); onAnswered(shown.item, activity, right);
    const upcoming = currentItem(next);
    if (upcoming) void prefetch(audio, upcoming);
    // The answered control is disabled now; keep keyboard focus moving forward.
    revealAnswer(nextButton);
  };
  const advance = () => {
    player.stop();
    const finished = runDone(run);
    if (finished || stopEarly) { onDone(); return; }
    setShown({ item: currentItem(run)!, n: shown.n + 1 }); setAnswered(false); window.scrollTo({ top: 0 });
  };
  const props = { pools: data.pools, melody, contrast, onAnswer: answer };
  const item = shown.item, key = `${item.key}:${shown.n}`;
  return <>
    {item.type === "hear-and-name" ? <HearAndName key={key} item={item} {...props} />
      : item.type === "same-or-different" ? <SameOrDifferent key={key} item={item} {...props} />
      : item.type === "where-does-it-end" ? <WhereDoesItEnd key={key} item={item} {...props} prompt={activity.type === "where-does-it-end" ? activity.params.prompt : undefined} />
      : item.type === "tap-the-phrase" ? <TapThePhrase key={key} item={item} {...props} />
      : item.type === "look-alikes" ? <LookAlikes key={key} item={item} {...props} first={shown.n === 0} />
      : item.type === "which-half" ? <WhichHalf key={key} item={item} {...props} />
      : <BuildThePhrase key={key} item={item} {...props} />}
    <Footer><button ref={nextButton} type="button" className="button-start" disabled={!answered} onClick={advance}>Next</button></Footer>
  </>;
}
function prefetch(audio: ReturnType<typeof useLearnServices>["audio"], item: DrillItem) {
  if (item.type === "look-alikes") {
    // Read mode plays nothing until the answer; hear mode plays the answer word's phrase.
    const side = item.shown[item.answer], heard = item.mode === "hear" ? phraseAt(side.verse, side.word.word) : null;
    return heard ? audio.phraseClip(phraseRequest(heard, heard.words), new AbortController().signal).catch(() => null) : Promise.resolve(null);
  }
  const phrase = item.type === "hear-and-name" ? item.answer : item.type === "same-or-different" ? item.first : item.type === "build-the-phrase" ? item.phrase : item.target;
  const words = item.type === "which-half" && item.audio === "lead-in" ? [0, phrase.words[1]] as const : phrase.words;
  return audio.phraseClip(phraseRequest(phrase, words), new AbortController().signal).catch(() => null);
}

/** End of a lesson: a plain fact about what you can now hear, this week's reading, the next step. */
function Done({ lesson, complete, nextId, fallback }: { lesson: Lesson; complete(): void; nextId: string | null; fallback: readonly ExampleVerse[] }) {
  useEffect(() => { complete(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const next = nextId ? lessonById(nextId) : null;
  const week = lesson.activities.find((activity): activity is ThisWeekActivity => activity.type === "this-week");
  return <>
    <div className={styles.doneHead}><h1 className={styles.doneTitle}>{lesson.title}</h1><p className={styles.doneWord}>Done</p></div>
    <p className={styles.doneLine}>{presentGoal(lesson.goal)}</p>
    {week && <ThisWeekSection activity={week} lesson={lesson} fallback={fallback} />}
    {next && <p className={styles.nextName}>Next: {next.title}</p>}
    <Footer>
      {next && <a className="button-start" href={`/learn/${next.id}`}>Start next lesson</a>}
      <a className={styles.backLink} href="/learn">Back to the path</a>
    </Footer>
  </>;
}
