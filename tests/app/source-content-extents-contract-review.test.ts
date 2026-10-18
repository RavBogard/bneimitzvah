import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseSourceContentResponse, SourceContentUnavailable } from "../../src/server/study/sources/content";

const work = "Invented Independent Contract Work";
const edition = { versionTitle: "Invented Independent Edition", language: "he", actualLanguage: "en", license: "Public Domain", source: "inert independent provenance" } as const;
function fixture(ref = `${work} 2:8`, text: unknown = ["Invented first.", "", "Invented last."]) {
  const parts = ref.slice(work.length + 1).split("-"), sections = parts[0].split(":"), range = parts.length === 2;
  const source = { id: "independent_contract", ref, indexTitle: work, category: "Commentary", labels: { en: null, he: null } };
  const version: Record<string, unknown> = { versionTitle: edition.versionTitle, language: edition.language, actualLanguage: edition.actualLanguage, languageFamilyName: "english", license: edition.license, versionSource: edition.source, text };
  const depth = sections.length + (range ? 0 : 1);
  const body: Record<string, unknown> = { ref, indexTitle: work, textDepth: depth, sections, toSections: range ? [...sections.slice(0, -1), parts[1]] : [...sections], addressTypes: Array.from({ length: depth }, (_, i) => ["Perek", "Pasuk", "Integer", "Pasuk"][i]), index_offsets_by_depth: {}, isComplex: false, isSpanning: false, warnings: [], versions: [version] };
  return { body, version, parse: () => parseSourceContentResponse(body, { source, edition, language: "en" }) };
}

test("mixed classes map a full 64-position range ending at the maximum coordinate without padding", () => {
  const ref = `${work} 2147483647:1:2147483584-2147483647`, f = fixture(ref, Array(64).fill(""));
  const value = f.parse();
  expect(value.schema).toBe("study-source-segments/v1");
  if (value.schema !== "study-source-segments/v1") throw Error("Expected extent");
  expect(value.extent).toEqual({ kind: "range", parentRef: `${work} 2147483647:1`, requestedStart: "2147483584", requestedEnd: "2147483647", observedStart: "2147483584", observedEnd: "2147483647" });
  expect(value.segments).toHaveLength(64);
  expect(value.segments[0]).toEqual({ ref: `${work} 2147483647:1:2147483584`, status: "missing", text: null });
  expect(value.segments[63]).toEqual({ ref: `${work} 2147483647:1:2147483647`, status: "missing", text: null });
  f.version.text = Array(63).fill(""); expect(f.parse).toThrow(SourceContentUnavailable);
  f.version.text = Array(65).fill(""); expect(f.parse).toThrow(SourceContentUnavailable);
});

test("allowed names require primitive exact strings without invoking conversion hooks", () => {
  const hook = vi.fn(() => "Perek");
  for (const type of [new String("Perek"), { toString: hook, valueOf: hook, [Symbol.toPrimitive]: hook }, Symbol("Pasuk"), "Pеrek", "Pasuk\u0000", "Integer.Perek"]) {
    const f = fixture(); f.body.addressTypes = ["Perek", "Pasuk", type]; expect(f.parse).toThrow(SourceContentUnavailable);
  }
  expect(hook).not.toHaveBeenCalled();
});

test("symbol side channels on otherwise empty warning/missing arrays and offsets remain held", () => {
  const marker = Symbol("independent extra proof");
  for (const key of ["warnings", "missings", "index_offsets_by_depth"]) {
    const f = fixture(), value = key === "index_offsets_by_depth" ? {} : [];
    Object.defineProperty(value, marker, { value: true, enumerable: false }); f.body[key] = value;
    expect(f.parse).toThrow(SourceContentUnavailable);
  }
  const f = fixture(); Object.defineProperty(f.body.addressTypes, marker, { value: true }); expect(f.parse).toThrow(SourceContentUnavailable);
});

test("null-prototype response facts and own nonenumerable empty missings retain the same closed observation", () => {
  const f = fixture(), expected = f.parse();
  Object.setPrototypeOf(f.body, null); Object.setPrototypeOf(f.version, null); f.body.index_offsets_by_depth = Object.create(null);
  Object.defineProperty(f.body, "missings", { value: [], enumerable: false });
  expect(f.parse()).toEqual(expected);
  expect(JSON.stringify(f.parse())).toBe(JSON.stringify(expected));
});

test("the public HTTP shape preserves selected edition and UTF8 aggregate boundaries with astral text", () => {
  const f = fixture(`${work} 2:8:4-5`, ["🚀".repeat(8192), "🚀".repeat(8192)]), value = f.parse();
  expect(value).toMatchObject({ edition: { versionTitle: edition.versionTitle, language: "he", actualLanguage: "en" }, provenance: { license: "Public Domain", versionSource: edition.source } });
  if (value.schema !== "study-source-segments/v1") throw Error("Expected extent");
  expect(value.segments.map(row => row.ref)).toEqual([`${work} 2:8:4`, `${work} 2:8:5`]);
  f.version.text = ["🚀".repeat(8192), "🚀".repeat(8192) + "x"]; expect(f.parse).toThrow(SourceContentUnavailable);
});

test("inherited missings cannot masquerade as absent even when own warnings and version proof are valid", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "missings"), hook = vi.fn(() => []);
  Object.defineProperty(Object.prototype, "missings", { get: hook, configurable: true });
  try {
    const f = fixture(); expect(f.parse).toThrow(SourceContentUnavailable); expect(hook).not.toHaveBeenCalled();
    Object.defineProperty(f.body, "missings", { value: [] });
    expect(f.parse().schema).toBe("study-source-segments/v1"); expect(hook).not.toHaveBeenCalled();
  } finally { if (previous) Object.defineProperty(Object.prototype, "missings", previous); else Reflect.deleteProperty(Object.prototype, "missings"); }
});
