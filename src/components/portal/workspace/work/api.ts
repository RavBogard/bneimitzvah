import { PortalRequestError } from "../../api";
import { identifier, type Assigned, type ReadingMode, type Selection } from "../api";
import type { StudyKind } from "../study/api";

export type Stream = "draft" | "note";
export type WorkVersion = { id: string; verseRef: string; version: number; text: string; assignmentId: string; assignmentRevision: number;
  author: { membershipId: string; displayName: string; mode: ReadingMode; assisted: boolean }; createdAt: string };
export type WorkVerse = { ref: string; draft: WorkVersion | null; notes: WorkVersion[] };
export type WorkPage = { offset: number; totalVerses: number; nextOffset: number | null; verses: WorkVerse[] };
export type WorkHistory = { versions: WorkVersion[]; nextBeforeVersion: number | null };
export type WorkReceipt = { committedVersion: number; currentLatestVersion: number; committed: WorkVersion; replayed?: boolean };
export type WorkOperation = { type: "page"; offset: number } | { type: "history"; stream: Stream; verseRef: string; beforeVersion?: number }
  | { type: "receipt"; stream: Stream; verseRef: string; mutationId: string }
  | { type: "draft" | "note"; verseRef: string; text: string; expectedVersion: number; mutationId: string };
export class WorkError extends PortalRequestError {
  constructor(status: number, public readonly code?: "conflict" | "stale-revision" | "invalid-request") { super(status); }
}
const bad = (): never => { throw new WorkError(503); };
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 1, max = 2147483647): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return bad(); return Number(value); }
export const normalizeWork = (text: string) => text.replace(/\r\n?/g, "\n");
export function workTextError(text: string, stream: Stream): string | null {
  if (!text.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) return "Remove unsupported control characters before saving.";
  if (new TextEncoder().encode(normalizeWork(text)).byteLength > 4096) return "Keep this text within 4,096 UTF-8 bytes.";
  return stream === "note" && !text.trim() ? "Write a note before submitting." : null;
}
export function workScope(baseline: Assigned, kind: StudyKind) {
  const row = baseline.readings.find(row => row.kind === kind); if (!row) return bad();
  return JSON.stringify([baseline.mode, baseline.student.id, baseline.context?.id ?? null, baseline.context?.authorityRevision ?? null, row.id, row.revision, row.verses]);
}
function version(value: unknown, ref: string, stream: Stream): WorkVersion {
  const row = object(value, ["id", "verseRef", "version", "text", "assignmentId", "assignmentRevision", "author", "createdAt"]);
  if (row.verseRef !== ref || typeof row.text !== "string" || normalizeWork(row.text) !== row.text || workTextError(row.text, stream)) return bad();
  const author = object(row.author, ["membershipId", "displayName", "mode", "assisted"]);
  if (typeof author.displayName !== "string" || !author.displayName.isWellFormed() || !author.displayName.trim() || [...author.displayName].length > 120 || author.displayName.includes("@") || /[\x00-\x1f\x7f-\x9f]/.test(author.displayName)
    || !["student", "parent", "tutor", "admin", "child-practice"].includes(String(author.mode)) || author.assisted !== (author.mode === "child-practice")
    || (stream === "note" ? !["tutor", "admin"].includes(String(author.mode)) : !["student", "child-practice"].includes(String(author.mode)))) return bad();
  if (typeof row.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.createdAt) || !Number.isFinite(Date.parse(row.createdAt))) return bad();
  return { id: identifier(row.id), verseRef: ref, version: integer(row.version), text: row.text, assignmentId: identifier(row.assignmentId), assignmentRevision: integer(row.assignmentRevision),
    author: { membershipId: identifier(author.membershipId), displayName: author.displayName, mode: author.mode as ReadingMode, assisted: author.assisted as boolean }, createdAt: row.createdAt };
}
function ordered(values: unknown, ref: string, stream: Stream, max: number, before?: number): WorkVersion[] {
  if (!Array.isArray(values) || values.length > max) return bad();
  const rows = values.map(value => version(value, ref, stream));
  if (rows.some((row, i) => row.version >= (i ? rows[i - 1].version : before ?? Infinity))) return bad();
  return rows;
}
export function parseWorkPage(value: unknown, baseline: Assigned, kind: StudyKind, offset: number): WorkPage {
  const row = object(value, ["ok", "studentId", "assignmentId", "assignmentRevision", "offset", "totalVerses", "nextOffset", "verses"]), assignment = baseline.readings.find(row => row.kind === kind);
  if (!assignment || row.ok !== true || row.studentId !== baseline.student.id || row.assignmentId !== assignment.id || row.assignmentRevision !== assignment.revision || row.offset !== offset || row.totalVerses !== assignment.verses.length || !Array.isArray(row.verses) || !row.verses.length || row.verses.length > 10 || offset < 0 || offset >= assignment.verses.length) return bad();
  const verses = row.verses.map((value, i) => { const v = object(value, ["ref", "draft", "notes"]), ref = assignment.verses[offset + i];
    if (!ref || v.ref !== ref) return bad(); return { ref, draft: v.draft === null ? null : version(v.draft, ref, "draft"), notes: ordered(v.notes, ref, "note", 3) }; });
  const nextOffset = offset + verses.length < assignment.verses.length ? offset + verses.length : null;
  if (row.nextOffset !== nextOffset) return bad();
  return { offset, nextOffset, totalVerses: assignment.verses.length, verses };
}
export function parseWorkHistory(value: unknown, ref: string, stream: Stream, before?: number): WorkHistory {
  const row = object(value, ["ok", "versions", "nextBeforeVersion"]); if (row.ok !== true) return bad();
  const versions = ordered(row.versions, ref, stream, 20, before);
  if (row.nextBeforeVersion !== null && (versions.length !== 20 || row.nextBeforeVersion !== versions[19].version)) return bad();
  return { versions, nextBeforeVersion: row.nextBeforeVersion as number | null };
}
export function parseWorkReceipt(value: unknown, operation: WorkOperation, assignment: { id: string; revision: number }): WorkReceipt {
  const write = operation.type === "draft" || operation.type === "note", row = object(value, ["ok", ...(write ? ["replayed"] : []), "committedVersion", "currentLatestVersion", "committed"]);
  if (operation.type === "page" || operation.type === "history" || row.ok !== true || (write && typeof row.replayed !== "boolean")) return bad();
  const stream = write ? operation.type as Stream : (operation as Extract<WorkOperation, { type: "receipt" }>).stream;
  const committed = version(row.committed, operation.verseRef, stream), committedVersion = integer(row.committedVersion), currentLatestVersion = integer(row.currentLatestVersion);
  if (committed.assignmentId !== assignment.id || committed.assignmentRevision !== assignment.revision || committedVersion !== committed.version || currentLatestVersion < committedVersion || (write && (committed.text !== operation.text || committedVersion !== operation.expectedVersion + 1))) return bad();
  return { committedVersion, currentLatestVersion, committed, ...(write ? { replayed: row.replayed as boolean } : {}) };
}
export async function fetchWork(baseline: Assigned, kind: StudyKind, operation: WorkOperation, signal: AbortSignal, selection?: Selection): Promise<WorkPage | WorkHistory | WorkReceipt> {
  const assignment = baseline.readings.find(row => row.kind === kind); if (!assignment || (baseline.mode === "child-practice") !== Boolean(selection)) return bad();
  if (selection && (selection.context.studentId !== baseline.student.id || selection.context.id !== baseline.context?.id || selection.context.authorityRevision !== baseline.context?.authorityRevision)) return bad();
  const binding = { mode: baseline.mode, kind, assignmentId: identifier(assignment.id), assignmentRevision: assignment.revision };
  const write = operation.type === "draft" || operation.type === "note", query = new URLSearchParams(Object.entries(binding).map(([k, v]) => [k, String(v)]));
  if (operation.type === "page") query.set("offset", String(operation.offset));
  else if (!write) for (const [key, value] of Object.entries(operation)) if (key !== "type" && value !== undefined) query.set(key, String(value));
  const { type, ...fields } = operation, controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 12_000);
  try {
    const headers = new Headers({ accept: "application/json" }); if (selection) headers.set("X-Practice-Context", selection.handle);
    if (write) headers.set("content-type", "application/json");
    const response = await fetch(`/api/students/${identifier(baseline.student.id)}/work${type === "page" ? "" : `/${type}`}${write ? "" : `?${query}`}`, { method: write ? "POST" : "GET", headers,
      ...(write ? { body: JSON.stringify({ ...binding, ...fields }) } : {}), signal: controller.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new WorkError(response.ok ? 503 : response.status);
    const reader = response.body?.getReader(); if (!reader) return bad(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 256 * 1024) { await reader.cancel(); return bad(); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); if (controller.signal.aborted) return bad();
    if (!response.ok) {
      if (response.status === 400 && value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && value.error === "invalid-request") throw new WorkError(400, "invalid-request");
      if (response.status === 409 || response.status === 400) { const error = object(value, ["ok", "code"]); if (error.ok !== false || !["conflict", "stale-revision", "invalid-request"].includes(String(error.code))) return bad(); throw new WorkError(response.status, error.code as WorkError["code"]); }
      throw new WorkError([401, 403, 404, 429].includes(response.status) ? response.status : 503);
    }
    return type === "page" ? parseWorkPage(value, baseline, kind, (operation as Extract<WorkOperation, { type: "page" }>).offset)
      : type === "history" ? parseWorkHistory(value, (operation as Extract<WorkOperation, { type: "history" }>).verseRef, (operation as Extract<WorkOperation, { type: "history" }>).stream, (operation as Extract<WorkOperation, { type: "history" }>).beforeVersion)
        : parseWorkReceipt(value, operation, assignment);
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
