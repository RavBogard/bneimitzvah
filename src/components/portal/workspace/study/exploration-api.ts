import { PortalRequestError } from "../../api";
import { call, identifier, workspaceApi, type Assigned, type ReadingMode, type Selection } from "../api";
import { readingDate, serviceSlot } from "../../../../lib/readings/reading-date";
import { parseCeremonyDate, expandReadingRanges } from "../../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../../lib/readings/catalog";
import { parseStudyContent, studyRangePlan, type StudyPage } from "./api";

type Mode = Exclude<ReadingMode, "parent">;
type Context = { studentId: string; studentRevision: number; mode: Mode; kind: "torah"; ceremonyDate: string;
  serviceSlot: "morning" | "havdalah" | "unknown"; readingDate: string | null; calendar: "diaspora" | "israel" };
export type PreparedExploration = Context & { status: "prepared"; binding: string; expiresAt: number; sourceFetchedAt: number; portion: string;
  ranges: string[]; verseCount: number; pages: { offset: number; first: string; last: string; chapters: string[] }[] };
export type ExplorationPreparation = PreparedExploration | Context & { status: "unresolved"; reason: keyof typeof explorationReasons }
  | Context & { status: "assigned"; assignment: { id: string; revision: number } };
export const explorationReasons = {
  "unknown-slot": "Your rabbi needs to choose a service time before the Torah portion can be shown.",
  "non-saturday": "Your rabbi will help choose the Torah reading for this ceremony date.",
  "calendar-date-out-of-range": "The Torah portion is not available for this ceremony date.",
  "calendar-source-unavailable": "The Torah portion couldn’t be loaded. Try again in a moment.",
  holiday: "This date has a special reading. Your rabbi will help choose the verses.",
  multiple: "This date has more than one possible reading. Your rabbi will help choose the verses.",
  nonregular: "Your rabbi will help choose the Torah reading for this date.",
  missing: "The Torah portion is not available for this date yet.",
} as const;
const bad = (): never => { throw new PortalRequestError(503); };
const object = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 160) => { if (typeof value !== "string" || !value.trim() || value.length > max || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value)) return bad(); return value; };
const positive = (value: unknown) => { if (!Number.isSafeInteger(value) || Number(value) < 1) return bad(); return Number(value); };
const keys = ["status", "studentId", "studentRevision", "mode", "kind", "ceremonyDate", "serviceSlot", "readingDate", "calendar"];
export const explorationBinding = (value: Assigned) => JSON.stringify([value.mode,
  [value.student.id, value.student.revision, value.student.firstName, value.student.lastName, value.student.ceremonyDate],
  value.context ? [value.context.id, value.context.authorityRevision, value.context.studentId, value.context.studentRevision, value.context.expiresAt] : null,
  value.readings.map(row => [row.id, row.kind, row.revision, row.ranges, row.verses, row.needsReview, row.aliyahStarts, row.confirmationDate, row.basis,
    [row.source.status, row.source.fetchedAt, row.source.date, row.source.calendar, row.source.attribution?.name, row.source.attribution?.url]])]);
