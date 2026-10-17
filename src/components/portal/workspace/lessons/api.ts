import { PortalRequestError } from "../../api";
import { identifier, type ReadingMode, type Selection } from "../api";
import type { LessonLogCursor, LessonLogEntry } from "../../../../lib/lesson-log/types";

export type LessonPage = { entries: LessonLogEntry[]; nextCursor: LessonLogCursor | null };
export type LessonOperation =
  | { type: "page"; before?: LessonLogCursor }
  | { type: "create"; entryId: string; lessonDate: string; summary: string }
  | { type: "edit"; entryId: string; expectedVersion: number; lessonDate: string; summary: string }
  | { type: "delete"; entryId: string; expectedVersion: number };
export type LessonResult = LessonPage | { entry: LessonLogEntry } | { removed: string; version: number };
export class LessonError extends PortalRequestError {
  constructor(status: number, public readonly conflict = false) { super(status); }
}
const bad = (): never => { throw new LessonError(503); };
const writable = (mode: ReadingMode) => mode === "tutor" || mode === "admin";
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2147483647 ? Number(value) : bad();
const encoder = new TextEncoder();
/** The server's own rule: real Gregorian YYYY-MM-DD. */
export function lessonDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)) return bad();
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : bad();
}
export const summaryLimit = 4096;
export const summaryBytes = (text: string) => encoder.encode(text.replace(/\r\n?/g, "\n")).length;
function entry(value: unknown, mode: ReadingMode): LessonLogEntry {
  const row = object(value, ["entryId", "lessonDate", "summary", "version", "displayName", "canEdit", "canDelete"]);
  if (typeof row.summary !== "string" || !row.summary.trim() || !row.summary.isWellFormed() || summaryBytes(row.summary) > summaryLimit) return bad();
  if (typeof row.displayName !== "string" || !row.displayName.trim() || row.displayName.length > 256 || typeof row.canEdit !== "boolean" || typeof row.canDelete !== "boolean") return bad();
  // Only staff can ever change a lesson; a learner view offering it is a broken answer.
  if (!writable(mode) && (row.canEdit || row.canDelete)) return bad();
  return { entryId: identifier(row.entryId), lessonDate: lessonDate(row.lessonDate), summary: row.summary, version: version(row.version), displayName: row.displayName, canEdit: row.canEdit, canDelete: row.canDelete };
}
export function parseLessonPage(value: unknown, mode: ReadingMode, studentId: string, before?: LessonLogCursor): LessonPage {
  const row = object(value, ["ok", "studentId", "mode", "entries", "nextCursor"]);
  if (row.ok !== true || row.studentId !== studentId || row.mode !== mode || !Array.isArray(row.entries) || row.entries.length > 50) return bad();
  const entries = row.entries.map(value => entry(value, mode));
  // Newest first by (date, id), and strictly after the cursor that was asked for.
  const key = (value: { lessonDate: string; entryId: string }) => `${value.lessonDate} ${value.entryId}`;
  for (let i = 0; i < entries.length; i++) if (i ? key(entries[i]) >= key(entries[i - 1]) : before && key(entries[i]) >= key(before)) return bad();
  let nextCursor: LessonLogCursor | null = null;
  if (row.nextCursor !== null) {
    const cursor = object(row.nextCursor, ["lessonDate", "entryId"]), last = entries.at(-1);
    if (entries.length !== 50 || !last || cursor.lessonDate !== last.lessonDate || cursor.entryId !== last.entryId) return bad();
    nextCursor = { lessonDate: last.lessonDate, entryId: last.entryId };
  }
  return { entries, nextCursor };
}
export async function fetchLessons(mode: ReadingMode, studentId: string, operation: LessonOperation, signal: AbortSignal, selection?: Selection): Promise<LessonResult> {
  const id = identifier(studentId), write = operation.type !== "page";
  if (write && !writable(mode) || (mode === "child-practice") !== Boolean(selection)) return bad();
  if (selection && (selection.context.studentId !== id || Date.parse(selection.context.expiresAt) <= Date.now())) return bad();
  const query = new URLSearchParams({ mode });
  if (operation.type === "page" && operation.before) { query.set("beforeDate", operation.before.lessonDate); query.set("beforeId", operation.before.entryId); }
  const path = operation.type === "page" ? `?${query}` : operation.type === "create" ? "" : `/${identifier(operation.entryId)}/${operation.type}`;
  const body = operation.type === "create" ? { mode, entryId: operation.entryId, lessonDate: operation.lessonDate, summary: operation.summary }
    : operation.type === "edit" ? { mode, expectedVersion: operation.expectedVersion, lessonDate: operation.lessonDate, summary: operation.summary }
    : operation.type === "delete" ? { mode, expectedVersion: operation.expectedVersion } : undefined;
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 12_000);
  try {
    const headers = new Headers({ accept: "application/json" }); if (selection) headers.set("X-Practice-Context", selection.handle);
    if (write) headers.set("content-type", "application/json");
    const response = await fetch(`/api/students/${id}/lesson-log${path}`, { method: write ? "POST" : "GET", headers, body: body && JSON.stringify(body),
      signal: controller.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new LessonError(response.ok ? 503 : response.status);
    const text = await response.text(); if (text.length > 512 * 1024) return bad();
    const value: unknown = JSON.parse(text); if (controller.signal.aborted) return bad();
    if (response.status === 409) { const failure = object(value, ["ok", "code"]); if (failure.ok !== false || failure.code !== "conflict" || !write) return bad(); throw new LessonError(409, true); }
    if (!response.ok) throw new LessonError([400, 401, 403, 404, 429].includes(response.status) ? response.status : 503);
    if (operation.type === "page") return parseLessonPage(value, mode, id, operation.before);
    if (operation.type === "delete") {
      const row = object(value, ["ok", "entryId", "version"]);
      if (row.ok !== true || row.entryId !== operation.entryId || version(row.version) !== operation.expectedVersion + 1) return bad();
      return { removed: operation.entryId, version: Number(row.version) };
    }
    const row = object(value, ["ok", "entry"]), saved = entry(row.entry, mode);
    if (row.ok !== true || saved.entryId !== operation.entryId || saved.lessonDate !== operation.lessonDate || saved.summary !== operation.summary.replace(/\r\n?/g, "\n")) return bad();
    // A create is version 1; an edit advances by one, or keeps its version when nothing changed.
    if (operation.type === "create" ? saved.version !== 1 : saved.version !== operation.expectedVersion && saved.version !== operation.expectedVersion + 1) return bad();
    return { entry: saved };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
