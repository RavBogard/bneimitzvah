import { PortalRequestError } from "../../api";
import { identifier, parseContext, type Assigned, type Selection } from "../api";
import { studyPlan, type StudyKind } from "./api";
import { referenceRecord } from "../../../../lib/reference-audio/source";
import { parseReferenceShortResolution, type ReferenceShortResolution } from "../../../../lib/reference-audio/short-resolution";

export type ShortReferencePage = Readonly<{ offset: number; nextOffset: number | null; totalVerses: number; references: readonly ReferenceShortResolution[] }>;
const bad = (): never => { throw new PortalRequestError(503); };
const stale = (): never => { throw new PortalRequestError(409); };
const contextKeys = ["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"];

/** Private selection only. No browser value is a server authorization proof. */
export function checkShortReferenceSelection(baseline: Assigned, selection?: Selection): void {
  if (baseline.mode !== "child-practice") { if (baseline.context !== null || selection) return bad(); return; }
  const expected = baseline.context;
  if (!expected || !selection || typeof selection.handle !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(selection.handle)) return stale();
  if (!referenceRecord(expected, contextKeys) || !referenceRecord(selection.context, contextKeys)) return stale();
  const actual = parseContext(selection.context, baseline.student.id);
  if (actual.id !== expected.id || actual.authorityRevision !== expected.authorityRevision || actual.studentRevision !== expected.studentRevision
    || actual.studentRevision !== baseline.student.revision || actual.studentId !== expected.studentId || actual.expiresAt !== expected.expiresAt
    || Date.parse(actual.expiresAt) <= Date.now()) return stale();
}

/** Page geometry is checked separately so a trusted page owner can revalidate
 * cached data without manufacturing an authority envelope. */
export function parseShortReferencePageData(value: unknown, baseline: Assigned, kind: StudyKind, offset: number): ShortReferencePage {
  const row = referenceRecord(value, ["offset", "nextOffset", "totalVerses", "references"]), plan = studyPlan(baseline, kind, offset);
  if (!row || !Array.isArray(row.references) || Object.getPrototypeOf(row.references) !== Array.prototype || row.references.length < 1 || row.references.length > 100) return bad();
  if (row.offset !== offset || row.nextOffset !== plan.nextOffset || row.totalVerses !== plan.assignment.verses.length || row.references.length !== plan.refs.length) return stale();
  const descriptors = Object.getOwnPropertyDescriptors(row.references);
  if (Reflect.ownKeys(row.references).length !== row.references.length + 1 || Object.values(descriptors).some(d => !Object.hasOwn(d, "value"))) return bad();
  const references = row.references.map((raw, i) => {
    const reference = parseReferenceShortResolution(raw); if (!reference) return bad();
    if (reference.verse.ref !== plan.refs[i]) return stale(); return reference;
  });
  const result = Object.freeze({ offset, nextOffset: plan.nextOffset, totalVerses: plan.assignment.verses.length, references: Object.freeze(references) });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) return bad(); return result;
}

export function parseShortReferencePage(value: unknown, baseline: Assigned, kind: StudyKind, offset: number, selection?: Selection): ShortReferencePage {
  checkShortReferenceSelection(baseline, selection);
  const row = referenceRecord(value, ["studentId", "studentRevision", "mode", "context", "assignment", "page"]), plan = studyPlan(baseline, kind, offset);
  if (!row) return bad();
  if (identifier(row.studentId) !== baseline.student.id || row.studentRevision !== baseline.student.revision || row.mode !== baseline.mode) return stale();
  if (baseline.mode === "child-practice") {
    if (!referenceRecord(row.context, contextKeys)) return bad();
    const context = parseContext(row.context, baseline.student.id), expected = baseline.context!;
    if (contextKeys.some(k => context[k as keyof typeof context] !== expected[k as keyof typeof expected])) return stale();
  } else if (row.context !== null) return bad();
  const assignment = referenceRecord(row.assignment, ["id", "revision", "kind", "needsReview"]);
  if (!assignment || assignment.id !== plan.assignment.id || assignment.revision !== plan.assignment.revision || assignment.kind !== kind || assignment.needsReview !== plan.assignment.needsReview) return stale();
  return parseShortReferencePageData(row.page, baseline, kind, offset);
}

