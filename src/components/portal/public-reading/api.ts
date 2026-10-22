import { PortalRequestError } from "../api";
import { parseStudyContent, studyRangePlan, type StudyKind, type StudyPage, type StudyVerse } from "../workspace/study/api";
import { referenceRecord } from "../../../lib/reference-audio/source";
import { parseReferenceShortResolution, type ReferenceShortResolution } from "../../../lib/reference-audio/short-resolution";
import { projectStudyVerse } from "../../../lib/hebrew/study-tokens";
import { parseStudyWordAids, type StudyWordAids } from "../../../lib/hebrew/word-aids";
import { parseStudyWordDetails, type StudyWordDetails } from "../../../lib/hebrew/word-details";
import { isSaturday } from "../../../lib/readings/public-shabbat";

/**
 * Signed-out reading transport. Every request is a same-origin GET with no
 * cookie, no Authorization and no referrer, to the /api/public allowlist only.
 * Responses are the same for everyone, so the browser and CDN may cache them.
 */
export type PublicPassage = Readonly<{ kind: StudyKind; ranges: readonly string[]; verseCount: number; pages: readonly Readonly<{ offset: number; first: string; last: string }>[] }>;
export type PublicWeek = Readonly<{ date: string; parashah: string | null; torah: PublicPassage | null; haftarah: PublicPassage | null; fetchedAt: number;
  listening: Readonly<{ pocketTorah: boolean }> }>;
export type PublicShortPage = Readonly<{ offset: number; nextOffset: number | null; totalVerses: number; references: readonly ReferenceShortResolution[] }>;
const bad = (): never => { throw new PortalRequestError(503); };

export async function getJson(path: string, cap: number, signal: AbortSignal): Promise<unknown> {
  const origin = location.origin;
  if (!["http:", "https:"].includes(new URL(origin).protocol) || new URL(origin).origin !== origin) return bad();
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 15_000);
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(path, { headers: { accept: "application/json" }, signal: controller.signal, credentials: "omit", mode: "same-origin", redirect: "error", referrerPolicy: "no-referrer" });
    if (!response.ok) { try { void response.body?.cancel().catch(() => {}); } catch {} throw new PortalRequestError([400, 404, 429, 503].includes(response.status) ? response.status : 503); }
    if (response.redirected || response.url !== origin + path || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) return bad();
    reader = response.body.getReader();
    const bytes = new Uint8Array(cap); let size = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > cap - size) return bad();
      bytes.set(part.value, size); size += part.value.byteLength;
    }
    if (signal.aborted || controller.signal.aborted) throw new PortalRequestError(409);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} } }
}
const query = (entries: [string, string][]) => new URLSearchParams(entries).toString();
const counted = (value: unknown, max = 1000): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;

