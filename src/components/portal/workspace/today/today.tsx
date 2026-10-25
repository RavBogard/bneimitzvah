"use client";
// 1.9 N11: the student's Today. Everything on it is read through the student's own workspace reads (the same ones the Reading page uses):
// the student list and assigned reading, the verse marks, the practice calendar's dates and the lesson notes. It adds no route and reads
// nobody else. It records nothing: opening Today is not practice.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { PortalRequestError } from "../../api";
import { workspaceApi, type Assigned, type Reading, type Student } from "../api";
import { statusOf, useWorkspace } from "../provider";
import { ButtonLink, Chip, EmptyState, List, ListRow } from "../../../ui";
import { ceremonyCountdown } from "../reading";
import { quietReadingAuthority } from "../quiet-refresh";
import { reconcileSelectedStudent, sortStudentsByCeremony } from "../student-label";
import { DocumentTitle } from "../document-title";
import { PracticeCalendar } from "../practice-calendar/store";
import { PracticeMonths } from "../practice-calendar/view";
import { dayOrdinal, dayString } from "../practice-calendar/api";
import { BeforeNext } from "../lessons/panel";
import { HonorsEntry } from "../honors/sheet";
import type { ProgressRows } from "../progress/api";
import type { LessonLogEntry } from "../../../../lib/lesson-log/types";
import type { ProgressVerse } from "../../../../lib/progress/types";
import { calendarMarks, deviceDate, lastSevenDays, parashahName, readingRows, refSegments, rehearsalLine, rowState, stateWord, displayRef, type RowState } from "./model";
import styles from "./today.module.css";

type Slice<T> = { status: "loading" } | { status: "unavailable" } | { status: "ready"; value: T };
const READING_HREF = "/workspace/student?tab=reading", LESSONS_HREF = "/workspace/student?tab=lessons";
const weekdayLetters = ["S", "M", "T", "W", "T", "F", "S"];
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const noteDay = (date: string) => { const [year, month, day] = date.split("-").map(Number); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day)); };

/** Every page of the student's marks for one reading (at most a thousand verses, a hundred to a page). */
async function readMarks(read: (baseline: Assigned, kind: Reading["kind"], operation: { type: "page"; offset: number }, signal: AbortSignal) => Promise<unknown>, baseline: Assigned, kind: Reading["kind"], signal: AbortSignal) {
  const verses: ProgressVerse[] = []; let offset = 0;
  for (let pages = 0; pages < 12; pages++) {
    const page = await read(baseline, kind, { type: "page", offset }, signal) as ProgressRows;
    verses.push(...page.verses);
    if (page.nextOffset === null) return verses;
    offset = page.nextOffset;
  }
  throw new PortalRequestError(503);
}