/** Anonymous media is fetched elsewhere. This request carries only the existing
 * same-origin cookie and optional private child-context header, never in URLs. */
export async function fetchShortReferencePage(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal, selection?: Selection): Promise<ShortReferencePage> {
  const expected = structuredClone(baseline), selected = selection ? structuredClone(selection) : undefined, plan = studyPlan(expected, kind, offset);
  checkShortReferenceSelection(expected, selected);
  const origin = location.origin;
  if (!["http:", "https:"].includes(new URL(origin).protocol) || new URL(origin).origin !== origin) return bad();
  const query = new URLSearchParams({ mode: expected.mode, kind, assignmentId: identifier(plan.assignment.id), assignmentRevision: String(plan.assignment.revision), translation: "jps2023", offset: String(offset) });
  const path = `/api/students/${identifier(expected.student.id)}/reference-audio/short/page?${query}`;
  const controller = new AbortController(), abort = () => controller.abort(), start = performance.now();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { void body?.cancel().catch(() => {}); } catch {} };
  const live = () => { if (signal.aborted || controller.signal.aborted) return stale(); if (performance.now() - start >= 15000) return bad(); checkShortReferenceSelection(expected, selected); };
  async function wait<T>(pending: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
    let expired = false, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
    const until = Math.min(start + 15000, performance.now() + ms), observed = pending.then(value => { if (expired || controller.signal.aborted) { late?.(value); return stale(); } return value; });
    try {
      const result = await Promise.race([observed, new Promise<never>((_, reject) => {
        stop = () => { expired = true; reject(new PortalRequestError(409)); }; controller.signal.addEventListener("abort", stop, { once: true });
        timer = setTimeout(() => { expired = true; reject(new PortalRequestError(503)); }, Math.max(1, until - performance.now())); if (controller.signal.aborted) stop();
      })]);
      try { live(); if (performance.now() >= until) return bad(); return result; } catch (error) { late?.(result); throw error; }
    } finally { clearTimeout(timer); if (stop) controller.signal.removeEventListener("abort", stop); }
  }
  try {
    live(); const headers = new Headers({ accept: "application/json" }); if (selected) headers.set("X-Practice-Context", selected.handle);
    const response = await wait(fetch(path, { headers, signal: controller.signal, credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" }), 15000, r => cancel(r.body));
    try {
      if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 503);
      if (response.redirected || response.url !== origin + path || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) return bad();
      reader = response.body.getReader();
    } catch (error) { cancel(response.body); throw error; }
    const bytes = new Uint8Array(1024 * 1024), proto = Object.getPrototypeOf(Uint8Array.prototype), field = (key: string, value: Uint8Array) => Object.getOwnPropertyDescriptor(proto, key)!.get!.call(value);
    let size = 0, empty = 0, progress = performance.now();
    for (;;) {
      const part = await wait(reader.read(), Math.max(1, 5000 - (performance.now() - progress))); if (performance.now() - progress >= 5000) return bad(); if (part.done) break;
      if (!(part.value instanceof Uint8Array)) return bad(); const length = Number(field("byteLength", part.value));
      if (length > bytes.length - size) return bad(); if (!length) { if (++empty > 64) return bad(); continue; }
      bytes.set(new Uint8Array(field("buffer", part.value) as ArrayBuffer, Number(field("byteOffset", part.value)), length), size); size += length; empty = 0; progress = performance.now();
    }
    live(); const result = parseShortReferencePage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))), expected, kind, offset, selected); live(); return result;
  } catch (error) { controller.abort(); if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { controller.abort(); signal.removeEventListener("abort", abort); if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} } }
}
