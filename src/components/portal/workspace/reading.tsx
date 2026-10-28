"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { type Assigned, type Reading, type ReadingMode, type Student } from "./api";
import { LearnReviewAction } from "../../learn/hero-actions";
import { statusOf, useWorkspace, useWorkspaceModal, WorkspaceLink } from "./provider";
import { printAddress, refFromVerses } from "../../../lib/print/print-address";
import { PortalRequestError } from "../api";
import type { DeparturePurpose } from "./departure-guards";
import { quietReadingAuthority } from "./quiet-refresh";
import { icons } from "./study/lift";
import { ReadingEditor } from "./reading-editor";
import { AssignedStudyText, type StudyReload } from "./study/view";
import { ProposedTorahText } from "./study/exploration-view";
import { createReadingAudioCoordinator } from "./study/reading-audio-coordinator";
import type { StudyKind } from "./study/api";
import { WorkCoordinator } from "./work/coordinator";
import { VerseTools } from "./work/verse-tools";
import { DepartureReview } from "./work/departure-review";
import { ServiceLearningPanel, type ServiceReload } from "./service-learning/panel";
import { ReadingToolbar } from "./reading-toolbar";
import { PracticeSheet } from "./study/practice-sheet";
import { ReadingPrefsScope } from "./reading-prefs";
import { LENS_STORAGE, StudyLensScope } from "./study-lens";
import { VersePanelScope } from "./study/verse-panel";
import { LensOnly } from "./lens-switch";
import { ProgressStore } from "./progress/store";
import { GuideStore } from "./study/guide-store";
import { GuideCard, GuideVerseNotes } from "./study/guide-card";
import { AboutCard } from "./study/about-card";
import { GuideStatusLine } from "./study/guide-status";
import type { StudyVerse } from "./study/api";
import { isGotIt, LiftProgress, useProgressSummary, VerseMark } from "./progress/marks";
import { BeforeNext, LastTime, LessonLog, type LessonReload } from "./lessons/panel";
import { ChildPracticeDisclosure } from "../practice-visibility/disclosure";
import { PracticeCalendar } from "./practice-calendar/store";
import { PracticeDays, StaffPracticeDays } from "./practice-calendar/view";
import { useCongregation } from "./settings/links";
import type { ServiceSettings } from "./settings/api";
import { ParentStudySummary, ParentSummaryStore } from "./parent-summary";
import type { PracticeDates } from "./practice-calendar/api";
import { serviceSlotName, serviceSlotTime } from "./service-slot";
import { StaffStudentLines } from "./staff/student-lines";
import { NeedsWork } from "./staff/needs-work";
import { TutorPracticeDays, TutorPracticeScope } from "./staff/practice";
import { LiftNote } from "./staff/lift-note";
import { ManageSheet } from "./staff/manage-sheet";
import { ReaderTitle, type Pill } from "../public-reading/reader-title";
import { ReadingFoot } from "../public-reading/reading-foot";
import { readingChapters } from "./study/reading-place-model";
import { Chip, Sheet } from "../../ui";
import { learnerTitle, titleName, titlePillKeys, titleReading } from "./reading-title";

const dayMs = 86_400_000;
/** "Sat, Jan 2, 2027" and whole days until it, computed on the calendar date only. */
export function ceremonyCountdown(date: string, now = new Date()) {
  const [year, month, day] = date.split("-").map(Number), ceremony = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), days = Math.round((ceremony - today) / dayMs);
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(ceremony);
  return { label, days, phrase: days > 1 ? `${days} days to go` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : null };
}
/** How near a date has to be before the tutor's views lead with it as a chip (tutor walk 2026-10-28, finding 2). */
export const NEXT_DATE_CHIP_DAYS = 14;
/**
 * The student's next date, rehearsal or Beit Mitzvah, whichever comes first from today (a rehearsal first on the same day), with its
 * chip ("Rehearsal tomorrow", "Beit Mitzvah in 9 days") when it is two weeks away or less; null when every date has passed.
 */
export function nextDate(student: Pick<Student, "ceremonyDate" | "rehearsal1" | "rehearsal2">, now = new Date()) {
  const dates = [...[student.rehearsal1, student.rehearsal2].filter((value): value is string => !!value).map(date => ({ kind: "rehearsal" as const, date })), { kind: "ceremony" as const, date: student.ceremonyDate }]
    .map(row => ({ ...row, ...ceremonyCountdown(row.date, now) })).filter(row => row.days >= 0).sort((a, b) => a.days - b.days || (a.kind === "rehearsal" ? -1 : 1));
  const first = dates[0];
  if (!first) return null;
  const name = first.kind === "rehearsal" ? "Rehearsal" : "Beit Mitzvah";
  const chip = first.days > NEXT_DATE_CHIP_DAYS ? null : first.days === 0 ? `${name} today` : first.days === 1 ? `${name} tomorrow` : `${name} in ${first.days} days`;
  return { kind: first.kind, date: first.date, label: first.label, days: first.days, chip };
}
/** Where the tutor's lesson rail sits beside the text; narrower, its card sits under the title (tutor walk 2026-10-28, whole-screen rethink). */
const RAIL_QUERY = "(min-width: 1200px)";
const subscribeRail = (change: () => void) => { if (typeof matchMedia !== "function") return () => undefined; const query = matchMedia(RAIL_QUERY); query.addEventListener("change", change); return () => query.removeEventListener("change", change); };
const railWide = () => typeof matchMedia === "function" && matchMedia(RAIL_QUERY).matches;
/** The next date as the lesson card says it: the chip within two weeks, else the kind, the date and the days to go. */
function NextDateLine({ student }: { student: Pick<Student, "ceremonyDate" | "rehearsal1" | "rehearsal2"> }) {
  const next = nextDate(student);
  if (!next) return null;
  const phrase = ceremonyCountdown(next.date).phrase;
  return <p className="lesson-prep-next" data-testid="lesson-next-date" data-next-kind={next.kind}>
    {next.chip ? <><Chip tone="attention">{next.chip}</Chip> <time dateTime={next.date}>{next.label}</time></>
      : <>{next.kind === "rehearsal" ? "Rehearsal" : "Beit Mitzvah"} · <time dateTime={next.date}>{next.label}</time>{phrase && ` · ${phrase}`}</>}
  </p>;
}
/**
 * The lesson card (tutor walk 2026-10-28, finding 4 and the whole-screen rethink): what a tutor needs before and after a lesson, at the top
 * of the rail beside the text (or under the title on a narrower screen): the next date, Needs work, the last "Before next time" and Add
 * lesson note. On the wide rail the Lessons list follows right under it, with its own Add lesson note, so the card has none there.
 */
