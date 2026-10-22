import { PortalRequestError } from "../../api";
import { parseStudyContent, studyRangePlan, type StudyPage } from "../study/api";
import { parseReferenceShortResolution, type ReferenceShortResolution } from "../../../../lib/reference-audio/short-resolution";
import { LISTENING_REASONS, LISTENING_SETS, LISTENING_SOURCES, listeningNote, type ListeningItem, type ListeningReason, type ListeningSet, type ListeningSource } from "../../../../lib/listening-review/sample";

export type Verdict = { verdict: "pass" | "needs-work"; reasons: ListeningReason[]; note: string | null; latencyMs: number | null; asset: string; at: string };
export type OverviewItem = ListeningItem & { available: boolean; verdict: Verdict | null };
export type Tally = { source: ListeningSource; set: ListeningSet; items: number; heard: number; pass: number; needsWork: number; wouldTeachWrong: number };
export type Overview = { sampleVersion: string; items: OverviewItem[]; tallies: Tally[]; comparison: { passRate: number; wouldTeachWrong: number } };
export type ItemView = { item: ListeningItem; page: StudyPage; reference: ReferenceShortResolution | null };
export type RecordOutcome = { ok: true; verdict: Verdict } | { ok: false; code: "conflict" | "invalid" | "unavailable" | "changed" };

const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10000 ? value as number : bad();
const short = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f<>]/.test(value) ? value : bad();

function parseItem(value: unknown): ListeningItem {
  const row = object(value, ["id", "source", "set", "kind", "ref", "why"]);
  if (typeof row.id !== "string" || !/^[a-z]{2}-[a-z0-9-]{1,60}$/.test(row.id) || !(LISTENING_SOURCES as readonly unknown[]).includes(row.source) || !(LISTENING_SETS as readonly unknown[]).includes(row.set)
    || (row.kind !== "torah" && row.kind !== "haftarah")) return bad();
  return { id: row.id, source: row.source as ListeningSource, set: row.set as ListeningSet, kind: row.kind, ref: short(row.ref, 64), why: short(row.why, 200) };
}
export function parseVerdict(value: unknown): Verdict {
  const row = object(value, ["verdict", "reasons", "note", "latencyMs", "asset", "at"]);
  if ((row.verdict !== "pass" && row.verdict !== "needs-work") || !Array.isArray(row.reasons) || row.reasons.some(r => !(LISTENING_REASONS as readonly unknown[]).includes(r))) return bad();
  const note = row.note === null ? null : listeningNote(row.note); if (note === undefined) return bad();
  if (row.latencyMs !== null && (!Number.isSafeInteger(row.latencyMs) || (row.latencyMs as number) < 0 || (row.latencyMs as number) > 60000)) return bad();
  if (typeof row.asset !== "string" || !/^[a-z]{2}_[a-f0-9]{20,64}$/.test(row.asset) || typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at))) return bad();
  return { verdict: row.verdict, reasons: row.reasons as ListeningReason[], note, latencyMs: row.latencyMs as number | null, asset: row.asset, at: row.at };
}
export function parseOverview(value: unknown): Overview {
  const view = object(object(value, ["ok", "overview"]).overview, ["sampleVersion", "items", "tallies", "comparison"]);
  if (!Array.isArray(view.items) || view.items.length > 200 || !Array.isArray(view.tallies) || view.tallies.length > LISTENING_SOURCES.length * LISTENING_SETS.length) return bad();
  const items = view.items.map((raw): OverviewItem => {
    const row = object(raw, ["id", "source", "set", "kind", "ref", "why", "available", "verdict"]);
    const { available, verdict, ...rest } = row; if (typeof available !== "boolean") return bad();
    return { ...parseItem(rest), available, verdict: verdict === null ? null : parseVerdict(verdict) };
  });
  const tallies = view.tallies.map((raw): Tally => {
    const row = object(raw, ["source", "set", "items", "heard", "pass", "needsWork", "wouldTeachWrong"]);
    if (!(LISTENING_SOURCES as readonly unknown[]).includes(row.source) || !(LISTENING_SETS as readonly unknown[]).includes(row.set)) return bad();
    return { source: row.source as ListeningSource, set: row.set as ListeningSet, items: count(row.items), heard: count(row.heard), pass: count(row.pass), needsWork: count(row.needsWork), wouldTeachWrong: count(row.wouldTeachWrong) };
  });
  const comparison = object(view.comparison, ["passRate", "wouldTeachWrong"]);
  if (typeof comparison.passRate !== "number" || comparison.passRate <= 0 || comparison.passRate > 1) return bad();
  return { sampleVersion: short(view.sampleVersion, 40), items, tallies, comparison: { passRate: comparison.passRate, wouldTeachWrong: count(comparison.wouldTeachWrong) } };
}
export function parseItemView(value: unknown, expected: string): ItemView {
  const row = object(value, ["ok", "item", "page", "reference"]), item = parseItem(row.item); if (row.ok !== true || item.id !== expected) return bad();
  const page = parseStudyContent(object(row.page, ["offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]), studyRangePlan([item.ref], item.kind, 0), 0, 1);
  const reference = row.reference === null ? null : parseReferenceShortResolution(row.reference);
  if (row.reference !== null && (!reference?.source || reference.verse.ref !== item.ref)) return bad();
  return { item, page, reference };
}

async function request(path: string, body?: object, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 25_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    if (!response.ok && response.status !== 409) throw new PortalRequestError([400, 401, 403, 404, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const text = await response.text(); if (text.length > 512 * 1024) return bad();
    return { status: response.status, value: JSON.parse(text) };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export const listeningApi = {
  async overview(signal?: AbortSignal) { return parseOverview((await request("/api/admin/listening-review", undefined, signal)).value); },
  async item(id: string, signal?: AbortSignal) {
    if (!/^[a-z]{2}-[a-z0-9-]{1,60}$/.test(id)) return bad();
    const result = await request(`/api/admin/listening-review/items/${id}`, undefined, signal); if (result.status !== 200) return bad();
    return parseItemView(result.value, id);
  },
  async record(input: { itemId: string; verdict: "pass" | "needs-work"; reasons: ListeningReason[]; note: string | null; latencyMs: number | null; asset: string; mutationId: string }): Promise<RecordOutcome> {
    const result = await request("/api/admin/listening-review/verdicts", input);
    if (result.status === 200) { const row = object(result.value, ["ok", "replayed", "verdict"]); if (row.ok !== true || typeof row.replayed !== "boolean") return bad(); return { ok: true, verdict: parseVerdict(row.verdict) }; }
    const row = object(result.value, ["ok", "code"]);
    if (row.ok !== false || !["conflict", "invalid", "unavailable", "changed"].includes(String(row.code))) return bad();
    return { ok: false, code: row.code as "conflict" | "invalid" | "unavailable" | "changed" };
  },
};
