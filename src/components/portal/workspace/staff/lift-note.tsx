"use client";
import { useState, useSyncExternalStore } from "react";
import type { StudyKind } from "../study/api";
import type { WorkCoordinator } from "../work/coordinator";
import { WorkEditor } from "../work/verse-tools";
import { chapterVerse } from "./model";

/**
 * "Add note for this verse" in Practice up close (1.9 N14, G7 TP-24): a tutor or admin writes a student-visible note on the
 * verse in front of them without leaving the lifted line. It is the same note, the same save and the same checks as the note in
 * the verse sheet; it widens nothing. Nothing for students or parents.
 */
export function LiftNote({ coordinator, kind, verseRef, firstName }: { coordinator: WorkCoordinator; kind: StudyKind; verseRef: string; firstName: string }) {
  useSyncExternalStore(coordinator.subscribe, coordinator.snapshot, coordinator.snapshot);
  const [open, setOpen] = useState(false), scope = coordinator.scope(kind);
  if (!scope || (scope.baseline.mode !== "tutor" && scope.baseline.mode !== "admin")) return null;
  if (!open) return <div className="lift-note"><button type="button" className="button-secondary" data-testid="lift-add-note" onClick={() => { setOpen(true); void coordinator.open(kind, verseRef); }}>Add note for this verse</button></div>;
  const cell = coordinator.cell(kind, verseRef, "note");
  return <section className="lift-note" aria-labelledby={`lift-note-${kind}`} data-testid="lift-note">
    <h3 id={`lift-note-${kind}`}>Note for <bdi dir="auto">{firstName}</bdi> on <bdi dir="ltr">{chapterVerse(verseRef)}</bdi></h3>
    {cell?.verified ? <WorkEditor coordinator={coordinator} kind={kind} verseRef={verseRef} stream="note" cell={cell} /> : <p role="status">{scope.loading ? "Loading saved work…" : "Saved work unavailable"}</p>}
  </section>;
}
