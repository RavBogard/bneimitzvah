import { PortalRequestError } from "../../api";
import { identifier, type Assigned, type Selection } from "../api";
import type { StudyKind } from "./api";

export type GuideSource = { id: string; ref: string; indexTitle: string; category: string; labels: { en: string | null; he: string | null }; readable: boolean };
export type GuideNote = { verseRef: string; body: string; sources: GuideSource[] };
export type GuideTheme = { id: string; title: string; intro: string; notes: GuideNote[]; read: boolean; readVersion: number };
export type GuideLabel = { origin: "claude" | "rabbi"; reviewed: boolean; rabbiName: string };
export type StudentGuideView = {
  kind: StudyKind; readingKey: string | null; tickable: boolean;
  base: { version: number; label: GuideLabel; overview: string; themes: GuideTheme[]; updatedAt: string } | null;
  additions: { version: number; label: GuideLabel; themes: GuideTheme[]; updatedAt: string } | null;
};
export type ThemeReadResult = { themeId: string; read: boolean; version: number };
/** A reading's guide view plus, for the haftarah, that week's public study sheet when the library has one. */
export type GuideFetch = { view: StudentGuideView | null; sheet: string | null };
export type GuideOperation = { type: "view" } | { type: "theme-read"; readingKey: string; themeId: string; read: boolean; expectedVersion: number };
export class GuideError extends PortalRequestError {
  constructor(status: number, public readonly code?: "conflict" | "stale-assignment") { super(status); }
}

const bad = (): never => { throw new GuideError(503); };
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : bad();
const line = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f<>]/.test(value) ? value : bad();
const nullableLine = (value: unknown, max: number) => value === null ? null : line(value, max);
const slug = (value: unknown, max: number) => typeof value === "string" && value.length <= max && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : bad();
const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647 ? Number(value) : bad();
const bool = (value: unknown) => typeof value === "boolean" ? value : bad();
const instant = (value: unknown) => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : bad();
const list = <T>(value: unknown, max: number, each: (item: unknown) => T) => Array.isArray(value) && value.length <= max ? value.map(each) : bad();

