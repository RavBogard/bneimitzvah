import { PortalRequestError } from "../api";
import { parseSavedList, parseSavedPage, type SavedList, type SavedPage } from "../saved/api";

/**
 * The shelf's client for readings for everyone (plan D7): the learner directory and claims (/api/learners*), the learner's own tutor
 * line (/api/mine/tutor*), and the read-only staff reads of a learner's shelf (/api/saved/learner/*). Strict parsing; anything odd
 * is a plain failure. Same-origin, uncached, never redirected.
 */
export type LearnerTutor = Readonly<{ name: string; claimed: boolean; mine: boolean }>;
export type LearnerStudent = Readonly<{ id: string; firstName: string; lastName: string; ceremonyDate: string }>;
export type Learner = Readonly<{ membershipId: string; name: string; readings: number; nearest: Readonly<{ name: string; date: string }> | null; tutor: LearnerTutor | null; student: LearnerStudent | null }>;
export type MyTutor = Readonly<{ name: string; claimed: boolean }>;
export type ClaimResult = Readonly<{ ok: true } | { ok: false; code: "has-tutor" }>;
export type RemoveTutorResult = Readonly<{ ok: true } | { ok: false; code: "assigned" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/;
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && Array.from(value).length <= max && !CONTROLS.test(value) && !value.includes("@") ? value : bad();
const id = (value: unknown) => typeof value === "string" && UUID.test(value) ? value : bad();
const day = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : bad();
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100000 ? value as number : bad();

async function call(path: string, body?: object, signal?: AbortSignal): Promise<{ status: number; value: unknown }> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const raw = await response.text(); if (raw.length > 256 * 1024) return bad();
    return { status: response.status, value: JSON.parse(raw) };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
const refused = (status: number): never => { throw new PortalRequestError([400, 401, 403, 404, 429, 503].includes(status) ? status : 503); };

export function parseLearners(value: unknown): readonly Learner[] {
  const row = object(value, ["ok", "learners"]);
  if (row.ok !== true || !Array.isArray(row.learners) || row.learners.length > 50) return bad();
  return row.learners.map(raw => {
    const item = object(raw, ["membershipId", "name", "readings", "nearest", "tutor", "student"]);
    const nearest = item.nearest === null ? null : (() => { const next = object(item.nearest, ["name", "date"]); return Object.freeze({ name: text(next.name, 80), date: day(next.date) }); })();
    const tutor = item.tutor === null ? null : (() => { const who = object(item.tutor, ["name", "claimed", "mine"]); if (typeof who.claimed !== "boolean" || typeof who.mine !== "boolean") return bad(); return Object.freeze({ name: text(who.name, 160), claimed: who.claimed, mine: who.mine }); })();
    const student = item.student === null ? null : (() => { const s = object(item.student, ["id", "firstName", "lastName", "ceremonyDate"]); return Object.freeze({ id: id(s.id), firstName: text(s.firstName, 100), lastName: text(s.lastName, 100), ceremonyDate: day(s.ceremonyDate) }); })();
    return Object.freeze({ membershipId: id(item.membershipId), name: text(item.name, 160), readings: count(item.readings), nearest, tutor, student });
  });
}
export function parseMyTutor(value: unknown): MyTutor | null {
  const row = object(value, ["ok", "tutor"]);
  if (row.ok !== true) return bad();
  if (row.tutor === null) return null;
  const who = object(row.tutor, ["name", "claimed"]);
  if (typeof who.claimed !== "boolean") return bad();
  return Object.freeze({ name: text(who.name, 160), claimed: who.claimed });
}

/** Find a learner: the directory, by a name prefix; at most fifty, the server's name order. */
export async function fetchLearners(q: string, signal?: AbortSignal): Promise<readonly Learner[]> {
  const search = q.trim() ? `?${new URLSearchParams([["q", q.trim()]])}` : "";
  const { status, value } = await call(`/api/learners${search}`, undefined, signal);
  return status === 200 ? parseLearners(value) : refused(status);
}
/** One learner by membership id, from the directory's pages (the directory is by name; a shelf page knows only the id). Null when not listed. */
export async function fetchLearner(membershipId: string, signal?: AbortSignal): Promise<Learner | null> {
  if (!UUID.test(membershipId)) return null;
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const search = after ? `?${new URLSearchParams([["after", after]])}` : "";
    const { status, value } = await call(`/api/learners${search}`, undefined, signal);
    if (status !== 200) return refused(status);
    const rows = parseLearners(value), found = rows.find(row => row.membershipId === membershipId);
    if (found) return found;
    if (rows.length < 50) return null;
    after = rows[rows.length - 1].membershipId;
  }
  return null;
}
export async function claimLearner(membershipId: string): Promise<ClaimResult> {
  const { status, value } = await call("/api/learners/claim", { learner: id(membershipId) });
  if (status === 409) { const row = object(value, ["ok", "code"]); return row.ok === false && row.code === "has-tutor" ? { ok: false, code: "has-tutor" } : bad(); }
  if (status !== 200) return refused(status);
  object(value, ["ok", "learner", "created"]);
  return { ok: true };
}
export async function unclaimLearner(membershipId: string): Promise<void> {
  const { status, value } = await call("/api/learners/unclaim", { learner: id(membershipId) });
  if (status !== 200) return refused(status);
  object(value, ["ok", "learner"]);
}
/** The person's own tutor line: from a claim (undoable) or the rabbi's assignment; null with neither. */
export async function fetchMyTutor(signal?: AbortSignal): Promise<MyTutor | null> {
  const { status, value } = await call("/api/mine/tutor", undefined, signal);
  return status === 200 ? parseMyTutor(value) : refused(status);
}
export async function removeMyTutor(): Promise<RemoveTutorResult> {
  const { status, value } = await call("/api/mine/tutor/remove", {});
  if (status === 409) { const row = object(value, ["ok", "code"]); return row.ok === false && row.code === "assigned" ? { ok: false, code: "assigned" } : bad(); }
  if (status !== 200) return refused(status);
  object(value, ["ok"]);
  return { ok: true };
}

/** A learner's readings as a staff viewer reads them: the same list shape as one's own; refused or not the viewer's to see, "missing". */
export type LearnerReadings = SavedList | Readonly<{ state: "missing" }>;
export async function fetchLearnerReadings(membershipId: string, signal?: AbortSignal): Promise<LearnerReadings> {
  if (!UUID.test(membershipId)) return { state: "missing" };
  const { status, value } = await call(`/api/saved/learner/readings?${new URLSearchParams([["learner", membershipId]])}`, undefined, signal);
  return status === 404 ? { state: "missing" } : parseSavedList(status, value);
}
/** A page of a learner's reading with the learner's marks, notes and translation, read-only. */
export async function fetchLearnerPage(membershipId: string, readingId: string, offset: number, signal?: AbortSignal): Promise<SavedPage> {
  if (!UUID.test(membershipId) || !UUID.test(readingId) || !Number.isSafeInteger(offset) || offset < 0 || offset > 999) return refused(400);
  const path = offset ? `/api/saved/learner/page?${new URLSearchParams([["learner", membershipId], ["id", readingId], ["offset", String(offset)]])}`
    : `/api/saved/learner/reading?${new URLSearchParams([["learner", membershipId], ["id", readingId]])}`;
  const { status, value } = await call(path, undefined, signal);
  return parseSavedPage(status, value, offset);
}
