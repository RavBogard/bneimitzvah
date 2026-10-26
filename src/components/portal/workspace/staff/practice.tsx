"use client";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { practiceVisibilityApi } from "../../practice-visibility/api";
import { PRACTICE_VISIBILITY_FROM, practiceVisibilityFrom } from "../../../../lib/practice-visibility/release";
import { canHearLines, dayLabel, dayLine, markLine, mixedUpLine, parentCountLine, rosterLine } from "../../../../lib/practice-visibility/lines";
import type { PracticeKind, PracticeMarkState, TutorPractice } from "../../../../lib/practice-visibility/types";

/**
 * 1.9 N23 display (decision 7): what the assigned tutor sees of a student's practice, and a parent's counts. Every line here is
 * built only from #120's read (`practiceVisibilityApi`), which asks nothing while the release gate is closed, so none of these can
 * render before the student's disclosure on Account, in Learn and in child practice does. `from` is the gate, injectable for tests.
 *
 * - the per-day lines ("Tue Oct 20 · Torah 23:1–23:9 · marked 23:4 Got it") and Learn's lines ("Often mixed up: tevir and
 *   etnachta") in the tutor's Lessons;
 * - the roster card line ("Practised 3 of last 7 days · Last lesson Oct 17 · 2 verses still working") on the tutor's cards;
 * - a mark made with a parent, on the verse card: "Student (with parent): got it";
 * - the parent's count line ("Noa has marked 12 verses Got it and 3 Still working.") in the parent's This week.
 * Admins (rabbis) never get this read; their pages are unchanged.
 */
export type TutorPracticeState = { view: TutorPractice; sources: ReadonlyMap<string, boolean | null> } | null;
const sourceKey = (kind: PracticeKind, verseRef: string, state: PracticeMarkState) => `${kind}|${verseRef}|${state}`;
const TutorPracticeContext = createContext<TutorPracticeState>(null);

/** The assigned tutor's read of one student, once per student page; null for anyone else, while the gate is closed, or on failure. */
export function useTutorPracticeRead(mode: string, studentId: string, from: string | null = PRACTICE_VISIBILITY_FROM): TutorPracticeState {
  const [state, setState] = useState<{ id: string; value: TutorPracticeState } | null>(null);
  const open = mode === "tutor" && practiceVisibilityFrom(from) !== null;
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    practiceVisibilityApi.tutor(studentId, request.signal, from).then(
      view => { if (!request.signal.aborted) setState({ id: studentId, value: view && { view, sources: new Map(view.marks.map(mark => [sourceKey(mark.kind, mark.verseRef, mark.state), mark.withParent])) } }); },
      () => { if (!request.signal.aborted) setState({ id: studentId, value: null }); });
    return () => request.abort();
  }, [open, studentId, from]);
  return open && state?.id === studentId ? state.value : null;
}
/** Provides the read to the lines below it. The read's state lives here, so its answer re-renders only the context's users. */
export function TutorPracticeScope({ mode, studentId, concealed, children }: { mode: string; studentId: string; concealed: boolean; children: ReactNode }) {
  const value = useTutorPracticeRead(mode, studentId);
  return <TutorPracticeContext.Provider value={concealed ? null : value}>{children}</TutorPracticeContext.Provider>;
}

/** TP-20 on a verse card: "Student (with parent): got it" when the tutor's read says a parent was there; "Student: got it" otherwise. */
export function useStudentMarkLine(kind: PracticeKind, verseRef: string, state: PracticeMarkState): string {
  const practice = useContext(TutorPracticeContext);
  return markLine(state, practice?.sources.get(sourceKey(kind, verseRef, state)) ?? null);
}

/** The tutor's Lessons: one line per day practised (newest first) and Learn to lein's lines. */
export function TutorPracticeDays() {
  const practice = useContext(TutorPracticeContext), days = useId(), learn = useId();
  if (!practice) return null;
  const { view } = practice, since = [view.from, addDays(view.today, -13)].sort().at(-1)!;
  const mixedUp = view.learn ? mixedUpLine(view.learn) : null;
  return <section className="tutor-practice" data-testid="tutor-practice" aria-labelledby={days}>
    <h3 id={days}>Verses practised</h3>
    {view.days.length ? <ul className="tutor-practice-days">{[...view.days].sort((a, b) => b.day.localeCompare(a.day)).map(entry => <li key={entry.day} data-testid="practice-day-line">{dayLine(entry)}</li>)}</ul>
      : <p className="field-help">No verses opened since {dayLabel(since)}.</p>}
    {view.learn && <div className="tutor-practice-learn" role="group" aria-labelledby={learn}>
      <h3 id={learn}>Learn to lein</h3>
      {canHearLines(view.learn).map(line => <p key={line}>{line}</p>)}
      {mixedUp && <p data-testid="mixed-up-line">{mixedUp}</p>}
    </div>}
  </section>;
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The tutor's student card: "Practised 3 of last 7 days · Last lesson Oct 17 · 2 verses still working". */
export function TutorCardLine({ studentId, from = PRACTICE_VISIBILITY_FROM }: { studentId: string; from?: string | null }) {
  const [line, setLine] = useState<{ id: string; text: string } | null>(null);
  const open = practiceVisibilityFrom(from) !== null;
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    practiceVisibilityApi.tutor(studentId, request.signal, from).then(view => { if (!request.signal.aborted && view) setLine({ id: studentId, text: rosterLine(view) }); }, () => undefined);
    return () => request.abort();
  }, [open, studentId, from]);
  return open && line?.id === studentId ? <span className="student-card-practice" data-testid="practice-roster-line">{line.text}</span> : null;
}

/** The parent's count line for one child, in the parent's This week. */
export function ParentCountLine({ studentId, name, from = PRACTICE_VISIBILITY_FROM }: { studentId: string; name: string; from?: string | null }) {
  const [counts, setCounts] = useState<{ id: string; gotIt: number; working: number } | null>(null);
  const open = practiceVisibilityFrom(from) !== null;
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    practiceVisibilityApi.parent(studentId, request.signal, from).then(value => { if (!request.signal.aborted && value) setCounts({ id: studentId, ...value }); }, () => undefined);
    return () => request.abort();
  }, [open, studentId, from]);
  return open && counts?.id === studentId ? <p className="parent-summary-marks" data-testid="parent-count-line"><bdi dir="auto">{parentCountLine(name, counts)}</bdi></p> : null;
}