function allowed(baseline: Assigned, selection?: Selection) {
  if (!["student", "child-practice", "tutor", "admin"].includes(baseline.mode) || baseline.readings.some(row => row.kind === "torah") || (baseline.mode === "child-practice") !== Boolean(selection)) throw new PortalRequestError(409);
  if (selection && (!baseline.context || selection.context.id !== baseline.context.id || selection.context.authorityRevision !== baseline.context.authorityRevision
    || selection.context.studentId !== baseline.student.id || baseline.context.studentRevision !== baseline.student.revision || selection.context.expiresAt !== baseline.context.expiresAt
    || Date.parse(selection.context.expiresAt) <= Date.now())) throw new PortalRequestError(409);
}
export function parseExplorationPreparation(value: unknown, baseline: Assigned): ExplorationPreparation {
  if (baseline.mode === "parent" || !["student", "child-practice", "tutor", "admin"].includes(baseline.mode) || baseline.readings.some(row => row.kind === "torah")) throw new PortalRequestError(409);
  const status = value && typeof value === "object" ? (value as Record<string, unknown>).status : null;
  const row = object(value, [...keys, ...(status === "prepared" ? ["binding", "expiresAt", "sourceFetchedAt", "portion", "ranges", "verseCount", "pages"] : status === "assigned" ? ["assignment"] : ["reason"])]);
  if (!["prepared", "unresolved", "assigned"].includes(String(status)) || row.studentId !== baseline.student.id || row.studentRevision !== baseline.student.revision
    || row.mode !== baseline.mode || row.kind !== "torah" || row.ceremonyDate !== baseline.student.ceremonyDate) return bad();
  let slot: Context["serviceSlot"], date: ReturnType<typeof readingDate>;
  try { slot = serviceSlot(row.serviceSlot); date = readingDate(parseCeremonyDate(row.ceremonyDate), slot); } catch { return bad(); }
  if (row.readingDate !== date.readingDate || (row.calendar !== "diaspora" && row.calendar !== "israel")) return bad();
  const context: Context = { studentId: identifier(row.studentId), studentRevision: positive(row.studentRevision), mode: baseline.mode, kind: "torah",
    ceremonyDate: baseline.student.ceremonyDate, serviceSlot: slot, readingDate: date.readingDate, calendar: row.calendar };
  if (status === "assigned") { const assignment = object(row.assignment, ["id", "revision"]); return { ...context, status, assignment: { id: identifier(assignment.id), revision: positive(assignment.revision) } }; }
  if (status === "unresolved") {
    if (typeof row.reason !== "string" || !Object.hasOwn(explorationReasons, row.reason) || date.manualFallback !== null && row.reason !== date.manualFallback) return bad();
    return { ...context, status, reason: row.reason as keyof typeof explorationReasons };
  }
  const now = Date.now(), binding = text(row.binding, 48000);
  if (date.readingDate === null || !/^v1\.[A-Za-z0-9_-]+$/.test(binding) || !Number.isSafeInteger(row.expiresAt) || Number(row.expiresAt) <= now || Number(row.expiresAt) > now + 300000
    || !Number.isSafeInteger(row.sourceFetchedAt) || Number(row.sourceFetchedAt) < 0 || Number(row.sourceFetchedAt) > now || now - Number(row.sourceFetchedAt) >= 86400000
    || !Array.isArray(row.ranges) || row.ranges.length !== 1 || !Array.isArray(row.pages) || row.pages.length < 1 || row.pages.length > 125) return bad();
  const ranges = row.ranges.map(ref => text(ref, 100)); let verses: string[];
  try { verses = expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS); } catch { return bad(); }
  if (row.verseCount !== verses.length) return bad();
  let offset: number | null = 0;
  const pages = row.pages.map(value => {
    if (offset === null) return bad(); const page = object(value, ["offset", "first", "last", "chapters"]), plan = studyRangePlan(ranges, "torah", offset);
    if (page.offset !== offset || page.first !== plan.refs[0] || page.last !== plan.refs.at(-1) || !Array.isArray(page.chapters) || page.chapters.length !== plan.chapters.length
      || page.chapters.some((chapter, i) => chapter !== plan.chapters[i].ref)) return bad();
    const result = { offset, first: plan.refs[0], last: plan.refs.at(-1)!, chapters: plan.chapters.map(chapter => chapter.ref) }; offset = plan.nextOffset; return result;
  });
  if (offset !== null) return bad();
  return { ...context, status: "prepared", binding, expiresAt: Number(row.expiresAt), sourceFetchedAt: Number(row.sourceFetchedAt), portion: text(row.portion), ranges, verseCount: verses.length, pages };
}
export function parseExplorationPage(value: unknown, prepared: PreparedExploration, offset: number): StudyPage {
  const row = object(value, ["studentId", "studentRevision", "mode", "kind", "expiresAt", "offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]);
  if (row.studentId !== prepared.studentId || row.studentRevision !== prepared.studentRevision || row.mode !== prepared.mode || row.kind !== "torah"
    || row.expiresAt !== prepared.expiresAt || prepared.expiresAt <= Date.now() || !prepared.pages.some(page => page.offset === offset)) throw new PortalRequestError(409);
  return parseStudyContent(row, studyRangePlan(prepared.ranges, "torah", offset), offset, prepared.verseCount);
}
async function current(baseline: Assigned, selection: Selection | undefined, signal: AbortSignal) {
  const live = await workspaceApi.reading(baseline.mode, baseline.student.id, selection, signal);
  if (signal.aborted || explorationBinding(live) !== explorationBinding(baseline)) throw new PortalRequestError(409);
}
export const explorationApi = {
  async prepare(supplied: Assigned, signal: AbortSignal, suppliedSelection?: Selection) {
    const baseline = structuredClone(supplied), selection = suppliedSelection ? structuredClone(suppliedSelection) : undefined;
    allowed(baseline, selection);
    const value = await call(`/api/students/${identifier(baseline.student.id)}/reading/explore/prepare`, { mode: baseline.mode }, selection?.handle, signal);
    await current(baseline, selection, signal);
    return parseExplorationPreparation(value, baseline);
  },
  async page(supplied: Assigned, suppliedPrepared: PreparedExploration, offset: number, signal: AbortSignal, suppliedSelection?: Selection) {
    const baseline = structuredClone(supplied), prepared = structuredClone(suppliedPrepared), selection = suppliedSelection ? structuredClone(suppliedSelection) : undefined;
    allowed(baseline, selection);
    if (baseline.student.id !== prepared.studentId || baseline.student.revision !== prepared.studentRevision || baseline.mode !== prepared.mode || prepared.expiresAt <= Date.now()
      || !prepared.pages.some(page => page.offset === offset)) throw new PortalRequestError(409);
    const value = await call(`/api/students/${identifier(prepared.studentId)}/reading/explore/page`, { mode: prepared.mode, binding: prepared.binding, offset }, selection?.handle, signal, 2 * 1024 * 1024);
    await current(baseline, selection, signal);
    return parseExplorationPage(value, prepared, offset);
  },
};
