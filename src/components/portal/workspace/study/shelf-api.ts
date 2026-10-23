import { PortalRequestError } from "../../api";
import { getJson } from "../../public-reading/api";
import { referenceRecord } from "../../../../lib/reference-audio/source";
import { parseCompareVerse } from "../../../../lib/readings/compare";
import { creditLine, EDITION_TEXT_LIMITS, licenseLabel, plainCredit } from "../../../../lib/readings/edition-credit";
import { parseSourceRef, shelfGroupLabel, shelfGroupOf, shelfSefariaUrl, sourceSefariaUrl, SHELF_GROUP_KEYS, SHELF_LIMITS, type ShelfAnswer, type ShelfGroup,
  type ShelfGroupKey, type ShelfItem, type ShelfWork } from "../../../../lib/readings/shelf";
import type { CommentaryComment } from "../../../../lib/readings/commentary";
import { parseRuns } from "./commentary-api";

/**
 * More on this verse in the browser: same-origin GETs to /api/public/related and /api/public/source (no cookie,
 * no Authorization, the same answer for everyone), strictly parsed. Credits and links are recomputed here
 * and must match the server's; every title and citation is plain text.
 */
const bad = (): never => { throw new PortalRequestError(503); };
export const shelfPath = (verse: string) => `/api/public/related?${new URLSearchParams([["verse", verse]]).toString()}`;
export const sourcePath = (ref: string) => `/api/public/source?${new URLSearchParams([["ref", ref]]).toString()}`;
const count = (value: unknown, max: number, min = 0) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const text = (value: unknown, max: number) => typeof value === "string" && plainCredit(value, max) === value;

function work(value: unknown, group: ShelfGroupKey): ShelfWork {
  const row = referenceRecord(value, ["title", "heTitle", "dates", "category", "curated", "items", "more"]);
  if (!row || !text(row.title, SHELF_LIMITS.title) || row.heTitle !== null && !text(row.heTitle, SHELF_LIMITS.title) || !text(row.category, SHELF_LIMITS.category)
    || shelfGroupOf(row.category as string) !== group || typeof row.curated !== "boolean" || !count(row.more, 4096) || !Array.isArray(row.items) || row.items.length < 1
    || row.items.length > SHELF_LIMITS.itemsPerWork) return bad();
  let dates: readonly [number, number] | null = null;
  if (row.dates !== null) {
    if (!Array.isArray(row.dates) || row.dates.length !== 2 || !row.dates.every(year => Number.isSafeInteger(year) && year >= -4000 && year <= 2100) || row.dates[0] > row.dates[1]) return bad();
    dates = Object.freeze([row.dates[0], row.dates[1]] as const);
  }
  const items = row.items.map((raw): ShelfItem => {
    const item = referenceRecord(raw, ["ref", "segments"]);
    if (!item || parseSourceRef(item.ref) !== item.ref || !count(item.segments, SHELF_LIMITS.segments, 1)) return bad();
    return Object.freeze({ ref: item.ref as string, segments: item.segments as number });
  });
  if (new Set(items.map(item => item.ref)).size !== items.length) return bad();
  return Object.freeze({ title: row.title as string, heTitle: row.heTitle as string | null, dates, category: row.category as string, curated: row.curated, items: Object.freeze(items), more: row.more as number });
}
/** The shelf as the related route answers it: Sefaria's links, and the congregation's product name for the credit's change line. */
export type ShelfView = ShelfAnswer & Readonly<{ productName: string }>;
export function parseShelfAnswer(value: unknown, verse: string): ShelfView {
  const row = referenceRecord(value, ["verse", "sefariaUrl", "groups", "productName"]);
  if (!row || row.verse !== verse || row.sefariaUrl !== shelfSefariaUrl(verse) || !text(row.productName, 120) || !Array.isArray(row.groups) || row.groups.length > SHELF_GROUP_KEYS.length) return bad();
  let last = -1, works = 0;
  const groups = row.groups.map((raw): ShelfGroup => {
    const group = referenceRecord(raw, ["key", "label", "count", "works"]), at = SHELF_GROUP_KEYS.indexOf(group?.key as ShelfGroupKey);
    if (!group || at <= last || group.label !== shelfGroupLabel(group.key as ShelfGroupKey) || !count(group.count, 4096, 1) || !Array.isArray(group.works) || group.works.length < 1) return bad();
    last = at; works += group.works.length;
    if (works > SHELF_LIMITS.works) return bad();
    return Object.freeze({ key: group.key as ShelfGroupKey, label: group.label as string, count: group.count as number, works: Object.freeze(group.works.map(item => work(item, group.key as ShelfGroupKey))) });
  });
  return Object.freeze({ verse, sefariaUrl: row.sefariaUrl as string, groups: Object.freeze(groups), productName: row.productName as string });
}
export async function fetchShelf(verse: string, signal: AbortSignal): Promise<ShelfView> {
  if (!parseCompareVerse(verse)) return bad();
  return parseShelfAnswer(await getJson(shelfPath(verse), SHELF_LIMITS.responseBytes, signal), verse);
}