function passage(value: unknown, kind: StudyKind): PublicPassage | null {
  if (value === null) return null;
  const row = referenceRecord(value, ["kind", "ranges", "verseCount", "pages"]);
  if (!row || row.kind !== kind || !Array.isArray(row.ranges) || row.ranges.length < 1 || row.ranges.length > 32 || row.ranges.some(ref => typeof ref !== "string" || ref.length > 160)
    || !counted(row.verseCount) || Number(row.verseCount) < 1 || !Array.isArray(row.pages) || row.pages.length < 1 || row.pages.length > 1000) return bad();
  const ranges = row.ranges as string[];
  const pages = row.pages.map((raw, index) => {
    const page = referenceRecord(raw, ["offset", "first", "last"]);
    if (!page || !counted(page.offset) || typeof page.first !== "string" || typeof page.last !== "string") return bad();
    const plan = studyRangePlan(ranges, kind, Number(page.offset));
    if (index === 0 && page.offset !== 0 || page.first !== plan.refs[0] || page.last !== plan.refs.at(-1)) return bad();
    return Object.freeze({ offset: Number(page.offset), first: page.first as string, last: page.last as string });
  });
  return Object.freeze({ kind, ranges: Object.freeze([...ranges]), verseCount: Number(row.verseCount), pages: Object.freeze(pages) });
}
export async function fetchPublicWeek(date: string, signal: AbortSignal): Promise<PublicWeek> {
  if (!isSaturday(date)) return bad();
  const row = referenceRecord(await getJson(`/api/public/reading?${query([["date", date]])}`, 256 * 1024, signal), ["date", "parashah", "torah", "haftarah", "fetchedAt", "listening"]);
  if (!row || row.date !== date || (row.parashah !== null && (typeof row.parashah !== "string" || row.parashah.length > 160)) || !Number.isSafeInteger(row.fetchedAt)) return bad();
  const listening = referenceRecord(row.listening, ["pocketTorah"]);
  if (!listening || typeof listening.pocketTorah !== "boolean") return bad();
  return Object.freeze({ date, parashah: row.parashah as string | null, torah: passage(row.torah, "torah"), haftarah: passage(row.haftarah, "haftarah"),
    fetchedAt: Number(row.fetchedAt), listening: Object.freeze({ pocketTorah: listening.pocketTorah as boolean }) });
}
export async function fetchPublicText(week: PublicWeek, kind: StudyKind, offset: number, signal: AbortSignal): Promise<StudyPage> {
  const value = week[kind]; if (!value || !value.pages.some(page => page.offset === offset)) return bad();
  const row = referenceRecord(await getJson(`/api/public/text?${query([["date", week.date], ["kind", kind], ["offset", String(offset)]])}`, 2 * 1024 * 1024, signal),
    ["kind", "date", "offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]);
  if (!row || row.kind !== kind || row.date !== week.date) return bad();
  return parseStudyContent(row, studyRangePlan(value.ranges, kind, offset), offset, value.verseCount);
}
async function verseBinding(verse: StudyVerse) {
  const projection = projectStudyVerse(verse.ref, verse.hebrew);
  if (projection.status !== "ready") return { ref: verse.ref };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projection.projection.readingText.normalize("NFC")));
  return { ref: verse.ref, readingTextSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
    words: Object.freeze(projection.projection.words.map(word => word.text)) };
}
/** `index` is the verse's position in the whole reading, not on the text page. */
export async function fetchPublicWordAids(week: PublicWeek, kind: StudyKind, index: number, verse: StudyVerse, signal: AbortSignal): Promise<StudyWordAids> {
  const value = week[kind]; if (!value || !counted(index) || index >= value.verseCount) return bad();
  const binding = await verseBinding(verse);
  const row = referenceRecord(await getJson(`/api/public/word-aids?${query([["date", week.date], ["kind", kind], ["verse", String(index)]])}`, 160 * 1024, signal), ["kind", "date", "verse", "wordAids"]);
  if (!row || row.kind !== kind || row.date !== week.date || row.verse !== index) return bad();
  return parseStudyWordAids(row.wordAids, binding) ?? bad();
}
export async function fetchPublicWordDetails(week: PublicWeek, kind: StudyKind, index: number, verse: StudyVerse, word: number, signal: AbortSignal): Promise<StudyWordDetails> {
  const value = week[kind]; if (!value || !counted(index) || index >= value.verseCount || !counted(word, 511)) return bad();
  const binding = await verseBinding(verse);
  const row = referenceRecord(await getJson(`/api/public/word-details?${query([["date", week.date], ["kind", kind], ["verse", String(index)], ["word", String(word)]])}`, 32 * 1024, signal),
    ["kind", "date", "verse", "wordDetails"]);
  if (!row || row.kind !== kind || row.date !== week.date || row.verse !== index) return bad();
  return parseStudyWordDetails(row.wordDetails, { ...binding, wordIndex: word }) ?? bad();
}
export async function fetchPublicShortPage(week: PublicWeek, kind: StudyKind, offset: number, signal: AbortSignal): Promise<PublicShortPage> {
  const value = week[kind]; if (!value || !week.listening.pocketTorah || !value.pages.some(page => page.offset === offset)) return bad();
  const plan = studyRangePlan(value.ranges, kind, offset);
  const row = referenceRecord(await getJson(`/api/public/reference/short?${query([["date", week.date], ["kind", kind], ["offset", String(offset)]])}`, 1024 * 1024, signal), ["kind", "date", "page"]);
  if (!row || row.kind !== kind || row.date !== week.date) return bad();
  const page = referenceRecord(row.page, ["offset", "nextOffset", "totalVerses", "references"]);
  if (!page || page.offset !== offset || page.nextOffset !== plan.nextOffset || page.totalVerses !== value.verseCount || !Array.isArray(page.references) || page.references.length !== plan.refs.length) return bad();
  const references = page.references.map((raw, i) => { const parsed = parseReferenceShortResolution(raw); if (!parsed || parsed.verse.ref !== plan.refs[i]) return bad(); return parsed; });
  return Object.freeze({ offset, nextOffset: plan.nextOffset, totalVerses: value.verseCount, references: Object.freeze(references) });
}