function LessonCard({ baseline, ask, ready, addButton, onAdd }: { baseline: Assigned; ask: string | null; ready: boolean; addButton: boolean; onAdd(origin: HTMLElement): void }) {
  return <section className="lesson-prep" aria-labelledby="lesson-prep-heading" data-testid="lesson-prep">
    <h2 id="lesson-prep-heading">Lesson</h2>
    <NextDateLine student={baseline.student} />
    <NeedsWork baseline={baseline} level={3} />
    {ask && <LastTime text={ask} headingId="lesson-prep-last" />}
    {addButton && <button type="button" className="button-primary lesson-prep-add" data-testid="lesson-prep-add" disabled={!ready} onClick={event => onAdd(event.currentTarget)}>Add lesson note</button>}
  </section>;
}
/** The saved rehearsals in order, labelled like the ceremony date. Nothing when none is set. */
export function RehearsalDates({ student }: { student: Pick<Student, "rehearsal1" | "rehearsal2"> }) {
  const dates = [student.rehearsal1, student.rehearsal2].filter((value): value is string => !!value);
  if (!dates.length) return null;
  return <p className="hero-rehearsals" data-testid="hero-rehearsals">{dates.length === 1 ? "Rehearsal" : "Rehearsals"}: {dates.map((value, index) => <span key={index}>{index > 0 && " and "}<time dateTime={value}>{ceremonyCountdown(value).label}</time></span>)}</p>;
}
/**
 * The confirmed service, named as the honors sheet names it: the congregation's name for it when set.
 * It sits on the name line, which has room on a phone, so the date line never wraps; the start time
 * shows beside it on wider screens only, so the phone header keeps its height. Nothing when the slot is unknown.
 */