export type SourceEdition = Readonly<{ language: "he" | "en"; title: string; license: string; licenseLabel: string; credit: string; url: string }>;
export type SourceTextAnswer = Readonly<{ ref: string; sefariaUrl: string; segments: readonly CommentaryComment[]; editions: readonly SourceEdition[] }>;
export const SOURCE_TEXT_BYTES = 256 * 1024;
export function parseSourceText(value: unknown, ref: string): SourceTextAnswer {
  const row = referenceRecord(value, ["ref", "sefariaUrl", "segments", "editions"]);
  if (!row || row.ref !== ref || row.sefariaUrl !== sourceSefariaUrl(ref) || !Array.isArray(row.segments) || row.segments.length < 1 || row.segments.length > 64
    || !Array.isArray(row.editions) || row.editions.length > 2) return bad();
  const segments = row.segments.map((raw): CommentaryComment => {
    const segment = referenceRecord(raw, ["hebrew", "english"]);
    if (!segment) return bad();
    const hebrew = segment.hebrew === null ? null : parseRuns(segment.hebrew), english = segment.english === null ? null : parseRuns(segment.english);
    if (hebrew && !hebrew.length || english && !english.length || !hebrew && !english) return bad();
    return Object.freeze({ hebrew, english });
  });
  const editions = row.editions.map((raw): SourceEdition => {
    const edition = referenceRecord(raw, ["language", "title", "license", "licenseLabel", "credit", "url"]);
    if (!edition || edition.language !== "he" && edition.language !== "en" || !text(edition.title, EDITION_TEXT_LIMITS.title) || typeof edition.license !== "string"
      || edition.license !== "" && !text(edition.license, EDITION_TEXT_LIMITS.license) || edition.licenseLabel !== licenseLabel(edition.license)
      || edition.credit !== creditLine(edition.title as string, edition.license) || edition.url !== sourceSefariaUrl(ref, { language: edition.language, title: edition.title as string })) return bad();
    return Object.freeze({ language: edition.language, title: edition.title as string, license: edition.license, licenseLabel: edition.licenseLabel as string, credit: edition.credit as string, url: edition.url as string });
  });
  const languages = editions.map(edition => edition.language);
  // Each language shown is credited, once; nothing is credited that is not shown.
  if (new Set(languages).size !== languages.length || segments.some(segment => segment.hebrew) !== languages.includes("he")
    || segments.some(segment => segment.english) !== languages.includes("en")) return bad();
  return Object.freeze({ ref, sefariaUrl: row.sefariaUrl as string, segments: Object.freeze(segments), editions: Object.freeze(editions) });
}
export async function fetchSourceText(ref: string, signal: AbortSignal): Promise<SourceTextAnswer> {
  if (parseSourceRef(ref) !== ref) return bad();
  return parseSourceText(await getJson(sourcePath(ref), SOURCE_TEXT_BYTES, signal), ref);
}
