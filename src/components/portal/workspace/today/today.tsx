"use client";
// The student's pinned reading (Readings for everyone E1; the 1.9 N11 Today, now the first card on /mine). Everything on it is read through the
// student's own workspace reads (the same ones the reading page uses): the student list and assigned reading, the verse marks, the practice
// calendar's dates and the lesson notes. It reads nobody else. It records nothing: showing the card is not practice.
import { bookletHref } from "../../print/booklet-href";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { PortalRequestError } from "../../api";
import { workspaceApi, type Assigned, type Reading, type Student } from "../api";
import { statusOf, useWorkspace } from "../provider";
import { ButtonLink, Chip } from "../../../ui";
import { ceremonyCountdown } from "../reading";
import { quietReadingAuthority } from "../quiet-refresh";
import { reconcileSelectedStudent, sortStudentsByCeremony } from "../student-label";
import { PracticeCalendar } from "../practice-calendar/store";
import { PracticeMonths } from "../practice-calendar/view";
import { dayOrdinal, dayString } from "../practice-calendar/api";
import { BeforeNext } from "../lessons/panel";
import { HonorsEntry } from "../honors/sheet";
import { useCongregation } from "../settings/links";
import { serviceSlotName } from "../service-slot";
import type { ProgressRows } from "../progress/api";
import type { LessonLogEntry } from "../../../../lib/lesson-log/types";
import type { ProgressVerse } from "../../../../lib/progress/types";
import { calendarMarks, deviceDate, lastSevenDays, nextDateLine, refSegments } from "./model";
import styles from "./today.module.css";

export type Slice<T> = { status: "loading" } | { status: "unavailable" } | { status: "ready"; value: T };
export type MarkSlice = Slice<ReadonlyMap<Reading["kind"], readonly ProgressVerse[]>>;
export const PINNED_HREF = "/mine/reading";
const weekdayLetters = ["S", "M", "T", "W", "T", "F", "S"];
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const noteDay = (date: string) => { const [year, month, day] = date.split("-").map(Number); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day)); };

/** Every page of the student's marks for one reading (at most a thousand verses, a hundred to a page). */
export async function readMarks(read: (baseline: Assigned, kind: Reading["kind"], operation: { type: "page"; offset: number }, signal: AbortSignal) => Promise<unknown>, baseline: Assigned, kind: Reading["kind"], signal: AbortSignal) {
  const verses: ProgressVerse[] = []; let offset = 0;
  for (let pages = 0; pages < 12; pages++) {
    const page = await read(baseline, kind, { type: "page", offset }, signal) as ProgressRows;
    verses.push(...page.verses);
    if (page.nextOffset === null) return verses;
    offset = page.nextOffset;
  }
  throw new PortalRequestError(503);
}

/** The verses a person has marked "got it" across a reading's kinds, and how many verses the reading has; null until the marks are read. */
export function gotCount(readings: readonly Reading[], marks: MarkSlice): { got: number; total: number } | null {
  const total = readings.reduce((sum, row) => sum + row.verses.length, 0);
  if (marks.status !== "ready") return null;
  let got = 0; for (const verses of marks.value.values()) got += verses.filter(verse => verse.selfCheck.state === "got-it").length;
  return { got, total };
}

/** What the pinned card shows. `phase` is "off" for a session without the student role: nothing is read. */
export type TodaySlices = Readonly<{
  phase: "off" | "loading" | "error" | "ready"; rows: readonly Student[]; assigned: Assigned | null; marks: MarkSlice; lesson: Slice<LessonLogEntry | null>;
  dates: ReturnType<PracticeCalendar["snapshot"]>; reload(): void;
}>;

