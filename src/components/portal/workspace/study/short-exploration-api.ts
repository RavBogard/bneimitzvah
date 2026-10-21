import { PortalRequestError } from "../../api";
import { identifier, type Assigned, type Selection } from "../api";
import { parseExplorationPreparation, parseExplorationPage, type PreparedExploration } from "./exploration-api";
import { studyRangePlan, type StudyPage } from "./api";
import { checkShortReferenceSelection, type ShortReferencePage } from "./short-reference-api";
import { referenceRecord } from "../../../../lib/reference-audio/source";
import { parseReferenceShortResolution } from "../../../../lib/reference-audio/short-resolution";
const bad = (): never => { throw new PortalRequestError(503); };
const stale = (): never => { throw new PortalRequestError(409); };

/** Actual proposed scope and rendered page, never a manufactured assignment. */
export function checkShortExplorationExpectation(baseline: Assigned, prepared: PreparedExploration, page: StudyPage, selection?: Selection) {
  checkShortReferenceSelection(baseline, selection);
  if (Number.isSafeInteger(prepared.expiresAt) && prepared.expiresAt <= Date.now()) return stale();
  const checked = parseExplorationPreparation(prepared, baseline);
  if (checked.status !== "prepared" || checked.expiresAt <= Date.now()) return stale();
  const parsed = parseExplorationPage({ studentId: baseline.student.id, studentRevision: baseline.student.revision, mode: baseline.mode, kind: "torah", expiresAt: checked.expiresAt, ...page }, checked, page.offset);
  const plan = studyRangePlan(checked.ranges, "torah", parsed.offset);
  return { prepared: checked, page: parsed, plan };
}
export function parseShortExplorationPageData(value: unknown, baseline: Assigned, prepared: PreparedExploration, page: StudyPage, selection?: Selection): ShortReferencePage {
  const { plan } = checkShortExplorationExpectation(baseline, prepared, page, selection), row = referenceRecord(value, ["offset", "nextOffset", "totalVerses", "references"]);
  if (!row || !Array.isArray(row.references) || Object.getPrototypeOf(row.references) !== Array.prototype || row.references.length < 1 || row.references.length > 100) return bad();
  if (row.offset !== page.offset || row.nextOffset !== plan.nextOffset || row.totalVerses !== prepared.verseCount || row.references.length !== plan.refs.length) return stale();
  if (Reflect.ownKeys(row.references).length !== row.references.length + 1 || Object.values(Object.getOwnPropertyDescriptors(row.references)).some(d => !Object.hasOwn(d, "value"))) return bad();
  const references = row.references.map((raw, i) => { const parsed = parseReferenceShortResolution(raw); if (!parsed) return bad(); if (parsed.verse.ref !== plan.refs[i] || parsed.verse.ref !== page.verses[i].ref) return stale(); return parsed; });
  const result = Object.freeze({ offset: page.offset, nextOffset: plan.nextOffset, totalVerses: prepared.verseCount, references: Object.freeze(references) });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) return bad(); return result;
}
export function parseShortExplorationPage(value: unknown, baseline: Assigned, prepared: PreparedExploration, page: StudyPage, selection?: Selection): ShortReferencePage {
  checkShortExplorationExpectation(baseline, prepared, page, selection);
  const row = referenceRecord(value, ["studentId", "studentRevision", "mode", "kind", "expiresAt", "page"]);
  if (!row) return bad();
  if (identifier(row.studentId) !== baseline.student.id || row.studentRevision !== baseline.student.revision || row.mode !== baseline.mode || row.kind !== "torah" || row.expiresAt !== prepared.expiresAt) return stale();
  return parseShortExplorationPageData(row.page, baseline, prepared, page, selection);
}
/** Bounded private POST. Signed scope/child handle never enter a URL or cache. */
export async function fetchShortExplorationPage(baseline: Assigned, suppliedPrepared: PreparedExploration, suppliedPage: StudyPage, signal: AbortSignal, selection?: Selection): Promise<ShortReferencePage> {
  const expected = structuredClone(baseline), prepared = structuredClone(suppliedPrepared), page = structuredClone(suppliedPage), selected = selection ? structuredClone(selection) : undefined;
  checkShortExplorationExpectation(expected, prepared, page, selected);
  const origin = location.origin; if (!["http:", "https:"].includes(new URL(origin).protocol) || new URL(origin).origin !== origin) return bad();
  const path = `/api/students/${identifier(expected.student.id)}/reading/explore/reference/short/page`;
  const controller = new AbortController(), abort = () => controller.abort(), start = performance.now();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, completed = false;
  const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { void body?.cancel().catch(() => {}); } catch {} };
  const live = () => { if (signal.aborted || controller.signal.aborted) return stale(); if (performance.now() - start >= 15000) return bad(); checkShortReferenceSelection(expected, selected); if (prepared.expiresAt <= Date.now()) return stale(); };
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
    headers.set("content-type", "application/json");
    // Preserve the exact Origin on Firefox's same-origin POST; redirects remain refused.
    const response = await wait(fetch(path, { method: "POST", body: JSON.stringify({ mode: expected.mode, binding: prepared.binding, offset: page.offset }), headers, signal: controller.signal, credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "same-origin" }), 15000, r => cancel(r.body));
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
    live(); const result = parseShortExplorationPage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))), expected, prepared, page, selected); live(); completed = true; return result;
  } catch (error) { controller.abort(); if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { if (!completed) controller.abort(); signal.removeEventListener("abort", abort); if (reader) { if (!completed) try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} } }
}
