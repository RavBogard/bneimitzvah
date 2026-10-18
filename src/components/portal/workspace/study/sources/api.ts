import { PortalRequestError } from "../../../api";
import { identifier, type Assigned, type Selection } from "../../api";
import { studyPlan, type StudyKind } from "../api";
import { referenceRecord } from "../../../../../lib/reference-audio/source";

export const SOURCE_CLIENT_LIMITS = Object.freeze({ totalMs: 15000, idleMs: 5000, discoveryBytes: 64 * 1024, assignmentBytes: 128 * 1024, requestBytes: 16 * 1024, emptyReads: 64 });
export type SourceCitation = Readonly<{ id: string; ref: string; indexTitle: string; category: string; labels: Readonly<{ en: string | null; he: string | null }> }>;
export type CurrentSources = Readonly<{ currentVersion: number; citations: readonly SourceCitation[] }>;
export type SourcePageSelection = Readonly<{ sourceOffset: number; catalogHash?: string }>;
export type SourcePage = Readonly<{ schema: "study-related-page/v1"; ref: string; catalogHash: string; sourceOffset: number; pageSize: 10; totalEntries: number; receivedRows: number; heldCount: number; duplicateCount: number; nextSourceOffset: number | null; entries: readonly SourceCitation[] }>;
export type SourceIntent = Readonly<{ verseRef: string; expectedVersion: number; mutationId: string; sourceIds: readonly string[]; catalogHash?: string }>;
export type SourceCommit = Readonly<{ outcome: "committed"; committedVersion: number; currentLatestVersion: number; committed: Readonly<{ version: number; citations: readonly SourceCitation[]; createdAt: string }> }>;
export type SourceUnconfirmed = Readonly<{ outcome: "unconfirmed" }>;
export type SourceBinding = Readonly<{ baseline: Assigned; kind: StudyKind; offset: number; selection?: Selection }>;
export type SourceErrorCode = "unavailable" | "stale-revision" | "conflict" | "source-catalog-changed" | "no-change" | "invalid-request";
export class SourceClientError extends PortalRequestError {
  /** definite is set only for a validated fixed error returned by the endpoint. */
  constructor(status = 503, readonly code: SourceErrorCode = "unavailable", readonly definite = false) { super(status); }
}
const fail = (): never => { throw new SourceClientError(); };
const stale = (): never => { throw new SourceClientError(409, "stale-revision"); };
const record = (value: unknown, keys: readonly string[]) => referenceRecord(value, keys) ?? fail();
const int = (value: unknown, max = 2147483647) => { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) return fail(); return Number(value); };
const hash = (value: unknown) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return fail(); return value; };
const sourceId = (value: unknown) => { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return fail(); return value; };
function plain(value: unknown, bound: number): string {
  if (typeof value !== "string" || !value.length || value.length > bound || !value.isWellFormed() || value !== value.normalize("NFC")
    || /[<>\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value) || new TextEncoder().encode(value).length > bound) return fail();
  return value;
}
function list(value: unknown, bound: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > bound || Reflect.ownKeys(value).length !== value.length + 1) return fail();
  return Array.from({ length: value.length }, (_, index) => { const field = Object.getOwnPropertyDescriptor(value, String(index)); if (!field || !Object.hasOwn(field, "value")) return fail(); return field.value; });
}
export function parseSourceCitations(value: unknown, bound = 32): readonly SourceCitation[] {
  if (!Number.isSafeInteger(bound) || bound < 0 || bound > 32) return fail();
  let last = "";
  return Object.freeze(list(value, bound).map(item => {
    const row = record(item, ["id", "ref", "indexTitle", "category", "labels"]), id = sourceId(row.id), labels = record(row.labels, ["en", "he"]);
    if (id <= last) return fail(); last = id;
    return Object.freeze({ id, ref: plain(row.ref, 512), indexTitle: plain(row.indexTitle, 512), category: plain(row.category, 128),
      labels: Object.freeze({ en: labels.en === null ? null : plain(labels.en, 256), he: labels.he === null ? null : plain(labels.he, 256) }) });
  }));
}
export function captureSourceIntent(value: unknown, ref: string): SourceIntent {
  const optional = value && typeof value === "object" && Object.hasOwn(value, "catalogHash"), row = record(value, ["verseRef", "expectedVersion", "mutationId", "sourceIds", ...(optional ? ["catalogHash"] : [])]);
  if (row.verseRef !== ref) return stale();
  const ids = list(row.sourceIds, 32).map(sourceId).sort(); if (new Set(ids).size !== ids.length) return fail();
  return Object.freeze({ verseRef: ref, expectedVersion: int(row.expectedVersion, 2147483646), mutationId: identifier(row.mutationId), sourceIds: Object.freeze(ids), ...(optional ? { catalogHash: hash(row.catalogHash) } : {}) });
}
export function captureSourcePage(value: unknown): SourcePageSelection {
  const optional = value && typeof value === "object" && Object.hasOwn(value, "catalogHash"), row = record(value, ["sourceOffset", ...(optional ? ["catalogHash"] : [])]), sourceOffset = int(row.sourceOffset, 4090);
  if (sourceOffset % 10 || sourceOffset > 0 && !optional) return fail();
  return Object.freeze({ sourceOffset, ...(optional ? { catalogHash: hash(row.catalogHash) } : {}) });
}

