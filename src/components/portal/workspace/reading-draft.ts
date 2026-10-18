import type { Reading } from "./api";
export type ReadingDraft = {
  method: "custom" | "calendar";
  custom: string;
  cuts: string;
  cutsEdited: boolean;
  current: { id: string; revision: number } | null;
  calendarPick: string;
};

export const emptyReadingDraft = (): ReadingDraft => ({ method: "custom", custom: "", cuts: "", cutsEdited: false, current: null, calendarPick: "" });

export function currentReadingDraft(reading: Reading): ReadingDraft {
  const torah = reading.kind === "torah";
  return {
    method: "custom", custom: reading.ranges.join("\n"),
    cuts: torah ? reading.aliyahStarts?.join("\n") ?? "" : "",
    cutsEdited: torah && reading.aliyahStarts !== null,
    current: torah ? { id: reading.id, revision: reading.revision } : null,
    calendarPick: "",
  };
}

/** undefined omits metadata; an explicitly empty draft records one aliyah. */
export function draftCuts(draft: ReadingDraft): string[] | undefined {
  if (!draft.cutsEdited) return undefined;
  const refs = draft.cuts.split(/\r?\n/).map(ref => ref.trim()).filter(Boolean);
  if (refs.length > 999 || refs.some(ref => ref.length > 100 || /[\x00-\x1f\x7f]/.test(ref))) throw new Error("Invalid aliyah starts");
  return refs;
}
