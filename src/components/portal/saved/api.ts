/**
 * The browser side of a member's own saved readings (Release 1.4). Same-origin, cookie session,
 * no-store and bounded, like requestPortal, but kept apart from the signed-out reading's public
 * client: nothing here runs until the member asks for it, so /read still never asks for a session
 * on its own. Every answer is parsed strictly; anything unexpected is a plain failure.
 */
export type SavedKind = "torah" | "haftarah";
export type SavedReading = Readonly<{ id: string; name: string; date: string | null; kind: SavedKind; ranges: string; verseCount: number; revision: number }>;
/** What the list tells the client about its own account: signed out, not eligible, or its readings. */
export type SavedList = Readonly<{ state: "signed-out" } | { state: "not-eligible" } | { state: "ready"; readings: readonly SavedReading[] }>;
export type SaveResult = Readonly<{ ok: true; reading: SavedReading } | { ok: false; code: "signed-out" | "not-eligible" | "limit" | "invalid" | "unavailable" }>;

export class SavedRequestError extends Error {
  constructor(readonly status: number) { super("Saved readings unavailable"); this.name = "SavedRequestError"; }
}
const LIMIT = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Printable ASCII ranges as the server stores them (the 1.3 ref contract); names are the member's own words.
const RANGES = /^[\x20-\x7e]{1,1000}$/;
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

async function request(path: "/api/saved/readings" | "/api/saved/readings/create", body?: Record<string, unknown>, signal?: AbortSignal) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      signal: controller.signal, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const status = [200, 400, 401, 403, 409].includes(response.status) ? response.status : 503;
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) return { status: status === 200 ? 503 : status, value: null };
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > LIMIT) { await reader.cancel(); return { status: 503, value: null }; }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown = null;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return { status: 503, value: null }; }
    return { status, value };
  } catch { return { status: 503, value: null }; }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const own = Object.keys(value);
  return own.length === keys.length && own.every(key => keys.includes(key)) ? value as Record<string, unknown> : null;
}
/** One saved reading as the server describes it, or null. */
export function parseSavedReading(value: unknown): SavedReading | null {
  const row = record(value, ["id", "name", "date", "kind", "ranges", "verseCount", "revision", "createdAt", "updatedAt"]);
  if (!row || typeof row.id !== "string" || !UUID.test(row.id) || typeof row.name !== "string" || !row.name.trim() || Array.from(row.name).length > 80 || CONTROLS.test(row.name)
    || (row.date !== null && (typeof row.date !== "string" || !DATE.test(row.date))) || (row.kind !== "torah" && row.kind !== "haftarah")
    || typeof row.ranges !== "string" || !RANGES.test(row.ranges) || !Number.isSafeInteger(row.verseCount) || (row.verseCount as number) < 1 || (row.verseCount as number) > 1000
    || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1 || typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") return null;
  return Object.freeze({ id: row.id, name: row.name, date: row.date as string | null, kind: row.kind, ranges: row.ranges, verseCount: row.verseCount as number, revision: row.revision as number });
}
export function parseSavedList(status: number, value: unknown): SavedList {
  if (status === 401) return { state: "signed-out" };
  if (status === 403) return { state: "not-eligible" };
  const row = status === 200 ? record(value, ["ok", "readings"]) : null;
  if (!row || row.ok !== true || !Array.isArray(row.readings) || row.readings.length > 100) throw new SavedRequestError(503);
  const readings = row.readings.map(parseSavedReading);
  if (readings.some(reading => reading === null) || new Set(readings.map(reading => reading!.id)).size !== readings.length) throw new SavedRequestError(503);
  return { state: "ready", readings: Object.freeze(readings as SavedReading[]) };
}
export function parseSaveResult(status: number, value: unknown): SaveResult {
  if (status === 401) return { ok: false, code: "signed-out" };
  if (status === 403) return { ok: false, code: "not-eligible" };
  if (status === 400) return { ok: false, code: "invalid" };
  if (status === 409) { const row = record(value, ["ok", "code"]); return { ok: false, code: row?.code === "limit" ? "limit" : "unavailable" }; }
  const row = status === 200 ? record(value, ["ok", "reading"]) : null, reading = row?.ok === true ? parseSavedReading(row.reading) : null;
  return reading ? { ok: true, reading } : { ok: false, code: "unavailable" };
}

/** The member's own readings, newest date first; signed out and not eligible are answers, not errors. */
export async function fetchSavedReadings(signal?: AbortSignal): Promise<SavedList> {
  const { status, value } = await request("/api/saved/readings", undefined, signal);
  return parseSavedList(status, value);
}
export async function createSavedReading(input: { name: string; date: string | null; kind: SavedKind; ranges: string }, signal?: AbortSignal): Promise<SaveResult> {
  const { status, value } = await request("/api/saved/readings/create", { name: input.name, date: input.date, kind: input.kind, ranges: input.ranges }, signal);
  return parseSaveResult(status, value);
}