export function useStudentToday(enabled = true): TodaySlices {
  const { epoch, readVerified, readProgress, readPracticeCalendar, readLessons, registerReload, registerWork, registerQuiet, serviceAuthorityFailed } = useWorkspace();
  const [rows, setRows] = useState<Student[]>([]), [assigned, setAssigned] = useState<Assigned | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading"), [retry, setRetry] = useState(0);
  const [marks, setMarks] = useState<MarkSlice>({ status: "loading" });
  const [lesson, setLesson] = useState<Slice<LessonLogEntry | null>>({ status: "loading" });
  const selected = useRef<string | null>(null), abort = useRef<AbortController | null>(null), sequence = useRef(0);
  const env = useRef({ readVerified, readProgress, readPracticeCalendar, readLessons, serviceAuthorityFailed, reload: () => undefined as unknown });
  const calendarRef = useRef<PracticeCalendar | null>(null);
  if (!calendarRef.current) calendarRef.current = new PracticeCalendar((...args) => env.current.readPracticeCalendar(...args), () => { void env.current.reload(); });
  const calendar = calendarRef.current, dates = useSyncExternalStore(calendar.subscribe, calendar.snapshot, calendar.snapshot);

  const load = useCallback(async () => {
    if (!enabled) return;
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
  }, [calendar, enabled]);
  env.current = { readVerified, readProgress, readPracticeCalendar, readLessons, serviceAuthorityFailed, reload: () => load().catch(() => undefined) };
  useEffect(() => enabled ? registerReload(async () => { await load(); }) : undefined, [registerReload, load, enabled]);
  useEffect(() => { void load().catch(() => undefined); return () => { sequence.current++; abort.current?.abort(); }; }, [load, epoch, retry]);
  // Like every private view: nothing is kept while access is being checked, and what is shown is checked again in the background.
  useLayoutEffect(() => enabled ? registerWork({ pause: () => { abort.current?.abort(); calendar.clear(); }, clear: () => { abort.current?.abort(); calendar.configure(null); }, settle: async () => {}, hasUnsaved: () => false, reveal() {} }) : undefined, [registerWork, calendar, enabled]);
  useLayoutEffect(() => {
    if (!assigned || !enabled) return;
    const expected = JSON.stringify(assigned), authority = quietReadingAuthority(assigned);
    return registerQuiet(async signal => {
      const fresh = await env.current.readVerified("student", assigned.student.id, signal);
      if (!signal.aborted && quietReadingAuthority(fresh) !== authority) throw new PortalRequestError(404);
      return !signal.aborted && JSON.stringify(fresh) === expected;
    });
  }, [assigned, registerQuiet, enabled]);
  return { phase: enabled ? phase : "off", rows, assigned, marks, lesson, dates, reload: () => setRetry(value => value + 1) };
}

/** The pinned reading's name and the line the shelf's model keeps (see `PinnedState`), once the student's reading is known. */
export function pinnedOf(slices: TodaySlices): { name: string; ceremony: string; done: number; total: number } | null {
  if (slices.phase !== "ready" || !slices.assigned) return null;
  const { student, readings } = slices.assigned, count = gotCount(readings, slices.marks);
  return { name: `${student.firstName} ${student.lastName}`, ceremony: ceremonyCountdown(student.ceremonyDate).label, done: count?.got ?? 0, total: count?.total ?? readings.reduce((sum, row) => sum + row.verses.length, 0) };
}

/** The student's Beit Mitzvah reading, first on the shelf. It states what the student has, never a score: "9 of 14" is a position. */
export function PinnedReadingCard({ slices }: { slices: TodaySlices }) {
  const headingId = useId();
  if (slices.phase === "off") return null;
  if (slices.phase === "loading") return <section className={styles.pinned} aria-busy="true" aria-live="polite" data-pinned-card><p className={styles.state} role="status">Loading the assigned reading</p><div className={styles.holdRoom} aria-hidden="true" /></section>;
  if (slices.phase === "error") return <section className={styles.pinned} data-pinned-card><div role="alert"><p>Students couldn’t be loaded. No previous selection is being shown.</p><button type="button" className="button-secondary" onClick={slices.reload}>Reload students</button></div></section>;
  if (!slices.rows.length || !slices.assigned) return <section className={styles.pinned} data-pinned-card><p>No student is currently linked to this role. Ask the congregation for help with your assignment.</p></section>;
  return <PinnedReady slices={slices} assigned={slices.assigned} headingId={headingId} />;
}

