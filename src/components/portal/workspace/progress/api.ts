import { PortalRequestError } from "../../api";
import { identifier, type Assigned, type Selection } from "../api";
import type { StudyKind } from "../study/api";
import { assessmentStates, selfCheckStates, type AssessmentState, type ProgressCounts, type ProgressStream, type ProgressVerse, type SelfCheckState } from "../../../../lib/progress/types";

export type ProgressMark = SelfCheckState | AssessmentState;
export type ProgressOperation = { type: "page"; offset: number } | { type: ProgressStream; verseRef: string; state: ProgressMark; expectedVersion: number };
export type ProgressRows = { offset: number; nextOffset: number | null; verses: ProgressVerse[]; counts: ProgressCounts };
export type ProgressSaved = { verseRef: string; stream: ProgressStream; state: ProgressMark; version: number };
export class ProgressError extends PortalRequestError {
  constructor(status: number, public readonly code?: "conflict" | "stale-assignment") { super(status); }
}
const bad = (): never => { throw new ProgressError(503); };
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1000 ? Number(value) : bad();
const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647 ? Number(value) : bad();
function mark<T extends string>(value: unknown, states: readonly T[]) { const row = object(value, ["state", "version"]); if (!states.includes(row.state as T)) return bad(); return { state: row.state as T, version: version(row.version) }; }
function tally<T extends string>(value: unknown, states: readonly T[], total: number) {
  const row = object(value, [...states]), result = Object.fromEntries(states.map(state => [state, count(row[state])])) as Record<T, number>;
  if (Object.values<number>(result).reduce((sum, value) => sum + value, 0) !== total) return bad();
  return result;
}
function assignmentOf(baseline: Assigned, kind: StudyKind) { return baseline.readings.find(row => row.kind === kind) ?? bad(); }
function binding(value: unknown, baseline: Assigned, kind: StudyKind) {
  const row = object(value, ["studentId", "mode", "kind", "assignmentId", "assignmentRevision"]), assignment = assignmentOf(baseline, kind);
  if (row.studentId !== baseline.student.id || row.mode !== baseline.mode || row.kind !== kind || row.assignmentId !== assignment.id || row.assignmentRevision !== assignment.revision) bad();
}
export function parseProgressPage(value: unknown, baseline: Assigned, kind: StudyKind, offset: number): ProgressRows {
  const row = object(value, ["ok", "binding", "offset", "nextOffset", "totalVerses", "verses", "counts"]), assignment = assignmentOf(baseline, kind);
  binding(row.binding, baseline, kind);
  if (row.ok !== true || row.offset !== offset || row.totalVerses !== assignment.verses.length || !Array.isArray(row.verses) || !row.verses.length || row.verses.length > 100) return bad();
  const verses = row.verses.map((value, i) => {
    const verse = object(value, ["verseRef", "selfCheck", "assessment"]);
    if (verse.verseRef !== assignment.verses[offset + i]) return bad();
    return { verseRef: verse.verseRef as string, selfCheck: mark(verse.selfCheck, selfCheckStates), assessment: mark(verse.assessment, assessmentStates) };
  });
  const nextOffset = offset + verses.length < assignment.verses.length ? offset + verses.length : null;
  if (row.nextOffset !== nextOffset) return bad();
  const counts = object(row.counts, ["selfCheck", "assessment"]), total = assignment.verses.length;
  return { offset, nextOffset, verses, counts: { selfCheck: tally(counts.selfCheck, selfCheckStates, total), assessment: tally(counts.assessment, assessmentStates, total) } };
}
export function parseProgressSaved(value: unknown, baseline: Assigned, kind: StudyKind, operation: Exclude<ProgressOperation, { type: "page" }>): ProgressSaved {
  const row = object(value, ["ok", "binding", "verseRef", "stream", "state", "version"]);
  binding(row.binding, baseline, kind);
  if (row.ok !== true || row.verseRef !== operation.verseRef || row.stream !== operation.type || row.state !== operation.state) return bad();
  // A same-state write is a no-op and keeps its version; any change advances it by one.
  const saved = version(row.version);
  if (saved !== operation.expectedVersion && saved !== operation.expectedVersion + 1) return bad();
  return { verseRef: operation.verseRef, stream: operation.type, state: operation.state, version: saved };
}
export async function fetchProgress(baseline: Assigned, kind: StudyKind, operation: ProgressOperation, signal: AbortSignal, selection?: Selection): Promise<ProgressRows | ProgressSaved> {
  const assignment = assignmentOf(baseline, kind); if ((baseline.mode === "child-practice") !== Boolean(selection)) return bad();
  if (selection && (selection.context.studentId !== baseline.student.id || selection.context.id !== baseline.context?.id)) return bad();
  const fields = { mode: baseline.mode, kind, assignmentId: identifier(assignment.id), assignmentRevision: assignment.revision }, write = operation.type !== "page";
  const query = new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, String(value)]));
  if (operation.type === "page") query.set("offset", String(operation.offset));
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 12_000);
  try {
    const headers = new Headers({ accept: "application/json" }); if (selection) headers.set("X-Practice-Context", selection.handle);
    if (write) headers.set("content-type", "application/json");
    const body = write ? JSON.stringify({ ...fields, verseRef: operation.verseRef, state: operation.state, expectedVersion: operation.expectedVersion }) : undefined;
    const response = await fetch(`/api/students/${identifier(baseline.student.id)}/progress${write ? `/${operation.type}` : `?${query}`}`, { method: write ? "POST" : "GET", headers, body,
      signal: controller.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ProgressError(response.ok ? 503 : response.status);
    const text = await response.text(); if (text.length > 128 * 1024) return bad();
    const value: unknown = JSON.parse(text); if (controller.signal.aborted) return bad();
    if (response.status === 409) { const failure = object(value, ["ok", "code"]); if (failure.ok !== false || (failure.code !== "conflict" && failure.code !== "stale-assignment")) return bad(); throw new ProgressError(409, failure.code); }
    if (!response.ok) throw new ProgressError([401, 403, 404, 429].includes(response.status) ? response.status : 503);
    return operation.type === "page" ? parseProgressPage(value, baseline, kind, operation.offset) : parseProgressSaved(value, baseline, kind, operation);
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
