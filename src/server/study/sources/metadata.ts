import "server-only";
import { wordAidRef } from "../../../lib/hebrew/word-aids";

/** Application safety bounds, not promises about Sefaria catalog size. */
export const SOURCE_METADATA_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, related: 4096, editions: 512, expandedAnchors: 256,
  idBytes: 128, citationBytes: 512, titleBytes: 512, categoryBytes: 128, labelBytes: 256, languageBytes: 64, licenseBytes: 256, sourceBytes: 2048 });
export class SourceMetadataUnavailable extends Error {
  constructor() { super("Study source metadata unavailable"); this.name = "SourceMetadataUnavailable"; }
}
const fail = (): never => { throw new SourceMetadataUnavailable(); };
const size = (value: string) => new TextEncoder().encode(value).byteLength;
const absent = Symbol("absent"), invalid = Symbol("invalid");
type Row = Record<string, unknown>;
function row(value: unknown): Row | null { return value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)) ? value as Row : null; }
function field(value: Row, name: string): unknown { const d = Object.getOwnPropertyDescriptor(value, name); return !d ? absent : Object.hasOwn(d, "value") ? d.value : invalid; }
function list(value: unknown, bound: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > bound || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) return null; result.push(d.value); }
  return result;
}
function plain(value: unknown, bound: number): string | null {
  if (typeof value !== "string" || !value.length || value.length > bound || !value.isWellFormed()
    || /[<>\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value)) return null;
  const normalized = value.normalize("NFC");
  return normalized.trim() === normalized && size(normalized) <= bound ? normalized : null;
}
export function sourceMetadataVerse(value: unknown): string { return wordAidRef(value) ? value : fail(); }
export function sourceMetadataWork(value: unknown): string { const title = plain(value, SOURCE_METADATA_LIMITS.titleBytes); return title && title !== "." && title !== ".." ? title : fail(); }
function nullable(value: unknown, bound: number): string | null | typeof invalid {
  return value === absent || value === null || value === "" ? null : plain(value, bound) ?? invalid;
}
// Only direct body fields are inspected. collectiveTitle.en/he are title labels.
function hasText(value: Row) {
  for (const key of ["text", "he", "en", "hebrew", "english", "body", "content", "snippet", "segments"]) {
    const v = field(value, key);
    if (v === absent || v === null || v === "") continue;
    if (typeof v === "string") { if (v.trim()) return true; continue; }
    if (Array.isArray(v) && v.length === 0) continue;
    return true;
  }
  return false;
}
export type RelatedSourceMetadata = Readonly<{ id: string; ref: string; indexTitle: string; category: string; labels: Readonly<{ en: string | null; he: string | null }> }>;
export type SourceEditionMetadata = Readonly<{ versionTitle: string; language: string; actualLanguage: string | null; license: string | null; source: string | null }>;
export type RelatedSourceCatalog = Readonly<{ schema: "study-related-metadata/v1"; verse: string; entries: readonly RelatedSourceMetadata[]; receivedRows: number; heldCount: number; duplicateCount: number }>;
export type SourceEditionCatalog = Readonly<{ schema: "study-edition-metadata/v1"; workTitle: string; entries: readonly SourceEditionMetadata[]; receivedRows: number; heldCount: number; duplicateCount: number }>;
function anchor(value: Row, requested: string) {
  const exact = plain(field(value, "anchorRef"), SOURCE_METADATA_LIMITS.citationBytes);
  if (exact === requested) return true;
  const expanded = list(field(value, "anchorRefExpanded"), SOURCE_METADATA_LIMITS.expandedAnchors);
  if (!exact || !expanded?.length) return false;
  const unique = new Set<string>();
  for (const ref of expanded) { if (!wordAidRef(ref) || unique.has(ref)) return false; unique.add(ref); }
  return unique.has(requested);
}
function related(value: Row, requested: string): RelatedSourceMetadata | null {
  const id = field(value, "_id"), ref = plain(field(value, "sourceRef"), SOURCE_METADATA_LIMITS.citationBytes), alias = field(value, "ref");
  const indexTitle = plain(field(value, "index_title"), SOURCE_METADATA_LIMITS.titleBytes), category = plain(field(value, "category"), SOURCE_METADATA_LIMITS.categoryBytes);
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !ref || alias !== absent && plain(alias, SOURCE_METADATA_LIMITS.citationBytes) !== ref || !indexTitle || !category || !anchor(value, requested)) return null;
  const titles = field(value, "collectiveTitle"), labels = titles === absent || titles === null ? null : row(titles);
  if (titles !== absent && titles !== null && !labels) return null;
  const en = nullable(labels ? field(labels, "en") : absent, SOURCE_METADATA_LIMITS.labelBytes), he = nullable(labels ? field(labels, "he") : absent, SOURCE_METADATA_LIMITS.labelBytes);
  if (en === invalid || he === invalid) return null;
  return Object.freeze({ id, ref, indexTitle, category, labels: Object.freeze({ en, he }) });
}
function edition(value: Row, work: string): SourceEditionMetadata | null {
  if (plain(field(value, "title"), SOURCE_METADATA_LIMITS.titleBytes) !== work) return null;
  const versionTitle = plain(field(value, "versionTitle"), SOURCE_METADATA_LIMITS.titleBytes), language = plain(field(value, "language"), SOURCE_METADATA_LIMITS.languageBytes);
  const actualLanguage = nullable(field(value, "actualLanguage"), SOURCE_METADATA_LIMITS.languageBytes), license = nullable(field(value, "license"), SOURCE_METADATA_LIMITS.licenseBytes), source = nullable(field(value, "versionSource"), SOURCE_METADATA_LIMITS.sourceBytes);
  if (!versionTitle || !language || actualLanguage === invalid || license === invalid || source === invalid) return null;
  return Object.freeze({ versionTitle, language, actualLanguage, license, source });
}
/** All rows with one conflicting/invalid known identity remain held, irrespective of order. */
function project<T>(value: unknown, bound: number, identity: (row: Row) => string | null, parse: (row: Row) => T | null) {
  const values = list(value, bound); if (!values) return fail();
  const groups = new Map<string, { count: number; value: T | null; serialized: string | null; held: boolean }>(); let heldCount = 0;
  for (const item of values) {
    const r = row(item); if (!r) { heldCount++; continue; } if (hasText(r)) return fail();
    const key = identity(r); if (!key) { heldCount++; continue; }
    const parsed = parse(r), serialized = parsed === null ? null : JSON.stringify(parsed), previous = groups.get(key);
    if (!previous) groups.set(key, { count: 1, value: parsed, serialized, held: parsed === null });
    else { previous.count++; if (parsed === null || previous.serialized !== serialized) previous.held = true; }
  }
  const entries: T[] = []; let duplicateCount = 0, bytes = 0;
  for (const group of groups.values()) {
    if (group.held || group.value === null) heldCount += group.count;
    else { bytes += size(group.serialized!); if (bytes > SOURCE_METADATA_LIMITS.bytes) return fail(); entries.push(group.value); duplicateCount += group.count - 1; }
  }
  return { entries: Object.freeze(entries), receivedRows: values.length, heldCount, duplicateCount };
}
function bounded<T>(value: T): T { if (size(JSON.stringify(value)) > SOURCE_METADATA_LIMITS.bytes) return fail(); return Object.freeze(value); }
export function parseRelatedMetadata(value: unknown, requestedVerse: string): RelatedSourceCatalog {
  try {
    const verse = sourceMetadataVerse(requestedVerse);
    return bounded({ schema: "study-related-metadata/v1" as const, verse, ...project(value, SOURCE_METADATA_LIMITS.related,
      r => { const id = field(r, "_id"); return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null; }, r => related(r, verse)) });
  } catch { return fail(); }
}
export function parseEditionMetadata(value: unknown, requestedWork: string): SourceEditionCatalog {
  try {
    const workTitle = sourceMetadataWork(requestedWork);
    return bounded({ schema: "study-edition-metadata/v1" as const, workTitle, ...project(value, SOURCE_METADATA_LIMITS.editions,
      r => { const title = plain(field(r, "versionTitle"), SOURCE_METADATA_LIMITS.titleBytes), language = plain(field(r, "language"), SOURCE_METADATA_LIMITS.languageBytes); return title && language ? JSON.stringify([title, language]) : null; }, r => edition(r, workTitle)) });
  } catch { return fail(); }
}
