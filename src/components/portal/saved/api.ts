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

type SavedPath = "/api/saved/readings" | "/api/saved/readings/create" | "/api/saved/readings/update" | "/api/saved/readings/remove" | "/api/saved/reading" | "/api/saved/mark"
  | "/api/saved/work" | "/api/saved/stars" | "/api/saved/star";
async function request(path: SavedPath, body?: Record<string, unknown>, signal?: AbortSignal, search = "") {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path + search, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      signal: controller.signal, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const status = [200, 400, 401, 403, 404, 409].includes(response.status) ? response.status : 503;
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

/** One verse of a saved reading as the member keeps it. Translation and note are read here; PR 3's Yours row writes them. */
export type SavedMark = Readonly<{ state: "unmarked" | "working" | "got-it"; version: number }>;
export type SavedWork = Readonly<{ text: string; version: number }>;
export type SavedVerse = Readonly<{ ref: string; translation: SavedWork | null; note: SavedWork | null; mark: SavedMark | null }>;
export type SavedPage = Readonly<{ state: "ready"; reading: SavedReading; offset: number; totalVerses: number; nextOffset: number | null; verses: readonly SavedVerse[] }>
  | Readonly<{ state: "signed-out" } | { state: "not-eligible" } | { state: "missing" }>;
const VERSE = /^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/;
function parseMark(value: unknown): SavedMark {
  const row = record(value, ["state", "version", "updatedAt"]);
  if (!row || (row.state !== "unmarked" && row.state !== "working" && row.state !== "got-it") || !Number.isSafeInteger(row.version) || (row.version as number) < 1 || typeof row.updatedAt !== "string") throw new SavedRequestError(503);
  return Object.freeze({ state: row.state, version: row.version as number });
}
function parseWork(value: unknown): SavedWork {
  const row = record(value, ["text", "version", "updatedAt"]);
  if (!row || typeof row.text !== "string" || row.text.length > 4096 || !Number.isSafeInteger(row.version) || (row.version as number) < 1 || typeof row.updatedAt !== "string") throw new SavedRequestError(503);
  return Object.freeze({ text: row.text, version: row.version as number });
}
export function parseSavedPage(status: number, value: unknown, offset: number): SavedPage {
  if (status === 401) return { state: "signed-out" };
  if (status === 403) return { state: "not-eligible" };
  if (status === 404) return { state: "missing" };
  const row = status === 200 ? record(value, ["ok", "reading", "offset", "totalVerses", "nextOffset", "verses"]) : null, reading = row?.ok === true ? parseSavedReading(row.reading) : null;
  if (!row || !reading || row.offset !== offset || row.totalVerses !== reading.verseCount || !Array.isArray(row.verses) || row.verses.length < 1 || row.verses.length > 10
    || (row.nextOffset !== null && row.nextOffset !== offset + row.verses.length)) throw new SavedRequestError(503);
  const verses = row.verses.map(item => {
    const verse = record(item, ["ref", "translation", "note", "mark"]);
    if (!verse || typeof verse.ref !== "string" || !VERSE.test(verse.ref)) throw new SavedRequestError(503);
    return Object.freeze({ ref: verse.ref, translation: verse.translation === null ? null : parseWork(verse.translation), note: verse.note === null ? null : parseWork(verse.note),
      mark: verse.mark === null ? null : parseMark(verse.mark) });
  });
  return Object.freeze({ state: "ready" as const, reading, offset, totalVerses: reading.verseCount, nextOffset: row.nextOffset as number | null, verses: Object.freeze(verses) });
}
/** A page of up to ten verses of one saved reading, with the member's marks. */
export async function fetchSavedPage(id: string, offset: number, signal?: AbortSignal): Promise<SavedPage> {
  if (!UUID.test(id) || !Number.isSafeInteger(offset) || offset < 0 || offset > 999) throw new SavedRequestError(400);
  const search = new URLSearchParams(offset ? [["id", id], ["offset", String(offset)]] : [["id", id]]).toString();
  const { status, value } = await request("/api/saved/reading", undefined, signal, `?${search}`);
  return parseSavedPage(status, value, offset);
}
export type ChangeResult<T> = Readonly<{ ok: true; value: T } | { ok: false; code: "signed-out" | "not-eligible" | "missing" | "invalid" | "limit" | "unavailable" } | { ok: false; code: "conflict"; current: unknown }>;
function change<T>(status: number, value: unknown, key: string, parse: (item: unknown) => T | null): ChangeResult<T> {
  if (status === 401) return { ok: false, code: "signed-out" };
  if (status === 403) return { ok: false, code: "not-eligible" };
  if (status === 404) return { ok: false, code: "missing" };
  if (status === 400) return { ok: false, code: "invalid" };
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (status === 409) return row?.ok === false && row.code === "conflict" ? { ok: false, code: "conflict", current: row.current } : { ok: false, code: row?.ok === false && row.code === "limit" ? "limit" : "unavailable" };
  try { const parsed = status === 200 && row?.ok === true ? parse(row[key]) : null; return parsed === null ? { ok: false, code: "unavailable" } : { ok: true, value: parsed }; }
  catch { return { ok: false, code: "unavailable" }; }
}
export async function updateSavedReading(input: { id: string; revision: number; name: string; date: string | null }, signal?: AbortSignal): Promise<ChangeResult<SavedReading>> {
  const { status, value } = await request("/api/saved/readings/update", { id: input.id, revision: input.revision, name: input.name, date: input.date }, signal);
  return change(status, value, "reading", parseSavedReading);
}
export async function removeSavedReading(input: { id: string; revision: number }, signal?: AbortSignal): Promise<ChangeResult<string>> {
  const { status, value } = await request("/api/saved/readings/remove", { id: input.id, revision: input.revision }, signal);
  return change(status, value, "removed", item => item === input.id ? input.id : null);
}
export async function setSavedMark(input: { readingId: string; verseRef: string; expectedVersion: number; state: SavedMark["state"] }, signal?: AbortSignal): Promise<ChangeResult<SavedMark>> {
  const { status, value } = await request("/api/saved/mark", { readingId: input.readingId, verseRef: input.verseRef, expectedVersion: input.expectedVersion, state: input.state }, signal);
  return change(status, value, "mark", parseMark);
}
/** A mark conflict's current mark: null when none is saved yet, undefined when the answer is not a mark. */
export function conflictMark(current: unknown): SavedMark | null | undefined {
  if (current === null) return null;
  try { return parseMark(current); } catch { return undefined; }
}

/** The bound the server keeps on a translation or note: 4,096 bytes of UTF-8, carriage returns read as newlines. */
export const SAVED_TEXT_BYTES = 4096;
const TEXT_CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/;
/** The text as the server would keep it, or null when it is too long or holds a character the server refuses. */
export function savedText(value: string): string | null {
  const normalized = value.replace(/\r\n?/g, "\n");
  return normalized.isWellFormed() && new TextEncoder().encode(normalized).byteLength <= SAVED_TEXT_BYTES && !TEXT_CONTROLS.test(normalized) ? normalized : null;
}
export type WorkStream = "translation" | "note";
/** Save My translation or My notes for one verse of a saved reading (the Yours row, PR 3). Empty clears it. */
export async function saveSavedWork(input: { readingId: string; verseRef: string; stream: WorkStream; expectedVersion: number; text: string }, signal?: AbortSignal): Promise<ChangeResult<SavedWork>> {
  const { status, value } = await request("/api/saved/work", { readingId: input.readingId, verseRef: input.verseRef, stream: input.stream, expectedVersion: input.expectedVersion, text: input.text }, signal);
  return change(status, value, "work", item => parseWork(item));
}
/** A work conflict's current text: null when none is saved yet, undefined when the answer is not one. */
export function conflictWork(current: unknown): SavedWork | null | undefined {
  if (current === null) return null;
  try { return parseWork(current); } catch { return undefined; }
}

/** One starred comment: a registered work's 1-based comment on a verse. Stars belong to the member, not to a reading. */
export type SavedStar = Readonly<{ work: string; verseRef: string; comment: number }>;
export type SavedStars = Readonly<{ state: "signed-out" } | { state: "not-eligible" } | { state: "ready"; stars: readonly SavedStar[] }>;
const WORK = /^[a-z][a-z0-9-]{0,31}$/;
function parseStar(value: unknown, keys: readonly string[] = ["work", "verseRef", "comment"]): SavedStar & { starred?: boolean } {
  const row = record(value, keys);
  if (!row || typeof row.work !== "string" || !WORK.test(row.work) || typeof row.verseRef !== "string" || !VERSE.test(row.verseRef)
    || !Number.isSafeInteger(row.comment) || (row.comment as number) < 1 || (row.comment as number) > 60 || (keys.includes("starred") && typeof row.starred !== "boolean")) throw new SavedRequestError(503);
  return Object.freeze({ work: row.work, verseRef: row.verseRef, comment: row.comment as number, ...keys.includes("starred") ? { starred: row.starred as boolean } : {} });
}
export function parseSavedStars(status: number, value: unknown): SavedStars {
  if (status === 401) return { state: "signed-out" };
  if (status === 403) return { state: "not-eligible" };
  const row = status === 200 ? record(value, ["ok", "stars"]) : null;
  if (!row || row.ok !== true || !Array.isArray(row.stars) || row.stars.length > 2000) throw new SavedRequestError(503);
  return { state: "ready", stars: Object.freeze(row.stars.map(item => parseStar(item))) };
}
/** Every comment the member has starred. */
export async function fetchSavedStars(signal?: AbortSignal): Promise<SavedStars> {
  const { status, value } = await request("/api/saved/stars", undefined, signal);
  return parseSavedStars(status, value);
}
/** Star or unstar one comment; the answer says which it is now. */
export async function setSavedStar(input: SavedStar & { starred: boolean }, signal?: AbortSignal): Promise<ChangeResult<SavedStar & { starred: boolean }>> {
  const { status, value } = await request("/api/saved/star", { work: input.work, verseRef: input.verseRef, comment: input.comment, starred: input.starred }, signal);
  return change(status, value, "star", item => {
    const star = parseStar(item, ["work", "verseRef", "comment", "starred"]) as SavedStar & { starred: boolean };
    return star.work === input.work && star.verseRef === input.verseRef && star.comment === input.comment ? star : null;
  });
}
