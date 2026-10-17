import { PortalRequestError } from "../../api";
import { identifier, parseContext, type Assigned, type Selection } from "../api";
import { studyPlan, type StudyKind } from "./api";
import { parseReferenceResolution, referenceRecord, type ReferenceResolution } from "../../../../lib/reference-audio/source";

const bad = (): never => { throw new PortalRequestError(503); };
const stale = (): never => { throw new PortalRequestError(409); };
export function parseReferenceAudio(value: unknown, baseline: Assigned, kind: StudyKind, offset: number, selection?: Selection, asset?: string): ReferenceResolution {
  const row = referenceRecord(value, ["studentId", "studentRevision", "mode", "context", "assignment", "reference"]), plan = studyPlan(baseline, kind, offset);
  if (!row) return bad();
  if (identifier(row.studentId) !== baseline.student.id || row.studentRevision !== baseline.student.revision || row.mode !== baseline.mode) return stale();
  if (baseline.mode === "child-practice") {
    const context = parseContext(row.context, baseline.student.id), expected = baseline.context;
    if (!selection || !expected || context.id !== expected.id || context.authorityRevision !== expected.authorityRevision || context.expiresAt !== expected.expiresAt
      || context.studentRevision !== baseline.student.revision || context.studentRevision !== expected.studentRevision || context.studentId !== expected.studentId
      || context.id !== selection.context.id || context.authorityRevision !== selection.context.authorityRevision || context.expiresAt !== selection.context.expiresAt
      || context.studentId !== selection.context.studentId || Date.parse(context.expiresAt) <= Date.now()) return stale();
  } else if (row.context !== null || selection) return bad();
  const assignment = referenceRecord(row.assignment, ["id", "revision", "kind", "needsReview"]);
  if (!assignment || assignment.id !== plan.assignment.id || assignment.revision !== plan.assignment.revision || assignment.kind !== kind || assignment.needsReview !== plan.assignment.needsReview) return stale();
  const reference = parseReferenceResolution(row.reference);
  if (!reference) return bad();
  if (reference.verse.ref !== plan.refs[0]) return stale();
  if (asset !== undefined && reference.verse.playback.status !== "unavailable" && reference.verse.playback.asset !== asset) return stale();
  return reference;
}

/** Same private study selection, smaller closed response. No retries or redirects. */
export async function fetchReferenceAudio(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal, selection?: Selection, asset?: string): Promise<ReferenceResolution> {
  const expected = structuredClone(baseline), selected = selection ? structuredClone(selection) : undefined, plan = studyPlan(expected, kind, offset);
  if ((expected.mode === "child-practice") !== Boolean(selected) || selected && (typeof selected.handle !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(selected.handle))) return bad();
  if (asset !== undefined && (typeof asset !== "string" || !/^ra_[a-f0-9]{32}$/.test(asset))) return bad();
  const query = new URLSearchParams({ mode: expected.mode, kind, assignmentId: identifier(plan.assignment.id), assignmentRevision: String(plan.assignment.revision), translation: "jps2023", offset: String(offset) });
  if (asset !== undefined) query.set("asset", asset);
  const abort = new AbortController(), onAbort = () => abort.abort();
  if (signal.aborted) onAbort(); signal.addEventListener("abort", onAbort, { once: true });
  const start = performance.now(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const live = () => { if (signal.aborted || abort.signal.aborted || performance.now() - start >= 15000) return stale(); };
  const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { void body?.cancel().catch(() => {}); } catch {} };
  async function wait<T>(pending: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
    let expired = false, stop: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const until = Math.min(start + 15000, performance.now() + ms);
    const observed = pending.then(value => { if (expired || abort.signal.aborted) { late?.(value); return stale(); } return value; });
    try {
      const value = await Promise.race([observed, new Promise<never>((_, reject) => {
        stop = () => { expired = true; reject(new PortalRequestError(409)); }; abort.signal.addEventListener("abort", stop, { once: true });
        timer = setTimeout(() => { expired = true; reject(new PortalRequestError(503)); }, Math.max(1, until - performance.now()));
        if (abort.signal.aborted) stop();
      })]);
      try { live(); if (performance.now() >= until) return bad(); return value; } catch (error) { late?.(value); throw error; }
    } finally { if (timer) clearTimeout(timer); if (stop) abort.signal.removeEventListener("abort", stop); }
  }
  try {
    live();
    const headers = new Headers({ accept: "application/json" }); if (selected) headers.set("X-Practice-Context", selected.handle);
    const response = await wait(fetch(`/api/students/${identifier(expected.student.id)}/reference-audio?${query}`, { headers, signal: abort.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" }), 15000, value => cancel(value.body));
    try {
      if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 503);
      if (response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) return bad();
      reader = response.body.getReader();
    } catch (error) { cancel(response.body); throw error; }
    const bytes = new Uint8Array(32768); let size = 0, empty = 0, progress = performance.now();
    while (true) {
      const part = await wait(reader.read(), Math.max(1, 5000 - (performance.now() - progress)));
      if (performance.now() - progress >= 5000) return bad();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > bytes.length - size) return bad();
      if (!part.value.byteLength) { if (++empty > 64) return bad(); continue; }
      bytes.set(part.value, size); size += part.value.byteLength; progress = performance.now(); empty = 0;
    }
    live();
    const result = parseReferenceAudio(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))), expected, kind, offset, selected, asset);
    live(); return result;
  } catch (error) { abort.abort(); if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { signal.removeEventListener("abort", onAbort); try { void reader?.cancel().catch(() => {}); } catch {} try { reader?.releaseLock(); } catch {} }
}
