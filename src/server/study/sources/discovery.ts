import "server-only";
import { createHash } from "node:crypto";
import { SOURCE_METADATA_LIMITS as L, SourceMetadataUnavailable, sourceMetadataVerse, type RelatedSourceMetadata } from "./metadata";

export type SourcePageSelection = Readonly<{ sourceOffset: number; catalogHash?: string }>;
export type RelatedSourcePage = Readonly<{ schema: "study-related-page/v1"; ref: string; catalogHash: string; sourceOffset: number; pageSize: 10;
  totalEntries: number; receivedRows: number; heldCount: number; duplicateCount: number; nextSourceOffset: number | null; entries: readonly RelatedSourceMetadata[] }>;
const fail = (): never => { throw new SourceMetadataUnavailable(); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  return value as Record<string, unknown>;
}
function field(value: Record<string, unknown>, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key); return d && Object.hasOwn(d, "value") ? d.value : fail();
}
function plain(value: unknown, bound: number): string {
  if (typeof value !== "string" || !value.length || value.length > bound || !value.isWellFormed()
    || /[<>\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value)) return fail();
  const result = value.normalize("NFC");
  return result.trim() === result && Buffer.byteLength(result) <= bound ? result : fail();
}
function count(value: unknown): number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= L.related ? Number(value) : fail(); }
export function sourcePageSelection(value: unknown): SourcePageSelection {
  const row = object(value), sourceOffset = field(row, "sourceOffset"), hash = Object.getOwnPropertyDescriptor(row, "catalogHash");
  if (!Number.isSafeInteger(sourceOffset) || Number(sourceOffset) < 0 || Number(sourceOffset) > 4090 || Number(sourceOffset) % 10 !== 0
    || hash && (!Object.hasOwn(hash, "value") || typeof hash.value !== "string" || !/^[a-f0-9]{64}$/.test(hash.value)) || Number(sourceOffset) > 0 && !hash) return fail();
  return Object.freeze({ sourceOffset: Number(sourceOffset), ...(hash ? { catalogHash: hash.value as string } : {}) });
}
export function discoverRelatedPage(catalog: unknown, requestedRef: string, supplied: SourcePageSelection):
  Readonly<{ status: "ready"; page: RelatedSourcePage }> | Readonly<{ status: "catalog-changed" }> | Readonly<{ status: "invalid-page" }> {
  const selection = sourcePageSelection(supplied), ref = sourceMetadataVerse(requestedRef), row = object(catalog);
  if (field(row, "schema") !== "study-related-metadata/v1" || field(row, "verse") !== ref) return fail();
  const receivedRows = count(field(row, "receivedRows")), heldCount = count(field(row, "heldCount")), duplicateCount = count(field(row, "duplicateCount"));
  const raw = field(row, "entries");
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > L.related || Reflect.ownKeys(raw).length !== raw.length + 1) return fail();
  const ids = new Set<string>(), entries: RelatedSourceMetadata[] = [];
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i)); if (!d || !Object.hasOwn(d, "value")) return fail();
    const entry = object(d.value), id = field(entry, "id"), labels = object(field(entry, "labels"));
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || ids.has(id)) return fail();
    ids.add(id);
    const label = (key: string) => { const v = field(labels, key); return v === null ? null : plain(v, L.labelBytes); };
    entries.push(Object.freeze({ id, ref: plain(field(entry, "ref"), L.citationBytes), indexTitle: plain(field(entry, "indexTitle"), L.titleBytes),
      category: plain(field(entry, "category"), L.categoryBytes), labels: Object.freeze({ en: label("en"), he: label("he") }) }));
  }
  if (entries.length + heldCount + duplicateCount !== receivedRows) return fail();
  entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Stable, explicit serialization covers all closed normalized public catalog facts,
  // including held/duplicate rows. Provider row ordering and unknown fields do not.
  const serialized = JSON.stringify({ schema: "study-related-catalog-hash/v1", ref, receivedRows, heldCount, duplicateCount, entries });
  if (Buffer.byteLength(serialized) > L.bytes) return fail();
  const catalogHash = createHash("sha256").update(serialized).digest("hex");
  if (selection.catalogHash !== undefined && selection.catalogHash !== catalogHash) return Object.freeze({ status: "catalog-changed" });
  if (selection.sourceOffset >= entries.length && (selection.sourceOffset !== 0 || entries.length !== 0)) return Object.freeze({ status: "invalid-page" });
  const end = Math.min(entries.length, selection.sourceOffset + 10);
  return Object.freeze({ status: "ready", page: Object.freeze({ schema: "study-related-page/v1", ref, catalogHash,
    sourceOffset: selection.sourceOffset, pageSize: 10, totalEntries: entries.length, receivedRows, heldCount, duplicateCount,
    nextSourceOffset: end < entries.length ? end : null, entries: Object.freeze(entries.slice(selection.sourceOffset, end)) }) });
}
