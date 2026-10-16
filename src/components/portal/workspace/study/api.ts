import { PortalRequestError } from "../../api";
import { identifier, parseContext, type Assigned, type Selection } from "../api";
import { TANAKH_VERSE_COUNTS } from "../../../../lib/readings/catalog";
import { expandReadingRanges } from "../../../../lib/readings/ranges";
import { studyEditions, type StudyChapter, type StudyEdition } from "./credits";

export type StudyKind = "torah" | "haftarah";
export type Segment = { kind: "text"; text: string } | { kind: "alternative"; written: string; read: string } | { kind: "gap"; break: "petuchah" | "setumah" } | { kind: "inverted-nun" };
export type StudyVerse = { ref: string; english: string | null; hebrew: { text: string; readingText: string; segments: Segment[]; paragraphAfter: "petuchah" | "setumah" | null } };
export type StudyPage = { offset: number; nextOffset: number | null; totalVerses: number; verses: StudyVerse[]; chapters: StudyChapter[]; translation: { key: "jps2023"; status: "available" | "partial" | "unavailable" } };
const bad = (): never => { throw new PortalRequestError(503); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return bad();
  return value as Record<string, unknown>;
}
function text(value: unknown, hebrew = false): string {
  if (typeof value !== "string" || !value.trim() || value.length > 65536 || !value.isWellFormed() || value !== value.normalize("NFC")
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(value) || hebrew && !/[א-ת]/u.test(value)) return bad();
  return value;
}
export function studyBinding(value: Assigned): string {
  return JSON.stringify([value.mode, value.student.id, value.student.revision, value.context, value.readings.map(row => [row.id, row.kind, row.revision, row.needsReview, row.verses])]);
}
export function studyPlan(baseline: Assigned, kind: StudyKind, offset: number) {
  const assignment = baseline.readings.find(row => row.kind === kind);
  if (!assignment || !Number.isInteger(offset) || offset < 0 || offset >= assignment.verses.length || assignment.verses.length > 1000) return bad();
  let canonical: string[]; try { canonical = expandReadingRanges(assignment.ranges, kind, TANAKH_VERSE_COUNTS); } catch { return bad(); }
  if (canonical.length !== assignment.verses.length || canonical.some((ref, index) => ref !== assignment.verses[index])) return bad();
  return {assignment,...studyRangePlan(assignment.ranges,kind,offset)};
}
export function studyRangePlan(ranges:readonly string[],kind:StudyKind,offset:number){
  let verses:string[];try{verses=expandReadingRanges(ranges,kind,TANAKH_VERSE_COUNTS);}catch{return bad();}
  if(!Number.isSafeInteger(offset) || offset<0 || offset>=verses.length)return bad();
  const chapters: { ref: string; url: string }[] = [], refs: string[] = [];
  for (const ref of verses.slice(offset, offset + 100)) {
    const match = /^(.*) ([1-9]\d*):([1-9]\d*)$/.exec(ref); if (!match) return bad();
    const book = match[1], chapter = Number(match[2]), verse = Number(match[3]);
    if (!Object.hasOwn(TANAKH_VERSE_COUNTS, book) || verse > (TANAKH_VERSE_COUNTS[book]?.[chapter - 1] ?? 0)) return bad();
    const chapterRef = `${book} ${chapter}`;
    if (!chapters.some(row => row.ref === chapterRef)) {
      if (chapters.length === 8) break;
      chapters.push({ ref: chapterRef, url: `https://www.sefaria.org/${encodeURIComponent(book)}.${chapter}` });
    }
    refs.push(ref);
  }
  return { refs, chapters, nextOffset: offset + refs.length < verses.length ? offset + refs.length : null };
}
function hebrew(value: unknown): StudyVerse["hebrew"] {
  const row = object(value, ["text", "readingText", "segments", "paragraphAfter"]);
  if (!Array.isArray(row.segments) || row.segments.length < 1 || row.segments.length > 4096 || ![null, "petuchah", "setumah"].includes(row.paragraphAfter as null)) return bad();
  const segments: Segment[] = row.segments.map(value => {
    if (!value || typeof value !== "object") return bad(); const kind = (value as Record<string, unknown>).kind;
    const segment = object(value, kind === "text" ? ["kind", "text"] : kind === "alternative" ? ["kind", "written", "read"] : kind === "gap" ? ["kind", "break"] : ["kind"]);
    if (kind === "text") {
      if (typeof segment.text !== "string" || segment.text.length > 65536 || !segment.text.isWellFormed() || segment.text !== segment.text.normalize("NFC") || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(segment.text)) return bad();
      return { kind, text: segment.text };
    }
    if (kind === "alternative") return { kind, written: text(segment.written, true), read: text(segment.read, true) };
    if (kind === "gap" && (segment.break === "petuchah" || segment.break === "setumah")) return { kind, break: segment.break };
    if (kind === "inverted-nun") return { kind };
    return bad();
  });
  const combine = (read: boolean) => segments.map(s => s.kind === "text" ? s.text : s.kind === "alternative" ? read ? s.read : s.written : s.kind === "gap" ? " " : "").join("").normalize("NFC").replace(/[\u00a0\u2009\t\r\n ]+/g, " ").trim();
  const written = text(row.text, true), reading = text(row.readingText, true);
  if (combine(false) !== written || combine(true) !== reading) return bad();
  const last = [...segments].reverse().find(s => s.kind !== "inverted-nun" && (s.kind !== "text" || s.text.trim()));
  const paragraphAfter = last?.kind === "gap" ? last.break : null;
  if (row.paragraphAfter !== paragraphAfter) return bad();
  return { text: written, readingText: reading, segments, paragraphAfter };
}
function edition(value: unknown): StudyEdition {
  const row = object(value, ["key", "versionTitle", "language", "creator", "sourceUrl", "license", "licenseUrl", "changes"]);
  if (row.key !== "mam" && row.key !== "jps2023") return bad(); const expected = studyEditions[row.key];
  if (Object.keys(expected).some(key => row[key] !== expected[key as keyof typeof expected])) return bad();
  return expected;
}
export function parseStudyPage(value: unknown, baseline: Assigned, kind: StudyKind, offset: number, selection?: Selection): StudyPage {
  const row = object(value, ["studentId", "studentRevision", "mode", "context", "assignment", "offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]), plan = studyPlan(baseline, kind, offset);
  if (identifier(row.studentId) !== baseline.student.id || row.studentRevision !== baseline.student.revision || row.mode !== baseline.mode) throw new PortalRequestError(409);
  if (baseline.mode === "child-practice") {
    const context = parseContext(row.context, baseline.student.id), expected = baseline.context;
    if (!selection || !expected || context.id !== expected.id || context.authorityRevision !== expected.authorityRevision || context.expiresAt !== expected.expiresAt || context.studentRevision !== row.studentRevision
      || context.id !== selection.context.id || context.authorityRevision !== selection.context.authorityRevision || context.expiresAt !== selection.context.expiresAt) throw new PortalRequestError(409);
  } else if (row.context !== null || selection) return bad();
  const a = object(row.assignment, ["id", "revision", "kind", "needsReview"]);
  if (a.id !== plan.assignment.id || a.revision !== plan.assignment.revision || a.kind !== kind || a.needsReview !== plan.assignment.needsReview) throw new PortalRequestError(409);
  return parseStudyContent(row,plan,offset,plan.assignment.verses.length);
}
// Shared text-only validator. Its caller validates the independent authorization
// envelope; preview must never fabricate an assigned-reading identity.
export function parseStudyContent(row:Record<string,unknown>,plan:ReturnType<typeof studyRangePlan>,offset:number,totalVerses:number):StudyPage{
  if (row.offset !== offset || row.nextOffset !== plan.nextOffset || row.totalVerses !== totalVerses || !Array.isArray(row.verses) || row.verses.length !== plan.refs.length || !Array.isArray(row.chapters) || row.chapters.length !== plan.chapters.length) return bad();
  const verses = row.verses.map((value, index): StudyVerse => { const v = object(value, ["ref", "english", "hebrew"]); if (v.ref !== plan.refs[index]) return bad(); return { ref: plan.refs[index], english: v.english === null ? null : text(v.english), hebrew: hebrew(v.hebrew) }; });
  const t = object(row.translation, ["key", "status"]), translated = verses.filter(v => v.english !== null).length;
  const status = translated === verses.length ? "available" : translated === 0 ? "unavailable" : "partial";
  if (t.key !== "jps2023" || t.status !== status) return bad();
  const chapters = row.chapters.map((value, index): StudyChapter => {
    const c = object(value, ["ref", "sefariaUrl", "fetchedAt", "hash", "editions"]), expected = plan.chapters[index];
    if (c.ref !== expected.ref || c.sefariaUrl !== expected.url || typeof c.fetchedAt !== "number" || c.fetchedAt < 0 || !Number.isFinite(new Date(c.fetchedAt).getTime()) || typeof c.hash !== "string" || !/^[a-f0-9]{64}$/.test(c.hash) || !Array.isArray(c.editions) || c.editions.length < 1 || c.editions.length > 2) return bad();
    const editions = c.editions.map(edition);
    if (editions[0].key !== "mam" || editions.length === 2 && editions[1].key !== "jps2023") return bad();
    if (verses.some(v => v.ref.startsWith(`${expected.ref}:`) && v.english !== null) && !editions.some(e => e.key === "jps2023")) return bad();
    return { ref: expected.ref, sefariaUrl: expected.url, fetchedAt: c.fetchedAt, hash: c.hash, editions };
  });
  return { offset, nextOffset: plan.nextOffset, totalVerses: totalVerses, verses, chapters, translation: { key: "jps2023", status } };
}
export async function fetchStudyPage(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal, selection?: Selection): Promise<StudyPage> {
  const plan = studyPlan(baseline, kind, offset);
  if ((baseline.mode === "child-practice") !== Boolean(selection)) return bad();
  const query = new URLSearchParams({ mode: baseline.mode, kind, assignmentId: identifier(plan.assignment.id), assignmentRevision: String(plan.assignment.revision), translation: "jps2023", offset: String(offset) });
  const controller = new AbortController(), abort = () => controller.abort(); if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 15_000);
  try {
    const headers = new Headers({ accept: "application/json" }); if (selection) headers.set("X-Practice-Context", selection.handle);
    const response = await fetch(`/api/students/${identifier(baseline.student.id)}/study-text?${query}`, { headers, signal: controller.signal, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const reader = response.body?.getReader(); if (!reader) return bad(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); return bad(); } chunks.push(next.value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let next = 0; for (const chunk of chunks) { bytes.set(chunk, next); next += chunk.byteLength; }
    if (controller.signal.aborted) throw new PortalRequestError(409);
    return parseStudyPage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), baseline, kind, offset, selection);
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
