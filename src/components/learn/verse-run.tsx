"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { familyColor, type Melody } from "../../lib/learn/course";
import { analyseVerse } from "../../lib/learn/verse";
import { tikkunText } from "../../lib/hebrew/tikkun";
import type { HebrewSource } from "../../lib/hebrew/study-tokens";
import { localDay } from "../../lib/learn/progress";
import { answerVerseRun, currentVerse, HELP_LEVELS, parseVerseCardId, recordVerse, startVerseRun, suggestedHelp, verseRunDone,
  type HelpLevel, type VerseCardId, type VerseReview, type VerseRun } from "../../lib/learn/verse-review";
import { verseTexts } from "./verses-api";
import styles from "./learn.module.css";
import stamStyles from "../../styles/stam-font.module.css";

/**
 * 1.9 N19: a student's own verses, one at a time, with no audio at all (the G3 gate; a structural test holds that this
 * module and the Run-through import no player, no phrase audio and no recording). The student chants the verse from the
 * text and answers Clean or Stumbled; nothing is scored and nothing is counted.
 */
const LEVEL_LABEL: Record<HelpLevel, string> = { colors: "Colors", marks: "Marks only", tikkun: "Tikkun" };
/** "Help: Colors → Marks only → Tikkun" (Daniel, 2026-10-24). The fade is a suggestion: every level stays one tap away. */
export function HelpLine({ value, onChange }: { value: HelpLevel; onChange(level: HelpLevel): void }) {
  return <p className={styles.helpLine} role="group" aria-label="Help"><span>Help: </span>{HELP_LEVELS.map((level, i) => <span key={level}>
    {i > 0 && <span aria-hidden="true"> → </span>}
    <button type="button" className={styles.helpLevel} aria-pressed={value === level} onClick={() => onChange(level)}>{LEVEL_LABEL[level]}</button>
  </span>)}</p>;
}

/** The verse at one level of help: phrase colours, the pointed text with its marks alone, or the scroll's letters. */
export function VerseText({ verseRef, kind, hebrew, level }: { verseRef: string; kind: Melody; hebrew: HebrewSource; level: HelpLevel }) {
  const verse = useMemo(() => analyseVerse({ ref: verseRef, kind, hebrew }), [verseRef, kind, hebrew]);
  if (level === "tikkun") return <p className={`${styles.hebrew} ${styles.runVerse} ${stamStyles.stam}`} lang="he" dir="rtl" data-help="tikkun">{tikkunText(hebrew.text)}</p>;
  if (!verse) return <p className={`${styles.hebrew} ${styles.runVerse}`} lang="he" dir="rtl" data-help="marks">{hebrew.readingText}</p>;
  return <p className={`${styles.hebrew} ${styles.runVerse}`} lang="he" dir="rtl" data-help={level}>{verse.units.map((unit, i) => <span key={unit.index}>{i > 0 && " "}
    <span className={level === "colors" ? `${styles.unit} ${styles.inked}` : styles.unit} style={level === "colors" ? { "--phrase-color": familyColor(unit.family) } as CSSProperties : undefined}>{unit.text}</span>
  </span>)}</p>;
}

