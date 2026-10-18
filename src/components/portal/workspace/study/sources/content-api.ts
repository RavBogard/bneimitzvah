import { PortalRequestError } from "../../../api";
import { identifier } from "../../api";
import { studyPlan } from "../api";
import { referenceRecord } from "../../../../../lib/reference-audio/source";
import { parseSourceCitations, type SourceBinding, type SourceCitation } from "./api";
import { createSourceContentBudget } from "./content-budget";
export type SourceContentTarget = Readonly<{ source: SourceCitation }> & (Readonly<{ sourceScope: "assigned"; expectedSetVersion: number }> | Readonly<{ sourceScope: "related"; sourceCatalogHash: string }>);
export type EditionPageRequest = Readonly<{ editionOffset: number; editionCatalogHash?: string }>;
export type SourceEdition = Readonly<{ versionTitle: string; language: string; actualLanguage: string | null; license: string | null; source: string | null }>;
export type EditionChoice = Readonly<{ editionCatalogHash: string; edition: SourceEdition; language: "he" | "en" }>;
export type SourceEditionPage = Readonly<{ schema: "study-edition-page/v1"; workTitle: string; editionCatalogHash: string; editionOffset: number; pageSize: 10; totalEntries: number; receivedRows: number; heldCount: number; duplicateCount: number; nextEditionOffset: number | null; entries: readonly SourceEdition[] }>;
export type SourceText = Readonly<{ schema: "study-source-text/v1"; ref: string; text: string; edition: Readonly<{ versionTitle: string; language: string; actualLanguage: "he" | "en" }>; provenance: Readonly<{ provider: "Sefaria"; sourceRef: string; editionTitle: string; license: "Public Domain" | "CC0"; versionSource: string; format: "text_only" }> }>;
export type SourceContentErrorCode = "source-not-found" | "invalid-request" | "stale-revision" | "source-set-changed" | "source-catalog-changed" | "edition-catalog-changed" | "unsupported-source" | "unsupported-edition" | "unavailable";
export class SourceContentError extends PortalRequestError { constructor(status = 503, readonly code: SourceContentErrorCode = "unavailable") { super(status); } }
export const isSourceMissing = (error: unknown) => error instanceof SourceContentError && error.status === 404 && error.code === "source-not-found";
const fail = (): never => { throw new SourceContentError(); }, stale = (): never => { throw new SourceContentError(409, "stale-revision"); };
const bytes = (v: string) => new TextEncoder().encode(v).length;
const record = (v: unknown, keys: readonly string[]) => referenceRecord(v, keys) ?? fail();
const integer = (v: unknown, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max ? Number(v) : fail();
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : fail();
const unsafe = /[<>\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
function plain(v: unknown, limit: number): string { return typeof v === "string" && !!v.length && v.isWellFormed() && v.trim() === v && v.normalize("NFC") === v && bytes(v) <= limit && !unsafe.test(v) ? v : fail(); }
function list(v: unknown, limit: number): unknown[] {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > limit || Reflect.ownKeys(v).length !== v.length + 1) return fail();
  return Array.from({ length: v.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(v, String(i)); return d && Object.hasOwn(d, "value") ? d.value : fail(); });
}
export function captureSourceContentTarget(value: unknown): SourceContentTarget {
  const scope = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "sourceScope")?.value : null;
  const row = record(value, ["source", "sourceScope", scope === "assigned" ? "expectedSetVersion" : "sourceCatalogHash"]), source = parseSourceCitations([row.source])[0];
  if (scope === "assigned") { const version = integer(row.expectedSetVersion); if (!version) return fail(); return Object.freeze({ source, sourceScope: "assigned", expectedSetVersion: version }); }
  if (scope !== "related") return fail(); return Object.freeze({ source, sourceScope: "related", sourceCatalogHash: hash(row.sourceCatalogHash) });
}
export function captureEditionPage(value: unknown): EditionPageRequest {
  const optional = !!value && typeof value === "object" && Object.hasOwn(value, "editionCatalogHash"), row = record(value, ["editionOffset", ...(optional ? ["editionCatalogHash"] : [])]), offset = integer(row.editionOffset, 510);
  if (offset % 10 || offset > 0 && !optional) return fail(); return Object.freeze({ editionOffset: offset, ...(optional ? { editionCatalogHash: hash(row.editionCatalogHash) } : {}) });
}
function edition(value: unknown): SourceEdition {
  const row = record(value, ["versionTitle", "language", "actualLanguage", "license", "source"]);
  return Object.freeze({ versionTitle: plain(row.versionTitle, 512), language: plain(row.language, 64), actualLanguage: row.actualLanguage === null ? null : plain(row.actualLanguage, 64), license: row.license === null ? null : plain(row.license, 256), source: row.source === null ? null : plain(row.source, 2048) });
}
export function eligibleSourceEdition(e: SourceEdition): e is SourceEdition & { actualLanguage: "he" | "en"; license: "Public Domain" | "CC0"; source: string } {
  return (e.actualLanguage === "he" || e.actualLanguage === "en") && !e.versionTitle.includes("|") && (e.license === "Public Domain" || e.license === "CC0") && !!e.source;
}
export function captureEditionChoice(value: unknown): EditionChoice {
  const row = record(value, ["editionCatalogHash", "edition", "language"]), selected = edition(row.edition);
  if (row.language !== "he" && row.language !== "en" || !eligibleSourceEdition(selected) || selected.actualLanguage !== row.language) return fail();
  return Object.freeze({ editionCatalogHash: hash(row.editionCatalogHash), edition: selected, language: row.language });
}
export function captureSourceContent(binding: SourceBinding, supplied: SourceContentTarget) {
  const base = structuredClone(binding.baseline), selected = binding.selection ? structuredClone(binding.selection) : undefined, kind = binding.kind, plan = studyPlan(base, kind, binding.offset), verse = plan.refs[0], target = captureSourceContentTarget(supplied);
  if (!verse || (base.mode === "child-practice") !== !!selected) return stale();
  if (base.context) { const context = record(base.context, ["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"]); if (context.studentId !== base.student.id || context.studentRevision !== base.student.revision || typeof context.expiresAt !== "string" || !Number.isFinite(Date.parse(context.expiresAt))) return stale(); }
  if (selected) { const context = record(selected.context, ["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"]); if (!/^[A-Za-z0-9_-]{43}$/.test(selected.handle) || !base.context || (Object.keys(context) as (keyof typeof base.context)[]).some(key => context[key] !== base.context![key])) return stale(); }
  return Object.freeze({ base, selected, kind, plan, verse, target });
}
export type SourceContentCapture = ReturnType<typeof captureSourceContent>;
function live(c: SourceContentCapture) { if (c.base.context && Date.parse(c.base.context.expiresAt) <= Date.now()) throw new PortalRequestError(404); }
function envelope(raw: unknown, c: SourceContentCapture, payload: "editions" | "text") {
  const lane = c.target.sourceScope === "assigned" ? "expectedSetVersion" : "sourceCatalogHash", row = record(raw, ["ok", "studentId", "studentRevision", "mode", "context", "assignment", "verseRef", "source", lane, payload]);
  if (row.ok !== true || row.studentId !== c.base.student.id || row.studentRevision !== c.base.student.revision || row.mode !== c.base.mode || row.verseRef !== c.verse) return stale();
  const context = c.base.context;
  if (context) { const value = record(row.context, ["id", "authorityRevision", "studentId", "studentRevision", "expiresAt"]); if ((Object.keys(value) as (keyof typeof context)[]).some(k => value[k] !== context[k])) return stale(); } else if (row.context !== null) return stale();
  const a = record(row.assignment, ["id", "revision", "kind", "needsReview"]), expected = c.plan.assignment;
  if (a.id !== expected.id || a.revision !== expected.revision || a.kind !== c.kind || a.needsReview !== expected.needsReview || JSON.stringify(parseSourceCitations([row.source])[0]) !== JSON.stringify(c.target.source)) return stale();
  if (row[lane] !== (c.target.sourceScope === "assigned" ? c.target.expectedSetVersion : c.target.sourceCatalogHash)) return stale();
  live(c); return row[payload];
}
export function parseSourceEditionResponse(raw: unknown, c: SourceContentCapture, supplied: EditionPageRequest): SourceEditionPage {
  const request = captureEditionPage(supplied), row = record(envelope(raw, c, "editions"), ["schema", "workTitle", "editionCatalogHash", "editionOffset", "pageSize", "totalEntries", "receivedRows", "heldCount", "duplicateCount", "nextEditionOffset", "entries"]);
  const total = integer(row.totalEntries, 512), received = integer(row.receivedRows, 512), held = integer(row.heldCount, 512), duplicate = integer(row.duplicateCount, 512), catalog = hash(row.editionCatalogHash), entries = list(row.entries, 10).map(edition), end = Math.min(total, request.editionOffset + 10);
  if (row.schema !== "study-edition-page/v1" || row.workTitle !== c.target.source.indexTitle || row.editionOffset !== request.editionOffset || row.pageSize !== 10 || total + held + duplicate !== received || entries.length !== end - request.editionOffset || request.editionOffset >= total && (request.editionOffset !== 0 || total !== 0) || row.nextEditionOffset !== (end < total ? end : null) || request.editionCatalogHash && request.editionCatalogHash !== catalog) return fail();
  const identities = new Set<string>(); let last = ""; for (const e of entries) { const identity = JSON.stringify([e.versionTitle, e.language]); if (identities.has(identity)) return fail(); identities.add(identity); const key = JSON.stringify([e.versionTitle, e.language, e.actualLanguage, e.license, e.source]); if (key <= last) return fail(); last = key; }
  if (bytes(JSON.stringify(raw)) > 131072) return fail();
  return Object.freeze({ schema: "study-edition-page/v1", workTitle: c.target.source.indexTitle, editionCatalogHash: catalog, editionOffset: request.editionOffset, pageSize: 10, totalEntries: total, receivedRows: received, heldCount: held, duplicateCount: duplicate, nextEditionOffset: end < total ? end : null, entries: Object.freeze(entries) });
}
export function parseSourceTextResponse(raw: unknown, c: SourceContentCapture, supplied: EditionChoice): SourceText {
  const choice = captureEditionChoice(supplied), row = record(envelope(raw, c, "text"), ["schema", "ref", "text", "edition", "provenance"]), e = record(row.edition, ["versionTitle", "language", "actualLanguage"]), p = record(row.provenance, ["provider", "sourceRef", "editionTitle", "license", "versionSource", "format"]), selected = choice.edition;
  if (row.schema !== "study-source-text/v1" || row.ref !== c.target.source.ref || e.versionTitle !== selected.versionTitle || e.language !== selected.language || e.actualLanguage !== choice.language || p.provider !== "Sefaria" || p.sourceRef !== c.target.source.ref || p.editionTitle !== selected.versionTitle || p.license !== selected.license || p.versionSource !== selected.source || p.format !== "text_only") return fail();
  const text = row.text;
  if (typeof text !== "string" || !text.trim() || !text.isWellFormed() || bytes(text) > 65536 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(text) || /&(?:#[0-9]+|#x[a-fA-F0-9]+|[A-Za-z][A-Za-z0-9]+);/.test(text)) return fail();
  if (bytes(JSON.stringify(raw)) > 131072) return fail();
  return Object.freeze({ schema: "study-source-text/v1", ref: c.target.source.ref, text, edition: Object.freeze({ versionTitle: selected.versionTitle, language: selected.language, actualLanguage: choice.language }), provenance: Object.freeze({ provider: "Sefaria", sourceRef: c.target.source.ref, editionTitle: selected.versionTitle, license: selected.license as "Public Domain" | "CC0", versionSource: selected.source!, format: "text_only" }) });
}
export interface SourceContentClient { editions(page: EditionPageRequest, signal: AbortSignal): Promise<SourceEditionPage>; text(choice: EditionChoice, signal: AbortSignal): Promise<SourceText> }
export function createSourceContentClient(binding: SourceBinding, target: SourceContentTarget): SourceContentClient {
  const captured = captureSourceContent(binding, target), { base, plan, kind, verse, selected } = captured;
  async function request<T>(path: string, signal: AbortSignal, parse: (raw: unknown) => T): Promise<T> {
    const budget = createSourceContentBudget(signal, 30000); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, incoming: Response | undefined;
    const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { void body?.cancel().catch(() => {}); } catch {} };
    try {
      return await budget.run(30000, async transportSignal => {
      live(captured); const headers = new Headers({ accept: "application/json" }); if (selected) headers.set("X-Practice-Context", selected.handle);
      incoming = await budget.run(30000, () => fetch(path, { method: "GET", headers, signal: transportSignal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" }), response => cancel(response.body));
      if ([401, 403].includes(incoming.status)) throw new PortalRequestError(incoming.status);
      const type = incoming.headers.get("content-type"), length = incoming.headers.get("content-length");
      if (incoming.redirected || !type || type.length > 128 || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-?8)?$/i.test(type) || !incoming.body || length !== null && (!/^(?:0|[1-9][0-9]{0,8})$/.test(length) || Number(length) > 131072)) return fail();
      reader = incoming.body.getReader(); const buffer = new Uint8Array(131072); let size = 0, empty = 0, progress = performance.now();
      const proto = Object.getPrototypeOf(Uint8Array.prototype), lengthOf = Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!, bufferOf = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!, offsetOf = Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!;
      for (;;) { const remaining = 5000 - (performance.now() - progress); if (remaining <= 0) return fail(); const part = await budget.run(remaining, () => reader!.read()); if (part.done) break;
        if (!(part.value instanceof Uint8Array)) return fail(); const length: number = lengthOf.call(part.value); if (length > buffer.length - size) return fail();
        if (!length) { if (++empty > 64) return fail(); continue; } buffer.set(new Uint8Array(bufferOf.call(part.value), offsetOf.call(part.value), length), size); size += length; empty = 0; progress = performance.now(); }
      const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))); budget.check(); live(captured);
      if (incoming.status !== 200) {
        const error = referenceRecord(raw, ["ok", "error"]), code = error?.ok === false ? error.error : null;
        if (incoming.status === 404) { if (code === "source-not-found") throw new SourceContentError(404, code); throw new PortalRequestError(404); }
        const codes: Record<number, readonly string[]> = { 400: ["invalid-request"], 409: ["stale-revision", "source-set-changed", "source-catalog-changed", "edition-catalog-changed"], 422: ["unsupported-source", "unsupported-edition"], 503: ["unavailable"] };
        if (typeof code !== "string" || !codes[incoming.status]?.includes(code)) return fail(); throw new SourceContentError(incoming.status, code as SourceContentErrorCode);
      }
      const result = parse(raw); budget.check(); live(captured); return result;
      });
    } catch (error) { if (incoming?.status === 404 && !isSourceMissing(error)) throw new PortalRequestError(404); if (error instanceof PortalRequestError) throw error; return fail(); }
    finally { budget.dispose(); if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} } else cancel(incoming?.body); }
  }
  const query = () => new URLSearchParams({ mode: base.mode, kind, assignmentId: identifier(plan.assignment.id), assignmentRevision: String(plan.assignment.revision), verseRef: verse, sourceId: captured.target.source.id, sourceScope: captured.target.sourceScope, ...(captured.target.sourceScope === "assigned" ? { expectedSetVersion: String(captured.target.expectedSetVersion) } : { sourceCatalogHash: captured.target.sourceCatalogHash }) });
  const endpoint = `/api/students/${identifier(base.student.id)}/source-`;
  return Object.freeze({
    editions(input: EditionPageRequest, signal: AbortSignal) { const page = captureEditionPage(input), q = query(); q.set("editionOffset", String(page.editionOffset)); if (page.editionCatalogHash) q.set("editionCatalogHash", page.editionCatalogHash); return request(`${endpoint}editions?${q}`, signal, raw => parseSourceEditionResponse(raw, captured, page)); },
    text(input: EditionChoice, signal: AbortSignal) { const choice = captureEditionChoice(input), q = query(); q.set("editionCatalogHash", choice.editionCatalogHash); q.set("editionTitle", choice.edition.versionTitle); q.set("language", choice.language); return request(`${endpoint}text?${q}`, signal, raw => parseSourceTextResponse(raw, captured, choice)); }
  });
}
