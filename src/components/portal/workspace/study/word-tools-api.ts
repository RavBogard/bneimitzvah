import { PortalRequestError } from "../../api";
import { identifier, parseContext, type Assigned, type Selection } from "../api";
import { studyPlan, type StudyKind, type StudyVerse } from "./api";
import { referenceRecord } from "../../../../lib/reference-audio/source";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import { parseStudyWordAids, type StudyWordAids } from "../../../../lib/hebrew/word-aids";
import { parseStudyWordDetails, type StudyWordDetails } from "../../../../lib/hebrew/word-details";

export const WORD_TOOLS_TRANSPORT = Object.freeze({ totalMs: 15000, idleMs: 5000, aidsBytes: 160 * 1024, detailsBytes: 32 * 1024, emptyReads: 64 });
const bad = (): never => { throw new PortalRequestError(503); };
const stale = (): never => { throw new PortalRequestError(409); };
function authority(value: unknown, base: Assigned, kind: StudyKind, offset: number, field: string, selected?: Selection) {
  const row = referenceRecord(value, ["studentId", "studentRevision", "mode", "context", "assignment", field]), plan = studyPlan(base, kind, offset);
  if (!row) return bad();
  if (identifier(row.studentId) !== base.student.id || row.studentRevision !== base.student.revision || row.mode !== base.mode) return stale();
  if (base.mode === "child-practice") {
    const context = parseContext(row.context, base.student.id), expected = base.context;
    if (!selected || !expected || context.id !== expected.id || context.authorityRevision !== expected.authorityRevision || context.expiresAt !== expected.expiresAt
      || context.studentId !== expected.studentId || context.studentRevision !== base.student.revision || context.studentRevision !== expected.studentRevision
      || context.id !== selected.context.id || context.authorityRevision !== selected.context.authorityRevision || context.expiresAt !== selected.context.expiresAt
      || context.studentId !== selected.context.studentId || Date.parse(context.expiresAt) <= Date.now()) return stale();
  } else if (row.context !== null || selected) return bad();
  const assignment = referenceRecord(row.assignment, ["id", "revision", "kind", "needsReview"]);
  if (!assignment || assignment.id !== plan.assignment.id || assignment.revision !== plan.assignment.revision || assignment.kind !== kind || assignment.needsReview !== plan.assignment.needsReview) return stale();
  return row[field];
}

async function fetchTools(base: Assigned, kind: StudyKind, offset: number, actual: StudyVerse, index: number | undefined, signal: AbortSignal, selection?: Selection): Promise<StudyWordAids | StudyWordDetails> {
  // Capture actual rendered text, authority and private selection before any await.
  const expected = structuredClone(base), verse = structuredClone(actual), selected = selection ? structuredClone(selection) : undefined, plan = studyPlan(expected, kind, offset);
  if ((expected.mode === "child-practice") !== Boolean(selected) || selected && (typeof selected.handle !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(selected.handle))) return bad();
  if (verse.ref !== plan.refs[0]) return stale();
  if (index !== undefined && (!Number.isSafeInteger(index) || index < 0 || index > 511)) return bad();
  const projection = projectStudyVerse(verse.ref, verse.hebrew);
  if (projection.status === "ready" && index !== undefined && index >= projection.projection.words.length) return bad();
  const abort = new AbortController(), onAbort = () => abort.abort();
  if (signal.aborted) onAbort(); signal.addEventListener("abort", onAbort, { once: true });
  const start = performance.now(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const live = () => { if (signal.aborted || abort.signal.aborted) return stale(); if (performance.now() - start >= WORD_TOOLS_TRANSPORT.totalMs) return bad(); if (expected.context && Date.parse(expected.context.expiresAt) <= Date.now()) return stale(); };
  const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { void body?.cancel().catch(() => {}); } catch {} };
  async function wait<T>(pending: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
    let expired = false, stop: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const until = Math.min(start + WORD_TOOLS_TRANSPORT.totalMs, performance.now() + ms);
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
    let binding: { ref: string; readingTextSha256?: string; words?: readonly string[] } = { ref: verse.ref };
    if (projection.status === "ready") {
      const digest = await wait(crypto.subtle.digest("SHA-256", new TextEncoder().encode(projection.projection.readingText.normalize("NFC"))), WORD_TOOLS_TRANSPORT.totalMs);
      binding = { ref: verse.ref, readingTextSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), words: Object.freeze(projection.projection.words.map(word => word.text)) };
    }
    live();
    const field = index === undefined ? "wordAids" : "wordDetails", endpoint = index === undefined ? "study-word-aids" : "study-word-details", cap = index === undefined ? WORD_TOOLS_TRANSPORT.aidsBytes : WORD_TOOLS_TRANSPORT.detailsBytes;
    const query = new URLSearchParams({ mode: expected.mode, kind, assignmentId: identifier(plan.assignment.id), assignmentRevision: String(plan.assignment.revision), translation: "jps2023", offset: String(offset) });
    if (index !== undefined) query.set("wordIndex", String(index));
    const headers = new Headers({ accept: "application/json" }); if (selected) headers.set("X-Practice-Context", selected.handle);
    const response = await wait(fetch(`/api/students/${identifier(expected.student.id)}/${endpoint}?${query}`, { headers, signal: abort.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" }), WORD_TOOLS_TRANSPORT.totalMs, value => cancel(value.body));
    try {
      if (!response.ok) throw new PortalRequestError([400,401,403,404,409,429,503].includes(response.status) ? response.status : 503);
      if (response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) return bad();
      live(); reader = response.body.getReader();
    } catch (error) { cancel(response.body); throw error; }
    const bytes = new Uint8Array(cap); let size = 0, empty = 0, progress = performance.now();
    while (true) {
      live(); const left = WORD_TOOLS_TRANSPORT.idleMs - (performance.now() - progress); if (left <= 0) return bad();
      const part = await wait(reader.read(), left);
      if (performance.now() - progress >= WORD_TOOLS_TRANSPORT.idleMs) return bad();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > bytes.length - size) return bad();
      if (!part.value.byteLength) { if (++empty > WORD_TOOLS_TRANSPORT.emptyReads) return bad(); continue; }
      bytes.set(part.value, size); size += part.value.byteLength; progress = performance.now(); empty = 0;
    }
    live();
    const payload = authority(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))), expected, kind, offset, field, selected);
    const result = index === undefined ? parseStudyWordAids(payload, binding) : parseStudyWordDetails(payload, { ...binding, wordIndex: index });
    live(); return result ?? bad();
  } catch (error) { abort.abort(); if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { signal.removeEventListener("abort", onAbort); try { void reader?.cancel().catch(() => {}); } catch {} try { reader?.releaseLock(); } catch {} }
}
export const fetchWordToolsAids = (base: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, signal: AbortSignal, selection?: Selection) => fetchTools(base, kind, offset, verse, undefined, signal, selection) as Promise<StudyWordAids>;
export const fetchWordToolsDetails = (base: Assigned, kind: StudyKind, offset: number, verse: StudyVerse, wordIndex: number, signal: AbortSignal, selection?: Selection) => fetchTools(base, kind, offset, verse, wordIndex, signal, selection) as Promise<StudyWordDetails>;
