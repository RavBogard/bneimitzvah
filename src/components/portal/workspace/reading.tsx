"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Assigned, type Reading, type ReadingMode, type Student } from "./api";
import { statusOf, useWorkspace, useWorkspaceModal, WorkspaceLink } from "./provider";
import { icons } from "./study/lift";
import { ReadingEditor } from "./reading-editor";
import { AssignedStudyText, type StudyReload } from "./study/view";
import type { StudyKind } from "./study/api";
import { WorkCoordinator } from "./work/coordinator";
import { VerseTools } from "./work/verse-tools";
import { DepartureReview } from "./work/departure-review";
import { ServiceLearningPanel, type ServiceReload } from "./service-learning/panel";
import { ReadingToolbar } from "./reading-toolbar";
import { ReadingPrefsScope } from "./reading-prefs";

const dayMs = 86_400_000;
/** "Sat, Jan 2, 2027" and whole days until it, computed on the calendar date only. */
export function ceremonyCountdown(date: string, now = new Date()) {
  const [year, month, day] = date.split("-").map(Number), ceremony = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), days = Math.round((ceremony - today) / dayMs);
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(ceremony);
  return { label, days, phrase: days > 1 ? `${days} days to go` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : null };
}
const displayRange = (ranges: string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1\u2013$2");
const refreshIcon = <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

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

export function ReadingPanel({ mode, studentId, onStudentReload }: { mode: ReadingMode; studentId: string; onStudentReload?(student: Student): void }) {
  const { readVerified: read, readWork, epoch, busy, selectChild, registerReload, registerWork, completeWork, registerDeparture, guardDeparture } = useWorkspace();
  const key = `${mode}:${studentId}:${epoch}`;
  const serviceId = useId();
  const [result, setResult] = useState<{ key: string; value?: Assigned; error?: number; loading?: boolean }>({ key: "" }), [retry, setRetry] = useState(0);
  const [selectedKind, setSelectedKind] = useState<StudyKind>("torah");
  const abort = useRef<AbortController | null>(null), sequence = useRef(0);
  const study = useRef<StudyReload | null>(null);
  const service = useRef<ServiceReload | null>(null);
  const registerService = useCallback((value: ServiceReload) => { service.current = value; return () => { if (service.current === value) service.current = null; }; }, []);
  const registerStudy = useCallback((value: StudyReload) => { study.current = value; return () => { if (study.current === value) study.current = null; }; }, []);
  const studyDenied = useCallback((status: number) => { setResult({ key, error: status }); }, [key]);
  const environment = useRef({ read, readWork, mode, studentId, studyDenied }); environment.current = { read, readWork, mode, studentId, studyDenied };
  const workRef = useRef<WorkCoordinator | null>(null);
  if (!workRef.current) workRef.current = new WorkCoordinator((...args) => environment.current.readWork(...args), signal => environment.current.read(environment.current.mode, environment.current.studentId, signal), status => environment.current.studyDenied(status));
  const work = workRef.current;
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
    work.pause(); study.current?.clear(); service.current?.clear();
    let lifecycle = work.lifecycle;
    setResult(previous => previous.key === key ? { ...previous, loading: true } : { key, loading: true });
    try {
      await work.settle();
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      const value = await read(mode, studentId, request.signal);
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      onStudentReload?.(value.student); work.configure(value, true); lifecycle = work.lifecycle; setResult({ key, value, loading: true });
      const kind = value.readings.some(row => row.kind === selectedKindRef.current) ? selectedKindRef.current : value.readings[0]?.kind;
      await Promise.all([study.current?.reload(value, request.signal), kind ? work.reload(request.signal, kind) : undefined, service.current?.reload(value, request.signal)]);
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      work.accept(lifecycle); completeWork(work);
      setResult({ key, value });
      return value;
    }
    catch (error) { if (!request.signal.aborted && turn === sequence.current) { if ([401, 403, 404].includes(statusOf(error))) work.clear(); setResult({ key, error: statusOf(error) }); } throw error; }
  }, [read, mode, studentId, key, onStudentReload, work, completeWork]);
  const selectedKindRef = useRef(selectedKind); selectedKindRef.current = selectedKind;
  useEffect(() => registerReload(async () => { await load(); }), [registerReload, load]);
  useEffect(() => { void load().catch(() => undefined); return () => { sequence.current++; abort.current?.abort(); }; }, [load, retry]);
  const current = result.key === key ? result : null;
  const [editorBusy, setEditorBusy] = useState(false);
  const editor = mode === "admin" || mode === "tutor" ? <ReadingEditor key={`${mode}:${studentId}`} mode={mode} baseline={current?.loading ? null : current?.value ?? null} reload={load} onBusy={setEditorBusy} /> : null;
  const student = current?.value?.student, readings = current?.value?.readings ?? [];
  const selectedReading = readings.find(row => row.kind === selectedKind) ?? readings[0];
  const otherReadings = readings.filter(row => row.id !== selectedReading?.id);
  const learner = mode === "student" || mode === "child-practice" || mode === "parent";
  // Tutors teach from the same Song session reading, and keep the staff assignment details.
  const song = learner || mode === "tutor", editorId = `${serviceId}-editor`;
  const lift = useRef<((index: number) => void) | null>(null);
  // Tutors change verses in a sheet over the reading instead of a form below it.
  const [sheetOpen, setSheetOpen] = useState(false), sheet = useRef<HTMLDialogElement>(null), sheetOrigin = useRef<HTMLElement | null>(null);
  useWorkspaceModal(sheet, sheetOpen);
  // The sheet stays open while a review or confirmation is in flight, so its outcome is seen.
  const closeSheet = () => { if (!editorBusy) setSheetOpen(false); };
  useEffect(() => {
    if (sheetOpen || !sheetOrigin.current) return;
    // "Assign verses" becomes "Change verses" once a reading is confirmed.
    const origin = sheetOrigin.current.isConnected ? sheetOrigin.current : document.querySelector<HTMLElement>(".reading-hero .hero-actions button.button-hero-secondary");
    origin?.focus(); sheetOrigin.current = null;
  }, [sheetOpen]);
  const openSheet = (event: { currentTarget: HTMLElement }) => { sheetOrigin.current = event.currentTarget; setSheetOpen(true); };
  const countdown = student ? ceremonyCountdown(student.ceremonyDate) : null;
  return <ReadingPrefsScope studentId={studentId}><DepartureReview coordinator={work} /><div className="reading-workspace reading-with-work" hidden={Boolean(current?.loading)} inert={Boolean(current?.loading)}>
    <section aria-label="Assigned reading">
      {!student ? <div className="workspace-state" aria-live="polite"><h2>{current?.error ? "Reading unavailable" : "Loading the assigned reading"}</h2>
        <p>{current?.error === 404 || current?.error === 403 ? "This reading is no longer available in the selected role. Choose another available student." : current?.error ? "We couldn’t load the confirmed assignment. No previous student’s reading is being shown." : "Checking the selected student and confirmed references."}</p>
        {current?.error && <button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload reading</button>}</div> : <>
      {song ? <><header className={`reading-hero${learner ? " reading-current-assignment" : ""}`} aria-labelledby="reading-heading">
        <div className="hero-who">
          <h2 id="reading-heading" className="hero-name"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
          <p className="hero-date"><time dateTime={student.ceremonyDate}>{countdown!.label}</time>{countdown!.phrase && <span className="hero-days">{countdown!.phrase}</span>}</p>
          <button type="button" className="hero-icon" aria-label="Refresh reading" onClick={() => setRetry(value => value + 1)}>{refreshIcon}</button>
        </div>
        {readings.length === 0 ? <div className="reading-empty"><h3 className="hero-reference hero-reference-empty">No reading has been assigned yet</h3><p className="hero-meta">Your tutor or rabbi will add your verses here.</p>
          <div className="hero-actions">{mode === "parent" && <button className="button-hero-secondary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : "Enter child practice"}</button>}{mode === "tutor" && <button type="button" className="button-hero-secondary" onClick={openSheet}>Assign verses</button>}<a className="button-hero-secondary service-entry" href={`#${serviceId}`}>Service parts</a></div></div> : <>
          <h3 className="hero-reference">{displayRange(selectedReading.ranges)}</h3>
          <p className="hero-meta">{selectedReading.kind === "torah" ? "Torah" : "Haftarah"} · {selectedReading.verses.length} {selectedReading.verses.length === 1 ? "verse" : "verses"}</p>
          <div className="hero-actions">
            <button type="button" className="button-start" onClick={() => lift.current ? lift.current(0) : document.querySelector(".study-verses")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>Start</button>
            {mode === "parent" && <button className="button-hero-secondary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : "Enter child practice"}</button>}
            {mode === "tutor" && <button type="button" className="button-hero-secondary" onClick={openSheet}>Change verses</button>}
            {readings.length < 2 && <a className="button-hero-secondary service-entry" href={`#${serviceId}`}>Service parts</a>}
          </div></>}
      </header>
      {!learner && readings.length > 0 && <AssignmentContext row={selectedReading} current />}</> : <>
      <h2 id="reading-heading"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
      <div className="reading-student-context"><p className="reading-date">Ceremony date: <time dateTime={student.ceremonyDate}>{student.ceremonyDate}</time></p>
      <button className="button-text" aria-label="Refresh reading" onClick={() => setRetry(value => value + 1)}>Refresh</button>
      {readings.length < 2 && <a className="button-text service-entry" href={`#${serviceId}`}>Service parts</a>}</div>
      {current?.loading && <p role="status">Checking the current assignment…</p>}
      {readings.length === 0 ? <div className="reading-empty"><h3>No reading has been assigned yet</h3><p>Your tutor or rabbi will confirm the verses here.</p></div>
        : <AssignmentContext row={selectedReading} current />}</>}</>}
      <AssignedStudyText baseline={current?.value ?? null} register={registerStudy} reloadMetadata={load} authorityFailed={status => { work.clear(); studyDenied(status); }} onKindChange={setSelectedKind}
        guardDeparture={guardDeparture} serviceHref={`#${serviceId}`} renderWork={(kind, verseRef) => <VerseTools coordinator={work} kind={kind} verseRef={verseRef} />} renderActiveWork={() => work.active && <VerseTools coordinator={work} kind={work.active.kind} verseRef={work.active.ref} />}
        onPage={async (kind, offset, signal) => { await work.loadPage(kind, offset, signal); }} learner={learner} songSession={song} liftHandle={lift} />
      {work.notice && <p className="field-help" role="status">{work.notice}</p>}
      {!learner && otherReadings.length > 0 && <details className="reading-other-assignments"><summary>Other confirmed reading details</summary>{otherReadings.map(row => <AssignmentContext key={row.id} row={row} />)}</details>}
    </section>
    {student && song && <ReadingToolbar />}
    {student && !song && <aside className="reading-tools" aria-labelledby="tools-heading"><h2 id="tools-heading">Practice tools</h2>
      <p>The confirmed assignment appears here. Use the review form below to propose and confirm changes.</p>
      <p>Open translation and notes beside each verse. Audio practice is not available yet.</p>
      <p><WorkspaceLink href="/trope-chart">Open the printable trope chart</WorkspaceLink></p>
      <p className="field-help">Unsent work stays only in this tab. Controlled workspace changes ask you to review it.</p>
    </aside>}
  </div>{current?.loading && <p role="status">Checking the current assignment, text and saved work…</p>}{editor && (mode === "tutor" ? <dialog ref={sheet} id={editorId} className="editor-sheet" aria-labelledby="reading-editor-title" onCancel={event => { event.preventDefault(); closeSheet(); }}>
      <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close verse editor" disabled={editorBusy} onClick={closeSheet}>{icons.close}</button></div>{editor}
    </dialog> : <div id={editorId} className="reading-editor-anchor">{editor}</div>)}
    <ServiceLearningPanel id={serviceId} mode={mode} studentId={studentId} baseline={current?.loading ? null : current?.value ?? null} register={registerService} reloadReading={load} />
  </ReadingPrefsScope>;
}