export function ServiceSlotName({ student, services }: { student: Pick<Student, "serviceSlot">; services?: ServiceSettings }) {
  const name = serviceSlotName(student.serviceSlot, services), time = serviceSlotTime(student.serviceSlot, services);
  return name ? <span className="hero-slot">{name}{time && <span className="hero-slot-time">{" "}·{" "}{time}</span>}</span> : null;
}
const displayRange = (ranges: string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1\u2013$2");

/** A parent's practice note: two lines at a narrow phone, with Read all to open the rest (re-walk 2026-10-28); full length everywhere else. */
function ClampedAsk({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <div className={`practice-ask${open ? "" : " practice-ask-clamped"}`} data-testid="practice-ask"><BeforeNext text={text} own={false} />
    <button type="button" className="button-text practice-ask-toggle" data-testid="practice-ask-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Show less" : "Read all"}</button></div>;
}
export function AssignedReadingSummaries({ readings, selectedKind, marked }: { readings: readonly Reading[]; selectedKind: StudyKind; marked?: string | null }) {
  return <div className="hero-reading-summaries" role="group" aria-label="Assigned readings">{readings.map(row => <div key={row.id} className="hero-reading-summary" data-reading-kind={row.kind} data-verse-count={row.verses.length} aria-current={row.kind === selectedKind ? "true" : undefined}>
    <h3>{row.kind === "torah" ? "Torah" : "Haftarah"} <bdi dir="ltr">{displayRange(row.ranges)}</bdi></h3>
    <p>{row.verses.length} {row.verses.length === 1 ? "verse" : "verses"}{row.kind === selectedKind && <> <span className="reading-summary-current">Current reading</span>{marked && <span className="hero-marked"> · {marked}</span>}</>}</p>
  </div>)}</div>;
}

function AssignmentContext({ row, current = false, staff }: { row: Reading; current?: boolean; staff: boolean }) {
  return <article className={`confirmed-reading${current ? " reading-current-assignment" : ""}`}>
    <h3>{row.kind === "torah" ? "Torah" : "Haftarah"}</h3>
    <p className="reading-reference">{row.ranges.join("; ")}</p>
    <p className={row.needsReview ? "reading-review status-chip status-chip-attention" : "field-help status-chip"} data-testid="reading-assignment-chip" data-needs-review={String(row.needsReview)}>{row.needsReview ? staff ? "Needs review" : "Needs review with your tutor or rabbi" : "Confirmed assignment"} · Revision {row.revision}</p>
    <details><summary>Assigned verse references ({row.verses.length})</summary><ol className="verse-references">{row.verses.map((verse, index) => <li key={`${index}:${verse}`}>{verse}</li>)}</ol>
      <p className="field-help">Calendar source: {row.source.attribution ? <a href={row.source.attribution.url} target="_blank" rel="noopener noreferrer">{row.source.attribution.name}</a> : "not recorded"}. {row.source.status === "unavailable" ? "Calendar source was unavailable when this assignment was confirmed." : row.source.status === "unknown" ? "Source availability is not recorded." : "Calendar source was available at confirmation."}</p>
      {row.confirmationDate && <p className="field-help">Ceremony date at confirmation: {row.confirmationDate}</p>}
    </details>
  </article>;
}

/** The anchors the foot, the pinned card and the old tab addresses name: Service parts and Lessons follow the text on one page (Readings for everyone E2). */
export const SECTION_IDS = Object.freeze({ service: "service-parts", lessons: "lessons" });
const sectionIds: readonly string[] = Object.values(SECTION_IDS);
/** The sentence that says listening is not released yet: under the reading for staff and parents, and on a student's disabled Listen. */
const LISTENING_OFF = "Listening isn’t available yet. You can read, use word tools and practice up close.";
/** The parent's page has no Up close (practice is its own mode), so its line names only what the page offers (finding 15). */
const LISTENING_OFF_PARENT = "Listening isn’t available yet. You can read and use word tools.";

/**
 * afterSummary: what sits right after a parent's "This week" summary (their honors row, 1.9 N13); nothing for any other mode.
 * firstName: the child's first name from the parent's list, for the parent's words before the reading has loaded (or when it fails to).
 */
export function ReadingPanel({ mode, studentId, onStudentReload, afterSummary, firstName }: { mode: ReadingMode; studentId: string; onStudentReload?(student: Student): void; afterSummary?: ReactNode; firstName?: string }) {
  const { readVerified: read, readWork, readProgress, readGuide, readPracticeCalendar, summary, epoch, busy, concealed, selectChild, registerReload, registerQuiet, registerWork, completeWork, registerDeparture, guardDeparture, serviceAuthorityFailed } = useWorkspace();
  const key = `${mode}:${studentId}:${epoch}`;
  const parentScope = JSON.stringify([summary.sessionBinding, epoch, mode, studentId]);
  const serviceId = useId();
  const audioRef = useRef<ReturnType<typeof createReadingAudioCoordinator> | null>(null);
  if (!audioRef.current) audioRef.current = createReadingAudioCoordinator();
  const audio = audioRef.current;
  // StrictMode reuses this scope after effect cleanup: stop, never permanently close it.
  useLayoutEffect(() => { const unregister = registerWork({ pause: audio.stopAll, clear: audio.stopAll, settle: async () => {}, hasUnsaved: () => false, reveal() {} });
    return () => { unregister(); audio.stopAll(); }; }, [audio, registerWork, key]);
  useLayoutEffect(() => { if (concealed) audio.stopAll(); }, [audio, concealed]);
  useEffect(() => { const background = () => { if (document.visibilityState !== "visible") audio.stopAll(); }, leave = () => audio.stopAll();
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { audio.stopAll(); document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, [audio]);
  const [result, setResult] = useState<{ key: string; value?: Assigned; error?: number; loading?: boolean }>({ key: "" }), [retry, setRetry] = useState(0);
  const [selectedKind, setSelectedKind] = useState<StudyKind>("torah");
  const abort = useRef<AbortController | null>(null), sequence = useRef(0);
  const study = useRef<StudyReload | null>(null);
  const service = useRef<ServiceReload | null>(null);
  const registerService = useCallback((value: ServiceReload) => { service.current = value; return () => { if (service.current === value) service.current = null; }; }, []);
  const lessons = useRef<LessonReload | null>(null);
  const registerLessons = useCallback((value: LessonReload) => { lessons.current = value; return () => { if (lessons.current === value) lessons.current = null; }; }, []);
  const registerStudy = useCallback((value: StudyReload) => { study.current = value; return () => { if (study.current === value) study.current = null; }; }, []);
  const studyDenied = useCallback((status: number) => { audio.stopAll(); setResult({ key, error: status }); }, [audio, key]);
  const environment = useRef({ read, readWork, readProgress, readGuide, readPracticeCalendar, mode, studentId, studyDenied, reload: () => undefined as unknown }); environment.current = { read, readWork, readProgress, readGuide, readPracticeCalendar, mode, studentId, studyDenied, reload: () => load().catch(() => undefined) };
  const workRef = useRef<WorkCoordinator | null>(null);
  if (!workRef.current) workRef.current = new WorkCoordinator((...args) => environment.current.readWork(...args), signal => environment.current.read(environment.current.mode, environment.current.studentId, signal), status => environment.current.studyDenied(status));
  const work = workRef.current;
  const progressRef = useRef<ProgressStore | null>(null);
  if (!progressRef.current) progressRef.current = new ProgressStore((...args) => environment.current.readProgress(...args), () => environment.current.reload(), status => { work.clear(); progressRef.current?.configure(null); environment.current.studyDenied(status); });
  const progress = progressRef.current;
  // The study guide for the shown reading; ticks are the learner's own. Parents and staff only read it.
  const guideRef = useRef<GuideStore | null>(null);
  if (!guideRef.current) guideRef.current = new GuideStore((baseline, kind, operation, signal) => environment.current.readGuide(baseline, kind, operation, signal), status => { guideRef.current?.configure(null); environment.current.studyDenied(status); });
  const guide = guideRef.current;
  const verseLookup = useRef<((ref: string) => StudyVerse | null) | null>(null);
  // Dates practiced, for the student and an explicitly selected child practice only. It forgets everything whenever the page is hidden or reloads.
  const calendarRef = useRef<PracticeCalendar | null>(null);
  if (!calendarRef.current) calendarRef.current = new PracticeCalendar((...args) => environment.current.readPracticeCalendar(...args), () => environment.current.reload());
  const calendar = calendarRef.current;
  const parentEnvironment = useRef({ scope: parentScope, concealed, readPracticeCalendar, denied: (status: number) => { studyDenied(status); serviceAuthorityFailed(status); } }); parentEnvironment.current = { scope: parentScope, concealed, readPracticeCalendar, denied: (status: number) => { studyDenied(status); serviceAuthorityFailed(status); } };
  const parentRef = useRef<ParentSummaryStore | null>(null);
  if (!parentRef.current) parentRef.current = new ParentSummaryStore((...args) => parentEnvironment.current.readPracticeCalendar(...args) as Promise<PracticeDates>, scope => parentEnvironment.current.scope === scope && !parentEnvironment.current.concealed, status => parentEnvironment.current.denied(status));
  const parentSummary = parentRef.current;
  useLayoutEffect(() => { if (mode !== "parent") return; const unregister = registerWork({ pause: parentSummary.pause, clear: parentSummary.clear, settle: async () => {}, hasUnsaved: () => false, reveal() {} });
    return () => { unregister(); parentSummary.clear(); }; }, [mode, key, parentSummary, registerWork]);
  useLayoutEffect(() => { const unregister = registerWork({ pause: () => calendar.clear(), clear: () => calendar.configure(null), settle: async () => {}, hasUnsaved: () => false, reveal: () => {} }); return () => { unregister(); calendar.configure(null); }; }, [registerWork, calendar, key]);
  useSyncExternalStore(work.subscribe, work.snapshot, work.snapshot);
  const needsUnload = work.hasUnsaved();
  useLayoutEffect(() => { const unregister = registerWork(work), unregisterDeparture = registerDeparture(work.guard); return () => { unregister(); unregisterDeparture(); work.clear(); }; }, [registerWork, registerDeparture, work, key]);
  useEffect(() => {
    if (!needsUnload) return;
    const unload = (event: BeforeUnloadEvent) => { if (work.hasUnsaved()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [work, needsUnload]);
  const load = useCallback(async () => {
    abort.current?.abort(); const request = new AbortController(), turn = ++sequence.current; abort.current = request;
    audio.stopAll(); work.pause(); study.current?.clear(); service.current?.clear(); lessons.current?.clear(); calendar.clear(); parentSummary.pause();
    let lifecycle = work.lifecycle;
    setResult(previous => previous.key === key ? { ...previous, loading: true } : { key, loading: true });
    try {
      await work.settle();
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      const value = await read(mode, studentId, request.signal);
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      onStudentReload?.(value.student); work.configure(value, true); progress.configure(value); guide.configure(value); calendar.configure(value);
      parentSummary.configure(value, parentScope);
      // The calendar loads beside the reading and never holds it back.
      void calendar.load(request.signal); lifecycle = work.lifecycle; setResult({ key, value, loading: true });
      const kind = value.readings.some(row => row.kind === selectedKindRef.current) ? selectedKindRef.current : value.readings[0]?.kind;
      await Promise.all([study.current?.reload(value, request.signal), kind ? work.reload(request.signal, kind) : undefined, service.current?.reload(value, request.signal), lessons.current?.reload(value, request.signal)]);
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      work.accept(lifecycle); completeWork(work);
      setResult({ key, value });
      return value;
    }
    catch (error) { if (!request.signal.aborted && turn === sequence.current) { if ([401, 403, 404].includes(statusOf(error))) { work.clear(); progress.configure(null); guide.configure(null); calendar.configure(null); parentSummary.clear(); } setResult({ key, error: statusOf(error) }); } throw error; }
  }, [read, mode, studentId, key, onStudentReload, work, progress, guide, calendar, completeWork, audio, parentSummary, parentScope]);
  const selectedKindRef = useRef(selectedKind); selectedKindRef.current = selectedKind;
  useEffect(() => registerReload(async () => { await load(); }), [registerReload, load]);
  const authorizedReading = result.key === key && !result.loading ? result.value : undefined;
  // A parent's sitting shows the tutor's newest "Before next time" once, right under the practice bar (parent walk 2026-10-28, finding 2), from the
  // lesson notes this page already reads for the plan; nothing is asked for it.
  const [ask, setAsk] = useState<{ key: string; text: string } | null>(null);
  useLayoutEffect(() => {
    if (mode !== "child-practice" || concealed || !authorizedReading) return;
    lessons.current?.snapshot?.(value => {
      if (value.baseline !== authorizedReading) return;
      setAsk(value.lesson.status === "ready" && value.lesson.latest?.beforeNext ? { key, text: value.lesson.latest.beforeNext } : null);
    });
  }, [mode, concealed, authorizedReading, key]);
  const shownAsk = mode === "child-practice" && ask?.key === key && !concealed ? ask.text : null;
  // The tutor's lesson card reads the same snapshot: the newest "Before next time", and whether the list is ready for a new note.
  const staffView = mode === "tutor" || mode === "admin";
  const [lessonCard, setLessonCard] = useState<{ key: string; ready: boolean; ask: string | null } | null>(null);
  useLayoutEffect(() => {
    if (!staffView || concealed || !authorizedReading) return;
    lessons.current?.snapshot?.(value => {
      if (value.baseline !== authorizedReading) return;
      setLessonCard({ key, ready: value.lesson.status === "ready", ask: value.lesson.status === "ready" ? value.lesson.latest?.beforeNext ?? null : null });
    });
  }, [staffView, concealed, authorizedReading, key]);
  const wide = useSyncExternalStore(subscribeRail, railWide, () => false);
  const congregation = useCongregation(Boolean(authorizedReading && !concealed)), links = congregation.links;
  useLayoutEffect(() => {
    if (mode !== "parent" || concealed || !authorizedReading || !parentSummary.matches(authorizedReading, parentScope)) return;
    // Provider reveal precedes its visible render; start only after that render is authorized.
    lessons.current?.snapshot?.(parentSummary.receiver()); void parentSummary.loadDates();
  }, [mode, concealed, authorizedReading, parentSummary, parentScope]);
  useLayoutEffect(() => {
    if (!authorizedReading) return;
    // Capture the complete closed metadata without changing UI/work state.
    const expected = JSON.stringify(authorizedReading), authority = quietReadingAuthority(authorizedReading);
    return registerQuiet(async signal => {
      const fresh = await read(mode, studentId, signal);
      if (!signal.aborted && quietReadingAuthority(fresh) !== authority) throw new PortalRequestError(404);
      return !signal.aborted && JSON.stringify(fresh) === expected;
    });
  }, [authorizedReading, registerQuiet, read, mode, studentId]);
  useEffect(() => { void load().catch(() => undefined); return () => { sequence.current++; abort.current?.abort(); }; }, [load, retry]);
  const current = result.key === key ? result : null;
  const [editorBusy, setEditorBusy] = useState(false);
  const student = current?.value?.student, readings = current?.value?.readings ?? [];
  const exploring = Boolean(student) && mode !== "parent" && !readings.some(row => row.kind === "torah");
  const selectedReading = readings.find(row => row.kind === selectedKind) ?? readings[0];
  const otherReadings = readings.filter(row => row.id !== selectedReading?.id);
  const learner = mode === "student" || mode === "child-practice" || mode === "parent";
  // The student practising alone on a phone (and a parent's sitting with a child): Hebrew first (2026-10-28 walk). The title is one line, the dock is the practice
  // bar, and the plan (rehearsals, service, service parts, lesson notes) waits in "Your plan" at the foot. A portion still being explored keeps its own page.
  const practisingMode = mode === "student" || mode === "child-practice", practising = practisingMode && Boolean(student) && readings.length > 0 && !exploring;
  // Tutors and admins teach from the same Song session reading, and keep the staff assignment details.
  const staff = mode === "tutor" || mode === "admin", song = learner || staff, editorId = `${serviceId}-editor`;
  const lift = useRef<((index: number) => void) | null>(null);
  const textStart = useRef<(() => void) | null>(null);
  const practice = useRef<((index: number | ((refs: readonly string[]) => number)) => void) | null>(null), readingPanel = useRef<HTMLDivElement | null>(null);
  const [hearReady, setHearReady] = useState(false), [practiceReady, setPracticeReady] = useState(false), [proposedReady, setProposedReady] = useState(false), [proposedHearReady, setProposedHearReady] = useState(false);
  const listeningEnabled = authorizedReading?.referenceListeningEnabled === true;
  const actionScope = useRef({ reading: authorizedReading, concealed }); actionScope.current = { reading: authorizedReading, concealed };
  const proposedHear = useRef<((index: number) => void) | null>(null);
  // Staff change verses in a sheet over the reading instead of a form below it.
  const [sheetOpen, setSheetOpen] = useState(false), [serviceDepartureActive, setServiceDepartureActive] = useState(false), sheet = useRef<HTMLDialogElement>(null), sheetOrigin = useRef<HTMLElement | null>(null);
  const editor = mode === "admin" || mode === "tutor" ? <ReadingEditor key={`${mode}:${studentId}`} mode={mode} baseline={current?.loading ? null : current?.value ?? null} reload={load} onBusy={setEditorBusy} active={sheetOpen && !work.departure && !serviceDepartureActive} /> : null;
  // Keep the editor draft mounted, but give departure review the sole modal
  // layer. This also makes access-check resume independent of effect ordering.
  useWorkspaceModal(sheet, sheetOpen && !work.departure && !serviceDepartureActive);
  // closedby is not available in every browser. Disabled controls can leave
  // focus outside the sheet, so capture Escape at document level only while
  // this visible editor is the actual active modal and has pending work.
  useLayoutEffect(() => {
    if (!editorBusy) return;
    const blockEscape = (event: KeyboardEvent) => {
      const node = sheet.current;
      if (event.key === "Escape" && node?.open && node.matches(":modal") && !node.closest("[hidden], [inert]")) event.preventDefault();
    };
    document.addEventListener("keydown", blockEscape, true);
    return () => document.removeEventListener("keydown", blockEscape, true);
  }, [editorBusy]);
  // The sheet stays open while a review or confirmation is in flight, so its outcome is seen.
  const closeSheet = () => { if (!editorBusy) setSheetOpen(false); };
  useEffect(() => {
    if (sheetOpen || !sheetOrigin.current) return;
    // "Assign verses" becomes "Change verses" once a reading is confirmed.
    const origin = sheetOrigin.current.isConnected ? sheetOrigin.current : document.querySelector<HTMLElement>("[data-pill=\"manage\"]");
    origin?.focus(); sheetOrigin.current = null;
  }, [sheetOpen]);
  // The Manage sheet's rows open the editor; the sheet has closed by then, so focus returns to the Manage pill when the editor does.
  const [manageOpen, setManageOpen] = useState(false), [changeOpen, setChangeOpen] = useState(false);
  const openSheet = (event: { currentTarget: HTMLElement }) => { sheetOrigin.current = event.currentTarget; setSheetOpen(true); };
  const openEditor = () => { sheetOrigin.current = document.querySelector<HTMLElement>("[data-pill=\"manage\"]"); setSheetOpen(true); };
  // Service parts and Lessons follow the text on one page, each under its own heading (Readings for everyone E2); the tabs retired. Every part stays
  // mounted, so reloads, access checks and unsent work behave exactly as on one long page. An address that names a section (the pinned card's
  // "Lessons", the foot, an old ?tab= link the redirect kept as a hash) brings it into view once the reading has loaded.
  const toSection = useCallback((id: string) => {
    const heading = document.getElementById(id); if (!heading?.isConnected) return;
    const folded = heading.closest<HTMLDetailsElement>("details[data-reading-plan], details[data-section-fold]"); if (folded) folded.open = true;
    heading.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); heading.focus({ preventScroll: true });
  }, []);
  const hashed = useRef(false);
  // A student's plan folds into one disclosure at the foot; the parts stay mounted inside it either way, so reloads and unsent work behave the same.
  // It wraps for the whole life of a student page (never only once the reading loads), so nothing inside remounts; it starts folded only once there is a
  // reading to practise (a student with only service parts, or a portion still being explored, sees them open).
  const plan = (children: ReactNode) => practisingMode ? <details className="reading-plan" data-reading-plan="" data-testid="reading-plan" open={!practising || undefined}><summary>Your plan</summary>{children}</details> : children;
  const guideLink = <p className="field-help"><a href="https://www.centralreform.org/beit-mitzvah/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">CRC preparation guide</a></p>;
  const tabPanel = (value: "reading" | "service" | "lessons", children: ReactNode) => value === "reading" ? children : <div className="reading-section" data-section={value}>{children}</div>;
  // A parent's page folds its rows and its text so it opens on This week (the whole-screen rethink). The parts stay mounted inside either way, so
  // reloads, access checks and the lesson snapshot that feeds This week behave exactly as on one long page.
  const sectionFold = (value: "service" | "lessons", label: string, children: ReactNode) => mode === "parent"
    ? <details className="parent-row" data-section-fold={value} data-testid={`parent-row-${value}`}><summary>{label}</summary>{children}</details> : children;
  const readingFold = (children: ReactNode) => mode === "parent"
    ? <details className="parent-reading" data-testid="parent-reading" hidden={!student}><summary><span>See <bdi dir="auto">{student?.firstName ?? firstName ?? ""}</bdi>’s reading</span></summary>{children}</details> : children;
  // Reading actions leave the page's other work through the departure review.
  const guardReading = guardDeparture;
  const startReading = () => {
    const target = exploring ? proposedHear.current : lift.current;
    if (listeningEnabled) { target?.(0); return; }
    if (!exploring) textStart.current?.();
    // Wait a frame so the reading panel is displayed before scrolling to it.
    const expected = authorizedReading;
    requestAnimationFrame(() => {
      if (!expected || actionScope.current.reading !== expected || actionScope.current.concealed) return;
      const section = readingPanel.current?.querySelector(exploring ? '[aria-label="Proposed Torah portion"]' : '[aria-label="Assigned text"]');
      const text = section?.querySelector<HTMLElement>(".study-verses");
      if (!text?.isConnected || text.closest("[hidden], [inert]")) return;
      text.focus({ preventScroll: true }); text.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  };
  // A student's Up close opens at the first verse on the page not yet marked Got it (the first when every one is).
  const openPractice = () => { const kind = selectedReading?.kind;
    practice.current?.(practising && kind ? refs => Math.max(0, refs.findIndex(ref => !isGotIt(progress, kind, ref))) : 0); };
  // The printable practice sheet reads through the same authorized study loader as the page.
  const [printing, setPrinting] = useState(false);
  useLayoutEffect(() => { if (!authorizedReading || concealed) setPrinting(false); }, [authorizedReading, concealed]);
  const openPrint = () => { audio.stopAll(); setPrinting(true); }, printDisabled = !authorizedReading || concealed || Boolean(current?.loading);
  // The reader's print sheet of the same verses (Daniel, 2026-10-23: a way in from wherever a person works on a reading). The link names
  // only the verses, never the student; the sheet loads them from the public routes. Leaving goes through the departure review.
  const printSheetRef = selectedReading ? refFromVerses(selectedReading.verses, selectedReading.kind) : null;
  const printSheetHref = printSheetRef && selectedReading ? printAddress({ mode: "ref", ref: printSheetRef, kind: selectedReading.kind }) : null;
  // Curated discussions are public, asked for by the passage's own canonical ref and nothing about the reader (the same as the print link above).
  const discussionPassage = student && authorizedReading && !concealed && !exploring && selectedReading && printSheetRef ? { ref: printSheetRef, kind: selectedReading.kind } : null;
  const practiceAction = mode !== "parent" && readings.length > 0 && <button type="button" className="button-hero-secondary reading-practice-action" disabled={!practiceReady || concealed || current?.loading} onClick={openPractice}>{exploring ? "Practice assigned Haftarah up close" : "Practice up close"}</button>;
  const countdown = student ? ceremonyCountdown(student.ceremonyDate) : null, marked = useProgressSummary(progress, selectedReading?.kind);
  // Staff see a rehearsal or Beit Mitzvah two weeks away or less first on the title line (tutor walk 2026-10-28, finding 2).
  const staffNext = staff && student ? nextDate(student) : null, staffChip = staffNext?.chip ? <><Chip tone="attention">{staffNext.chip}</Chip> </> : null;
  // The title block (Readings for everyone E2): the name, one muted line, and the pills that act on the reading as a whole. A learner has Change (Go to verse);
  // staff have Change and Manage, where every other action went.
  const titleRange = titleReading(readings, exploring, selectedReading?.kind);
  const brief = student ? learnerTitle(student.ceremonyDate) : null;
  // A parent's page opens on what's next: the name and one date line, no ranges or counts (This week has the count, the reading has the ranges).
  const titleLine = practising && student && brief ? <>{mode === "child-practice" ? null : <>{brief.label} · </>}<span className="hero-date" data-testid="hero-date"><time dateTime={student.ceremonyDate}>{brief.date}</time></span>{brief.countdown && ` · ${brief.countdown}`}</>
    : mode === "parent" && student && countdown ? <>Beit Mitzvah · <span className="hero-date" data-testid="hero-date"><time dateTime={student.ceremonyDate}>{countdown.label}</time></span></>
    : student && countdown ? <>{staffChip}Beit Mitzvah · <span className="hero-date" data-testid="hero-date"><time dateTime={student.ceremonyDate}>{countdown.label}</time></span>{titleRange && ` · ${titleRange}`}{marked && <span className="hero-marked"> · {marked}</span>}</> : null;
  const slotLine = student && congregation.ready ? serviceSlotName(student.serviceSlot, congregation.services) : null;
  // The parent's service sits on its own line with no leading dot (finding 14); This week says the next rehearsal, so the dates are not repeated (finding 3).
  // Its start time shows beside it on wider screens only, as on every reading header.
  const slotTime = student && congregation.ready ? serviceSlotTime(student.serviceSlot, congregation.services) : null;
  const titleNote = student && !practising && (mode === "parent" ? slotLine && <p className="hero-who" data-testid="hero-slot"><span className="hero-slot">{slotLine}{slotTime && <span className="hero-slot-time"> · {slotTime}</span>}</span></p>
    : <>{slotLine && <p className="hero-who"><ServiceSlotName student={student} services={congregation.services} /></p>}<RehearsalDates student={student} /></>);
  const pillByKey = { change: { key: "change", label: learner ? "Go to verse" : "Change", icon: "chevron", haspopup: "dialog", expanded: changeOpen, onClick: () => setChangeOpen(true) },
    manage: { key: "manage", label: "Manage", icon: "sliders", haspopup: "dialog", expanded: manageOpen, onClick: () => setManageOpen(true) } } satisfies Record<"change" | "manage", Pill>;
  // The parent's page keeps the text folded under "See Noa's reading", so it has no Go to verse.
  const pills: Pill[] = mode === "parent" ? [] : titlePillKeys(staff).map(key => pillByKey[key]);
  const childName = student?.firstName ?? firstName ?? "";
  const practiceWith = mode === "parent" && student ? <button type="button" className="button-primary parent-practice" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : <span>Practice with <bdi dir="auto">{student.firstName}</bdi></span>}</button> : null;
  const StateHeading = mode === "child-practice" ? "h2" : "h1";
  const chapters = selectedReading ? readingChapters(selectedReading.verses) : [];
  const goToVerse = (ref: string) => { setChangeOpen(false); requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(`[data-verse-ref="${CSS.escape(ref)}"]`); if (!target) return;
    target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); target.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }); };
  const refresh = () => {
    const target = studyDenied, turn = sequence.current;
    // Explicit reload retains translation drafts; only Sources must settle before their owners are replaced.
    void guardDeparture("sources").then(leave => { if (leave && environment.current.studyDenied === target && sequence.current === turn && !abort.current?.signal.aborted) setRetry(value => value + 1); });
  };
  const writeNote = () => { toSection(SECTION_IDS.lessons); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-lesson-add]")?.click()); };
  // Arriving at /mine/reading#lessons (or an old ?tab= address the redirect turned into a hash): once the reading is shown, bring that section forward, once.
  useEffect(() => {
    if (hashed.current || !authorizedReading || concealed) return;
    const id = decodeURIComponent(window.location.hash.slice(1)); hashed.current = true;
    if (sectionIds.includes(id)) requestAnimationFrame(() => toSection(id));
  }, [authorizedReading, concealed, toSection]);
  const serviceBlock = tabPanel("service", <><ServiceLearningPanel id={serviceId} headingId={SECTION_IDS.service} mode={mode} studentId={studentId} baseline={current?.loading ? null : current?.value ?? null} register={registerService} reloadReading={load} onDepartureActive={setServiceDepartureActive} onVisit={(plan, unitId) => calendar.visitUnit(plan, unitId)} />
      {authorizedReading && !concealed && <p className="field-help"><a href={links.siddurUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">CRC digital siddur collection</a>{links.musicUrl && <> · <a href={links.musicUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Service music</a></>}</p>}</>);
  const lessonsBlock = tabPanel("lessons", <>{staff && student && authorizedReading && !concealed && <TutorPracticeDays />}{staff && student && authorizedReading && !concealed && <StaffPracticeDays calendar={calendar} firstName={student.firstName} />}<LessonLog mode={mode} studentId={studentId} register={registerLessons} tabbed={false} headingId={SECTION_IDS.lessons} firstName={student?.firstName ?? firstName} /></>);
  // A parent reads the lesson notes first (what the tutor asked), then the service parts; everyone else keeps the page's order.
  const parts = mode === "parent" ? <>{sectionFold("lessons", "Lesson notes", lessonsBlock)}{sectionFold("service", "Service parts", serviceBlock)}</> : <>{serviceBlock}{lessonsBlock}</>;
  // N3's section chip row (the tutor's aliyot, with "Service parts" last) is built in `study/view.tsx` and sits in a sticky bar above the passage for every role;
  // its "Service parts" chip goes to the Service parts section below the text (`onService`).
  // Learners (students, child practice, parents) always open in Lein; staff open in the lens they last used.
  // 1.9 N23: the assigned tutor's read of this student's practice is held by the scope itself, so its answer re-renders only the lines
  // that use it, never this panel (and never its playback). Nothing is asked for anyone else, or while the gate is closed.
  // Staff (tutor walk 2026-10-28, whole-screen rethink): the text and Service parts on the left, and a lesson rail on the right that stays in view,
  // with the lesson card over the Lessons list. Narrower, the card sits under the title and the Lessons follow Service parts, as before.
  const card = staff && student && authorizedReading && !concealed ? <LessonCard baseline={authorizedReading} ask={lessonCard?.key === key ? lessonCard.ask : null} ready={lessonCard?.key === key && lessonCard.ready}
    addButton={!wide} onAdd={origin => lessons.current?.add?.(origin)} /> : null;
  const body = <>
    {/* 1.9 N16 re-measure (CLS): while the reading loads it keeps a screen of room, so what follows it never jumps into view and out again. */}
    {current?.loading && <div className="reading-loading-space reading-loading" data-testid="reading-loading"><p role="status">Checking the current assignment, text and saved work…</p>
      <div className="reading-skeleton" aria-hidden="true"><span /><span /><span /><span /><span /></div></div>}<div className="reading-workspace reading-with-work" data-testid="reading-workspace" hidden={Boolean(current?.loading)} inert={Boolean(current?.loading)}>
    <section aria-label="Assigned reading">
      {!student ? <div className={`workspace-state${current?.error ? "" : " reading-loading-space"}`} aria-live="polite"><StateHeading>{current?.error ? "Reading unavailable" : "Loading the assigned reading"}</StateHeading>
        <p>{current?.error === 404 || current?.error === 403 ? "This reading is no longer available in the selected role. Choose another available student." : current?.error && mode === "parent" && childName ? <><bdi dir="auto">{childName}</bdi>’s reading didn’t load.</> : current?.error ? "We couldn’t load the confirmed assignment. No previous student’s reading is being shown." : "Checking the selected student and confirmed references."}</p>
        {current?.error && <button className="button-secondary" onClick={() => setRetry(value => value + 1)}>{mode === "parent" ? "Try again" : "Reload reading"}</button>}</div> : <>
      {song ? <><header className={`reading-hero${learner ? " reading-current-assignment" : ""}`} aria-labelledby="reading-heading">
        {/* A parent's sitting mirrors the student's Hebrew-first page (parent walk 2026-10-28, finding 1): under the one-line bar, the tutor's ask, then one
            line of what the tutor sees, then the date and Go to verse (the child's name is the bar's, so its heading here is for screen readers only). */}
        {shownAsk && <ClampedAsk text={shownAsk} />}
        {mode === "child-practice" && <ChildPracticeDisclosure name={student.firstName} place="child-practice" />}
        <ReaderTitle name={titleName(student)} headingId="reading-heading" level={mode === "child-practice" ? 2 : 1} line={titleLine} pills={pills} note={titleNote} hideName={mode === "child-practice"} />
        {staff && authorizedReading && !concealed && <StaffStudentLines mode={mode} baseline={authorizedReading} />}
        {exploring || readings.length === 0 ? <div className="reading-empty"><h2 className="hero-reference hero-reference-empty">{exploring ? "Explore the full Torah portion" : "No reading has been assigned yet"}</h2><p className="hero-meta">{exploring ? "Read the portion while you and your tutor choose your verses." : staff ? "Choose the verses this student will read." : "Your tutor or rabbi will add your verses here."}</p>
          {(staff || practiceAction) && <div className="hero-actions">{staff && <button type="button" className="button-hero-secondary" onClick={openSheet}>Assign verses</button>}{practiceAction}</div>}</div> : <>
          {/* A student's switch under the title names the reading, and Up close is in the dock (Hebrew first). A parent's ranges are in the reading itself. */}
          {!practising && mode !== "parent" && !staff && readings.length > 1 && <AssignedReadingSummaries readings={readings} selectedKind={selectedReading.kind} />}
          {!practising && practiceAction && <div className="hero-actions">{practiceAction}</div>}</>}
      </header>
      {!wide && card}
      {/* The parent's page is a This week page (the whole-screen rethink): the card with Practice with the child, then Lesson notes and Service parts as
          rows that open in place, then Family honors, and last the text behind "See Noa's reading". */}
      {mode === "parent" && <ParentStudySummary store={parentSummary} baseline={authorizedReading ?? null} scope={parentScope} concealed={concealed} notice={congregation.consentNotice} action={practiceWith} readProgress={readProgress} />}
      {!learner && readings.length > 0 && <AssignmentContext row={selectedReading} current staff={staff} />}
      </> : <>
      <h2 id="reading-heading"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
      <div className="reading-student-context"><p className="reading-date">Ceremony date: <time dateTime={student.ceremonyDate}>{student.ceremonyDate}</time></p>
      <button className="button-text" aria-label="Refresh reading" onClick={() => setRetry(value => value + 1)}>Refresh</button>
</div>
      {current?.loading && <p role="status">Checking the current assignment…</p>}
      {readings.length === 0 ? <div className="reading-empty"><h3>No reading has been assigned yet</h3><p>Your tutor or rabbi will confirm the verses here.</p></div>
        : <AssignmentContext row={selectedReading} current staff={staff} />}</>}</>}
      {/* The rows stay mounted whether or not the reading has loaded, as the plan's parts always were, so their reloads run with the page's. */}
      {mode === "parent" && parts}{mode === "parent" && student && afterSummary}
      {readingFold(tabPanel("reading", <>{student && authorizedReading && !concealed && !exploring && selectedReading && mode === "admin" && <GuideStatusLine kind={selectedReading.kind} readingKey={selectedReading.readingKey ?? null} />}{student && authorizedReading && !concealed && !exploring && selectedReading && <LensOnly lens="lein"><div className={`guide-place guide-place-wide`}><GuideCard store={guide} kind={selectedReading.kind} firstName={student.firstName} learner={learner} /></div></LensOnly>}<VersePanelScope passage={discussionPassage}><div className="reading-passage-layout" ref={readingPanel}>{student && song && <ReadingToolbar practice={practising ? { onUpClose: practiceReady && !concealed && !current?.loading ? openPractice : undefined, listenReason: LISTENING_OFF } : undefined} listeningEnabled={listeningEnabled} tikkunAvailable={exploring || selectedReading?.kind === "torah"} worksCorpus={exploring || selectedReading?.kind !== "haftarah" ? "torah" : "neviim"} onHear={(exploring ? proposedHearReady : hearReady) && !concealed && !current?.loading ? startReading : undefined} />}
        {authorizedReading && !listeningEnabled && !practising && <p className="field-help">{readings.length ? mode === "parent" ? LISTENING_OFF_PARENT : LISTENING_OFF : "Listening isn’t available yet. You can keep reading the Torah portion."}</p>}
        <ProposedTorahText audio={audio} hearHandle={proposedHear} onReadingReady={setProposedReady} onHearReady={setProposedHearReady} baseline={current?.loading ? null : current?.value ?? null} reloadMetadata={load} authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} />
        {exploring && readings.length > 0 && <header><h3 data-testid="assigned-haftarah-heading">Assigned Haftarah</h3><p className="reading-reference">{displayRange(readings[0].ranges)}</p>
          {listeningEnabled && <LensOnly lens="lein"><button type="button" className="button-secondary" disabled={!hearReady || concealed || current?.loading} onClick={() => lift.current?.(0)}>Hear Haftarah</button></LensOnly>}</header>}
        <AssignedStudyText audio={audio} stopAudio={audio.stopAll} baseline={current?.value ?? null} register={registerStudy} reloadMetadata={load} authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} onKindChange={setSelectedKind}
        guardDeparture={guardReading} renderGuide={(kind, verseRef) => <GuideVerseNotes store={guide} kind={kind} verseRef={verseRef} />} guide={guide}
        renderIntro={kind => student && authorizedReading && !concealed && !exploring ? <AboutCard store={guide} kind={kind} /> : null} renderWork={(kind, verseRef) => <VerseTools coordinator={work} kind={kind} verseRef={verseRef} />} renderActiveWork={() => work.active && <VerseTools coordinator={work} kind={work.active.kind} verseRef={work.active.ref} />}
        onPage={async (kind, offset, signal) => { await work.loadPage(kind, offset, signal); }} onPrint={learner && !printDisabled ? openPrint : undefined} printSheetHref={learner ? printSheetHref ?? undefined : undefined} learner={learner} practising={practising} gotIt={practising ? (kind, verseRef) => isGotIt(progress, kind, verseRef) : undefined} songSession={song} liftHandle={lift} practiceHandle={practice} textStartHandle={textStart} verseLookupHandle={verseLookup} onPracticeReady={setPracticeReady} onHearReady={setHearReady} onService={() => toSection(SECTION_IDS.service)}
        onShown={(kind, offset, length) => progress.ensure(kind, offset, length)} renderMark={(kind, verseRef) => <VerseMark store={progress} kind={kind} verseRef={verseRef} />} renderLiftControls={(kind, verseRef) => <><LiftProgress store={progress} kind={kind} verseRef={verseRef} listening={listeningEnabled} childName={mode === "child-practice" ? student?.firstName : undefined} />{staff && student && <LiftNote key={`${kind}:${verseRef}`} coordinator={work} kind={kind} verseRef={verseRef} firstName={student.firstName} />}</>} onVisit={(kind, verseRef) => calendar.visitVerse(kind, verseRef)} /></div></VersePanelScope>
      {/* A parent's sitting keeps the week's dots, the feedback for the sitting, right after the text, so the Hebrew comes first (finding 1). */}
      {mode === "child-practice" && <PracticeDays calendar={calendar} />}
      {student && authorizedReading && !concealed && !exploring && selectedReading && <LensOnly lens="lein"><div className={`guide-place guide-place-narrow`}><GuideCard store={guide} kind={selectedReading.kind} firstName={student.firstName} learner={learner} /></div></LensOnly>}
      {work.notice && <p className="field-help" role="status">{work.notice}</p>}
      {authorizedReading && !concealed && !practisingMode && guideLink}
      {!learner && otherReadings.length > 0 && <details className="reading-other-assignments"><summary>Other confirmed reading details</summary>{otherReadings.map(row => <AssignmentContext key={row.id} row={row} staff={staff} />)}</details>}
      {/* The parent's text already ends in Trope chart and Print practice sheet, and its rows sit above it: one foot row, not two (finding 16). */}
      {student && song && authorizedReading && !concealed && mode !== "parent" && <ReadingFoot printLast print={printSheetHref ?? undefined} lead={practisingMode ? undefined : <><a href={`#${SECTION_IDS.service}`}>Service parts</a><a href={`#${SECTION_IDS.lessons}`}>Lessons</a></>} more={mode === "student" ? <LearnReviewAction /> : undefined} />}</>))}
    </section>
    {student && !song && <aside className="reading-tools" aria-labelledby="tools-heading"><h2 id="tools-heading">Practice tools</h2>
      <p>The confirmed assignment appears here. Use the review form below to propose and confirm changes.</p>
      <p>{listeningEnabled ? "Click a word or verse control to listen. Translation and notes stay beside the reading." : "Translation, word tools and notes stay beside the reading."}</p>
      <p><WorkspaceLink href="/trope-chart">Open the printable trope chart</WorkspaceLink></p>
      <p className="field-help">Unsent work stays only in this tab. Controlled workspace changes ask you to review it.</p>
    </aside>}
  </div>
  </>;
  return <TutorPracticeScope mode={mode} studentId={studentId} concealed={concealed}><ReadingPrefsScope studentId={studentId} englishOnWide={!staff}><StudyLensScope storageKey={staff ? LENS_STORAGE.staff : null}><DepartureReview coordinator={work} />
    {staff ? <div className="staff-layout" data-testid="staff-layout"><div className="staff-main">{body}{serviceBlock}</div>
      <div className="lesson-rail" data-testid="lesson-rail">{wide && card}{lessonsBlock}</div></div> : body}{editor && (staff ? <dialog ref={sheet} id={editorId} className="editor-sheet" aria-labelledby="reading-editor-title" closedby={editorBusy ? "none" : "closerequest"} onCancel={event => { event.preventDefault(); closeSheet(); }}>
      <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close verse editor" disabled={editorBusy} onClick={closeSheet}>{icons.close}</button></div>{editor}
    </dialog> : <div id={editorId} className="reading-editor-anchor">{editor}</div>)}
    {plan(<>{student && practisingMode && authorizedReading && !concealed && <div className="reading-plan-dates">{slotLine && <p className="hero-slot" data-testid="plan-service">{slotLine}</p>}<RehearsalDates student={student} />{guideLink}</div>}
    {mode !== "parent" && !staff && parts}</>)}
    {student && song && <Sheet open={changeOpen} onClose={() => setChangeOpen(false)} title={learner ? "Go to verse" : "Change reading"} closeLabel="Close">
      <div data-change-sheet="">{chapters.length > 0 && <label className="reading-go-to"><span>Go to verse</span>
        <select aria-label="Go to verse" value="" onChange={event => { const next = chapters.find(row => row.key === event.target.value); if (next) goToVerse(next.first); }}>
          <option value="" disabled>Choose</option>{chapters.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>}</div>
    </Sheet>}
    {student && staff && (mode === "tutor" || mode === "admin") && <ManageSheet mode={mode} student={student} baseline={authorizedReading && !concealed ? authorizedReading : null}
      actions={{ open: manageOpen, onClose: () => setManageOpen(false), setDivisions: openEditor, changeVerses: openEditor, printPractice: openPrint, printDisabled: printDisabled || readings.length === 0,
        printWholeHref: printSheetHref, writeNote, refresh, reload: load }} />}
    {printing && authorizedReading && !concealed && selectedReading && <PracticeSheet baseline={authorizedReading} initialKind={selectedReading.kind} onClose={() => setPrinting(false)}
      authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} />}
  </StudyLensScope></ReadingPrefsScope></TutorPracticeScope>;
}