export function StudentToday() {
  const { epoch, readVerified, readProgress, readPracticeCalendar, readLessons, registerReload, registerWork, registerQuiet, serviceAuthorityFailed } = useWorkspace();
  const [rows, setRows] = useState<Student[]>([]), [assigned, setAssigned] = useState<Assigned | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading"), [retry, setRetry] = useState(0);
  const [marks, setMarks] = useState<Slice<ReadonlyMap<Reading["kind"], readonly ProgressVerse[]>>>({ status: "loading" });
  const [lesson, setLesson] = useState<Slice<LessonLogEntry | null>>({ status: "loading" });
  const selected = useRef<string | null>(null), abort = useRef<AbortController | null>(null), sequence = useRef(0), headingId = useId();
  const env = useRef({ readVerified, readProgress, readPracticeCalendar, readLessons, serviceAuthorityFailed, reload: () => undefined as unknown });
  const calendarRef = useRef<PracticeCalendar | null>(null);
  if (!calendarRef.current) calendarRef.current = new PracticeCalendar((...args) => env.current.readPracticeCalendar(...args), () => { void env.current.reload(); });
  const calendar = calendarRef.current, dates = useSyncExternalStore(calendar.subscribe, calendar.snapshot, calendar.snapshot);

  const load = useCallback(async () => {
    abort.current?.abort(); const request = new AbortController(), turn = ++sequence.current; abort.current = request;
    const stale = () => request.signal.aborted || turn !== sequence.current;
    calendar.clear(); setMarks({ status: "loading" }); setLesson({ status: "loading" }); setAssigned(null); setPhase("loading");
    try {
      const students = await workspaceApi.students("student", undefined, request.signal); if (stale()) return;
      const id = students.some(row => row.id === selected.current) ? selected.current : sortStudentsByCeremony(students)[0]?.id ?? null;
      selected.current = id; setRows(students);
      if (!id) { setPhase("ready"); return; }
      const value = await env.current.readVerified("student", id, request.signal); if (stale()) return;
      setRows(previous => reconcileSelectedStudent(previous, id, value.student));
      calendar.configure(value); setAssigned(value); setPhase("ready");
      const reads = [
        (async () => {
          try {
            const next = new Map<Reading["kind"], readonly ProgressVerse[]>();
            for (const reading of value.readings) next.set(reading.kind, await readMarks(env.current.readProgress, value, reading.kind, request.signal));
            if (!stale()) setMarks({ status: "ready", value: next });
          } catch (error) {
            if (stale()) return;
            if ([401, 403, 404].includes(statusOf(error))) env.current.serviceAuthorityFailed(statusOf(error));
            setMarks({ status: "unavailable" });
          }
        })(),
        (async () => {
          try {
            const page = await env.current.readLessons("student", id, { type: "page" }, request.signal) as { entries: LessonLogEntry[] };
            if (!stale()) setLesson({ status: "ready", value: page.entries[0] ?? null });
          } catch { if (!stale()) setLesson({ status: "unavailable" }); }
        })(),
        calendar.load(request.signal),
      ];
      await Promise.all(reads);
    } catch (error) { if (!stale()) { setPhase("error"); throw error; } }
  }, [calendar]);
  env.current = { readVerified, readProgress, readPracticeCalendar, readLessons, serviceAuthorityFailed, reload: () => load().catch(() => undefined) };
  useEffect(() => registerReload(async () => { await load(); }), [registerReload, load]);
  useEffect(() => { void load().catch(() => undefined); return () => { sequence.current++; abort.current?.abort(); }; }, [load, epoch, retry]);
  // Like every private view: nothing is kept while access is being checked, and what is shown is checked again in the background.
  useLayoutEffect(() => registerWork({ pause: () => { abort.current?.abort(); calendar.clear(); }, clear: () => { abort.current?.abort(); calendar.configure(null); }, settle: async () => {}, hasUnsaved: () => false, reveal() {} }), [registerWork, calendar]);
  useLayoutEffect(() => {
    if (!assigned) return;
    const expected = JSON.stringify(assigned), authority = quietReadingAuthority(assigned);
    return registerQuiet(async signal => {
      const fresh = await env.current.readVerified("student", assigned.student.id, signal);
      if (!signal.aborted && quietReadingAuthority(fresh) !== authority) throw new PortalRequestError(404);
      return !signal.aborted && JSON.stringify(fresh) === expected;
    });
  }, [assigned, registerQuiet]);

  if (phase === "loading") return <section className="workspace-state" aria-live="polite"><h1>Loading the assigned reading</h1><p>Checking the selected student and confirmed references.</p></section>;
  if (phase === "error") return <div role="alert" className="workspace-state"><h1>Reading unavailable</h1><p>Students couldn’t be loaded. No previous selection is being shown.</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload students</button></div>;
  if (!rows.length || !assigned) return <section className="workspace-state"><h1>Your assigned reading</h1><p>No student is currently linked to this role. Ask the congregation for help with your assignment.</p></section>;
  const student = assigned.student;
  return <TodayView headingId={headingId} student={student} ownAdultHonors={rows.find(row => row.id === student.id)?.ownAdultHonors === true} readings={assigned.readings} marks={marks} lesson={lesson} dates={dates}
    choices={rows.length > 1 ? sortStudentsByCeremony(rows) : null} onChoose={id => { selected.current = id; void load().catch(() => undefined); }} />;
}

