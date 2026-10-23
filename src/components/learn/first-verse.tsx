"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import type { FirstVerse as FirstVerseActivity, Lesson } from "../../lib/learn/course";
import { isSpecialMelody, type AnalysedVerse } from "../../lib/learn/verse";
import { AudioError, FamilyChip, phraseRequest, PlayTile, UnitsText } from "./bits";
import { useCourseVerses } from "./course-data";
import { useLearnServices, usePlayerState, useProgress } from "./services";
import { useWeekVerses } from "./week-data";
import styles from "./learn.module.css";

/** The families every beginner meets first; a verse made only of these is preferred. */
const COMMON: ReadonlySet<FamilyId> = new Set<FamilyId>(["sof-pasuk", "etnachta", "zakef", "revia", "tevir", "sof-haftarah"]);
/** Shortest word-ready verse of the week first, common families first; ties keep reading order. */
export function firstVerseCandidates(verses: readonly AnalysedVerse[], maxWords: number): AnalysedVerse[] {
  const fits = verses.filter(verse => verse.wordReady && !isSpecialMelody(verse.ref) && verse.units.length <= maxWords && verse.units.length >= 2);
  const common = (verse: AnalysedVerse) => verse.phrases.every(phrase => COMMON.has(phrase.family)) ? 0 : 1;
  return fits.map((verse, order) => ({ verse, order })).sort((a, b) => common(a.verse) - common(b.verse) || a.verse.units.length - b.verse.units.length || a.order - b.order).map(row => row.verse);
}
/** The deep link into Lein: this Shabbat, this reading, this verse (its 1-based place in the reading) selected. */
export const readLink = (date: string, kind: string, position: number) => `/read?${new URLSearchParams([["date", date], ["kind", kind], ["verse", String(position)]]).toString()}`;
const STEPS = ["Hear each phrase", "Hear the verse", "Chant along, slowly", "Chant along"] as const;

/** Your first verse: hear each phrase, the verse, then chant along at 0.75 and at 1; then the one quiet moment. */
export function FirstVerse({ lesson, onDone }: { lesson: Lesson; onDone(): void }) {
  const activity = lesson.activities.find((row): row is FirstVerseActivity => row.type === "first-verse")!;
  const kind = activity.params.kind, week = useWeekVerses(kind), fallbackData = useCourseVerses(useMemo(() => [lesson], [lesson]));
  const { progress } = useProgress(), celebrated = useRef(progress ? Object.hasOwn(progress.lessons, lesson.id) : false);
  useEffect(() => { if (progress && Object.hasOwn(progress.lessons, lesson.id)) celebrated.current = true; }, [progress, lesson.id]);
  const weekCandidates = useMemo(() => week.status === "ready" ? firstVerseCandidates(week.verses, activity.params.maxWords) : [], [week, activity.params.maxWords]);
  const fallback = useMemo(() => fallbackData.status === "ready" ? (fallbackData.examples.get(lesson.id) ?? []).map(row => row.verse) : [], [fallbackData, lesson.id]);
  const fromWeek = weekCandidates.length > 0, candidates = fromWeek ? weekCandidates : fallback;
  const [choice, setChoice] = useState(0), [step, setStep] = useState(0), [phrase, setPhrase] = useState(0), [sheet, setSheet] = useState(false);
  const { player } = useLearnServices();
  const settled = week.status !== "loading" && (fromWeek || fallbackData.status !== "loading");
  if (!settled) return <p role="status" className={styles.state}>Loading the reading…</p>;
  if (week.status === "none" && kind === "haftarah" && !fallback.length) return <p>No recording for this haftarah yet.</p>;
  const verse = candidates[choice % Math.max(1, candidates.length)];
  if (!verse) return <div role="status" className={styles.state}><p>The recording did not load. Try again.</p></div>;
  const date = week.status === "ready" ? week.date : null;
  const whole = phraseRequest(verse, [0, verse.units.length - 1]), current = verse.phrases[phrase];
  const id = `first:${verse.ref}:${step}:${phrase}`;
  const next = () => {
    player.stop();
    if (step === 0 && phrase < verse.phrases.length - 1) { setPhrase(phrase + 1); return; }
    if (step < STEPS.length - 1) { setStep(step + 1); setPhrase(0); return; }
    if (activity.params.celebrate && !celebrated.current) { celebrated.current = true; setSheet(true); void player.play(`sheet:${verse.ref}`, [whole]); }
    else onDone();
  };
  const position = week.status === "ready" ? week.refs.indexOf(verse.ref) + 1 : 0;
  const lein = date && fromWeek && position > 0 ? readLink(date, kind, position) : "/read";
  return <>
    <p className={styles.listen}>One verse from this week's reading.</p>
    {!fromWeek && <p className={styles.muted}>From the course's own verses while this week's recording is not ready.</p>}
    {week.status === "ready" && week.shifted && <p className={styles.muted}>Showing the coming Shabbat.</p>}
    <ol className={styles.steps} aria-label="Steps">{STEPS.map((label, i) => <li key={label} className={styles.stepItem} data-state={i < step ? "done" : i === step ? "current" : undefined}>
      <span className={styles.number} data-on={i === step} aria-hidden="true">{i + 1}</span>{label}{i === step && <span className="sr-only">, current step</span>}</li>)}</ol>
    <div className={styles.stage}>
      <UnitsText verse={verse} className={styles.phraseLarge} look={unit => step === 0 ? (current && unit >= current.units[0] && unit <= current.units[1] ? "inked" : "plain") : "inked"} />
      {step === 0 && current && <FamilyChip family={current.family} melody={kind} />}
      <PlayTile key={id} id={id} requests={step === 0 && current ? [phraseRequest(verse, current.units)] : [whole]} rate={step === 2 ? 0.75 : 1} />
      <AudioError id={id} />
      <span className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></span>
    </div>
    {step === 0 && phrase === 0 && candidates.length > 1 && <button type="button" className={styles.textButton} onClick={() => { player.stop(); setChoice(choice + 1); setPhrase(0); }}>Choose a different verse</button>}
    <div className={styles.footer}><div className={styles.footerInner}><button type="button" className="button-start" onClick={next}>Next</button></div></div>
    {sheet && <Celebration verse={verse} lein={activity.params.openInLein ? lein : null} onBack={() => { player.stop(); setSheet(false); onDone(); }} />}
  </>;
}

