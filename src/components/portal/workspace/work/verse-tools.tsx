"use client";
import { useId, useState, useSyncExternalStore } from "react";
import type { StudyKind } from "../study/api";
import type { Stream } from "./api";
import { WorkCoordinator, type WorkCell } from "./coordinator";
import { WorkAttribution, WorkHistory } from "./history";

function saveLabel(cell: WorkCell, stream: Stream) {
  if (cell.revisionRecovery) return cell.error || "The reading was updated. Review your unsent text before saving.";
  if (cell.phase === "saving") return "Saving…";
  if (cell.phase === "unknown") return "Save not confirmed. Your text is still in this tab.";
  if (cell.phase === "conflict") return cell.committedEarlier ? "An earlier save succeeded. A newer version is saved." : "Another version was saved. Review before saving yours.";
  if (!cell.verified) return "Saved work unavailable";
  if (cell.phase === "invalid") return "Not saved";
  if (stream === "note") return cell.text ? "Not submitted yet" : "Add a student-visible note when you’re ready.";
  if (cell.text !== (cell.head?.text ?? "")) return "Not saved yet";
  return cell.head ? cell.head.text === "" ? "Translation cleared · Saved" : "Saved" : "No translation saved yet";
}
function recoveryMessage(label: string, detail: string) {
  let remainder = detail.trim();
  // Collapse only identical leading sentences; all distinct recovery detail stays.
  for (const sentence of label.match(/[^.!?]+[.!?](?:\s+|$)|.+$/g) ?? [label]) {
    const prefix = sentence.trim();
    if (remainder === prefix) { remainder = ""; break; }
    if (!remainder.startsWith(`${prefix} `)) break;
    remainder = remainder.slice(prefix.length).trimStart();
  }
  return remainder ? `${label} ${remainder}` : label;
}
function Editor({ coordinator, kind, verseRef, stream, cell }: { coordinator: WorkCoordinator; kind: StudyKind; verseRef: string; stream: Stream; cell: WorkCell }) {
  const id = useId(), [recovering, setRecovering] = useState(false);
  const label = stream === "draft" ? "My translation" : "Student-visible note";
  const revision = cell.revisionRecovery, recovery = Boolean(revision) || cell.phase === "unknown" || cell.phase === "conflict", status = saveLabel(cell, stream), separateError = Boolean(cell.error && !recovery);
  async function recover(retry: boolean) { if (recovering) return; setRecovering(true); try { await coordinator.recover(kind, verseRef, stream, retry); } finally { setRecovering(false); } }
  return <div className="work-editor">
    <label htmlFor={id}>{label} · <bdi dir="ltr">{verseRef}</bdi></label>
    <p id={`${id}-help`} className="field-help">{stream === "draft" ? "Your tutor can read saved translations." : "Visible to the student and their authorized readers. Correct a saved note by adding another note."}</p>
    <textarea id={id} dir="auto" rows={5} value={cell.text} readOnly={Boolean(revision)} aria-describedby={`${id}-help ${id}-status${separateError ? ` ${id}-error` : ""}`} aria-invalid={cell.phase === "invalid" || Boolean(cell.error && !cell.pending && cell.phase !== "conflict" && !revision)}
      onChange={event => coordinator.edit(kind, verseRef, stream, event.target.value)} onCompositionStart={() => coordinator.composition(kind, verseRef, stream, true)} onCompositionEnd={event => { coordinator.edit(kind, verseRef, stream, event.currentTarget.value); coordinator.composition(kind, verseRef, stream, false); }}
      onBlur={() => { if (stream === "draft") void coordinator.save(kind, verseRef, stream); }} />
    <p id={`${id}-status`} role="status" className={`work-status${recovery ? " request-error" : ""}`}>{recovery ? recoveryMessage(status, cell.error) : status}</p>
    {separateError && <p id={`${id}-error`} className="request-error" role={cell.phase === "invalid" ? "alert" : "status"}>{cell.error}</p>}
    {revision && <section className="work-comparison" aria-label={`Review unsent ${stream === "draft" ? "translation" : "note"} for ${verseRef}`}>
      <h5>Current saved {stream === "draft" ? "translation" : "note"}</h5>
      <p className="work-text" dir="auto">{cell.head ? cell.head.text || "Translation cleared" : "No saved version"}</p>
      <p className="field-help">Your copy stays only in this tab. Check the saved work before choosing what to keep.</p>
      {revision.outcome === "unknown" ? <button className="button-secondary" disabled={recovering} onClick={() => void recover(false)}>{recovering ? "Checking earlier save…" : "Check what saved"}</button>
        : <div className="work-actions"><button className="button-secondary" disabled={!cell.verified || (revision.outcome === "committed" && cell.text === revision.committedText)} onClick={() => coordinator.resolveRevision(kind, verseRef, stream, false)}>Review and keep my text</button>
          <button className="button-text" disabled={!cell.verified} onClick={() => coordinator.resolveRevision(kind, verseRef, stream, true)}>{stream === "draft" ? "Use saved translation" : "Discard unsent note"}</button></div>}
    </section>}
    {cell.phase === "conflict" && <section className="work-comparison" aria-label={`Current saved ${stream === "draft" ? "translation" : "note"} for ${verseRef}`}>
      <h5>{cell.verified ? "Current saved" : "Current saved version unavailable"}{cell.verified ? stream === "draft" ? " translation" : " note" : ""}</h5>{cell.verified && <p className="work-text" dir="auto">{cell.head ? cell.head.text || "Translation cleared" : "No saved version"}</p>}
      <p className="field-help">Your unsent text remains above. Review both versions before choosing.</p>
      <div className="work-actions"><button className="button-secondary" disabled={!cell.verified} onClick={() => coordinator.resolveConflict(kind, verseRef, stream, false)}>Keep my text for another save</button><button className="button-text" disabled={!cell.verified} onClick={() => coordinator.resolveConflict(kind, verseRef, stream, true)}>{stream === "draft" ? "Use saved translation" : "Discard unsent note"}</button></div>
    </section>}
    {revision ? null : cell.pending && cell.phase === "unknown" ? <div className="work-actions"><button className="button-secondary" disabled={recovering} onClick={() => void recover(false)}>{recovering ? "Checking save…" : "Check what saved"}</button><button className="button-text" disabled={recovering} onClick={() => void recover(true)}>Send the same save again</button></div>
      : <button className="button-secondary" disabled={!cell.verified || Boolean(cell.pending) || cell.composing || cell.phase === "conflict" || Boolean(cell.error) || (stream === "draft" ? cell.text === (cell.head?.text ?? "") : !cell.text.trim())} onClick={() => void coordinator.save(kind, verseRef, stream)}>{stream === "draft" ? "Save now" : "Add student-visible note"}</button>}
  </div>;
}
export function VerseTools({ coordinator, kind, verseRef }: { coordinator: WorkCoordinator; kind: StudyKind; verseRef: string }) {
  useSyncExternalStore(coordinator.subscribe, coordinator.snapshot, coordinator.snapshot);
  const [stream, setStream] = useState<Stream>("draft"), id = useId(), scope = coordinator.scope(kind);
  if (!scope) return null;
  const active = coordinator.active?.kind === kind && coordinator.active.ref === verseRef, verse = scope.verses.get(verseRef), cell = coordinator.cell(kind, verseRef, stream);
  const learner = scope.baseline.mode === "student" || scope.baseline.mode === "child-practice", staff = scope.baseline.mode === "tutor" || scope.baseline.mode === "admin", editable = stream === "draft" ? learner : staff;
  const assignment = scope.baseline.readings.find(row => row.kind === kind)!;
  return <details className="verse-work" open={active} onToggle={event => { if (event.currentTarget.open && !active) void coordinator.open(kind, verseRef); else if (!event.currentTarget.open && active) coordinator.close(kind, verseRef); }}>
    <summary>{learner ? "Your translation & notes" : "Translation & notes"}<span className={learner ? "sr-only" : undefined}> · <bdi dir="ltr">{verseRef}</bdi></span></summary>
    {active && <div className="verse-work-content">
      <div className="work-streams" role="group" aria-label={`Work for ${verseRef}`}><button className="button-text" aria-pressed={stream === "draft"} aria-controls={`${id}-draft`} onClick={() => setStream("draft")}>{learner ? "My translation" : "Student translation"}</button><button className="button-text" aria-pressed={stream === "note"} aria-controls={`${id}-note`} onClick={() => setStream("note")}>{learner ? "Notes from your teachers" : "Teacher notes"}</button></div>
      {(!verse || !cell || !cell.verified) && <div role="status"><p>{scope.loading ? "Loading saved work…" : "Saved work unavailable"}</p><button className="button-secondary" disabled={scope.loading} onClick={() => void coordinator.loadPage(kind, assignment.verses.indexOf(verseRef))}>Retry work</button></div>}
      {verse && cell && (!cell.revisionRecovery || cell.verified) && <section id={`${id}-${stream}`} aria-label={`${stream === "draft" ? learner ? "My translation" : "Student translation" : learner ? "Notes from your teachers" : "Teacher notes"} for ${verseRef}`}>
        {staff && stream === "note" && <p className="field-help">The student can read these notes.</p>}
        {cell.verified && stream === "note" && <div className="work-notes">{!verse.notes.length ? <p>No teacher notes yet.</p> : verse.notes.map(note => <article key={note.id}><p className="work-text" dir="auto">{note.text}</p><WorkAttribution version={note} assignmentId={assignment.id} revision={assignment.revision} /></article>)}</div>}
        {editable ? <><Editor coordinator={coordinator} kind={kind} verseRef={verseRef} stream={stream} cell={cell} />{stream === "draft" && cell.verified && cell.head && <WorkAttribution version={cell.head} assignmentId={assignment.id} revision={assignment.revision} />}</> : cell.verified && stream === "draft" && <div><p className="field-help">Saved student translation · Read-only</p><p className="work-text" dir="auto">{verse.draft ? verse.draft.text || "Translation cleared · Saved" : "No translation saved yet"}</p>{verse.draft && <WorkAttribution version={verse.draft} assignmentId={assignment.id} revision={assignment.revision} />}</div>}
        {cell.verified && <WorkHistory coordinator={coordinator} cell={cell} kind={kind} verseRef={verseRef} stream={stream} />}
      </section>}
    </div>}
  </details>;
}
