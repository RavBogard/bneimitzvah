"use client";
import { useSyncExternalStore } from "react";
import type { StudyKind } from "../study/api";
import type { AssessmentState, SelfCheckState } from "../../../../lib/progress/types";
import type { ProgressStore } from "./store";

const selfLabels: Record<SelfCheckState, string> = { unmarked: "Not marked", working: "Still working", "got-it": "Got it" };
const assessmentLabels: Record<AssessmentState, string> = { "not-started": "Not started", working: "Working", solid: "Solid" };
const check = <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const useStore = (store: ProgressStore) => useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);

/** The verse card's quiet mark: the student's own, and for staff the assessment beside it. */
export function VerseMark({ store, kind, verseRef }: { store: ProgressStore; kind: StudyKind; verseRef: string }) {
  useStore(store);
  const verse = store.verse(kind, verseRef); if (!verse) return null;
  // Staff and parents see both marks, each named; students see their own.
  const staff = store.stream !== "self-check", self = verse.selfCheck.state, assessment = verse.assessment.state;
  return <span className="verse-marks">
    {self !== "unmarked" && <span className="verse-mark" data-state={self}>{self === "got-it" && check}{staff ? `Student: ${selfLabels[self].toLowerCase()}` : selfLabels[self]}</span>}
    {staff && assessment !== "not-started" && <span className="verse-mark" data-state={assessment}>{assessment === "solid" && check}{`Tutor: ${assessmentLabels[assessment].toLowerCase()}`}</span>}
  </span>;
}

/** In the practice view: students mark how a verse is going, tutors and admins assess it. */
export function LiftProgress({ store, kind, verseRef }: { store: ProgressStore; kind: StudyKind; verseRef: string }) {
  useStore(store);
  const verse = store.verse(kind, verseRef), stream = store.stream, pending = store.pending(kind, verseRef), notice = store.notice(kind, verseRef);
  if (!verse) return store.failed(kind) ? <p className="lift-progress-note" role="status">Marks are unavailable right now.</p> : null;
  const self = verse.selfCheck.state, assessment = verse.assessment.state;
  const choose = (state: SelfCheckState | AssessmentState, current: string, cleared: SelfCheckState | AssessmentState) => void store.set(kind, verseRef, current === state ? cleared : state);
  return <div className="lift-progress">
    {stream === "self-check" ? <div className="lift-marks" role="group" aria-label={`How ${verseRef} is going`}>
      {(["working", "got-it"] as const).map(state => <button key={state} type="button" className="lift-mark" data-state={state} aria-pressed={self === state} aria-disabled={pending || undefined}
        onClick={() => { if (!pending) choose(state, self, "unmarked"); }}>{state === "got-it" && check}{selfLabels[state]}</button>)}
    </div> : stream === "assessment" ? <div className="lift-marks" role="group" aria-label={`Assessment for ${verseRef}`}>
      {(["not-started", "working", "solid"] as const).map(state => <button key={state} type="button" className="lift-mark" data-state={state} aria-pressed={assessment === state} aria-disabled={pending || undefined}
        onClick={() => { if (!pending && assessment !== state) choose(state, assessment, "not-started"); }}>{state === "solid" && check}{assessmentLabels[state]}</button>)}
    </div> : null}
    <p className="lift-progress-note" role="status">{notice}</p>
    {!notice && <p className="lift-progress-note">{stream === "assessment" ? `Student: ${selfLabels[self].toLowerCase()}`
      : stream === "self-check" ? assessment !== "not-started" ? `Your tutor: ${assessmentLabels[assessment].toLowerCase()}` : ""
        : [self !== "unmarked" ? selfLabels[self] : "", assessment !== "not-started" ? `Tutor: ${assessmentLabels[assessment].toLowerCase()}` : ""].filter(Boolean).join(" · ")}</p>}
  </div>;
}

/** "5 got it", and for staff "3 solid" too; nothing until a verse is marked. */
export function useProgressSummary(store: ProgressStore, kind: StudyKind | undefined) {
  useStore(store);
  const counts = kind ? store.counts(kind) : null; if (!counts) return "";
  const parts = [counts.selfCheck["got-it"] ? `${counts.selfCheck["got-it"]} got it` : "", store.stream === "assessment" && counts.assessment.solid ? `${counts.assessment.solid} solid` : ""];
  return parts.filter(Boolean).join(" · ");
}