/** The one quiet moment (COURSE.md): the verse on the lake sheet, its phrase colours wiping in word by word
 * with the ink pull as the recording plays once, then one line, the reference and two plain actions. */
function Celebration({ verse, lein, onBack }: { verse: AnalysedVerse; lein: string | null; onBack(): void }) {
  const state = usePlayerState(), [shown, setShown] = useState(false), start = useRef<number | null>(null), sheet = useRef<HTMLDivElement>(null);
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const playing = state.id === `sheet:${verse.ref}` && state.status === "playing", seconds = playing ? state.seconds : 0;
  if (playing && start.current === null) start.current = seconds;
  const span = start.current ?? 0, inking = reduced || start.current !== null;
  useEffect(() => { sheet.current?.focus(); }, []);
  useEffect(() => {
    if (reduced) { setShown(true); return; }
    if (state.id === `sheet:${verse.ref}` && (state.status === "error" || state.status === "idle") && start.current === null) { setShown(true); return; }
    if (start.current === null) return;
    const timer = setTimeout(() => setShown(true), (span + 0.6) * 1000);
    return () => clearTimeout(timer);
  }, [reduced, span, state.status, state.id, verse.ref]);
  // Each word starts its wipe at its share of the recording, so the colour follows the voice.
  const delay = (unit: number) => reduced ? 0 : span * unit / verse.units.length / 0.07;
  return <div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="celebration-line" tabIndex={-1}>
    <div className={styles.sheetStage}>
      <p className={styles.sheetRef}><bdi dir="ltr">{verse.ref}</bdi></p>
      <UnitsText key={inking ? "ink" : "plain"} verse={verse} className={styles.sheetHebrew} look={() => inking ? "pull" : "plain"} wipe={delay} />
      <p id="celebration-line" className={`${styles.sheetLine}${shown ? "" : ` ${styles.sheetHidden}`}`} aria-live="polite">{shown ? "You can lein this verse." : ""}</p>
    </div>
    <div className={`${styles.sheetActions}${shown ? "" : ` ${styles.sheetHidden}`}`}>
      {lein && <a className={`${styles.sheetStep} ${styles.sheetPrimary}`} href={lein}>Open in Lein</a>}
      <button type="button" className={styles.sheetStep} onClick={onBack}>Back to the path</button>
    </div>
  </div>;
}
