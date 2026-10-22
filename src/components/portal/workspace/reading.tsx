"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { type Assigned, type Reading, type ReadingMode, type Student } from "./api";
import { statusOf, useWorkspace, useWorkspaceModal, WorkspaceLink } from "./provider";
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
  return <p className="hero-rehearsals">{dates.length === 1 ? "Rehearsal" : "Rehearsals"}: {dates.map((value, index) => <span key={index}>{index > 0 && " and "}<time dateTime={value}>{ceremonyCountdown(value).label}</time></span>)}</p>;
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
const refreshIcon = <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function AssignedReadingSummaries({ readings, selectedKind, marked }: { readings: readonly Reading[]; selectedKind: StudyKind; marked?: string | null }) {
  return <div className="hero-reading-summaries" role="group" aria-label="Assigned readings">{readings.map(row => <div key={row.id} className="hero-reading-summary" aria-current={row.kind === selectedKind ? "true" : undefined}>
    <h3>{row.kind === "torah" ? "Torah" : "Haftarah"} <bdi dir="ltr">{displayRange(row.ranges)}</bdi></h3>
    <p>{row.verses.length} {row.verses.length === 1 ? "verse" : "verses"}{row.kind === selectedKind && <> <span className="reading-summary-current">Current reading</span>{marked && <span className="hero-marked"> · {marked}</span>}</>}</p>
  </div>)}</div>;
}

function AssignmentContext({ row, current = false }: { row: Reading; current?: boolean }) {
  return <article className={`confirmed-reading${current ? " reading-current-assignment" : ""}`}>
    <h3>{row.kind === "torah" ? "Torah" : "Haftarah"}</h3>
    <p className="reading-reference">{row.ranges.join("; ")}</p>
    <p className={row.needsReview ? "reading-review status-chip status-chip-attention" : "field-help status-chip"}>{row.needsReview ? "Needs review with your tutor or rabbi" : "Confirmed assignment"} · Revision {row.revision}</p>
    <details><summary>Assigned verse references ({row.verses.length})</summary><ol className="verse-references">{row.verses.map((verse, index) => <li key={`${index}:${verse}`}>{verse}</li>)}</ol>
      <p className="field-help">Calendar source: {row.source.attribution ? <a href={row.source.attribution.url} target="_blank" rel="noopener noreferrer">{row.source.attribution.name}</a> : "not recorded"}. {row.source.status === "unavailable" ? "Calendar source was unavailable when this assignment was confirmed." : row.source.status === "unknown" ? "Source availability is not recorded." : "Calendar source was available at confirmation."}</p>
      {row.confirmationDate && <p className="field-help">Ceremony date at confirmation: {row.confirmationDate}</p>}
    </details>
  </article>;
}

type PageTab = "reading" | "service" | "lessons";
const pageTabs: [PageTab, string][] = [["reading", "Reading"], ["service", "Service parts"], ["lessons", "Lessons"]];