export type RunVerse = Readonly<{ id: VerseCardId; ref: string; kind: Melody; hebrew: HebrewSource }>;
/** One verse of a run: "Chant this verse", the help line, the text, then Clean or Stumbled in the footer. */
export function VerseRunView({ verses, review, mode, onAnswer, onDone, frame }: { verses: readonly RunVerse[]; review: VerseReview | null; mode: "review" | "run-through";
  onAnswer(id: VerseCardId, clean: boolean): void; onDone(run: VerseRun): void; frame(body: ReactNode, footer?: ReactNode): ReactElement }) {
  const [run, setRun] = useState<VerseRun>(() => startVerseRun(verses.map(verse => verse.id)));
  const id = currentVerse(run), verse = verses.find(row => row.id === id) ?? null, card = id ? review?.cards[id] : undefined;
  const suggestion = suggestedHelp(card, mode), [level, setLevel] = useState<HelpLevel>(suggestion), heading = useRef<HTMLHeadingElement>(null);
  // Each verse opens at its own suggestion; the student may take more help or less at any time.
  useEffect(() => { setLevel(suggestion); heading.current?.focus({ preventScroll: true }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (verseRunDone(run)) onDone(run); }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!verse) return frame(null);
  const answer = (clean: boolean) => { onAnswer(verse.id, clean); setRun(value => answerVerseRun(value, clean ? "clean" : "stumbled")); window.scrollTo({ top: 0 }); };
  return frame(<section className={styles.runStep} aria-labelledby="verse-run-prompt" data-verse={verse.ref}>
    <h2 id="verse-run-prompt" ref={heading} tabIndex={-1} className={styles.prompt}>Chant this verse</h2>
    <p className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></p>
    <HelpLine value={level} onChange={setLevel} />
    {suggestion === "tikkun" && level !== "tikkun" && <p className={styles.runNote}>Try it in the tikkun.</p>}
    <VerseText verseRef={verse.ref} kind={verse.kind} hebrew={verse.hebrew} level={level} />
  </section>, <div className={styles.verseAnswers}>
    <button type="button" className="button-secondary" onClick={() => answer(true)}>Clean</button>
    <button type="button" className="button-secondary" onClick={() => answer(false)}>Stumbled</button>
  </div>);
}

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; verses: readonly RunVerse[] };
/** The text of some of the student's own verses, text only: no recording is asked for. */
export function useVerseTexts(ids: readonly VerseCardId[] | null, retry = 0): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" }), key = ids?.join("\n") ?? null;
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    setLoaded({ status: "loading" });
    (async () => {
      const cards = (ids ?? []).map(id => ({ id, ...parseVerseCardId(id)! })), out: RunVerse[] = [];
      for (const kind of ["torah", "haftarah"] as const) {
        const mine = cards.filter(card => card.kind === kind); if (!mine.length) continue;
        const texts = await verseTexts(mine.map(card => card.ref), kind, controller.signal);
        for (const card of mine) { const hebrew = texts.get(card.ref); if (hebrew) out.push(Object.freeze({ id: card.id, ref: card.ref, kind, hebrew })); }
      }
      const order = new Map((ids ?? []).map((id, i) => [id, i]));
      if (!controller.signal.aborted) setLoaded({ status: "ready", verses: out.sort((a, b) => order.get(a.id)! - order.get(b.id)!) });
    })().catch(() => { if (!controller.signal.aborted) setLoaded({ status: "error" }); });
    return () => controller.abort();
  }, [key, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  return loaded;
}

/** Due verse cards inside Review: each answer moves its card (up once per review when Clean, down when Stumbled). */
export function VerseReviewStage({ ids, review, until, update, onDone, frame }: { ids: readonly VerseCardId[]; review: VerseReview | null; until: string | null;
  update(change: (value: VerseReview) => VerseReview): void; onDone(): void; frame(body: ReactNode, footer?: ReactNode): ReactElement }) {
  const [retry, setRetry] = useState(0), texts = useVerseTexts(ids, retry), moved = useRef(new Set<string>()), today = useRef(localDay(Date.now()));
  const empty = texts.status === "ready" && !texts.verses.length;
  useEffect(() => { if (empty) onDone(); }, [empty]); // eslint-disable-line react-hooks/exhaustive-deps
  if (texts.status === "loading" || empty) return frame(<p role="status" className={styles.state}>Loading the review…</p>);
  if (texts.status === "error") return frame(<div className={styles.state}><button type="button" className="button-secondary" onClick={() => setRetry(n => n + 1)}>Try again</button></div>,
    <button type="button" className="button-secondary" onClick={onDone}>Next</button>);
  return <VerseRunView verses={texts.verses} review={review} mode="review" frame={frame} onDone={() => onDone()}
    onAnswer={(id, clean) => update(value => recordVerse(value, id, clean, today.current, { moved: moved.current, until }))} />;
}