function PinnedReady({ slices, assigned, headingId }: { slices: TodaySlices; assigned: Assigned; headingId: string }) {
  const { student, readings } = assigned, { marks, lesson, dates } = slices, congregation = useCongregation(true);
  const today = deviceDate(), countdown = ceremonyCountdown(student.ceremonyDate), rehearsal = nextDateLine(student, today), caption = useId();
  const own = slices.rows.find(row => row.id === student.id), slot = congregation.ready ? serviceSlotName(student.serviceSlot, congregation.services) : null;
  const count = gotCount(readings, marks), note = lesson.status === "ready" ? lesson.value : null;
  const dayMarks = calendarMarks(student), calendarDay = dates.status === "ready" ? dayOrdinal(dates.serverDay) : dayOrdinal(today);
  return <section className={styles.pinned} aria-labelledby={headingId} data-pinned-card data-testid="pinned-reading">
    <div className={styles.head}>
      <Chip tone="attention">{`Beit Mitzvah · ${countdown.label}`}</Chip>
      {countdown.phrase && <span className={styles.days} data-nobreak>{countdown.phrase}</span>}
    </div>
    <h2 id={headingId} className={styles.name}><a href={PINNED_HREF} className={styles.nameLink}><bdi dir="auto">{student.firstName} {student.lastName}</bdi></a></h2>
    {(readings.length > 0 || slot) && <p className={styles.ranges}>{readings.flatMap(reading => refSegments(reading.ranges).map((segment, index) => `${index === 0 ? `${reading.kind === "torah" ? "Torah" : "Haftarah"} ` : ""}${segment}`))
      .map((text, index, all) => <span key={index}><span data-nobreak>{text}{(index < all.length - 1 || slot) && " ·"}</span>{" "}</span>)}{slot && <span data-nobreak>{slot}</span>}</p>}
    {/* Open comes right after the name and ranges, so a phone shows it without scrolling. */}
    <ButtonLink variant="primary" href={PINNED_HREF} block>Open</ButtonLink>
    {rehearsal && <p className={styles.rehearsal} data-testid="rehearsal-line" data-nobreak>{rehearsal}</p>}
    {readings.length === 0 ? <p className={styles.empty}>Your tutor or rabbi will add your verses here.</p>
      : <div className={styles.got} data-testid="pinned-progress">
        <p className={styles.gotLabel}>Verses you’ve got</p>
        <div className={styles.bar} aria-hidden="true"><span style={{ inlineSize: count && count.total ? `${Math.round(count.got * 100 / count.total)}%` : "0%" }} /></div>
        <p className={styles.gotCount}>{count ? `${count.got} of ${count.total}` : " "}</p>
      </div>}
    {readings.length > 0 && lesson.status === "loading" && <div className={styles.holdNote} aria-hidden="true" />}
    {note && <section className={styles.note} data-testid="today-note" aria-labelledby={`${headingId}-note`}>
      <p id={`${headingId}-note`} className={styles.noteLabel}>Latest from <bdi dir="auto">{note.displayName}</bdi> · <time dateTime={note.lessonDate}>{noteDay(note.lessonDate)}</time>:</p>
      <p className={styles.noteText} dir="auto">{note.summary}</p>
      {note.beforeNext && <BeforeNext text={note.beforeNext} own />}
    </section>}
    {readings.length > 0 && dates.status === "loading" && <div className={styles.holdDots} aria-hidden="true" />}
    {readings.length > 0 && dates.status === "ready" && <div className={styles.dots}>
      <ol className="practice-week" data-testid="practice-week" aria-label="Practice this week" aria-describedby={caption}>{lastSevenDays(dates.serverDay, dates.dates).map(day =>
        <li key={day.date} data-testid="practice-day" className={`practice-day${day.practised ? " practice-day-done" : ""}${day.today ? " practice-day-today" : ""}`}>
          <span aria-hidden="true" className="practice-day-letter">{weekdayLetters[day.weekday]}</span>
          <span className="practice-day-dot" aria-hidden="true" />
          <span className="sr-only">{weekdayNames[day.weekday]}{day.today ? ", today" : ""}: {day.practised ? "practiced" : "not practiced"}</span>
        </li>)}</ol>
      <p id={caption} className={styles.caption}>Days you practiced · a day fills when you open your reading up close</p>
    </div>}
    {readings.length > 0 && dates.status === "unavailable" && <p className={styles.caption}>Practice days couldn’t be loaded.</p>}
    {dates.status === "loading" && <div className={styles.holdCalendar} aria-hidden="true" />}
    {dates.status !== "loading" && <div className={styles.calendar}><PracticeMonths today={calendarDay} first={dates.status === "ready" ? dayOrdinal(dates.fromDate) : calendarDay - 364}
      practiced={ordinal => dates.status === "ready" && dates.dates.has(dayString(ordinal))} marks={dayMarks} lastDay={dayOrdinal(student.ceremonyDate)} /></div>}
    {readings.length > 0 && <div className={styles.actions}>
      {readings.length > 0 && <ul className={styles.links} aria-label="In your reading"><li><a href={`${PINNED_HREF}#service-parts`}>Service parts</a></li><li><a href={`${PINNED_HREF}#lessons`}>Lessons</a></li><li><a href={bookletHref(student.id)} data-testid="print-booklet">Print booklet</a></li></ul>}
    </div>}
    {own?.ownAdultHonors === true && <HonorsEntry key={student.id} mode="student" studentId={student.id} name={`${student.firstName} ${student.lastName}`} />}
  </section>;
}
