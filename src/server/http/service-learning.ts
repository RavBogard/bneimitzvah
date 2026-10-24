import "server-only";
import type { HttpRuntime } from "../runtime/composition";
import type { ActiveMode } from "../access/types";
import type { ServiceUnitMaterial, ServiceSpan, ServiceSectionHeading } from "../../lib/service-learning/types";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

function route(path: string) {
  const match = /^\/api\/students\/([^/]+)\/service-plan(?:\/(catalog|prepare|confirm|unit))?$/.exec(path);
  return match ? { studentId: match[1], operation: match[2] ?? "metadata" } : null;
}
export function serviceLearningRouteMethods(path: string): readonly string[] | null {
  const found = route(path); return found ? [found.operation === "metadata" ? "GET" : "POST"] : null;
}
function mode(value: unknown, staff: boolean): ActiveMode | "child-practice" {
  if (typeof value !== "string" || !(staff ? ["admin", "tutor"] : ["admin", "tutor", "student", "parent", "child-practice"]).includes(value)) throw new HttpBoundaryError();
  return value as ActiveMode | "child-practice";
}
function integer(value: unknown, zero = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > 2_147_483_646) throw new HttpBoundaryError();
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new HttpBoundaryError();
  return value;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new HttpBoundaryError(); return value;
}
function unitId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) throw new HttpBoundaryError(); return value;
}
function selectedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256) throw new HttpBoundaryError();
  const ids = value.map(unitId);
  if (new Set(ids).size !== ids.length || Buffer.byteLength(JSON.stringify(ids)) > 16_384) throw new HttpBoundaryError();
  return ids;
}
// Copy reviewed public fields rather than serializing domain/database objects.
// Neither a new internal field nor a source-only coordinate gains wire access.
function pick(value: object, keys: readonly string[]): { [key: string]: JsonValue } {
  const out: { [key: string]: JsonValue } = {};
  for (const key of keys) if (Object.hasOwn(value, key)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !("value" in field) || field.value === undefined) throw new Error("Service projection unavailable");
    out[key] = field.value as JsonValue;
  }
  return out;
}
function spans(value: readonly ServiceSpan[]): JsonValue[] {
  return value.map((span): JsonValue => "t" in span ? { t: span.t } : "em" in span ? { em: spans(span.em) } : "strong" in span ? { strong: spans(span.strong) } : { footnote: spans(span.footnote) });
}
const section = (value: ServiceSectionHeading) => pick(value, ["idx", "en", "he", "opener"]);
export function material(value: ServiceUnitMaterial): JsonValue {
  const unit = pick(value.unit, ["id", "family", "name", "section", "caption", "standalone", "render", "group", "shortName"]);
  unit.blocks = value.unit.blocks.map(block => {
    const out = pick(block, ["type", "he", "role", "label", "verse", "cue", "occasion", "gold"]);
    if (block.en !== undefined) out.en = typeof block.en === "string" ? block.en : spans(block.en);
    if (block.text !== undefined) out.text = spans(block.text);
    if (block.footnote !== undefined) out.footnote = spans(block.footnote);
    if (block.marks !== undefined) out.marks = block.marks.map(mark => ({ type: mark.type, label: mark.label }));
    return out;
  });
  if (value.unit.renderStructure !== undefined) unit.renderStructure = pick(value.unit.renderStructure, ["kind", "groups", "rows", "head", "tail", "refrain", "refrainGroups"]);
  if (value.unit.renderSegments !== undefined) unit.renderSegments = { he: [...value.unit.renderSegments.he], en: [...value.unit.renderSegments.en] };
  if (value.unit.sourceBoundaries !== undefined) unit.sourceBoundaries = { en: value.unit.sourceBoundaries.en.map(row => ({ block: row.block, endAfter: row.endAfter })) };
  return { unit, section: section(value.section), license: pick(value.license, ["spdx", "attribution"]),
    source: pick(value.source, ["catalogIdentity", "sourceGitSha", "sourceBuiltAt", "artifactCommit", "artifactRunId"]),
    ...(value.blockGranularity === undefined ? {} : { blockGranularity: value.blockGranularity }) };
}
type Service = HttpRuntime["serviceLearning"];
type Plan = NonNullable<Awaited<ReturnType<Service["metadata"]>> extends infer R ? R extends { plan: infer P } ? P : never : never>;
const plan = (value: Plan) => pick(value, ["id", "revision", "needsReview", "catalogId", "catalogIdentity", "catalogState"]);
type Summary = { id: string; name: string; caption?: string; section: ServiceSectionHeading; page?: number };
const summary = (value: Summary) => ({ ...pick(value, ["id", "name", "caption"]), section: section(value.section), ...pick(value, ["page"]) });

