import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { discoverRelatedPage, sourcePageSelection } from "../../src/server/study/sources/discovery";
import { parseRelatedMetadata, SourceMetadataUnavailable } from "../../src/server/study/sources/metadata";
const ref = "Genesis 1:1";
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: `id_${String(i).padStart(4, "0")}`, sourceRef: `Synthetic Work ${i}`, index_title: "Synthetic Work", category: "Commentary", anchorRef: ref, collectiveTitle: { en: "Synthetic title", he: null } }));
function ready(n: number, offset = 0, hash?: string) {
  const r = discoverRelatedPage(parseRelatedMetadata(rows(n), ref), ref, { sourceOffset: offset, ...(hash ? { catalogHash: hash } : {}) });
  if (r.status !== "ready") throw new Error("Expected ready page"); return r.page;
}
test("every entry beyond 64 remains reachable through explicit ten-entry pages through the final 4096 boundary", () => {
  for (const n of [0, 1, 10, 11, 71, 4096]) {
    let page = ready(n), ids = [...page.entries.map(e => e.id)]; const hash = page.catalogHash;
    while (page.nextSourceOffset !== null) { page = ready(n, page.nextSourceOffset, hash); ids.push(...page.entries.map(e => e.id)); }
    expect(ids.length).toBe(n); expect(new Set(ids).size).toBe(n); expect(page.nextSourceOffset).toBeNull(); expect(page.entries.length).toBeLessThanOrEqual(10);
  }
});
test("full sorted normalized catalog hash ignores row order but includes off-page facts and liability counts", () => {
  const raw = rows(21), a = parseRelatedMetadata(raw, ref), b = parseRelatedMetadata([...raw].reverse(), ref);
  const first = discoverRelatedPage(a, ref, { sourceOffset: 0 }); expect(discoverRelatedPage(b, ref, { sourceOffset: 0 })).toEqual(first);
  const page = ready(21); raw[20].category = "Different";
  expect(discoverRelatedPage(parseRelatedMetadata(raw, ref), ref, { sourceOffset: 10, catalogHash: page.catalogHash })).toEqual({ status: "catalog-changed" });
  expect(discoverRelatedPage({ ...a, receivedRows: 22, heldCount: 1 }, ref, { sourceOffset: 0, catalogHash: page.catalogHash })).toEqual({ status: "catalog-changed" });
});
test("changed hash precedes shorter catalog bounds; matching invalid page differs from a valid empty first page", () => {
  const a = ready(11), empty = parseRelatedMetadata([], ref);
  expect(discoverRelatedPage(empty, ref, { sourceOffset: 10, catalogHash: a.catalogHash })).toEqual({ status: "catalog-changed" });
  expect(discoverRelatedPage(empty, ref, { sourceOffset: 10, catalogHash: ready(0).catalogHash })).toEqual({ status: "invalid-page" });
  expect(discoverRelatedPage(parseRelatedMetadata(rows(10), ref), ref, { sourceOffset: 10, catalogHash: ready(10).catalogHash })).toEqual({ status: "invalid-page" });
});
test("page selection is captured without getters, requires explicit zero and hash on later pages", () => {
  for (const value of [{}, { sourceOffset: 1 }, { sourceOffset: 4100 }, { sourceOffset: 10 }, { sourceOffset: 0, catalogHash: "A".repeat(64) }]) expect(() => sourcePageSelection(value)).toThrow(SourceMetadataUnavailable);
  const getter = vi.fn(); expect(() => sourcePageSelection(Object.defineProperty({}, "sourceOffset", { get: getter }))).toThrow(); expect(getter).not.toHaveBeenCalled();
  const supplied = { sourceOffset: 0 }; const copy = sourcePageSelection(supplied); supplied.sourceOffset = 10; expect(copy.sourceOffset).toBe(0); expect(Object.isFrozen(copy)).toBe(true);
});
test("closed trusted catalog is independently bounded/copied; unexpected fields never reach pages or hash", () => {
  const catalog = parseRelatedMetadata(rows(1), ref), e = catalog.entries[0];
  const r = discoverRelatedPage({ ...catalog, private: "not returned", entries: [{ ...e, text: "not returned", labels: { ...e.labels, secret: "not returned" } }] }, ref, { sourceOffset: 0 });
  expect(r).toEqual(discoverRelatedPage(catalog, ref, { sourceOffset: 0 }));
  if (r.status === "ready") { expect(r.page.entries[0]).not.toBe(e); expect(Object.isFrozen(r.page.entries[0].labels)).toBe(true); }
  for (const bad of [{ ...catalog, verse: "Genesis 1:2" }, { ...catalog, heldCount: 1 }, { ...catalog, entries: [e, e], receivedRows: 2 }, { ...catalog, entries: [{ ...e, category: "<html>" }] }]) expect(() => discoverRelatedPage(bad, ref, { sourceOffset: 0 })).toThrow(SourceMetadataUnavailable);
});
test("ten maximum escaped entries leave room for the full authority envelope within 64KiB", () => {
  const catalog = { schema: "study-related-metadata/v1", verse: ref, receivedRows: 10, heldCount: 0, duplicateCount: 0,
    entries: rows(10).map(r => ({ id: r._id, ref: "\\".repeat(512), indexTitle: '"'.repeat(512), category: "\\".repeat(128), labels: { en: '"'.repeat(256), he: "\\".repeat(256) } })) };
  const result = discoverRelatedPage(catalog, ref, { sourceOffset: 0 }); expect(result.status).toBe("ready");
  expect(Buffer.byteLength(JSON.stringify({ authority: "x".repeat(8192), sources: result }))).toBeLessThan(65536);
});