/** One captured assigned verse. Construction performs no I/O and exposes no child handle. */
export function createSourceAssignmentClient(input: SourceBinding) {
  const base = structuredClone(input.baseline), kind = input.kind, offset = input.offset, selected = input.selection ? structuredClone(input.selection) : undefined;
  const plan = studyPlan(base, kind, offset), ref = plan.refs[0], canEdit = base.mode === "admin" || base.mode === "tutor";
  if (!ref || (base.mode === "child-practice") !== Boolean(selected)) return fail();
  if (selected) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(selected.handle) || !base.context) return stale();
    const c = record(selected.context, ["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"]);
    if ((["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"] as const).some(key => c[key] !== base.context![key])) return stale();
  }
  const liveContext = () => {
    if (!base.context) return;
    if (base.context.studentId !== base.student.id || base.context.studentRevision !== base.student.revision || !Number.isFinite(Date.parse(base.context.expiresAt))) return stale();
    if (Date.parse(base.context.expiresAt) <= Date.now()) throw new SourceClientError(404);
  };
  function envelope(value: unknown, keys: readonly string[], assigned: boolean) {
    const row = record(value, ["studentId", "studentRevision", "mode", "context", "assignment", ...(assigned ? ["ok", "verseRef"] : []), ...keys]);
    if (row.studentId !== base.student.id || row.studentRevision !== base.student.revision || row.mode !== base.mode) return stale();
    if (assigned && (row.ok !== true || row.verseRef !== ref)) return stale();
    if (base.context) {
      const c = record(row.context, ["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"]), expected = base.context;
      if (c.id !== expected.id || c.authorityRevision !== expected.authorityRevision || c.studentId !== expected.studentId || c.studentRevision !== expected.studentRevision || c.expiresAt !== expected.expiresAt) return stale();
    } else if (row.context !== null) return stale();
    const a = record(row.assignment, ["id", "revision", "kind", "needsReview"]);
    if (a.id !== plan.assignment.id || a.revision !== plan.assignment.revision || a.kind !== kind || a.needsReview !== plan.assignment.needsReview) return stale();
    liveContext(); return row;
  }
  const selectionQuery = () => new URLSearchParams({ mode: base.mode, kind, assignmentId: identifier(plan.assignment.id), assignmentRevision: String(plan.assignment.revision) });
  function current(value: unknown): CurrentSources {
    const row = envelope(value, ["currentVersion", "citations"], true), currentVersion = int(row.currentVersion), citations = parseSourceCitations(row.citations);
    if (!currentVersion && citations.length) return fail(); return Object.freeze({ currentVersion, citations });
  }
  function page(value: unknown, supplied: SourcePageSelection): SourcePage {
    const row = record(envelope(value, ["sources"], false).sources, ["schema", "ref", "catalogHash", "sourceOffset", "pageSize", "totalEntries", "receivedRows", "heldCount", "duplicateCount", "nextSourceOffset", "entries"]);
    if (row.schema !== "study-related-page/v1" || row.ref !== ref || row.pageSize !== 10 || row.sourceOffset !== supplied.sourceOffset) return fail();
    const catalogHash = hash(row.catalogHash), totalEntries = int(row.totalEntries, 4096), receivedRows = int(row.receivedRows, 4096), heldCount = int(row.heldCount, 4096), duplicateCount = int(row.duplicateCount, 4096);
    const entries = parseSourceCitations(row.entries, 10), end = Math.min(totalEntries, supplied.sourceOffset + 10), nextSourceOffset = end < totalEntries ? end : null;
    if (supplied.catalogHash && supplied.catalogHash !== catalogHash) throw new SourceClientError(409, "source-catalog-changed");
    if (receivedRows !== totalEntries + heldCount + duplicateCount || supplied.sourceOffset >= totalEntries && (totalEntries > 0 || supplied.sourceOffset !== 0)
      || entries.length !== end - supplied.sourceOffset || row.nextSourceOffset !== nextSourceOffset) return fail();
    return Object.freeze({ schema: "study-related-page/v1", ref, catalogHash, sourceOffset: supplied.sourceOffset, pageSize: 10, totalEntries, receivedRows, heldCount, duplicateCount, nextSourceOffset, entries });
  }
  function commit(value: unknown, intent: SourceIntent, receipt: boolean): SourceCommit | SourceUnconfirmed {
    const kindRow = record(value, receipt && value && typeof value === "object" && Object.getOwnPropertyDescriptor(value, "outcome")?.value === "unconfirmed"
      ? ["ok", "studentId", "studentRevision", "mode", "context", "assignment", "verseRef", "outcome"]
      : ["ok", "studentId", "studentRevision", "mode", "context", "assignment", "verseRef", ...(receipt ? ["outcome"] : ["replayed"]), "committedVersion", "currentLatestVersion", "committed"]);
    if (receipt && kindRow.outcome === "unconfirmed") { envelope(value, ["outcome"], true); return Object.freeze({ outcome: "unconfirmed" }); }
    const row = envelope(value, [...(receipt ? ["outcome"] : ["replayed"]), "committedVersion", "currentLatestVersion", "committed"], true);
    if (receipt ? row.outcome !== "committed" : typeof row.replayed !== "boolean") return fail();
    const committedVersion = int(row.committedVersion), currentLatestVersion = int(row.currentLatestVersion), snapshot = record(row.committed, ["version", "citations", "createdAt"]), citations = parseSourceCitations(snapshot.citations);
    if (committedVersion !== intent.expectedVersion + 1 || snapshot.version !== committedVersion || currentLatestVersion < committedVersion
      || citations.map(entry => entry.id).join("\n") !== intent.sourceIds.join("\n") || typeof snapshot.createdAt !== "string" || snapshot.createdAt.length > 32
      || !Number.isFinite(Date.parse(snapshot.createdAt)) || new Date(snapshot.createdAt).toISOString() !== snapshot.createdAt) return fail();
    return Object.freeze({ outcome: "committed", committedVersion, currentLatestVersion, committed: Object.freeze({ version: committedVersion, citations, createdAt: snapshot.createdAt }) });
  }
  async function request(path: string, signal: AbortSignal, cap: number, body?: object): Promise<unknown> {
    const abort = new AbortController(), onAbort = () => abort.abort(), start = performance.now(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (signal.aborted) onAbort(); signal.addEventListener("abort", onAbort, { once: true });
    const cancel = (stream?: ReadableStream<Uint8Array> | null) => { try { void stream?.cancel().catch(() => {}); } catch {} };
    const live = () => { if (signal.aborted || abort.signal.aborted) return stale(); liveContext(); if (performance.now() - start >= SOURCE_CLIENT_LIMITS.totalMs) return fail(); };
    async function wait<T>(pending: Promise<T>, idle: number, late?: (value: T) => void): Promise<T> {
      let expired = false, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
      const until = Math.min(start + SOURCE_CLIENT_LIMITS.totalMs, performance.now() + idle);
      const observed = pending.then(value => { if (expired || abort.signal.aborted) { late?.(value); return stale(); } return value; });
      try {
        const value = await Promise.race([observed, new Promise<never>((_, reject) => {
          stop = () => { expired = true; reject(new SourceClientError(409, "stale-revision")); }; abort.signal.addEventListener("abort", stop, { once: true });
          timer = setTimeout(() => { expired = true; reject(new SourceClientError()); }, Math.max(1, until - performance.now())); if (abort.signal.aborted) stop();
        })]);
        try { live(); if (performance.now() >= until) return fail(); return value; } catch (error) { late?.(value); throw error; }
      } finally { if (timer) clearTimeout(timer); if (stop) abort.signal.removeEventListener("abort", stop); }
    }
    try {
      live(); const headers = new Headers({ accept: "application/json" }); if (selected) headers.set("X-Practice-Context", selected.handle);
      const serialized = body === undefined ? undefined : JSON.stringify(body); if (serialized && new TextEncoder().encode(serialized).length > SOURCE_CLIENT_LIMITS.requestBytes) return fail();
      if (serialized) headers.set("content-type", "application/json");
      const response = await wait(fetch(path, { method: serialized ? "POST" : "GET", body: serialized, headers, signal: abort.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" }), SOURCE_CLIENT_LIMITS.idleMs, r => cancel(r.body));
      try {
        if ([401, 403, 404].includes(response.status)) throw new SourceClientError(response.status);
        const type = response.headers.get("content-type"), length = response.headers.get("content-length");
        if (response.redirected || !type || type.length > 128 || type.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body
          || length !== null && (!/^(?:0|[1-9][0-9]{0,8})$/.test(length) || Number(length) > cap)) return fail();
        live(); reader = response.body.getReader();
      } catch (error) { cancel(response.body); throw error; }
      const bytes = new Uint8Array(cap); let size = 0, empty = 0, progress = performance.now();
      const proto = Object.getPrototypeOf(Uint8Array.prototype), lengthOf = Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!;
      const bufferOf = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!, offsetOf = Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!;
      while (true) {
        live(); const left = SOURCE_CLIENT_LIMITS.idleMs - (performance.now() - progress); if (left <= 0) return fail();
        const part = await wait(reader.read(), left); if (performance.now() - progress >= SOURCE_CLIENT_LIMITS.idleMs) return fail(); if (part.done) break;
        if (!(part.value instanceof Uint8Array)) return fail();
        const length: number = lengthOf.call(part.value); if (length > cap - size) return fail();
        if (!length) { if (++empty > SOURCE_CLIENT_LIMITS.emptyReads) return fail(); continue; }
        bytes.set(new Uint8Array(bufferOf.call(part.value), offsetOf.call(part.value), length), size); size += length; empty = 0; progress = performance.now();
      }
      live(); const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))); live();
      if (response.status !== 200) {
        const row = referenceRecord(value, ["ok", "code"]), codes: readonly string[] = response.status === 409 ? ["stale-revision", "conflict", "source-catalog-changed", "no-change"] : response.status === 400 ? ["invalid-request"] : [];
        const code = row?.ok === false && typeof row.code === "string" && codes.includes(row.code) ? row.code as SourceErrorCode : "unavailable";
        throw new SourceClientError([400, 401, 403, 404, 409, 413, 429, 503].includes(response.status) ? response.status : 503, code, code !== "unavailable");
      }
      return value;
    } catch (error) { abort.abort(); if (error instanceof PortalRequestError) throw error; return fail(); }
    finally { signal.removeEventListener("abort", onAbort); try { void reader?.cancel().catch(() => {}); } catch {} try { reader?.releaseLock(); } catch {} }
  }
  const endpoint = `/api/students/${identifier(base.student.id)}/source-assignments`;
  const mutation = async (input: SourceIntent, signal: AbortSignal, receipt: boolean) => {
    if (!canEdit) throw new SourceClientError(403);
    const intent = captureSourceIntent(input, ref), value = await request(endpoint + (receipt ? "/receipt" : ""), signal, SOURCE_CLIENT_LIMITS.assignmentBytes,
      { mode: base.mode, kind, assignmentId: plan.assignment.id, assignmentRevision: plan.assignment.revision, ...intent });
    return commit(value, intent, receipt);
  };
  return Object.freeze({ ref, canEdit,
    async read(signal: AbortSignal) { const q = selectionQuery(); q.set("verseRef", ref); return current(await request(`${endpoint}?${q}`, signal, SOURCE_CLIENT_LIMITS.assignmentBytes)); },
    async discover(input: SourcePageSelection, signal: AbortSignal) { const paging = captureSourcePage(input), q = selectionQuery(); q.set("translation", "jps2023"); q.set("offset", String(offset)); q.set("sourceOffset", String(paging.sourceOffset)); if (paging.catalogHash) q.set("catalogHash", paging.catalogHash);
      return page(await request(`/api/students/${identifier(base.student.id)}/study-sources?${q}`, signal, SOURCE_CLIENT_LIMITS.discoveryBytes), paging); },
    async write(intent: SourceIntent, signal: AbortSignal): Promise<SourceCommit> { return await mutation(intent, signal, false) as SourceCommit; },
    receipt(intent: SourceIntent, signal: AbortSignal) { return mutation(intent, signal, true); }
  });
}
export type SourceAssignmentClient = ReturnType<typeof createSourceAssignmentClient>;