export async function handleServiceLearningRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const found = route(new URL(request.url).pathname); if (!found) return null;
  try {
    const methods = serviceLearningRouteMethods(new URL(request.url).pathname)!;
    if (!methods.includes(request.method)) { const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", methods.join(", ")); return response; }
    const query = uniqueQuery(request.url, found.operation === "metadata" ? ["mode"] : []);
    const studentId = uuid(found.studentId), staff = ["catalog", "prepare", "confirm"].includes(found.operation);
    if (staff && request.headers.has("X-Practice-Context")) throw new HttpBoundaryError();
    let output: JsonValue;
    if (found.operation === "metadata") {
      const result = await runtime.serviceLearning.metadata(request, { studentId, mode: mode(query.get("mode"), false) });
      if (result.state === "stale") return privateJson({ ok: false, code: "stale-revision" }, 409);
      output = result.state === "no-plan" ? { state: result.state } : result.state === "assigned" ? { state: result.state, plan: plan(result.plan), units: result.units.map(summary), ...pick(result, ["serviceStart"]) } : { state: result.state, plan: plan(result.plan) };
    } else {
      requireCookieMutation(request, runtime.origin);
      const operation = found.operation;
      const required = operation === "catalog" ? ["mode"] : operation === "prepare" ? ["mode", "expectedStudentRevision", "expectedPlanRevision", "catalogId", "catalogIdentity", "selectedIds"] : operation === "confirm" ? ["mode", "binding"] : ["mode", "planId", "planRevision", "catalogIdentity", "unitId"];
      const body = closedObject(await readJsonBody(request, operation === "confirm" ? "binding" : operation === "prepare" ? "work" : "ordinary"), required);
      const selection = { studentId, mode: mode(body.mode, staff) };
      if (operation === "catalog") {
        const result = await runtime.serviceLearning.catalog(request, { ...selection, mode: selection.mode as ActiveMode });
        output = result.state !== "available" ? { state: result.state } : { state: result.state,
          ...pick(result, ["studentRevision", "ceremonyDate", "serviceSlot", "expectedPlanRevision", "catalogId", "catalogIdentity", "lifecycleRevision"]), units: result.units.map(summary), defaults: [...result.defaults] };
      } else if (operation === "prepare") {
        const result = await runtime.serviceLearning.prepare(request, { ...selection, mode: selection.mode as ActiveMode, expectedStudentRevision: integer(body.expectedStudentRevision), expectedPlanRevision: integer(body.expectedPlanRevision, true), catalogId: uuid(body.catalogId), catalogIdentity: identity(body.catalogIdentity), selectedIds: selectedIds(body.selectedIds) });
        if (!result.ok) return privateJson({ ok: false, code: "stale-revision" }, 409);
        output = { ok: true, binding: result.binding, expiresAt: result.expiresAt, selectedIds: [...result.selectedIds], clearsPlan: result.clearsPlan,
          review: pick(result.review, ["studentRevision", "ceremonyDate", "serviceSlot", "catalogId", "catalogIdentity", "lifecycleRevision", "expectedPlanRevision"]) };
      } else if (operation === "confirm") {
        if (typeof body.binding !== "string" || body.binding.length > 48_000 || !/^v1\.[A-Za-z0-9_-]+$/.test(body.binding)) throw new HttpBoundaryError();
        const result = await runtime.serviceLearning.confirm(request, { ...selection, mode: selection.mode as ActiveMode, binding: body.binding });
        if (!result.ok) return privateJson({ ok: false, code: "stale-revision" }, 409);
        output = { ok: true, planId: result.planId, revision: result.revision, cleared: result.cleared };
      } else {
        const result = await runtime.serviceLearning.unit(request, { ...selection, planId: uuid(body.planId), planRevision: integer(body.planRevision), catalogIdentity: identity(body.catalogIdentity), unitId: unitId(body.unitId) });
        if (result.state === "stale") return privateJson({ ok: false, code: "stale-revision" }, 409);
        output = result.state === "assigned" ? { state: result.state, plan: plan(result.plan), material: material(result.material) } : { state: result.state, plan: plan(result.plan) };
      }
    }
    if (Buffer.byteLength(JSON.stringify(output)) > 256 * 1024) throw new Error("Service projection unavailable");
    return privateJson(output);
  } catch (error) { return errorResponse(error); }
}
