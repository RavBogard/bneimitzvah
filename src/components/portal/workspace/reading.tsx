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
import { DiscussionList, SourcesButton, VersePanelScope } from "./study/verse-panel";
import { ProgressStore } from "./progress/store";
import { GuideStore } from "./study/guide-store";
import { GuideCard, GuideVerseNotes } from "./study/guide-card";
import { GuideWalk } from "./study/guide-walk";
import { GuideStatusLine } from "./study/guide-status";
import type { StudyVerse } from "./study/api";
import { LiftProgress, useProgressSummary, VerseMark } from "./progress/marks";
import { LessonLog, type LessonReload } from "./lessons/panel";
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
import { Sheet } from "../../ui";
import { titleName, titlePillKeys, titleReading } from "./reading-title";

const dayMs = 86_400_000;
/** "Sat, Jan 2, 2027" and whole days until it, computed on the calendar date only. */
export function ceremonyCountdown(date: string, now = new Date()) {
  const [year, month, day] = date.split("-").map(Number), ceremony = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), days = Math.round((ceremony - today) / dayMs);
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(ceremony);
  return { label, days, phrase: days > 1 ? `${days} days to go` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : null };
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
  return name ? <span className="hero-slot"><span aria-hidden="true">· </span>{name}{time && <span className="hero-slot-time"> · {time}</span>}</span> : null;
}
const displayRange = (ranges: string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1\u2013$2");

export function AssignedReadingSummaries({ readings, selectedKind, marked }: { readings: readonly Reading[]; selectedKind: StudyKind; marked?: string | null }) {
  return <div className="hero-reading-summaries" role="group" aria-label="Assigned readings">{readings.map(row => <div key={row.id} className="hero-reading-summary" data-reading-kind={row.kind} data-verse-count={row.verses.length} aria-current={row.kind === selectedKind ? "true" : undefined}>
    <h3>{row.kind === "torah" ? "Torah" : "Haftarah"} <bdi dir="ltr">{displayRange(row.ranges)}</bdi></h3>
    <p>{row.verses.length} {row.verses.length === 1 ? "verse" : "verses"}{row.kind === selectedKind && <> <span className="reading-summary-current">Current reading</span>{marked && <span className="hero-marked"> · {marked}</span>}</>}</p>
  </div>)}</div>;
}

function AssignmentContext({ row, current = false }: { row: Reading; current?: boolean }) {
  return <article className={`confirmed-reading${current ? " reading-current-assignment" : ""}`}>
    <h3>{row.kind === "torah" ? "Torah" : "Haftarah"}</h3>
    <p className="reading-reference">{row.ranges.join("; ")}</p>
    <p className={row.needsReview ? "reading-review status-chip status-chip-attention" : "field-help status-chip"} data-testid="reading-assignment-chip" data-needs-review={String(row.needsReview)}>{row.needsReview ? "Needs review with your tutor or rabbi" : "Confirmed assignment"} · Revision {row.revision}</p>
    <details><summary>Assigned verse references ({row.verses.length})</summary><ol className="verse-references">{row.verses.map((verse, index) => <li key={`${index}:${verse}`}>{verse}</li>)}</ol>
      <p className="field-help">Calendar source: {row.source.attribution ? <a href={row.source.attribution.url} target="_blank" rel="noopener noreferrer">{row.source.attribution.name}</a> : "not recorded"}. {row.source.status === "unavailable" ? "Calendar source was unavailable when this assignment was confirmed." : row.source.status === "unknown" ? "Source availability is not recorded." : "Calendar source was available at confirmation."}</p>
      {row.confirmationDate && <p className="field-help">Ceremony date at confirmation: {row.confirmationDate}</p>}
    </details>
  </article>;
}

/** The anchors the foot, the pinned card and the old tab addresses name: Service parts and Lessons follow the text on one page (Readings for everyone E2). */
export const SECTION_IDS = Object.freeze({ service: "service-parts", lessons: "lessons" });
const sectionIds: readonly string[] = Object.values(SECTION_IDS);

/** afterSummary: what sits right after a parent's "This week" summary (their honors row, 1.9 N13); nothing for any other mode. */
export function ReadingPanel({ mode, studentId, onStudentReload, afterSummary }: { mode: ReadingMode; studentId: string; onStudentReload?(student: Student): void; afterSummary?: ReactNode }) {
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
  const verseLookup = useRef<((ref: string) => StudyVerse | null) | null>(null), [walking, setWalking] = useState(false);
  // Closing the walk returns to the verse last shown, or to the button that opened it.
  const closeWalk = (last: string | null) => {
    setWalking(false);
    requestAnimationFrame(() => {
      const target = last ? document.querySelector<HTMLElement>(`[data-guide-notes="${CSS.escape(last)}"]`) : null;
      if (target?.isConnected) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
      else [...document.querySelectorAll<HTMLElement>("[data-guide-kind] button[data-guide-study]")].find(button => button.offsetParent !== null)?.focus();
    });
  };
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
  // Tutors and admins teach from the same Song session reading, and keep the staff assignment details.
  const staff = mode === "tutor" || mode === "admin", song = learner || staff, editorId = `${serviceId}-editor`;
  const lift = useRef<((index: number) => void) | null>(null);
  const textStart = useRef<(() => void) | null>(null);
  const practice = useRef<((index: number) => void) | null>(null), readingPanel = useRef<HTMLDivElement | null>(null);
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
    heading.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); heading.focus({ preventScroll: true });
  }, []);
  const hashed = useRef(false);
  const tabPanel = (value: "reading" | "service" | "lessons", children: ReactNode) => value === "reading" ? children : <div className="reading-section" data-section={value}>{children}</div>;
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
  const openPractice = () => { practice.current?.(0); };
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
  // The title block (Readings for everyone E2): the name, one muted line, and the pills that act on the reading as a whole. A learner has Change (Go to verse);
  // staff have Change and Manage, where every other action went.
  const titleRange = titleReading(readings, exploring);
  const titleLine = student && countdown ? <>Beit Mitzvah · <span className="hero-date" data-testid="hero-date"><time dateTime={student.ceremonyDate}>{countdown.label}</time></span>{titleRange && ` · ${titleRange}`}{marked && <span className="hero-marked"> · {marked}</span>}</> : null;
  const slotLine = student && congregation.ready ? serviceSlotName(student.serviceSlot, congregation.services) : null;
  const titleNote = student && <>{slotLine && <p className="hero-who"><ServiceSlotName student={student} services={congregation.services} /></p>}<RehearsalDates student={student} /></>;
  const pillByKey = { change: { key: "change", label: "Change", icon: "chevron", haspopup: "dialog", expanded: changeOpen, onClick: () => setChangeOpen(true) },
    manage: { key: "manage", label: "Manage", icon: "sliders", haspopup: "dialog", expanded: manageOpen, onClick: () => setManageOpen(true) } } satisfies Record<"change" | "manage", Pill>;
  const pills: Pill[] = titlePillKeys(staff).map(key => pillByKey[key]);
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
  // N3's section chip row (the tutor's aliyot, with "Service parts" last) is built in `study/view.tsx` and sits in a sticky bar above the passage for every role;
  // its "Service parts" chip goes to the Service parts section below the text (`onService`).
  // Learners (students, child practice, parents) always open in Lein; staff open in the lens they last used.
  // 1.9 N23: the assigned tutor's read of this student's practice is held by the scope itself, so its answer re-renders only the lines
  // that use it, never this panel (and never its playback). Nothing is asked for anyone else, or while the gate is closed.
  return <TutorPracticeScope mode={mode} studentId={studentId} concealed={concealed}><ReadingPrefsScope studentId={studentId} englishOnWide={!staff}><StudyLensScope storageKey={staff ? LENS_STORAGE.staff : null}><DepartureReview coordinator={work} />
    {/* 1.9 N16 re-measure (CLS): while the reading loads it keeps a screen of room, so what follows it never jumps into view and out again. */}
    {current?.loading && <div className="reading-loading-space" aria-hidden="true" />}<div className="reading-workspace reading-with-work" data-testid="reading-workspace" hidden={Boolean(current?.loading)} inert={Boolean(current?.loading)}>
    <section aria-label="Assigned reading">
      {!student ? <div className={`workspace-state${current?.error ? "" : " reading-loading-space"}`} aria-live="polite"><StateHeading>{current?.error ? "Reading unavailable" : "Loading the assigned reading"}</StateHeading>
        <p>{current?.error === 404 || current?.error === 403 ? "This reading is no longer available in the selected role. Choose another available student." : current?.error ? "We couldn’t load the confirmed assignment. No previous student’s reading is being shown." : "Checking the selected student and confirmed references."}</p>
        {current?.error && <button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload reading</button>}</div> : <>
      {song ? <><header className={`reading-hero${learner ? " reading-current-assignment" : ""}`} aria-labelledby="reading-heading">
        <ReaderTitle name={titleName(student)} headingId="reading-heading" level={mode === "child-practice" ? 2 : 1} line={titleLine} pills={pills} note={titleNote} />
        {staff && authorizedReading && !concealed && <StaffStudentLines mode={mode} baseline={authorizedReading} />}
        {mode === "parent" && <p className="hero-meta">Sit down with <bdi dir="auto">{student.firstName}</bdi> and tap Practice with <bdi dir="auto">{student.firstName}</bdi> to go through <bdi dir="auto">{student.firstName}</bdi>'s verses together.</p>}
        {exploring || readings.length === 0 ? <div className="reading-empty"><h2 className="hero-reference hero-reference-empty">{exploring ? "Explore the full Torah portion" : "No reading has been assigned yet"}</h2><p className="hero-meta">{exploring ? "Read the portion while you and your tutor choose your verses." : staff ? "Choose the verses this student will read." : "Your tutor or rabbi will add your verses here."}</p>
          <div className="hero-actions">{mode === "parent" && <button className="button-hero-secondary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : `Practice with ${student.firstName}`}</button>}{staff && <button type="button" className="button-hero-secondary" onClick={openSheet}>Assign verses</button>}{practiceAction}</div></div> : <>
          {readings.length > 1 && <AssignedReadingSummaries readings={readings} selectedKind={selectedReading.kind} marked={marked} />}
          <div className="hero-actions">
            {practiceAction}
            {mode === "parent" && <button className="button-hero-secondary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : `Practice with ${student.firstName}`}</button>}
          </div></>}
        {/* The week's dots belong to the pinned card on the shelf (E1); a parent's practice page keeps its own, the feedback for the sitting. */}
        {mode === "child-practice" && <PracticeDays calendar={calendar} />}
      </header>
      {mode === "parent" && <ParentStudySummary store={parentSummary} baseline={authorizedReading ?? null} scope={parentScope} concealed={concealed} notice={congregation.consentNotice} />}
      {mode === "parent" && afterSummary}
      {!learner && readings.length > 0 && <AssignmentContext row={selectedReading} current />}
      </> : <>
      <h2 id="reading-heading"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
      <div className="reading-student-context"><p className="reading-date">Ceremony date: <time dateTime={student.ceremonyDate}>{student.ceremonyDate}</time></p>
      <button className="button-text" aria-label="Refresh reading" onClick={() => setRetry(value => value + 1)}>Refresh</button>
</div>
      {current?.loading && <p role="status">Checking the current assignment…</p>}
      {readings.length === 0 ? <div className="reading-empty"><h3>No reading has been assigned yet</h3><p>Your tutor or rabbi will confirm the verses here.</p></div>
        : <AssignmentContext row={selectedReading} current />}</>}</>}
      {tabPanel("reading", <>{student && authorizedReading && !concealed && !exploring && selectedReading && mode === "admin" && <GuideStatusLine kind={selectedReading.kind} readingKey={selectedReading.readingKey ?? null} />}{student && authorizedReading && !concealed && !exploring && selectedReading && <div className={`guide-place guide-place-wide`}><GuideCard store={guide} kind={selectedReading.kind} firstName={student.firstName} learner={learner} onStudy={() => setWalking(true)} /></div>}{walking && selectedReading && guide.view(selectedReading.kind) && <GuideWalk view={guide.view(selectedReading.kind)!} lookup={ref => verseLookup.current?.(ref) ?? null} onClose={closeWalk} />}<VersePanelScope passage={discussionPassage}><SourcesButton /><div className="reading-passage-layout" ref={readingPanel}>{student && song && <ReadingToolbar listeningEnabled={listeningEnabled} tikkunAvailable={exploring || selectedReading?.kind === "torah"} worksCorpus={exploring || selectedReading?.kind !== "haftarah" ? "torah" : "neviim"} onHear={(exploring ? proposedHearReady : hearReady) && !concealed && !current?.loading ? startReading : undefined} />}
        {authorizedReading && !listeningEnabled && <p className="field-help">{readings.length ? "Listening isn’t available yet. You can read, use word tools and practice up close." : "Listening isn’t available yet. You can keep reading the Torah portion."}</p>}
        <ProposedTorahText audio={audio} hearHandle={proposedHear} onReadingReady={setProposedReady} onHearReady={setProposedHearReady} baseline={current?.loading ? null : current?.value ?? null} reloadMetadata={load} authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} />
        {exploring && readings.length > 0 && <header><h3 data-testid="assigned-haftarah-heading">Assigned Haftarah</h3><p className="reading-reference">{displayRange(readings[0].ranges)}</p>
          {listeningEnabled && <button type="button" className="button-secondary" disabled={!hearReady || concealed || current?.loading} onClick={() => lift.current?.(0)}>Hear Haftarah</button>}</header>}
        <AssignedStudyText audio={audio} stopAudio={audio.stopAll} baseline={current?.value ?? null} register={registerStudy} reloadMetadata={load} authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} onKindChange={setSelectedKind}
        guardDeparture={guardReading} renderGuide={(kind, verseRef) => <GuideVerseNotes store={guide} kind={kind} verseRef={verseRef} />} renderWork={(kind, verseRef) => <VerseTools coordinator={work} kind={kind} verseRef={verseRef} />} renderActiveWork={() => work.active && <VerseTools coordinator={work} kind={work.active.kind} verseRef={work.active.ref} />}
        onPage={async (kind, offset, signal) => { await work.loadPage(kind, offset, signal); }} onPrint={learner && !printDisabled ? openPrint : undefined} printSheetHref={learner ? printSheetHref ?? undefined : undefined} learner={learner} songSession={song} liftHandle={lift} practiceHandle={practice} textStartHandle={textStart} verseLookupHandle={verseLookup} onPracticeReady={setPracticeReady} onHearReady={setHearReady} onService={() => toSection(SECTION_IDS.service)}
        onShown={(kind, offset, length) => progress.ensure(kind, offset, length)} renderMark={(kind, verseRef) => <VerseMark store={progress} kind={kind} verseRef={verseRef} />} renderLiftControls={(kind, verseRef) => <><LiftProgress store={progress} kind={kind} verseRef={verseRef} />{staff && student && <LiftNote key={`${kind}:${verseRef}`} coordinator={work} kind={kind} verseRef={verseRef} firstName={student.firstName} />}</>} onVisit={(kind, verseRef) => calendar.visitVerse(kind, verseRef)} /><DiscussionList /></div></VersePanelScope>
      {student && authorizedReading && !concealed && !exploring && selectedReading && <div className={`guide-place guide-place-narrow`}><GuideCard store={guide} kind={selectedReading.kind} firstName={student.firstName} learner={learner} onStudy={() => setWalking(true)} /></div>}
      {work.notice && <p className="field-help" role="status">{work.notice}</p>}
      {authorizedReading && !concealed && <p className="field-help"><a href="https://www.centralreform.org/beit-mitzvah/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">CRC preparation guide</a></p>}
      {!learner && otherReadings.length > 0 && <details className="reading-other-assignments"><summary>Other confirmed reading details</summary>{otherReadings.map(row => <AssignmentContext key={row.id} row={row} />)}</details>}
      {student && song && authorizedReading && !concealed && <ReadingFoot printLast print={printSheetHref ?? undefined} lead={<><a href={`#${SECTION_IDS.service}`}>Service parts</a><a href={`#${SECTION_IDS.lessons}`}>Lessons</a></>} more={mode === "student" ? <LearnReviewAction /> : undefined} />}</>)}
    </section>
    {student && !song && <aside className="reading-tools" aria-labelledby="tools-heading"><h2 id="tools-heading">Practice tools</h2>
      <p>The confirmed assignment appears here. Use the review form below to propose and confirm changes.</p>
      <p>{listeningEnabled ? "Click a word or verse control to listen. Translation and notes stay beside the reading." : "Translation, word tools and notes stay beside the reading."}</p>
      <p><WorkspaceLink href="/trope-chart">Open the printable trope chart</WorkspaceLink></p>
      <p className="field-help">Unsent work stays only in this tab. Controlled workspace changes ask you to review it.</p>
    </aside>}
  </div>{current?.loading && <p role="status">Checking the current assignment, text and saved work…</p>}{editor && (staff ? <dialog ref={sheet} id={editorId} className="editor-sheet" aria-labelledby="reading-editor-title" closedby={editorBusy ? "none" : "closerequest"} onCancel={event => { event.preventDefault(); closeSheet(); }}>
      <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close verse editor" disabled={editorBusy} onClick={closeSheet}>{icons.close}</button></div>{editor}
    </dialog> : <div id={editorId} className="reading-editor-anchor">{editor}</div>)}
    {tabPanel("service", <><ServiceLearningPanel id={serviceId} headingId={SECTION_IDS.service} mode={mode} studentId={studentId} baseline={current?.loading ? null : current?.value ?? null} register={registerService} reloadReading={load} onDepartureActive={setServiceDepartureActive} onVisit={(plan, unitId) => calendar.visitUnit(plan, unitId)} />
      {authorizedReading && !concealed && <p className="field-help"><a href={links.siddurUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">CRC digital siddur collection</a>{links.musicUrl && <> · <a href={links.musicUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Service music</a></>}</p>}</>)}
    {tabPanel("lessons", <>{staff && student && authorizedReading && !concealed && <NeedsWork baseline={authorizedReading} />}{staff && student && authorizedReading && !concealed && <TutorPracticeDays />}{staff && student && authorizedReading && !concealed && <StaffPracticeDays calendar={calendar} firstName={student.firstName} />}<LessonLog mode={mode} studentId={studentId} register={registerLessons} tabbed={false} headingId={SECTION_IDS.lessons} /></>)}
    {student && song && <Sheet open={changeOpen} onClose={() => setChangeOpen(false)} title="Change reading" closeLabel="Close">
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
