import type { Assigned, Reading } from "./api";
import { aliyahStarts } from "../../../lib/readings/aliyah-starts";
import type { ReadingDraft } from "./reading-draft";

/** Autosave applies only to an explicit edit of divisions on this unchanged confirmed passage. */
export function canAutosaveDivisions(draft: ReadingDraft, reading: Reading | undefined, verses: readonly string[], starts: readonly string[]): boolean {
  if (!reading || reading.kind !== "torah" || draft.method !== "custom" || !draft.current || draft.current.id !== reading.id || draft.current.revision !== reading.revision
    || verses.length !== reading.verses.length || !verses.every((ref, index) => ref === reading.verses[index])) return false;
  try { aliyahStarts("torah", [...starts], reading.verses); return true; } catch { return false; }
}

export function divisionsSaved(current: Assigned, before: Reading, starts: readonly string[], receipt: { assignmentId: string; revision: number }): Reading | null {
  const saved = current.readings.find(row => row.kind === "torah");
  return saved && saved.id === receipt.assignmentId && saved.revision === receipt.revision
    && JSON.stringify(saved.verses) === JSON.stringify(before.verses) && JSON.stringify(saved.ranges) === JSON.stringify(before.ranges)
    && JSON.stringify(saved.aliyahStarts) === JSON.stringify(starts) && saved.confirmationDate === before.confirmationDate
    && saved.needsReview === before.needsReview && JSON.stringify(saved.source) === JSON.stringify(before.source) ? saved : null;
}
