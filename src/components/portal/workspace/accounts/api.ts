import { PortalRequestError } from "../../api";

/** Release 1.4 approvers' client: the request queue, members and approvers. Strict parsing; anything odd is a plain failure. */
export type ApproverMode = "admin" | "tutor";
export type AccountRequest = Readonly<{ id: string; name: string; purpose: string | null; email: string | null; requestedAt: string }>;
export type Member = Readonly<{ id: string; name: string; since: string }>;
export type ApproversView = Readonly<{ admins: readonly string[]; designated: readonly Readonly<{ id: string; name: string }>[]; candidates: readonly Readonly<{ tutorGrantId: string; name: string }>[] }>;
export type DecisionResult = Readonly<{ ok: true } | { ok: false; code: "disabled" }>;
export type DesignationResult = Readonly<{ ok: true } | { ok: false; code: "admin" | "designated" }>;

const bad = (): never => { throw new PortalRequestError(503); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && Array.from(value).length <= max && !CONTROLS.test(value) ? value : bad();
const id = (value: unknown) => typeof value === "string" && UUID.test(value) ? value : bad();
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : bad();
const email = (value: unknown) => value === null ? null : typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value) ? value : bad();

async function request(path: string, body?: object, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    // A refused decision (409) carries its reason; every other failure is only a status.
    if (!response.ok && response.status !== 409) throw new PortalRequestError([400, 401, 403, 404, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const raw = await response.text(); if (raw.length > 256 * 1024) return bad();
    return { status: response.status, value: JSON.parse(raw) };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
const refusal = <C extends string>(value: unknown, codes: readonly C[]): { ok: false; code: C } => {
  const row = object(value, ["ok", "code"]);
  return row.ok === false && codes.includes(row.code as C) ? { ok: false, code: row.code as C } : bad();
};

export function parseRequests(value: unknown): readonly AccountRequest[] {
  const row = object(value, ["ok", "requests"]);
  if (row.ok !== true || !Array.isArray(row.requests) || row.requests.length > 50) return bad();
  return row.requests.map(raw => { const item = object(raw, ["id", "name", "purpose", "email", "requestedAt"]);
    return { id: id(item.id), name: text(item.name, 80), purpose: item.purpose === null ? null : text(item.purpose, 500), email: email(item.email), requestedAt: instant(item.requestedAt) }; });
}
export function parseMembers(value: unknown): readonly Member[] {
  const row = object(value, ["ok", "members"]);
  if (row.ok !== true || !Array.isArray(row.members) || row.members.length > 500) return bad();
  return row.members.map(raw => { const item = object(raw, ["id", "name", "since"]); return { id: id(item.id), name: text(item.name, 80), since: instant(item.since) }; });
}
export function parseApprovers(value: unknown): ApproversView {
  const row = object(value, ["ok", "admins", "designated", "candidates"]);
  if (row.ok !== true || !Array.isArray(row.admins) || !Array.isArray(row.designated) || !Array.isArray(row.candidates) || row.admins.length > 100 || row.designated.length > 100 || row.candidates.length > 200) return bad();
  return { admins: row.admins.map(name => text(name, 80)),
    designated: row.designated.map(raw => { const item = object(raw, ["id", "name"]); return { id: id(item.id), name: text(item.name, 80) }; }),
    candidates: row.candidates.map(raw => { const item = object(raw, ["tutorGrantId", "name"]); return { tutorGrantId: id(item.tutorGrantId), name: text(item.name, 80) }; }) };
}
export function parseSummary(value: unknown): number {
  const row = object(value, ["ok", "requests"]);
  return row.ok === true && Number.isSafeInteger(row.requests) && (row.requests as number) >= 0 && (row.requests as number) <= 50 ? row.requests as number : bad();
}
const done = (value: unknown, keys: readonly string[] = ["ok"]) => object(value, keys).ok === true ? { ok: true as const } : bad();

export const accountsApi = {
  async summary(mode: ApproverMode, signal?: AbortSignal) { return parseSummary((await request(`/api/accounts/summary?mode=${mode}`, undefined, signal)).value); },
  async requests(mode: ApproverMode, signal?: AbortSignal) { return parseRequests((await request(`/api/accounts/requests?mode=${mode}`, undefined, signal)).value); },
  async approve(mode: ApproverMode, requestId: string): Promise<DecisionResult> {
    const { status, value } = await request("/api/accounts/requests/approve", { mode, requestId });
    return status === 409 ? refusal(value, ["disabled"] as const) : done(value, ["ok", "memberId"]);
  },
  async decline(mode: ApproverMode, requestId: string): Promise<DecisionResult> { return done((await request("/api/accounts/requests/decline", { mode, requestId })).value); },
  async members(signal?: AbortSignal) { return parseMembers((await request("/api/accounts/members", undefined, signal)).value); },
  async endMember(memberId: string) { return done((await request("/api/accounts/members/end", { memberId })).value); },
  async approvers(signal?: AbortSignal) { return parseApprovers((await request("/api/accounts/approvers", undefined, signal)).value); },
  async addApprover(tutorGrantId: string): Promise<DesignationResult> {
    const { status, value } = await request("/api/accounts/approvers/add", { tutorGrantId });
    return status === 409 ? refusal(value, ["admin", "designated"] as const) : done(value, ["ok", "approverId"]);
  },
  async removeApprover(approverId: string) { return done((await request("/api/accounts/approvers/remove", { approverId })).value); },
};