function TodayView({ headingId, student, ownAdultHonors, readings, marks, lesson, dates, choices, onChoose }: {
  headingId: string; student: Student; ownAdultHonors: boolean; readings: readonly Reading[]; marks: Slice<ReadonlyMap<Reading["kind"], readonly ProgressVerse[]>>; lesson: Slice<LessonLogEntry | null>;
  dates: ReturnType<PracticeCalendar["snapshot"]>; choices: Student[] | null; onChoose(id: string): void;
}) {
  const today = deviceDate(), countdown = ceremonyCountdown(student.ceremonyDate), parashah = parashahName(readings.find(row => row.kind === "torah"));
  const heading = parashah ?? `${student.firstName} ${student.lastName}`, rehearsal = rehearsalLine(student, today);
  const rows = readingRows(readings), stateOf = (row: (typeof rows)[number]): RowState | null => {
    if (marks.status !== "ready") return null;
    const verses = marks.value.get(row.kind); return verses ? rowState(verses, row.start, row.end) : null;
  };
  const settled = marks.status !== "loading" && dates.status !== "loading";
  const states = rows.map(stateOf), started = states.some(state => state !== null && state !== "not-started") || dates.status === "ready" && dates.dates.size > 0;
  const next = rows.length ? rows[Math.max(0, states.findIndex(state => state !== "solid"))] : null;
  const dayMarks = calendarMarks(student), calendarDay = dates.status === "ready" ? dayOrdinal(dates.serverDay) : dayOrdinal(today);
  const note = lesson.status === "ready" ? lesson.value : null;
  return <section className={styles.today} data-today aria-labelledby={headingId}>
    <DocumentTitle heading={heading} />
    {choices && <ul className={styles.chooser} aria-label="Student">{choices.map(row => <li key={row.id}>
      <button type="button" className="student-card" aria-pressed={row.id === student.id} onClick={() => { if (row.id !== student.id) onChoose(row.id); }}><span className="student-card-name"><bdi dir="auto">{row.firstName} {row.lastName}</bdi></span></button></li>)}</ul>}
    <div className={styles.lake}>
      {parashah && choices && <p className={styles.who}><bdi dir="auto">{student.firstName} {student.lastName}</bdi></p>}
      <h1 id={headingId} className={styles.parashah} tabIndex={-1}><bdi dir="auto">{heading}</bdi></h1>
      <p className={styles.when}><time className={styles.nobreak} dateTime={student.ceremonyDate} data-nobreak>{countdown.label}</time>{countdown.phrase && <span className={styles.days} data-nobreak>{countdown.phrase}</span>}</p>
      {rehearsal && <p className={styles.rehearsal} data-nobreak>{rehearsal}</p>}
      {readings.length > 0 && <ul className={styles.readings} aria-label="Assigned readings">{readings.flatMap(reading => refSegments(reading.ranges).map((segment, index) =>
        <li key={`${reading.id}:${index}`}><Chip>{index === 0 ? `${reading.kind === "torah" ? "Torah" : "Haftarah"} ${segment}` : segment}</Chip></li>))}</ul>}
    </div>
    {readings.length === 0 ? <EmptyState title="No reading has been assigned yet" description="Your tutor or rabbi will add your verses here." /> : <>
      {next && settled && <NextCard row={next} started={started} dates={dates} />}
      <List label="Reading sections">{rows.map((row, index) => <ListRow key={row.key} href={READING_HREF} title={row.label}
        meta={<bdi dir="ltr" className={styles.nobreak} data-nobreak>{row.ref}</bdi>}
        trailing={states[index] ? <span className={styles.state} data-state={states[index]}><span className={styles.dot} aria-hidden="true" />{stateWord[states[index]!]}</span> : undefined} />)}</List>
    </>}
    {note && <section className={styles.note} aria-labelledby={`${headingId}-note`}>
      <div className={styles.noteHead}>
        <p id={`${headingId}-note`} className={styles.noteLabel}>Latest from <bdi dir="auto">{note.displayName}</bdi> · <time dateTime={note.lessonDate}>{noteDay(note.lessonDate)}</time>:</p>
        <a className={styles.noteMore} href={LESSONS_HREF}>Lessons</a>
      </div>
      <p className={styles.noteText} dir="auto">{note.summary}</p>
      {note.beforeNext && <BeforeNext text={note.beforeNext} own />}
    </section>}
    {dates.status !== "loading" && <div className={styles.calendar}><PracticeMonths today={calendarDay} first={dates.status === "ready" ? dayOrdinal(dates.fromDate) : calendarDay - 364}
      practiced={ordinal => dates.status === "ready" && dates.dates.has(dayString(ordinal))} marks={dayMarks} lastDay={dayOrdinal(student.ceremonyDate)} /></div>}
    {ownAdultHonors && <HonorsEntry key={student.id} mode="student" studentId={student.id} name={`${student.firstName} ${student.lastName}`} />}
  </section>;
}

function NextCard({ row, started, dates }: { row: ReturnType<typeof readingRows>[number]; started: boolean; dates: ReturnType<PracticeCalendar["snapshot"]> }) {
  const id = useId(), caption = useId(), range = displayRef(row.ref);
  return <section className={styles.next} aria-labelledby={id}>
    <h2 id={id} className={styles.nextTitle}>{row.label}{started && <> <span className={styles.nextRef}><bdi dir="ltr" className={styles.nobreak} data-nobreak>{range}</bdi></span></>}</h2>
    <ButtonLink variant="primary" block href={READING_HREF}>{started ? "Start where you left off" : <>Practice verses&nbsp;<bdi dir="ltr" className={styles.nobreak} data-nobreak>{range}</bdi></>}</ButtonLink>
    {dates.status === "ready" ? <div className={styles.dots}>
      <ol className="practice-week" aria-labelledby={caption}>{lastSevenDays(dates.serverDay, dates.dates).map(day =>
        <li key={day.date} className={`practice-day${day.practised ? " practice-day-done" : ""}${day.today ? " practice-day-today" : ""}`}>
          <span aria-hidden="true" className="practice-day-letter">{weekdayLetters[day.weekday]}</span>
          <span className="practice-day-dot" aria-hidden="true" />
          <span className="sr-only">{weekdayNames[day.weekday]}{day.today ? ", today" : ""}: {day.practised ? "practiced" : "not practiced"}</span>
        </li>)}</ol>
      <p id={caption} className={styles.caption}>Days you practised · a day fills when you open your reading up close</p>
    </div> : dates.status === "unavailable" ? <p className={styles.caption}>Practice days couldn’t be loaded.</p> : null}
  </section>;
}
