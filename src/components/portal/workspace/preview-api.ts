import { PortalRequestError } from "../api";
import { call, workspaceApi, identifier, type Assigned } from "./api";
import { readingBaseline, fallbackLabels, type ReadingKind, type StaffMode } from "./reading-proposal";
import { readingDate, serviceSlot } from "../../../lib/readings/reading-date";
import { expandReadingRanges, parseCeremonyDate } from "../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { studyRangePlan, parseStudyContent, type StudyPage } from "./study/api";

type Context = { studentId: string; studentRevision: number; mode: StaffMode; kind: ReadingKind; ceremonyDate: string;
  serviceSlot: "morning" | "havdalah" | "unknown"; readingDate: string | null; calendar: "diaspora" | "israel";
  source: "calendar" | "manual"; sourceFetchedAt: number | null; manualFallback: keyof typeof fallbackLabels | null; portion: string | null;
  calendarAliyot: { n: number; ref: string }[]; maftir: { ref: string; reason: string | null } | null };
export type PreparedPreview = Context & { status: "prepared"; binding: string; expiresAt: number; ranges: string[]; verseCount: number;
  pages: { offset: number; first: string; last: string; chapters: string[] }[] };
export type PreviewPreparation = PreparedPreview | Context & { status: "manual-required" };
const bad = (): never => { throw new PortalRequestError(503); };
const object = (value: unknown, keys: string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 160) => { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return bad(); return value; };
const positive = (value: unknown) => { if (!Number.isSafeInteger(value) || Number(value) < 1) return bad(); return Number(value); };
const keys = ["status", "studentId", "studentRevision", "mode", "kind", "ceremonyDate", "serviceSlot", "readingDate", "calendar", "source", "sourceFetchedAt", "manualFallback", "portion", "calendarAliyot", "maftir"];
export function parsePreviewPreparation(value: unknown, baseline: Assigned, kind: ReadingKind, source: "calendar" | "manual"): PreviewPreparation {
  if (!value || typeof value !== "object") return bad();
  const status = (value as Record<string, unknown>).status;
  const row = object(value, status === "prepared" ? [...keys, "binding", "expiresAt", "ranges", "verseCount", "pages"] : keys);
  if ((status !== "prepared" && status !== "manual-required") || row.studentId !== baseline.student.id || row.studentRevision !== baseline.student.revision
    || row.mode !== baseline.mode || (row.mode !== "admin" && row.mode !== "tutor") || row.kind !== kind || row.source !== source || row.ceremonyDate !== baseline.student.ceremonyDate) return bad();
  let slot: Context["serviceSlot"], date: ReturnType<typeof readingDate>;
  try { slot = serviceSlot(row.serviceSlot); date = readingDate(parseCeremonyDate(row.ceremonyDate), slot); } catch { return bad(); }
  if (row.readingDate !== date.readingDate || (row.calendar !== "diaspora" && row.calendar !== "israel")
    || row.manualFallback !== null && !Object.hasOwn(fallbackLabels, String(row.manualFallback)) || date.manualFallback !== null && row.manualFallback !== date.manualFallback) return bad();
  if (row.sourceFetchedAt !== null && (!Number.isSafeInteger(row.sourceFetchedAt) || Number(row.sourceFetchedAt) < 0 || Number(row.sourceFetchedAt) > Date.now())) return bad();
  if (date.readingDate === null && row.sourceFetchedAt !== null) return bad();
  if (source === "calendar" && status === "prepared" && (row.manualFallback !== null || row.sourceFetchedAt === null)) return bad();
  if (status === "manual-required" && (source !== "calendar" || row.manualFallback === null)) return bad();
  if (!Array.isArray(row.calendarAliyot) || row.calendarAliyot.length > 7 || (source === "manual" || kind === "haftarah") && row.calendarAliyot.length) return bad();
  const calendarAliyot = row.calendarAliyot.map(value => {
    const row = object(value, ["n", "ref"]), n = positive(row.n); if (n > 7) return bad();
    return { n, ref: text(row.ref, 100) };
  });
  if (new Set(calendarAliyot.map(row => row.n)).size !== calendarAliyot.length) return bad();
  let maftir: Context["maftir"] = null;
  if (row.maftir !== null) { const m = object(row.maftir, ["ref", "reason"]); maftir = { ref: text(m.ref, 100), reason: m.reason === null ? null : text(m.reason) }; }
  const context: Context = { studentId: identifier(row.studentId), studentRevision: positive(row.studentRevision), mode: row.mode, kind, ceremonyDate: row.ceremonyDate as string,
    serviceSlot: slot, readingDate: date.readingDate, calendar: row.calendar, source, sourceFetchedAt: row.sourceFetchedAt as number | null,
    manualFallback: row.manualFallback as Context["manualFallback"], portion: row.portion === null ? null : text(row.portion), calendarAliyot, maftir };
  if (status === "manual-required") return { status, ...context };
  const binding = text(row.binding, 48000);
  if (!/^v1\.[A-Za-z0-9_-]+$/.test(binding) || !Number.isSafeInteger(row.expiresAt) || Number(row.expiresAt) <= Date.now() || Number(row.expiresAt) > Date.now() + 300000
    || !Array.isArray(row.ranges) || !Array.isArray(row.pages) || row.pages.length < 1 || row.pages.length > 125) return bad();
  const ranges = row.ranges.map(ref => text(ref, 100)); let verses: string[];
  try { verses = expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS); } catch { return bad(); }
  if (row.verseCount !== verses.length) return bad();
  let offset: number | null = 0;
  const pages = row.pages.map(value => {
    if (offset === null) return bad(); const page = object(value, ["offset", "first", "last", "chapters"]), plan = studyRangePlan(ranges, kind, offset);
    if (page.offset !== offset || page.first !== plan.refs[0] || page.last !== plan.refs.at(-1) || !Array.isArray(page.chapters)
      || page.chapters.length !== plan.chapters.length || page.chapters.some((ref, i) => ref !== plan.chapters[i].ref)) return bad();
    const result = { offset, first: plan.refs[0], last: plan.refs.at(-1)!, chapters: plan.chapters.map(chapter => chapter.ref) }; offset = plan.nextOffset; return result;
  });
  if (offset !== null) return bad();
  for (const row of calendarAliyot) try { if (expandReadingRanges([row.ref], "torah", TANAKH_VERSE_COUNTS).some(ref => !verses.includes(ref))) return bad(); } catch { return bad(); }
  return { status, ...context, binding, expiresAt: Number(row.expiresAt), ranges, verseCount: verses.length, pages };
}
export function parsePreviewPage(value: unknown, prepared: PreparedPreview, offset: number): StudyPage {
  const row = object(value, ["studentId", "studentRevision", "mode", "kind", "expiresAt", "offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]);
  if (row.studentId !== prepared.studentId || row.studentRevision !== prepared.studentRevision || row.mode !== prepared.mode || row.kind !== prepared.kind
    || row.expiresAt !== prepared.expiresAt || prepared.expiresAt <= Date.now() || !prepared.pages.some(page => page.offset === offset)) throw new PortalRequestError(409);
  return parseStudyContent(row, studyRangePlan(prepared.ranges, prepared.kind, offset), offset, prepared.verseCount);
}
export const previewApi = {
  async prepare(mode: StaffMode, baseline: Assigned, kind: ReadingKind, source: "calendar" | "manual", ranges: string[] | undefined, signal: AbortSignal) {
    if (baseline.mode !== mode || !["admin", "tutor"].includes(mode)) return bad();
    const id = identifier(baseline.student.id);
    const raw = await call(`/api/students/${id}/reading/preview/prepare`, { mode, kind, source, ...(ranges === undefined ? {} : { ranges }) }, undefined, signal);
    const live = await workspaceApi.reading(mode, id, undefined, signal);
    if (readingBaseline(live, kind) !== readingBaseline(baseline, kind)) throw new PortalRequestError(409);
    return parsePreviewPreparation(raw, baseline, kind, source);
  },
  async page(prepared: PreparedPreview, offset: number, signal: AbortSignal) {
    if (!prepared.pages.some(page => page.offset === offset) || prepared.expiresAt <= Date.now()) throw new PortalRequestError(409);
    return parsePreviewPage(await call(`/api/students/${identifier(prepared.studentId)}/reading/preview/page`, { mode: prepared.mode, binding: prepared.binding, offset }, undefined, signal, 2 * 1024 * 1024), prepared, offset);
  },
};