function source(value: unknown): GuideSource {
  const row = object(value, ["id", "ref", "indexTitle", "category", "labels", "readable"]), labels = object(row.labels, ["en", "he"]);
  if (typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id)) return bad();
  return { id: row.id, ref: line(row.ref, 512), indexTitle: line(row.indexTitle, 512), category: line(row.category, 128),
    labels: { en: nullableLine(labels.en, 256), he: nullableLine(labels.he, 256) }, readable: bool(row.readable) };
}
function note(value: unknown, verses: ReadonlySet<string>): GuideNote {
  const row = object(value, ["verseRef", "body", "sources"]);
  // The server already filtered notes to this student's verses; anything else is a broken response.
  if (typeof row.verseRef !== "string" || !verses.has(row.verseRef)) return bad();
  return { verseRef: row.verseRef, body: text(row.body, 4096), sources: list(row.sources, 3, source) };
}
function theme(value: unknown, verses: ReadonlySet<string>): GuideTheme {
  const row = object(value, ["id", "title", "intro", "notes", "read", "readVersion"]);
  if (typeof row.id !== "string" || row.id.length > 73 || !/^(?:student--)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)) return bad();
  return { id: row.id, title: line(row.title, 480), intro: text(row.intro, 4096), notes: list(row.notes, 12, item => note(item, verses)), read: bool(row.read), readVersion: version(row.readVersion) };
}
function label(value: unknown): GuideLabel {
  const row = object(value, ["origin", "reviewed", "rabbiName"]);
  if (row.origin !== "claude" && row.origin !== "rabbi") return bad();
  return { origin: row.origin, reviewed: bool(row.reviewed), rabbiName: line(row.rabbiName, 320) };
}
export function parseSheet(value: unknown, kind: StudyKind): string | null {
  const sheet = value && typeof value === "object" && Object.hasOwn(value, "sheet") ? (value as { sheet: unknown }).sheet : null;
  if (sheet === null) return null;
  if (kind !== "haftarah" || typeof sheet !== "string" || sheet.length > 200 || !/^https:\/\/haftarah\.centralreform\.org\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sheet)) return bad();
  return sheet;
}
export function parseGuideView(value: unknown, baseline: Assigned, kind: StudyKind): StudentGuideView | null {
  const row = object(value, ["ok", "view", ...(value && typeof value === "object" && Object.hasOwn(value, "sheet") ? ["sheet"] : [])]);
  if (row.ok !== true) return bad();
  if (row.view === null) return null;
  const view = object(row.view, ["kind", "readingKey", "tickable", "base", "additions"]), reading = baseline.readings.find(r => r.kind === kind) ?? bad();
  if (view.kind !== kind) return bad();
  const readingKey = view.readingKey === null ? null : slug(view.readingKey, 160);
  if (readingKey !== (reading.readingKey ?? null)) return bad();
  const verses = new Set(reading.verses);
  const base = view.base === null ? null : (() => {
    const b = object(view.base, ["version", "label", "overview", "themes", "updatedAt"]);
    return { version: version(b.version), label: label(b.label), overview: text(b.overview, 8192), themes: list(b.themes, 8, t => theme(t, verses)), updatedAt: instant(b.updatedAt) };
  })();
  const additions = view.additions === null ? null : (() => {
    const a = object(view.additions, ["version", "label", "themes", "updatedAt"]);
    return { version: version(a.version), label: label(a.label), themes: list(a.themes, 8, t => theme(t, verses)), updatedAt: instant(a.updatedAt) };
  })();
  if (!base && !additions) return bad();
  const tickable = bool(view.tickable);
  if (tickable && (baseline.mode !== "student" && baseline.mode !== "child-practice")) return bad();
  return { kind, readingKey, tickable, base, additions };
}
export function parseThemeRead(value: unknown, operation: Extract<GuideOperation, { type: "theme-read" }>): ThemeReadResult {
  const row = object(value, ["ok", "themeId", "read", "version"]);
  if (row.ok !== true || row.themeId !== operation.themeId || row.read !== operation.read) return bad();
  const saved = version(row.version);
  if (saved !== operation.expectedVersion && saved !== operation.expectedVersion + 1) return bad();
  return { themeId: operation.themeId, read: operation.read, version: saved };
}

export async function fetchGuide(baseline: Assigned, kind: StudyKind, operation: GuideOperation, signal: AbortSignal, selection?: Selection): Promise<GuideFetch | ThemeReadResult> {
  if ((baseline.mode === "child-practice") !== Boolean(selection)) return bad();
  if (selection && (selection.context.studentId !== baseline.student.id || selection.context.id !== baseline.context?.id)) return bad();
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 12_000);
  try {
    const write = operation.type === "theme-read", headers = new Headers({ accept: "application/json" });
    if (selection) headers.set("X-Practice-Context", selection.handle);
    if (write) headers.set("content-type", "application/json");
    const base = `/api/students/${identifier(baseline.student.id)}/study-guide`;
    const url = write ? `${base}/theme-read` : `${base}?${new URLSearchParams({ mode: baseline.mode, kind })}`;
    const body = write ? JSON.stringify({ mode: baseline.mode, kind, readingKey: operation.readingKey, themeId: operation.themeId, read: operation.read, expectedVersion: operation.expectedVersion }) : undefined;
    // same-origin keeps a real Origin header on the POST in every engine; no-referrer makes Firefox send Origin: null.
    const response = await fetch(url, { method: write ? "POST" : "GET", headers, body, signal: controller.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "same-origin" });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new GuideError(response.ok ? 503 : response.status);
    const raw = await response.text(); if (raw.length > 320 * 1024) return bad();
    const value: unknown = JSON.parse(raw); if (controller.signal.aborted) return bad();
    if (response.status === 409) { const failure = object(value, ["ok", "code"]); if (failure.ok !== false || (failure.code !== "conflict" && failure.code !== "stale-assignment")) return bad(); throw new GuideError(409, failure.code); }
    if (!response.ok) throw new GuideError([401, 403, 404, 429].includes(response.status) ? response.status : 503);
    return write ? parseThemeRead(value, operation) : { view: parseGuideView(value, baseline, kind), sheet: parseSheet(value, kind) };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
