import { PortalRequestError } from "../api";
import { parseStudyContent, studyRangePlan, type StudyKind, type StudyPage, type StudyVerse } from "../workspace/study/api";
import { referenceRecord } from "../../../lib/reference-audio/source";
import { parseReferenceShortResolution, type ReferenceShortResolution } from "../../../lib/reference-audio/short-resolution";
import { projectStudyVerse } from "../../../lib/hebrew/study-tokens";
import { parseStudyWordAids, type StudyWordAids } from "../../../lib/hebrew/word-aids";
import { parseStudyWordDetails, type StudyWordDetails } from "../../../lib/hebrew/word-details";
import { isSaturday } from "../../../lib/readings/public-shabbat";
import { canonicalReadingRef } from "../../../lib/readings/reading-ref";
import { publicReadingPath, publicShortPath, publicTextPath, publicWordAidsPath, publicWordDetailsPath, type ReadingSelector } from "./urls";

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
  const row = referenceRecord(await getJson(publicReadingPath({ by: "date", date }), 256 * 1024, signal), ["date", "parashah", "torah", "haftarah", "fetchedAt", "listening"]);
  if (!row || row.date !== date || (row.parashah !== null && (typeof row.parashah !== "string" || row.parashah.length > 160)) || !Number.isSafeInteger(row.fetchedAt)) return bad();
  return Object.freeze({ date, parashah: row.parashah as string | null, torah: passage(row.torah, "torah"), haftarah: passage(row.haftarah, "haftarah"),
    fetchedAt: Number(row.fetchedAt), listening: listeningOf(row.listening) });
}
function listeningOf(value: unknown): Readonly<{ pocketTorah: boolean }> {
  const listening = referenceRecord(value, ["pocketTorah"]);
  if (!listening || typeof listening.pocketTorah !== "boolean") return bad();
  return Object.freeze({ pocketTorah: listening.pocketTorah as boolean });
}
/** "Any reading": the passage a canonical ref names, paged exactly as a week's. */
export type PublicRefReading = Readonly<{ ref: string; kind: StudyKind; passage: PublicPassage; listening: Readonly<{ pocketTorah: boolean }> }>;
export async function fetchPublicRefReading(ref: string, kind: StudyKind, signal: AbortSignal): Promise<PublicRefReading> {
  const canonical = canonicalReadingRef(ref, kind); if (!canonical) throw new PortalRequestError(400);
  const row = referenceRecord(await getJson(publicReadingPath({ by: "ref", ref, kind }), 256 * 1024, signal), ["ref", "kind", "passage", "listening"]);
  if (!row || row.ref !== ref || row.kind !== kind) return bad();
  const value = passage(row.passage, kind);
  if (!value || value.ranges.join("; ") !== ref || value.verseCount !== canonical.verses.length) return bad();
  return Object.freeze({ ref, kind, passage: value, listening: listeningOf(row.listening) });
}

/** One passage the page can read: how to ask for it, its paging, and whether recordings are on. */
export type PublicSource = Readonly<{ selector: ReadingSelector; passage: PublicPassage; listening: boolean }>;
export const weekSource = (week: PublicWeek, kind: StudyKind): PublicSource | null =>
  week[kind] ? Object.freeze({ selector: Object.freeze({ by: "date" as const, date: week.date }), passage: week[kind]!, listening: week.listening.pocketTorah }) : null;
export const refSource = (reading: PublicRefReading): PublicSource =>
  Object.freeze({ selector: Object.freeze({ by: "ref" as const, ref: reading.ref, kind: reading.kind }), passage: reading.passage, listening: reading.listening.pocketTorah });
/** The key that named the passage, echoed by every page body. */
function echoes(row: Record<string, unknown>, selector: ReadingSelector): boolean {
  return selector.by === "date" ? row.date === selector.date : row.ref === selector.ref;
}
const selectorKeys = (selector: ReadingSelector) => selector.by === "date" ? "date" : "ref";

export async function fetchPublicText(source: PublicSource, offset: number, signal: AbortSignal): Promise<StudyPage> {
  const { passage: value, selector } = source, kind = value.kind; if (!value.pages.some(page => page.offset === offset)) return bad();
  const row = referenceRecord(await getJson(publicTextPath(selector, kind, offset), 2 * 1024 * 1024, signal),
    ["kind", selectorKeys(selector), "offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]);
  if (!row || row.kind !== kind || !echoes(row, selector)) return bad();
  return parseStudyContent(row, studyRangePlan(value.ranges, kind, offset), offset, value.verseCount);
}
async function verseBinding(verse: StudyVerse) {
  const projection = projectStudyVerse(verse.ref, verse.hebrew);
  if (projection.status !== "ready") return { ref: verse.ref };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projection.projection.readingText.normalize("NFC")));
  return { ref: verse.ref, readingTextSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
    words: Object.freeze(projection.projection.words.map(word => word.text)) };
}
/** `index` is the verse's position in the whole passage, not on the text page. */
export async function fetchPublicWordAids(source: PublicSource, index: number, verse: StudyVerse, signal: AbortSignal): Promise<StudyWordAids> {
  const { passage: value, selector } = source, kind = value.kind; if (!counted(index) || index >= value.verseCount) return bad();
  const binding = await verseBinding(verse);
  const row = referenceRecord(await getJson(publicWordAidsPath(selector, kind, index), 160 * 1024, signal), ["kind", selectorKeys(selector), "verse", "wordAids"]);
  if (!row || row.kind !== kind || !echoes(row, selector) || row.verse !== index) return bad();
  return parseStudyWordAids(row.wordAids, binding) ?? bad();
}
export async function fetchPublicWordDetails(source: PublicSource, index: number, verse: StudyVerse, word: number, signal: AbortSignal): Promise<StudyWordDetails> {
  const { passage: value, selector } = source, kind = value.kind; if (!counted(index) || index >= value.verseCount || !counted(word, 511)) return bad();
  const binding = await verseBinding(verse);
  const row = referenceRecord(await getJson(publicWordDetailsPath(selector, kind, index, word), 32 * 1024, signal), ["kind", selectorKeys(selector), "verse", "wordDetails"]);
  if (!row || row.kind !== kind || !echoes(row, selector) || row.verse !== index) return bad();
  return parseStudyWordDetails(row.wordDetails, { ...binding, wordIndex: word }) ?? bad();
}
export async function fetchPublicShortPage(source: PublicSource, offset: number, signal: AbortSignal): Promise<PublicShortPage> {
  const { passage: value, selector } = source, kind = value.kind; if (!source.listening || !value.pages.some(page => page.offset === offset)) return bad();
  const plan = studyRangePlan(value.ranges, kind, offset);
  const row = referenceRecord(await getJson(publicShortPath(selector, kind, offset), 1024 * 1024, signal), ["kind", selectorKeys(selector), "page"]);
  if (!row || row.kind !== kind || !echoes(row, selector)) return bad();
  const page = referenceRecord(row.page, ["offset", "nextOffset", "totalVerses", "references"]);
  if (!page || page.offset !== offset || page.nextOffset !== plan.nextOffset || page.totalVerses !== value.verseCount || !Array.isArray(page.references) || page.references.length !== plan.refs.length) return bad();
  const references = page.references.map((raw, i) => { const parsed = parseReferenceShortResolution(raw); if (!parsed || parsed.verse.ref !== plan.refs[i]) return bad(); return parsed; });
  return Object.freeze({ offset, nextOffset: plan.nextOffset, totalVerses: value.verseCount, references: Object.freeze(references) });
}
