import type { WorkVersion, Stream } from "./api";
import type { WorkCoordinator, WorkCell } from "./coordinator";
import type { StudyKind } from "../study/api";

export function WorkAttribution({ version, assignmentId, revision }: { version: WorkVersion; assignmentId: string; revision: number }) {
  return <p className="work-attribution"><bdi dir="auto">{version.author.displayName}</bdi> · {version.author.assisted ? "Assisted child practice" : version.author.mode === "admin" ? "Rabbi/admin" : version.author.mode === "tutor" ? "Tutor" : "Student"} · <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString()}</time> · Version {version.version}
    {(version.assignmentId !== assignmentId || version.assignmentRevision !== revision) && <> · Saved under an earlier assignment (revision {version.assignmentRevision})</>}</p>;
}
export function WorkHistory({ coordinator, cell, kind, verseRef, stream }: { coordinator: WorkCoordinator; cell: WorkCell; kind: StudyKind; verseRef: string; stream: Stream }) {
  const assignment = coordinator.scope(kind)!.baseline.readings.find(row => row.kind === kind)!;
  return <details className="work-history" onToggle={event => { if (event.currentTarget.open && !cell.history && !cell.historyBusy) void coordinator.history(kind, verseRef, stream); }}>
    <summary>{stream === "draft" ? "Translation history" : "Note history"} · <bdi dir="ltr">{verseRef}</bdi></summary>
    {cell.historyBusy ? <p role="status">Loading history…</p> : cell.history ? <>
      {!cell.history.versions.length ? <p>No saved versions yet.</p> : <ol>{cell.history.versions.map(version => <li key={version.id}><p className="work-text" dir="auto">{version.text === "" ? "Translation cleared" : version.text}</p><WorkAttribution version={version} assignmentId={assignment.id} revision={assignment.revision} /></li>)}</ol>}
      <div className="work-actions">{cell.historyBefore !== undefined && <button className="button-secondary" onClick={() => void coordinator.history(kind, verseRef, stream)}>Latest history</button>}
        {cell.history.nextBeforeVersion !== null && <button className="button-secondary" onClick={() => void coordinator.history(kind, verseRef, stream, cell.history!.nextBeforeVersion!)}>Older versions</button>}</div>
    </> : <button className="button-secondary" onClick={() => void coordinator.history(kind, verseRef, stream)}>Load history</button>}
  </details>;
}
