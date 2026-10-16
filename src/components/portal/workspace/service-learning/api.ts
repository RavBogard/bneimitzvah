import { PortalRequestError } from "../../api";
import { identifier, type ReadingMode, type Selection } from "../api";
import type { ServiceBlock, ServiceSpan, ServiceUnitMaterial, ServiceSectionHeading } from "../../../../lib/service-learning/types";

export type ServicePlan = { id: string; revision: number; needsReview: boolean; catalogId: string; catalogIdentity: string; catalogState: "active" | "superseded" | "withdrawn" };
export type UnitSummary = { id: string; name: string; caption?: string; section: ServiceSectionHeading };
export type ServiceMetadata = { state: "no-plan" } | { state: "cleared" | "withdrawn"; plan: ServicePlan } | { state: "assigned"; plan: ServicePlan; units: UnitSummary[] };
export type ServiceUnitResponse = { state: "withdrawn"; plan: ServicePlan } | { state: "assigned"; plan: ServicePlan; material: ServiceUnitMaterial };
export type Catalog = { state: "unknown-slot" | "unavailable" } | { state: "available"; studentRevision: number; ceremonyDate: string; serviceSlot: "morning" | "havdalah"; expectedPlanRevision: number; catalogId: string; catalogIdentity: string; lifecycleRevision: number; units: UnitSummary[] };
export type AvailableCatalog = Extract<Catalog, { state: "available" }>;
export type PreparedServicePlan = { ok: true; binding: string; selectedIds: string[]; clearsPlan: boolean; review: Omit<AvailableCatalog, "state" | "units" | "studentRevision"> & { studentRevision: number }; expiresAt: number };
const bad = (): never => { throw new PortalRequestError(503); };
export function closed(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) return bad();
  return row;
}
function string(value: unknown, max = 16_384): string { if (typeof value !== "string" || value.length > max || !value.isWellFormed()) return bad(); return value; }
function nonempty(value: unknown, max = 128): string { const result = string(value, max); if (!result.trim()) return bad(); return result; }
function integer(value: unknown, min = 1): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > 2_147_483_646) return bad(); return Number(value); }
function digest(value: unknown): string { const result = string(value, 64); if (!/^[a-f0-9]{64}$/.test(result)) return bad(); return result; }
function date(value: unknown): string { const result = string(value, 10), parsed = new Date(`${result}T00:00:00Z`); if (!/^\d{4}-\d\d-\d\d$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) return bad(); return result; }
function slot(value: unknown): "morning" | "havdalah" { if (value !== "morning" && value !== "havdalah") return bad(); return value; }
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) return bad(); return value; }
function unitId(value: unknown): string { const id = nonempty(value); if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)?@(bm-shacharit|bm-maariv)$/.test(id)) return bad(); return id; }
function ids(value: unknown): string[] { const result = array(value, 256).map(unitId); if (new Set(result).size !== result.length) return bad(); return result; }
function section(value: unknown): ServiceSectionHeading {
  const row = closed(value, ["idx"], ["en", "he", "opener"]), out: { idx: number; en?: string | null; he?: string | null; opener?: boolean } = { idx: integer(row.idx, 0) };
  for (const key of ["en", "he"] as const) if (Object.hasOwn(row, key)) out[key] = row[key] === null ? null : string(row[key]);
  if (Object.hasOwn(row, "opener")) { if (typeof row.opener !== "boolean") return bad(); out.opener = row.opener; }
  return out;
}
function summaries(value: unknown): UnitSummary[] {
  const result = array(value, 256).map(value => { const row = closed(value, ["id", "name", "section"], ["caption"]); return { id: unitId(row.id), name: nonempty(row.name, 16_384), section: section(row.section), ...(Object.hasOwn(row, "caption") ? { caption: string(row.caption) } : {}) }; });
  if (new Set(result.map(row => row.id)).size !== result.length) return bad(); return result;
}
function plan(value: unknown): ServicePlan {
  const row = closed(value, ["id", "revision", "needsReview", "catalogId", "catalogIdentity", "catalogState"]);
  if (typeof row.needsReview !== "boolean" || !["active", "superseded", "withdrawn"].includes(String(row.catalogState))) return bad();
  return { id: identifier(row.id), revision: integer(row.revision), needsReview: row.needsReview, catalogId: identifier(row.catalogId), catalogIdentity: digest(row.catalogIdentity), catalogState: row.catalogState as ServicePlan["catalogState"] };
}
export function parseServiceMetadata(value: unknown): ServiceMetadata {
  const state = closed(value, ["state"], ["plan", "units"]).state;
  if (state === "no-plan") { closed(value, ["state"]); return { state }; }
  if (state === "cleared" || state === "withdrawn") { const row = closed(value, ["state", "plan"]); return { state, plan: plan(row.plan) }; }
  if (state !== "assigned") return bad();
  const row = closed(value, ["state", "plan", "units"]), result = { state, plan: plan(row.plan), units: summaries(row.units) } as const;
  if (!result.units.length || result.plan.catalogState === "withdrawn") return bad(); return result;
}
export function parseCatalog(value: unknown): Catalog {
  const state = closed(value, ["state"], ["studentRevision", "ceremonyDate", "serviceSlot", "expectedPlanRevision", "catalogId", "catalogIdentity", "lifecycleRevision", "units"]).state;
  if (state === "unknown-slot" || state === "unavailable") { closed(value, ["state"]); return { state }; }
  if (state !== "available") return bad();
  const row = closed(value, ["state", "studentRevision", "ceremonyDate", "serviceSlot", "expectedPlanRevision", "catalogId", "catalogIdentity", "lifecycleRevision", "units"]), serviceSlot = slot(row.serviceSlot), units = summaries(row.units);
  if (units.some(unit => !unit.id.endsWith(serviceSlot === "morning" ? "@bm-shacharit" : "@bm-maariv"))) return bad();
  return { state, studentRevision: integer(row.studentRevision), ceremonyDate: date(row.ceremonyDate), serviceSlot, expectedPlanRevision: integer(row.expectedPlanRevision, 0), catalogId: identifier(row.catalogId), catalogIdentity: digest(row.catalogIdentity), lifecycleRevision: integer(row.lifecycleRevision), units };
}
export function parsePreparation(value: unknown, catalog: AvailableCatalog, selected: readonly string[]): PreparedServicePlan {
  const row = closed(value, ["ok", "binding", "selectedIds", "clearsPlan", "review", "expiresAt"]), review = closed(row.review, ["studentRevision", "ceremonyDate", "serviceSlot", "catalogId", "catalogIdentity", "lifecycleRevision", "expectedPlanRevision"]);
  const canonical = catalog.units.filter(unit => selected.includes(unit.id)).map(unit => unit.id), received = ids(row.selectedIds);
  if (row.ok !== true || row.clearsPlan !== (received.length === 0) || typeof row.binding !== "string" || row.binding.length > 48_000 || !/^v1\.[A-Za-z0-9_-]+$/.test(row.binding) || canonical.length !== selected.length || JSON.stringify(received) !== JSON.stringify(canonical)) return bad();
  for (const key of Object.keys(review) as (keyof typeof catalog)[]) if (review[key] !== catalog[key]) throw new PortalRequestError(409);
  if (!Number.isSafeInteger(row.expiresAt) || Number(row.expiresAt) <= Date.now()) return bad();
  return { ok: true, binding: row.binding, selectedIds: received, clearsPlan: row.clearsPlan as boolean, review: review as PreparedServicePlan["review"], expiresAt: Number(row.expiresAt) };
}
const blockKinds = ["stanza", "trope", "english", "rubric", "chatimah", "seasonal", "display"];
function material(value: unknown): ServiceUnitMaterial {
  const row = closed(value, ["unit", "section", "license", "source"], ["blockGranularity"]), u = closed(row.unit, ["id", "family", "name", "section", "blocks"], ["caption", "standalone", "render", "group", "shortName", "renderStructure", "renderSegments", "sourceBoundaries"]);
  let nodes = 0;
  function spans(value: unknown, depth = 0): ServiceSpan[] {
    if (depth > 18) return bad();
    return array(value, 512).map(value => { if (++nodes > 20_000) return bad(); const v = closed(value, [], ["t", "em", "strong", "footnote"]), keys = Object.keys(v); if (keys.length !== 1) return bad(); const key = keys[0]; return (key === "t" ? { t: string(v.t) } : { [key]: spans(v[key], depth + 1) }) as ServiceSpan; });
  }
  const blocks = array(u.blocks, 256).map(value => {
    const b = closed(value, ["type"], ["he", "en", "text", "footnote", "role", "label", "verse", "cue", "occasion", "gold", "marks"]);
    if (!blockKinds.includes(String(b.type))) return bad();
    const out: Record<string, unknown> = { type: b.type };
    for (const key of ["he", "label", "verse", "cue", "occasion"]) if (Object.hasOwn(b, key)) out[key] = string(b[key]);
    if (Object.hasOwn(b, "en")) out.en = typeof b.en === "string" ? string(b.en) : spans(b.en);
    for (const key of ["text", "footnote"]) if (Object.hasOwn(b, key)) out[key] = spans(b[key]);
    if (Object.hasOwn(b, "role")) { if (b.role !== "original" || b.type !== "english" || b.en === undefined) return bad(); out.role = b.role; }
    if (Object.hasOwn(b, "gold")) { if (typeof b.gold !== "boolean") return bad(); out.gold = b.gold; }
    if (Object.hasOwn(b, "marks")) out.marks = array(b.marks, 64).map(value => { const mark = closed(value, ["type", "label"]); return { type: nonempty(mark.type, 16_384), label: nonempty(mark.label, 16_384) }; });
    if (b.verse !== undefined && b.label !== undefined && b.verse !== b.label) return bad();
    return out as ServiceBlock;
  });
  const out: Record<string, unknown> = { id: unitId(u.id), name: nonempty(u.name, 16_384), section: integer(u.section, 0), family: u.family, blocks };
  if (u.family !== "bm-shacharit" && u.family !== "bm-maariv" || !String(u.id).endsWith(`@${u.family}`)) return bad();
  for (const key of ["caption", "shortName"]) if (Object.hasOwn(u, key)) out[key] = string(u[key]);
  if (Object.hasOwn(u, "group")) out.group = u.group === null ? null : nonempty(u.group, 16_384);
  if (Object.hasOwn(u, "standalone")) { if (typeof u.standalone !== "boolean") return bad(); out.standalone = u.standalone; }
  if (Object.hasOwn(u, "render")) { if (u.render !== "interleave") return bad(); out.render = u.render; }
  if (Object.hasOwn(u, "renderStructure")) {
    const s = closed(u.renderStructure, ["kind"], ["groups", "rows", "head", "tail", "refrain", "refrainGroups"]), result: Record<string, unknown> = { kind: nonempty(s.kind) };
    if (!["litany", "paired-passages", "paragraphs", "parallel-passages", "refrain-song", "section-close", "section-opening", "section-opening-call", "section-start", "service-event", "short-prayer", "short-sequence", "source-lines", "stanza-groups", "threshold", "title-page"].includes(String(s.kind))) return bad();
    for (const key of ["head", "tail", "refrain"]) if (Object.hasOwn(s, key)) result[key] = integer(s[key], 0);
    for (const key of ["groups", "rows", "refrainGroups"]) if (Object.hasOwn(s, key)) result[key] = key === "rows" && typeof s[key] === "number" ? integer(s[key]) : array(s[key], 256).map(x => integer(x, key === "refrainGroups" ? 0 : 1));
    out.renderStructure = result;
  }
  if (Object.hasOwn(u, "renderSegments")) { const s = closed(u.renderSegments, ["he", "en"]), he = array(s.he, 512).map(x => string(x)), en = array(s.en, 512).map(x => string(x)); if (!he.length || he.length !== en.length || he.join("") !== blocks.map(b => b.he ?? "").join("") || blocks.some(b => b.en !== undefined && typeof b.en !== "string") || en.join("") !== blocks.map(b => b.en ?? "").join("")) return bad(); out.renderSegments = { he, en }; }
  if (Object.hasOwn(u, "sourceBoundaries")) { const s = closed(u.sourceBoundaries, ["en"]), positions = new Map<number, number>(); out.sourceBoundaries = { en: array(s.en, 512).map(value => { const pointer = closed(value, ["block", "endAfter"]), index = integer(pointer.block, 0), anchor = nonempty(pointer.endAfter, 16_384), text = blocks[index]?.en; if (typeof text !== "string" || text.indexOf(anchor) < 0 || text.indexOf(anchor) !== text.lastIndexOf(anchor)) return bad(); const end = text.indexOf(anchor) + anchor.length; if (end >= text.length || end <= (positions.get(index) ?? 0)) return bad(); positions.set(index, end); return { block: index, endAfter: anchor }; }) }; }
  const license = closed(row.license, ["spdx"], ["attribution"]), source = closed(row.source, ["catalogIdentity", "sourceGitSha", "sourceBuiltAt", "artifactCommit", "artifactRunId"]), sectionHeading = section(row.section);
  if (sectionHeading.idx !== out.section || row.blockGranularity !== undefined && row.blockGranularity !== "line" && row.blockGranularity !== "stanza") return bad();
  if (!/^[a-f0-9]{7,40}(?:-LICENSED)?$/.test(string(source.sourceGitSha)) || !/^[a-f0-9]{40}$/.test(string(source.artifactCommit)) || !/^[1-9]\d{0,19}$/.test(string(source.artifactRunId)) || !Number.isFinite(Date.parse(string(source.sourceBuiltAt)))) return bad();
  return { unit: out as unknown as ServiceUnitMaterial["unit"], section: sectionHeading, license: { spdx: nonempty(license.spdx, 16_384), ...(license.attribution === undefined ? {} : { attribution: nonempty(license.attribution, 16_384) }) }, source: { catalogIdentity: digest(source.catalogIdentity), sourceGitSha: String(source.sourceGitSha), sourceBuiltAt: String(source.sourceBuiltAt), artifactCommit: String(source.artifactCommit), artifactRunId: String(source.artifactRunId) }, ...(row.blockGranularity === undefined ? {} : { blockGranularity: row.blockGranularity }) };
}
export function parseServiceUnit(value: unknown, expected: ServicePlan, selected: string): ServiceUnitResponse {
  const row = closed(value, ["state", "plan"], ["material"]), current = plan(row.plan);
  if (current.id !== expected.id || current.revision !== expected.revision || current.catalogId !== expected.catalogId || current.catalogIdentity !== expected.catalogIdentity) throw new PortalRequestError(409);
  if (row.state === "withdrawn") { closed(value, ["state", "plan"]); return { state: "withdrawn", plan: current }; }
  if (row.state !== "assigned" || current.catalogState === "withdrawn") return bad(); closed(value, ["state", "plan", "material"]);
  const result = material(row.material); if (result.unit.id !== selected || result.source.catalogIdentity !== current.catalogIdentity) return bad();
  return { state: "assigned", plan: current, material: result };
}
async function request(mode: ReadingMode, studentId: string, action: "metadata" | "unit" | "catalog" | "prepare" | "confirm", body: Record<string, unknown> | undefined, signal: AbortSignal, selection?: Selection): Promise<unknown> {
  if (!["student", "parent", "tutor", "admin", "child-practice"].includes(mode) || action !== "metadata" && action !== "unit" && mode !== "admin" && mode !== "tutor") return bad();
  const id = identifier(studentId);
  if (mode === "child-practice" && (!selection || selection.context.studentId !== id || Date.parse(selection.context.expiresAt) <= Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(selection.handle))) return bad();
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 12_000);
  const headers = new Headers({ accept: "application/json" });
  if (action !== "metadata") headers.set("content-type", "application/json");
  if (mode === "child-practice") headers.set("X-Practice-Context", selection!.handle);
  try {
    const path = `/api/students/${id}/service-plan${action === "metadata" ? `?mode=${mode}` : `/${action}`}`;
    const response = await fetch(path, { method: action === "metadata" ? "GET" : "POST", body: action === "metadata" ? undefined : JSON.stringify({ mode, ...body }), headers, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new PortalRequestError(response.status);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const reader = response.body?.getReader(); if (!reader) return bad(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 256 * 1024) { await reader.cancel(); return bad(); } chunks.push(next.value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    if (controller.signal.aborted) throw new PortalRequestError(409);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
export const serviceApi = {
  async metadata(mode: ReadingMode, id: string, signal: AbortSignal, selection?: Selection) { return parseServiceMetadata(await request(mode, id, "metadata", undefined, signal, selection)); },
  async unit(mode: ReadingMode, id: string, expected: ServicePlan, selected: string, signal: AbortSignal, selection?: Selection) { return parseServiceUnit(await request(mode, id, "unit", { planId: expected.id, planRevision: expected.revision, catalogIdentity: expected.catalogIdentity, unitId: selected }, signal, selection), expected, selected); },
  async catalog(mode: "admin" | "tutor", id: string, signal: AbortSignal) { return parseCatalog(await request(mode, id, "catalog", {}, signal)); },
  async prepare(mode: "admin" | "tutor", id: string, catalog: AvailableCatalog, selectedIds: string[], signal: AbortSignal) { return parsePreparation(await request(mode, id, "prepare", { expectedStudentRevision: catalog.studentRevision, expectedPlanRevision: catalog.expectedPlanRevision, catalogId: catalog.catalogId, catalogIdentity: catalog.catalogIdentity, selectedIds }, signal), catalog, selectedIds); },
  async confirm(mode: "admin" | "tutor", id: string, binding: string, signal: AbortSignal) { const row = closed(await request(mode, id, "confirm", { binding }, signal), ["ok", "planId", "revision", "cleared"]); if (row.ok !== true || typeof row.cleared !== "boolean") return bad(); return { planId: identifier(row.planId), revision: integer(row.revision), cleared: row.cleared }; },
};
export const servicePlanKey = (value: ServiceMetadata | null) => !value ? "" : value.state === "no-plan" ? "no-plan" : JSON.stringify([value.state, value.plan.id, value.plan.revision, value.plan.catalogIdentity, value.plan.catalogState, value.plan.needsReview]);
