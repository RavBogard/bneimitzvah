"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Assigned, Reading, Student } from "../api";
import { useWorkspace, WorkspaceLink } from "../provider";
import type { ProgressRows } from "../progress/api";
import type { ProgressVerse } from "../../../../lib/progress/types";
import type { TutorPractice } from "../../../../lib/practice-visibility/types";
import type { PracticeCalendar } from "../practice-calendar/store";
import { BeforeNext } from "../lessons/panel";
import { Chip } from "../../../ui";
import { useTutorPractice } from "./practice";
import { ALIYOT_HEADING, aliyahRows, lastLessonLine, markSolidLabel, marksFromLine, marksSince, practisedSince, practisedSinceLine, READINGS_HEADING, sinceHeading, type AliyahRow } from "./lesson-prep-model";

/**
 * Project review 2026-11-16, T1 and T10: the Aliyot block on the staff lesson card. One row per aliyah (or per reading with no aliyot) with
 * Not started / Working / Solid, from the same progress pages the tutor and admin already read verse by verse (nothing new is asked of
 * the server). The assigned tutor can mark a whole aliyah solid: the existing one-verse assessment write, sent once per verse in turn,
 * with its own progress and failure lines. An admin sees the states only.
 */
type Progress = { done: number; of: number };
export function AliyotList({ rows, canMark, pending, failure, onMark }: { rows: readonly AliyahRow[]; canMark: boolean; pending: ({ key: string } & Progress) | null;
  failure: ({ key: string } & Progress) | null; onMark(row: AliyahRow): void }) {
  const heading = useId();
  if (!rows.length) return null;
  const divided = rows.some(row => row.key.startsWith("torah:"));
  return <section className="aliyot" data-testid="aliyot" aria-labelledby={heading}>
    <h3 id={heading}>{divided ? ALIYOT_HEADING : READINGS_HEADING}</h3>
    <ul className="aliyot-rows">{rows.map(row => <li key={row.key} className="aliyot-row" data-testid="aliyah-row" data-row={row.key} data-state={row.state}>
      <span className="aliyot-row-name"><span>{row.label}</span> <bdi dir="ltr">{row.ref}</bdi></span>
      <Chip tone={row.state === "solid" ? "done" : row.state === "working" ? "info" : "neutral"}>{row.word}</Chip>
      {canMark && row.state !== "solid" && <button type="button" className="button-secondary aliyot-mark" data-testid="mark-aliyah-solid" disabled={pending !== null} aria-busy={pending?.key === row.key || undefined}
        onClick={() => onMark(row)}>{markSolidLabel(row)}</button>}
      {pending?.key === row.key && <p className="field-help aliyot-note" role="status" data-testid="mark-aliyah-pending">Marking {pending.done} of {pending.of} verses solid…</p>}
      {failure?.key === row.key && <p className="field-help aliyot-note" role="alert" data-testid="mark-aliyah-failed">Marked {failure.done} of {failure.of} verses solid. The rest didn't save. The states shown are the saved ones. Try again.</p>}
    </li>)}</ul>
  </section>;
}

type Marks = { scope: string; value: ReadonlyMap<Reading["kind"], readonly ProgressVerse[]> };
export function AliyotBlock({ baseline, onMarked }: { baseline: Assigned; onMarked?(): void }) {
  const { readProgress } = useWorkspace();
  const scope = JSON.stringify([baseline.mode, baseline.student.id, baseline.readings.map(row => [row.id, row.revision])]);
  const [marks, setMarks] = useState<Marks | null>(null), [tick, setTick] = useState(0);
  const [pending, setPending] = useState<({ key: string } & Progress) | null>(null), [failure, setFailure] = useState<({ key: string; scope: string } & Progress) | null>(null);
  const writing = useRef<AbortController | null>(null);
  useEffect(() => () => writing.current?.abort(), [scope]);
  useEffect(() => {
    if (baseline.mode !== "tutor" && baseline.mode !== "admin") return;
    const request = new AbortController();
    (async () => {
      const value = new Map<Reading["kind"], ProgressVerse[]>();
      for (const reading of baseline.readings) {
        const verses: ProgressVerse[] = []; let offset: number | null = 0, pages = 0;
        while (offset !== null && pages++ < 11) {
          const page = await readProgress(baseline, reading.kind, { type: "page", offset }, request.signal) as ProgressRows;
          verses.push(...page.verses); offset = page.nextOffset;
        }
        value.set(reading.kind, verses);
      }
      if (!request.signal.aborted) setMarks({ scope, value });
    })().catch(() => undefined);
    return () => request.abort();
  }, [baseline, readProgress, scope, tick]);
  const current = marks?.scope === scope ? marks.value : null;
  if (!current) return null;
  const rows = aliyahRows(baseline.readings, current);
  async function mark(row: AliyahRow) {
    if (pending || baseline.mode !== "tutor") return;
    const request = new AbortController(); writing.current = request;
    const of = row.unsolid.length; let done = 0;
    setFailure(null); setPending({ key: row.key, done, of });
    try {
      // The existing per-verse assessment write, one verse at a time, each with the version just read (a conflict stops the run).
      for (const verse of row.unsolid) {
        await readProgress(baseline, row.kind, { type: "assessment", verseRef: verse.verseRef, state: "solid", expectedVersion: verse.assessment.version }, request.signal);
        done++; if (!request.signal.aborted) setPending({ key: row.key, done, of });
      }
    } catch { if (!request.signal.aborted) setFailure({ key: row.key, scope, done, of }); }
    finally { if (!request.signal.aborted) { setPending(null); setTick(value => value + 1); onMarked?.(); } }
  }
  return <AliyotList rows={rows} canMark={baseline.mode === "tutor"} pending={pending} failure={failure?.scope === scope ? failure : null} onMark={row => void mark(row)} />;
}

/**
 * T4/T7: "Since your last lesson" at the top of the lesson card, on every width. The last lesson's date and its "Before next time" come
 * from the lesson notes staff already read; days practised since then from the practice calendar staff already read (dates only). The
 * verses newly marked since then come only from the assigned tutor's own practice-visibility read (decision 7): `practice` is null for
 * an admin, and this never shows per-day detail to anyone but the assigned tutor. With no lesson note yet, there is no block.
 */
export function SinceLastLesson({ mode, lesson, practised, practice }: { mode: "tutor" | "admin"; lesson: { lessonDate: string; beforeNext: string | null } | null;
  practised: { today: string; dates: Iterable<string> } | null; practice: TutorPractice | null }) {
  const heading = useId();
  if (!lesson) return null;
  const tutor = mode === "tutor", days = practised ? practisedSince(practised.dates, lesson.lessonDate, practised.today) : null;
  const marks = tutor && practice ? marksSince(practice, lesson.lessonDate) : null;
  return <section className="lesson-since" data-testid="lesson-since" aria-labelledby={heading}>
    <h3 id={heading}>{sinceHeading(tutor)}</h3>
    <p data-testid="since-lesson-date"><time dateTime={lesson.lessonDate}>{lastLessonLine(lesson.lessonDate)}</time></p>
    {days !== null && <p data-testid="since-practised">{practisedSinceLine(days)}</p>}
    {marks && <ul className="lesson-since-marks" data-testid="since-marks">{marks.lines.map(line => <li key={line}>{line}</li>)}</ul>}
    {marks?.from && <p className="field-help">{marksFromLine(marks.from)}</p>}
    {lesson.beforeNext && <BeforeNext text={lesson.beforeNext} own={false} />}
  </section>;
}
/** The live block: the calendar's dates and, for the assigned tutor, the tutor's own read. */
export function LessonSince({ mode, lesson, calendar }: { mode: "tutor" | "admin"; lesson: { lessonDate: string; beforeNext: string | null } | null; calendar: PracticeCalendar }) {
  const state = useSyncExternalStore(calendar.subscribe, calendar.snapshot, calendar.snapshot), practice = useTutorPractice();
  return <SinceLastLesson mode={mode} lesson={lesson} practised={state.status === "ready" ? { today: state.serverDay, dates: state.dates } : null} practice={mode === "tutor" ? practice : null} />;
}

/**
 * An unassigned student's page for staff (project review 2026-11-16, walkthrough finding 31): the real next steps first, as the places that
 * already do them. Assign verses opens the verse editor; an admin also gets People and access (choose a tutor) and Invitations (invite a parent).
 */
export function StaffNextSteps({ mode, student, torahOnly, onAssign, practiceAction }: { mode: "tutor" | "admin"; student: Pick<Student, "id" | "firstName">; torahOnly: boolean;
  onAssign(event: { currentTarget: HTMLElement }): void; practiceAction?: ReactNode }) {
  const id = encodeURIComponent(student.id);
  return <div className="reading-empty" data-testid="staff-next-steps">
    <h2 className="hero-reference hero-reference-empty">{torahOnly ? "No Torah verses assigned yet" : "No reading has been assigned yet"}</h2>
    <p className="hero-meta">Choose the {torahOnly ? "Torah verses" : "verses"} <bdi dir="auto">{student.firstName}</bdi> will read.</p>
    <div className="hero-actions">
      <button type="button" className="button-hero-secondary" onClick={onAssign}>Assign verses</button>
      {mode === "admin" && <WorkspaceLink className="button-secondary" href={`/workspace/admin/students/${id}/access`} data-testid="next-step-tutor">Choose a tutor</WorkspaceLink>}
      {mode === "admin" && <WorkspaceLink className="button-secondary" href={`/workspace/admin/invitations?student=${id}&role=parent`} data-testid="next-step-invite">Invite a parent</WorkspaceLink>}
      {practiceAction}
    </div>
  </div>;
}
