"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Assigned, type ReadingMode } from "./api";
import { statusOf, useWorkspace } from "./provider";

export function ReadingPanel({ mode, studentId }: { mode: ReadingMode; studentId: string }) {
  const { read, epoch, busy, selectChild, registerReload } = useWorkspace();
  const key = `${mode}:${studentId}:${epoch}`;
  const [result, setResult] = useState<{ key: string; value?: Assigned; error?: number }>({ key: "" }), [retry, setRetry] = useState(0);
  const abort = useRef<AbortController | null>(null), sequence = useRef(0);
  const load = useCallback(async () => {
    abort.current?.abort(); const request = new AbortController(), turn = ++sequence.current; abort.current = request;
    setResult({ key });
    try { const value = await read(mode, studentId, request.signal); if (!request.signal.aborted && turn === sequence.current) setResult({ key, value }); }
    catch (error) { if (!request.signal.aborted && turn === sequence.current) { setResult({ key, error: statusOf(error) }); throw error; } }
  }, [read, mode, studentId, key]);
  useEffect(() => registerReload(load), [registerReload, load]);
  useEffect(() => { void load().catch(() => undefined); return () => { sequence.current++; abort.current?.abort(); }; }, [load, retry]);
  const current = result.key === key ? result : null;
  if (!current?.value) return <section className="workspace-state" aria-live="polite"><h2>{current?.error ? "Reading unavailable" : "Loading the assigned reading"}</h2>
    <p>{current?.error === 404 || current?.error === 403 ? "This reading is no longer available in the selected role. Choose another available student." : current?.error ? "We couldn’t load the confirmed assignment. No previous student’s reading is being shown." : "Checking the selected student and confirmed references."}</p>
    {current?.error && <button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload reading</button>}</section>;
  const { student, readings } = current.value;
  return <div className="reading-workspace">
    <section aria-labelledby="reading-heading">
      <h2 id="reading-heading"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h2>
      <p className="reading-date">Ceremony date: <time dateTime={student.ceremonyDate}>{student.ceremonyDate}</time></p>
      <button className="button-text" onClick={() => setRetry(value => value + 1)}>Refresh reading</button>
      {readings.length === 0 ? <div className="reading-empty"><h3>No reading has been assigned yet</h3><p>Your tutor or rabbi will confirm the verses here.</p></div>
        : readings.map(row => <article className="confirmed-reading" key={row.id}>
          <h3>{row.kind === "torah" ? "Torah" : "Haftarah"}</h3>
          <p className="reading-reference">{row.ranges.join("; ")}</p>
          <p className={row.needsReview ? "reading-review" : "field-help"}>{row.needsReview ? "Needs review with your tutor or rabbi" : "Confirmed assignment"} · Revision {row.revision}</p>
          <details><summary>Assigned verse references ({row.verses.length})</summary><ol className="verse-references">{row.verses.map((verse, index) => <li key={`${index}:${verse}`}>{verse}</li>)}</ol></details>
          <p className="field-help">Calendar source: {row.source.attribution ? <a href={row.source.attribution.url} target="_blank" rel="noopener noreferrer">{row.source.attribution.name}</a> : "not recorded"}. {row.source.status === "unavailable" ? "Calendar source was unavailable when this assignment was confirmed." : row.source.status === "unknown" ? "Source availability is not recorded." : "Calendar source was available at confirmation."}</p>
          {row.confirmationDate && <p className="field-help">Ceremony date at confirmation: {row.confirmationDate}</p>}
        </article>)}
    </section>
    <aside className="reading-tools" aria-labelledby="tools-heading"><h2 id="tools-heading">{mode === "parent" ? "Parent view" : mode === "child-practice" ? "Child practice" : "Practice tools"}</h2>
      <p>{mode === "parent" ? "You’re viewing this child’s assignment. Parent access is read-only." : mode === "child-practice" ? "You’re practicing as the child named here, through your own parent account. Staff actions are separate." : mode === "tutor" || mode === "admin" ? "This view shows the student’s confirmed assignment. It does not change their reading." : "Your confirmed references appear here first."}</p>
      <p>Hebrew text, audio and study tools are not available in this build yet.</p>
      {mode === "parent" && <button className="button-primary" disabled={busy} onClick={() => void selectChild(student.id)}>{busy ? "Opening practice…" : "Enter child practice"}</button>}
    </aside>
  </div>;
}