export function ReadingPanel({ mode, studentId, onStudentReload }: { mode: ReadingMode; studentId: string; onStudentReload?(student: Student): void }) {
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
    const origin = sheetOrigin.current.isConnected ? sheetOrigin.current : document.querySelector<HTMLElement>(".reading-hero .hero-actions button.button-hero-secondary");
    origin?.focus(); sheetOrigin.current = null;
  }, [sheetOpen]);
  const openSheet = (event: { currentTarget: HTMLElement }) => { sheetOrigin.current = event.currentTarget; setSheetOpen(true); };
  // Staff switch between the reading, service parts and lessons as tabs. All stay mounted,
  // so reloads, access checks and unsent work behave exactly as on one long page.
  const tabbed = staff, [tab, setTab] = useState<PageTab>("reading");
  useLayoutEffect(() => { setTab("reading"); }, [studentId]);
  useLayoutEffect(() => { if (tabbed && tab !== "reading") audio.stopAll(); }, [audio, tabbed, tab]);
  // The tabs exist only once the student has loaded; until then (or after a failed load) both panels show.
  const tabsShown = tabbed && Boolean(student);
  const tabId = (value: PageTab) => `${serviceId}-tab-${value}`, panelId = (value: PageTab) => `${serviceId}-panel-${value}`;
  const panels = useRef<Partial<Record<PageTab, HTMLDivElement | null>>>({});
  // A dialog opened inside a hidden panel (a departure prompt, say) brings its tab forward,
  // so the tutor sees where it came from. CSS keeps such a panel displayed meanwhile.
  useEffect(() => {
    if (!tabbed) return;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const node = record.target;
        if (!(node instanceof HTMLDialogElement) || !node.open) continue;
        const owner = pageTabs.find(([value]) => panels.current[value]?.contains(node));
        if (owner && panels.current[owner[0]]?.hidden) setTab(owner[0]);
      }
    });
    for (const [value] of pageTabs) { const node = panels.current[value]; if (node) observer.observe(node, { subtree: true, attributeFilter: ["open"] }); }
    return () => observer.disconnect();
  }, [tabbed]);
  // The wrapper is always present for tutors, so switching tabs never remounts a panel.
  const tabPanel = (value: PageTab, children: ReactNode) => tabbed ? <div ref={node => { panels.current[value] = node; }} role={tabsShown ? "tabpanel" : undefined} id={panelId(value)} aria-labelledby={tabsShown ? tabId(value) : undefined} className="page-tab-panel" hidden={tabsShown && tab !== value}>{children}</div> : children;
  // Reading actions run from the Reading tab. If a draft prompt brought another tab
  // forward and the tutor chose to continue, return to the reading they asked for.
  const guardReading = useCallback(async (purpose?: DeparturePurpose) => { const leave = await guardDeparture(purpose); if (leave && tabbed) setTab("reading"); return leave; }, [guardDeparture, tabbed]);
  const startReading = () => {
    setTab("reading");
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
  const openPractice = () => { setTab("reading"); practice.current?.(0); };
  // The printable practice sheet reads through the same authorized study loader as the page.
  const [printing, setPrinting] = useState(false);
  useLayoutEffect(() => { if (!authorizedReading || concealed) setPrinting(false); }, [authorizedReading, concealed]);
  const openPrint = () => { audio.stopAll(); setPrinting(true); }, printDisabled = !authorizedReading || concealed || Boolean(current?.loading);
  // On a learner's phone the first verse stays above the fold: the action moves under the reading, beside the trope chart.
  const printAction = readings.length > 0 && <button type="button" className="button-hero-secondary reading-print-action" data-learner={learner ? "" : undefined} disabled={printDisabled} onClick={openPrint}>Print practice sheet</button>;
  const practiceAction = mode !== "parent" && readings.length > 0 && <button type="button" className="button-hero-secondary reading-practice-action" disabled={!practiceReady || concealed || current?.loading} onClick={openPractice}>{exploring ? "Practice assigned Haftarah up close" : "Practice up close"}</button>;
  const tabKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = pageTabs.findIndex(([value]) => value === tab);
    const next = event.key === "ArrowRight" ? (index + 1) % pageTabs.length : event.key === "ArrowLeft" ? (index + pageTabs.length - 1) % pageTabs.length : event.key === "Home" ? 0 : event.key === "End" ? pageTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setTab(pageTabs[next][0]); document.getElementById(tabId(pageTabs[next][0]))?.focus();
  };
  const countdown = student ? ceremonyCountdown(student.ceremonyDate) : null, marked = useProgressSummary(progress, selectedReading?.kind);
  return <ReadingPrefsScope studentId={studentId} englishOnWide={!staff}><DepartureReview coordinator={work} /><div className="reading-workspace reading-with-work" hidden={Boolean(current?.loading)} inert={Boolean(current?.loading)}>
    <section aria-label="Assigned reading">
      {!student ? <div className="workspace-state" aria-live="polite"><h2>{current?.error ? "Reading unavailable" : "Loading the assigned reading"}</h2>
        <p>{current?.error === 404 || current?.error === 403 ? "This reading is no longer available in the selected role. Choose another available student." : current?.error ? "We couldn’t load the confirmed assignment. No previous student’s reading is being shown." : "Checking the selected student and confirmed references."}</p>
        {current?.error && <button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload reading</button>}</div> : <>
      {song ? <><header className={`reading-hero${learner ? " reading-current-assignment" : ""}`} aria-labelledby="reading-heading">
        <div className="hero-who">
          <h2 id="reading-heading" className="hero-name"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
          {congregation.ready && <ServiceSlotName student={student} services={congregation.services} />}
          <p className="hero-date"><time dateTime={student.ceremonyDate}>{countdown!.label}</time>{countdown!.phrase && <span className="hero-days">{countdown!.phrase}</span>}</p>
          <button type="button" className="hero-icon" aria-label="Refresh reading" onClick={() => {
            const target = studyDenied, turn = sequence.current;
            // Explicit reload retains translation drafts; only Sources must settle before their owners are replaced.
            void guardReading("sources").then(leave => { if (leave && environment.current.studyDenied === target && sequence.current === turn && !abort.current?.signal.aborted) setRetry(value => value + 1); });
          }}>{refreshIcon}</button>
        </div>
        <RehearsalDates student={student} />
        {mode === "parent" && <p className="hero-meta">Read-only overview. Choose Practice with <bdi dir="auto">{student.firstName}</bdi> to mark verses together.</p>}
        {exploring || readings.length === 0 ? <div className="reading-empty"><h3 className="hero-reference hero-reference-empty">{exploring ? "Explore the full Torah portion" : "No reading has been assigned yet"}</h3><p className="hero-meta">{exploring ? "Read the portion while you and your tutor choose your verses." : staff ? "Choose the verses this student will read." : "Your tutor or rabbi will add your verses here."}</p>
          <div className="hero-actions">{mode === "parent" && <button className="button-hero-secondary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : `Practice with ${student.firstName}`}</button>}{staff && <button type="button" className="button-hero-secondary" onClick={openSheet}>Assign verses</button>}{exploring && <button type="button" className="button-start" disabled={!proposedReady || concealed || current?.loading} onClick={startReading}>Start reading</button>}{practiceAction}{printAction}{!tabbed && <a className="button-hero-secondary service-entry" href={`#${serviceId}`}>Service parts</a>}</div></div> : <>
          {readings.length > 1 ? <AssignedReadingSummaries readings={readings} selectedKind={selectedReading.kind} marked={marked} /> : <><h3 className="hero-reference">{displayRange(selectedReading.ranges)}</h3>
          <p className="hero-meta">{selectedReading.kind === "torah" ? "Torah" : "Haftarah"} · {selectedReading.verses.length} {selectedReading.verses.length === 1 ? "verse" : "verses"}{marked && <span className="hero-marked"> · {marked}</span>}</p></>}
          <div className="hero-actions">
            <button type="button" className="button-start" disabled={!practiceReady || concealed || current?.loading} onClick={startReading}>Start reading</button>
            {practiceAction}
            {printAction}
            {mode === "parent" && <button className="button-hero-secondary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : `Practice with ${student.firstName}`}</button>}
            {staff && <><button type="button" className="button-hero-secondary" onClick={openSheet}>Change verses</button><WorkspaceLink className="button-hero-secondary" href="/trope-chart">Trope chart</WorkspaceLink></>}
            {readings.length < 2 && !tabbed && <a className="button-hero-secondary service-entry" href={`#${serviceId}`}>Service parts</a>}
          </div></>}
        {!staff && <PracticeDays calendar={calendar} />}
      </header>
      {mode === "parent" && <ParentStudySummary store={parentSummary} baseline={authorizedReading ?? null} scope={parentScope} concealed={concealed} notice={congregation.consentNotice} />}
      {!learner && readings.length > 0 && <AssignmentContext row={selectedReading} current />}
      {tabbed && <div role="tablist" aria-label="Student page" className="page-tabs" onKeyDown={tabKeys}>{pageTabs.map(([value, label]) => <button key={value} type="button" role="tab" id={tabId(value)} aria-controls={panelId(value)} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className="page-tab" onClick={() => setTab(value)}>{label}</button>)}</div>}</> : <>
      <h2 id="reading-heading"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
      <div className="reading-student-context"><p className="reading-date">Ceremony date: <time dateTime={student.ceremonyDate}>{student.ceremonyDate}</time></p>
      <button className="button-text" aria-label="Refresh reading" onClick={() => setRetry(value => value + 1)}>Refresh</button>
      {readings.length < 2 && <a className="button-text service-entry" href={`#${serviceId}`}>Service parts</a>}</div>
      {current?.loading && <p role="status">Checking the current assignment…</p>}
      {readings.length === 0 ? <div className="reading-empty"><h3>No reading has been assigned yet</h3><p>Your tutor or rabbi will confirm the verses here.</p></div>
        : <AssignmentContext row={selectedReading} current />}</>}</>}
      {tabPanel("reading", <>{student && authorizedReading && !concealed && !exploring && selectedReading && mode === "admin" && <GuideStatusLine kind={selectedReading.kind} readingKey={selectedReading.readingKey ?? null} />}{student && authorizedReading && !concealed && !exploring && selectedReading && <div className={`guide-place guide-place-wide`}><GuideCard store={guide} kind={selectedReading.kind} firstName={student.firstName} learner={learner} onStudy={() => setWalking(true)} /></div>}{walking && selectedReading && guide.view(selectedReading.kind) && <GuideWalk view={guide.view(selectedReading.kind)!} lookup={ref => verseLookup.current?.(ref) ?? null} onClose={closeWalk} />}<div className="reading-passage-layout" ref={readingPanel}>{student && song && (!tabbed || tab === "reading") && <ReadingToolbar listeningEnabled={listeningEnabled} tikkunAvailable={exploring || selectedReading?.kind === "torah"} onHear={(exploring ? proposedHearReady : hearReady) && !concealed && !current?.loading ? startReading : undefined} />}
        {authorizedReading && !listeningEnabled && <p className="field-help">{readings.length ? "Listening isn’t available yet. You can read, use word tools and practice up close." : "Listening isn’t available yet. You can keep reading the Torah portion."}</p>}
        <ProposedTorahText audio={audio} hearHandle={proposedHear} onReadingReady={setProposedReady} onHearReady={setProposedHearReady} baseline={current?.loading ? null : current?.value ?? null} reloadMetadata={load} active={!tabbed || tab === "reading"} authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} />
        {exploring && readings.length > 0 && <header><h3>Assigned Haftarah</h3><p className="reading-reference">{displayRange(readings[0].ranges)}</p>
          {listeningEnabled && <button type="button" className="button-secondary" disabled={!hearReady || concealed || current?.loading} onClick={() => lift.current?.(0)}>Hear Haftarah</button>}</header>}
        <AssignedStudyText audio={audio} stopAudio={audio.stopAll} baseline={current?.value ?? null} register={registerStudy} reloadMetadata={load} authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} onKindChange={setSelectedKind}
        guardDeparture={guardReading} serviceHref={tabbed ? undefined : `#${serviceId}`} renderGuide={(kind, verseRef) => <GuideVerseNotes store={guide} kind={kind} verseRef={verseRef} />} renderWork={(kind, verseRef) => <VerseTools coordinator={work} kind={kind} verseRef={verseRef} />} renderActiveWork={() => work.active && <VerseTools coordinator={work} kind={work.active.kind} verseRef={work.active.ref} />}
        onPage={async (kind, offset, signal) => { await work.loadPage(kind, offset, signal); }} onPrint={learner && !printDisabled ? openPrint : undefined} learner={learner} songSession={song} liftHandle={lift} practiceHandle={practice} textStartHandle={textStart} verseLookupHandle={verseLookup} onPracticeReady={setPracticeReady} onHearReady={setHearReady} active={!tabbed || tab === "reading"}
        onShown={(kind, offset, length) => progress.ensure(kind, offset, length)} renderMark={(kind, verseRef) => <VerseMark store={progress} kind={kind} verseRef={verseRef} />} renderLiftControls={(kind, verseRef) => <LiftProgress store={progress} kind={kind} verseRef={verseRef} />} onVisit={(kind, verseRef) => calendar.visitVerse(kind, verseRef)} /></div>
      {student && authorizedReading && !concealed && !exploring && selectedReading && <div className={`guide-place guide-place-narrow`}><GuideCard store={guide} kind={selectedReading.kind} firstName={student.firstName} learner={learner} onStudy={() => setWalking(true)} /></div>}
      {work.notice && <p className="field-help" role="status">{work.notice}</p>}
      {authorizedReading && !concealed && <p className="field-help"><a href="https://www.centralreform.org/beit-mitzvah/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">CRC preparation guide</a></p>}
      {!learner && otherReadings.length > 0 && <details className="reading-other-assignments"><summary>Other confirmed reading details</summary>{otherReadings.map(row => <AssignmentContext key={row.id} row={row} />)}</details>}</>)}
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
    {tabPanel("service", <><ServiceLearningPanel id={serviceId} mode={mode} studentId={studentId} baseline={current?.loading ? null : current?.value ?? null} register={registerService} reloadReading={load} onDepartureActive={setServiceDepartureActive} onVisit={(plan, unitId) => calendar.visitUnit(plan, unitId)} />
      {authorizedReading && !concealed && <p className="field-help"><a href={links.siddurUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">CRC digital siddur collection</a>{links.musicUrl && <> · <a href={links.musicUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Service music</a></>}</p>}</>)}
    {tabPanel("lessons", <>{staff && student && authorizedReading && !concealed && <StaffPracticeDays calendar={calendar} firstName={student.firstName} />}<LessonLog mode={mode} studentId={studentId} register={registerLessons} tabbed={tabbed} /></>)}
    {printing && authorizedReading && !concealed && selectedReading && <PracticeSheet baseline={authorizedReading} initialKind={selectedReading.kind} onClose={() => setPrinting(false)}
      authorityFailed={status => { work.clear(); progress.configure(null); calendar.configure(null); studyDenied(status); }} />}
  </ReadingPrefsScope>;
}
