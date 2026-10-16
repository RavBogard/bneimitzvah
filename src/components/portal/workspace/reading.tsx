"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Assigned, type Reading, type ReadingMode, type Student } from "./api";
import { statusOf, useWorkspace, WorkspaceLink } from "./provider";
import { ReadingEditor } from "./reading-editor";
import { AssignedStudyText, type StudyReload } from "./study/view";
import type { StudyKind } from "./study/api";
import { WorkCoordinator } from "./work/coordinator";
import { VerseTools } from "./work/verse-tools";
import { DepartureReview } from "./work/departure-review";

function AssignmentContext({ row, current = false }: { row: Reading; current?: boolean }) {
  return <article className={`confirmed-reading${current ? " reading-current-assignment" : ""}`}>
    <h3>{row.kind === "torah" ? "Torah" : "Haftarah"}</h3>
    <p className="reading-reference">{row.ranges.join("; ")}</p>
    <p className={row.needsReview ? "reading-review" : "field-help"}>{row.needsReview ? "Needs review with your tutor or rabbi" : "Confirmed assignment"} · Revision {row.revision}</p>
    <details><summary>Assigned verse references ({row.verses.length})</summary><ol className="verse-references">{row.verses.map((verse, index) => <li key={`${index}:${verse}`}>{verse}</li>)}</ol>
      <p className="field-help">Calendar source: {row.source.attribution ? <a href={row.source.attribution.url} target="_blank" rel="noopener noreferrer">{row.source.attribution.name}</a> : "not recorded"}. {row.source.status === "unavailable" ? "Calendar source was unavailable when this assignment was confirmed." : row.source.status === "unknown" ? "Source availability is not recorded." : "Calendar source was available at confirmation."}</p>
      {row.confirmationDate && <p className="field-help">Ceremony date at confirmation: {row.confirmationDate}</p>}
    </details>
  </article>;
}

export function ReadingPanel({ mode, studentId, onStudentReload }: { mode: ReadingMode; studentId: string; onStudentReload?(student: Student): void }) {
  const { readVerified: read, readWork, epoch, busy, selectChild, registerReload, registerWork, completeWork, registerDeparture, guardDeparture } = useWorkspace();
  const key = `${mode}:${studentId}:${epoch}`;
  const [result, setResult] = useState<{ key: string; value?: Assigned; error?: number; loading?: boolean }>({ key: "" }), [retry, setRetry] = useState(0);
  const [selectedKind, setSelectedKind] = useState<StudyKind>("torah");
  const abort = useRef<AbortController | null>(null), sequence = useRef(0);
  const study = useRef<StudyReload | null>(null);
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
    work.pause(); study.current?.clear();
    let lifecycle = work.lifecycle;
    setResult(previous => previous.key === key ? { ...previous, loading: true } : { key, loading: true });
    try {
      await work.settle();
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      const value = await read(mode, studentId, request.signal);
      if (request.signal.aborted || turn !== sequence.current || lifecycle !== work.lifecycle) throw new Error("Reading request replaced");
      onStudentReload?.(value.student); work.configure(value, true); lifecycle = work.lifecycle; setResult({ key, value, loading: true });
      const kind = value.readings.some(row => row.kind === selectedKindRef.current) ? selectedKindRef.current : value.readings[0]?.kind;
      await Promise.all([study.current?.reload(value, request.signal), kind ? work.reload(request.signal, kind) : undefined]);
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
  const editor = mode === "admin" || mode === "tutor" ? <ReadingEditor key={`${mode}:${studentId}`} mode={mode} baseline={current?.loading ? null : current?.value ?? null} reload={load} /> : null;
  const student = current?.value?.student, readings = current?.value?.readings ?? [];
  const selectedReading = readings.find(row => row.kind === selectedKind) ?? readings[0];
  const otherReadings = readings.filter(row => row.id !== selectedReading?.id);
  return <><DepartureReview coordinator={work} /><div className="reading-workspace reading-with-work" hidden={Boolean(current?.loading)} inert={Boolean(current?.loading)}>
    <section aria-label="Assigned reading">
      {!student ? <div className="workspace-state" aria-live="polite"><h2>{current?.error ? "Reading unavailable" : "Loading the assigned reading"}</h2>
        <p>{current?.error === 404 || current?.error === 403 ? "This reading is no longer available in the selected role. Choose another available student." : current?.error ? "We couldn’t load the confirmed assignment. No previous student’s reading is being shown." : "Checking the selected student and confirmed references."}</p>
        {current?.error && <button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload reading</button>}</div> : <>
      <h2 id="reading-heading"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
      <div className="reading-student-context"><p className="reading-date">Ceremony date: <time dateTime={student.ceremonyDate}>{student.ceremonyDate}</time></p>
      <button className="button-text" onClick={() => setRetry(value => value + 1)}>Refresh reading</button></div>
      {current?.loading && <p role="status">Checking the current assignment…</p>}
      {readings.length === 0 ? <div className="reading-empty"><h3>No reading has been assigned yet</h3><p>Your tutor or rabbi will confirm the verses here.</p></div>
        : <AssignmentContext row={selectedReading} current />}</>}
      <AssignedStudyText baseline={current?.value ?? null} register={registerStudy} reloadMetadata={load} authorityFailed={status => { work.clear(); studyDenied(status); }} onKindChange={setSelectedKind}
        guardDeparture={guardDeparture} renderWork={(kind, verseRef) => <VerseTools coordinator={work} kind={kind} verseRef={verseRef} />} renderActiveWork={() => work.active && <VerseTools coordinator={work} kind={work.active.kind} verseRef={work.active.ref} />}
        onPage={async (kind, offset, signal) => { await work.loadPage(kind, offset, signal); }} />
      {work.notice && <p className="field-help" role="status">{work.notice}</p>}
      {otherReadings.length > 0 && <details className="reading-other-assignments"><summary>Other confirmed reading details</summary>{otherReadings.map(row => <AssignmentContext key={row.id} row={row} />)}</details>}
    </section>
    {student && <aside className="reading-tools" aria-labelledby="tools-heading"><h2 id="tools-heading">{mode === "parent" ? "Parent view" : mode === "child-practice" ? "Child practice" : "Practice tools"}</h2>
      <p>{mode === "parent" ? "You’re viewing this child’s assignment. Parent access is read-only." : mode === "child-practice" ? "You’re practicing as the child named here, through your own parent account. Staff actions are separate." : mode === "tutor" || mode === "admin" ? "The confirmed assignment appears here. Use the review form below to propose and confirm changes." : "Your confirmed references appear here first."}</p>
      <p>Open translation and notes beside each verse. Audio practice is not available yet.</p>
      <p><WorkspaceLink href="/trope-chart">Open the printable trope chart</WorkspaceLink></p>
      <p className="field-help">Unsent work stays only in this tab. Controlled workspace changes ask you to review it. Your browser may warn before reload or close; Back, Forward, closing the browser or an unexpected route change can discard work. A warning and delivery cannot be guaranteed.</p>
      {mode === "parent" && <button className="button-primary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : "Enter child practice"}</button>}
    </aside>}
  </div>{current?.loading && <p role="status">Checking the current assignment, text and saved work…</p>}{editor}</>;
}
