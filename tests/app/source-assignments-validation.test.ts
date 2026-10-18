import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import * as v from "../../src/server/study/source-assignments-validation";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { discoverRelatedPage, projectRelatedCatalog } from "../../src/server/study/sources/discovery";
const write = () => ({ verseRef: "Genesis 1:1", expectedVersion: 0, mutationId: randomUUID(), sourceIds: ["b","a"] });
test("intent is closed, immutable, sorted and independent of caller identity arrays", () => {
  const raw = write(), selected = v.intent(raw); raw.sourceIds.push("c"); expect(selected.sourceIds).toEqual(["a","b"]); expect(Object.isFrozen(selected.sourceIds)).toBe(true);
  for (const bad of [{ ...write(), sourceIds: ["a","a"] }, { ...write(), sourceIds: Array(33).fill("a") }, { ...write(), expectedVersion: 2147483647 }, { ...write(), catalogHash: "A".repeat(64) }, { ...write(), citations: [] }, { ...write(), sourceIds: ["https://example.test"] }]) expect(() => v.intent(bad)).toThrow();
  const getter = vi.fn(); expect(() => v.intent(Object.defineProperty(write(), "sourceIds", { get: getter }))).toThrow(); expect(getter).not.toHaveBeenCalled();
});
test("canonical digest binds mode, stream, verse, expected version, selected IDs and supplied catalog identity", () => {
  const s = { mode: "admin" as const, studentId: randomUUID(), kind: "torah" as const, assignmentId: randomUUID(), assignmentRevision: 1 }, w = v.intent(write()), d = v.digest(s,w);
  expect(v.digest(s,v.intent({ ...w, sourceIds: ["b","a"] }))).toBe(d);
  for (const [selection, intent] of [[{...s,assignmentRevision:2},w],[{...s,mode:"tutor" as const},w],[s,{...w,expectedVersion:1}],[s,{...w,catalogHash:"0".repeat(64)}],[s,{...w,sourceIds:["a"]}] ] as const) expect(v.digest(selection,intent)).not.toBe(d);
});
test("full-catalog helper extraction preserves discovery hashes and reaches off-page entries", () => {
  const catalog = parseRelatedMetadata(Array.from({length:40},(_,i)=>({_id:`id${String(i).padStart(2,"0")}`,sourceRef:`Invented ${i}`,index_title:"Invented",category:"Commentary",anchorRef:"Genesis 1:1"})),"Genesis 1:1");
  const full = projectRelatedCatalog(catalog,"Genesis 1:1"), page = discoverRelatedPage(catalog,"Genesis 1:1",{sourceOffset:0}); expect(full.entries).toHaveLength(40);expect(Object.isFrozen(full.entries)).toBe(true);
  expect(page.status==="ready"&&page.page.catalogHash).toBe(full.catalogHash);expect(page.status==="ready"&&page.page.entries).toEqual(full.entries.slice(0,10));
});
