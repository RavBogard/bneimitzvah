"use client";
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { Melody } from "../../lib/learn/course";
import { localDay } from "../../lib/learn/progress";
import { practiseAgain, recordVerse, stumbledRefs, verseCardId, type VerseRun } from "../../lib/learn/verse-review";
import { useOwnReading } from "./own-reading";
import { useVerseReview } from "./own-verses";
import { useVerseTexts, VerseRunView } from "./verse-run";
import styles from "./learn.module.css";

/**
 * 1.9 N19: the Run-through. A signed-in student chants their own reading verse by verse with no audio and the colours off,
 * and marks each verse Clean or Stumbled. A stumble feeds review (the verse becomes a card, or its card drops); the summary
 * names the stumbled verses, "Practise verses 3 and 8 again.", with no tally. Nothing here plays, and nothing is shown to
 * a tutor, a parent or anyone else: the results live only in the student's own verse cards.
 * Anyone without an own reading (signed out, a tutor, a parent, an admin) sees only the way back.
 */
const close = <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>;
export function RunThroughScreen({ kind }: { kind: Melody | null }) {
  const own = useOwnReading(), verseCards = useVerseReview();
  const frame = (body: ReactNode, footer?: ReactNode) => <div className={`portal-shell ${styles.shell}`}>
    <header className={styles.bar}><a className={styles.close} href="/learn" aria-label="Back to the path">{close}</a><h1 className={styles.barTitle}>Run-through</h1><span /></header>
    <main className={styles.lesson}>{body}{footer && <div className={styles.footer}><div className={styles.footerInner}>{footer}</div></div>}</main>
  </div>;
  const back = <a className={styles.backLink} href="/learn">Back to the path</a>;
  if (own.status === "pending") return frame(<p role="status" className={styles.state}>Loading the reading…</p>);
  const reading = own.status === "ready" ? (kind ? own[kind] : null) ?? own.torah ?? own.haftarah : null;
  if (!reading) return frame(null, back);
  const both = own.status === "ready" && own.torah && own.haftarah;
  return <RunThroughReading key={`${reading.kind}:${reading.id}:${reading.revision}`} verses={reading.verses} kind={reading.kind} frame={frame} back={back} verseCards={verseCards}
    nav={both ? <nav className={styles.links} aria-label="Reading"><a href="/learn/run-through" aria-current={reading.kind === "torah" ? "page" : undefined}>Torah</a>
      <a href="/learn/run-through?kind=haftarah" aria-current={reading.kind === "haftarah" ? "page" : undefined}>Haftarah</a></nav> : null} />;
}

function RunThroughReading({ verses, kind, frame, back, nav, verseCards }: { verses: readonly string[]; kind: Melody; frame(body: ReactNode, footer?: ReactNode): ReactElement;
  back: ReactNode; nav: ReactNode; verseCards: ReturnType<typeof useVerseReview> }) {
  const ids = useMemo(() => verses.map(ref => verseCardId(kind, ref)), [verses, kind]);
  const [retry, setRetry] = useState(0), texts = useVerseTexts(ids, retry), [done, setDone] = useState<VerseRun | null>(null), today = useRef(localDay(Date.now()));
  const state = verseCards.state, review = state.status === "ready" ? state.review : null, until = state.status === "ready" ? state.until : null;
  if (texts.status === "loading") return frame(<p role="status" className={styles.state}>Loading the reading…</p>);
  if (texts.status === "error") return frame(<div className={styles.state}><button type="button" className="button-secondary" onClick={() => setRetry(n => n + 1)}>Try again</button></div>, back);
  if (done) {
    const line = practiseAgain(stumbledRefs(done));
    return frame(<>{line && <p className={styles.doneLine} data-run-summary>{line}</p>}{nav}</>, back);
  }
  if (!texts.verses.length) return frame(nav, back);
  return <VerseRunView verses={texts.verses} review={review} mode="run-through" frame={frame} onDone={setDone}
    onAnswer={(id, clean) => verseCards.update(value => recordVerse(value, id, clean, today.current, { until }))} />;
}
