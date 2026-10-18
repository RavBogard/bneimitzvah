import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { integer, verse } from "../student-work/validation";
export type SourceContentScope = Readonly<{ verseRef: string; sourceId: string }> & (Readonly<{ sourceScope: "assigned"; expectedSetVersion: number }> | Readonly<{ sourceScope: "related"; sourceCatalogHash: string }>);
export type EditionIntent = SourceContentScope & Readonly<{ editionOffset: number; editionCatalogHash?: string }>;
export type TextIntent = SourceContentScope & Readonly<{ editionCatalogHash: string; editionTitle: string; language: "he" | "en" }>;
export function catalogHash(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new HttpBoundaryError(); return value; }
export function editionTitle(value: unknown): string {
  if (typeof value !== "string" || !value.length || !value.isWellFormed() || value.trim() !== value || Buffer.byteLength(value) > 512 || /[|<>\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value)) throw new HttpBoundaryError(); return value;
}
function scope(row: Record<string, unknown>): SourceContentScope {
  if (typeof row.sourceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(row.sourceId)) throw new HttpBoundaryError();
  const common = { verseRef: verse(row.verseRef), sourceId: row.sourceId };
  if (row.sourceScope === "assigned" && !Object.hasOwn(row,"sourceCatalogHash")) return Object.freeze({ ...common, sourceScope: "assigned", expectedSetVersion: integer(row.expectedSetVersion,1,2147483646) });
  if (row.sourceScope === "related" && !Object.hasOwn(row,"expectedSetVersion")) return Object.freeze({ ...common, sourceScope: "related", sourceCatalogHash: catalogHash(row.sourceCatalogHash) });
  throw new HttpBoundaryError();
}
const common = ["verseRef","sourceId","sourceScope"], optional = ["expectedSetVersion","sourceCatalogHash"];
export function editionIntent(value: unknown): EditionIntent {
  const row = closedObject(value,[...common,"editionOffset"],[...optional,"editionCatalogHash"]), editionOffset = integer(row.editionOffset,0,510);
  if (editionOffset % 10 || editionOffset > 0 && !Object.hasOwn(row,"editionCatalogHash")) throw new HttpBoundaryError();
  return Object.freeze({ ...scope(row), editionOffset, ...(Object.hasOwn(row,"editionCatalogHash") ? {editionCatalogHash:catalogHash(row.editionCatalogHash)} : {}) });
}
export function textIntent(value: unknown): TextIntent {
  const row = closedObject(value,[...common,"editionCatalogHash","editionTitle","language"],optional);
  if (row.language !== "he" && row.language !== "en") throw new HttpBoundaryError();
  return Object.freeze({ ...scope(row), editionCatalogHash: catalogHash(row.editionCatalogHash), editionTitle: editionTitle(row.editionTitle), language: row.language });
}
