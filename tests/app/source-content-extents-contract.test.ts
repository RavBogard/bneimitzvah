import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseSourceContent, parseSourceContentResponse, SourceContentUnavailable } from "../../src/server/study/sources/content";
import { parseSourceSegments } from "../../src/server/study/sources/content-extents";

const work = "Invented Contract Work";
const edition = { versionTitle: "Invented Contract Edition", language: "en", actualLanguage: "he", license: "CC0", source: "inert invented provenance" } as const;
const source = (ref: string) => ({ id: "invented_contract", ref, indexTitle: work, category: "Commentary", labels: { en: null, he: null } });
function fixture(depth = 3, range = false, text: unknown = ["Invented first.", "", " Invented e\u0301.\n"]) {
  const sections = Array.from({ length: range ? depth : depth - 1 }, (_, i) => String(i + 2));
  if (range) sections[sections.length - 1] = "3";
  const ref = `${work} ${sections.join(":")}${range ? "-5" : ""}`;
  const version: Record<string, unknown> = { versionTitle: edition.versionTitle, language: edition.language, actualLanguage: "he", languageFamilyName: "hebrew", license: edition.license, versionSource: edition.source, text };
  const body: Record<string, unknown> = { ref, indexTitle: work, textDepth: depth, isComplex: false, addressTypes: Array(depth).fill("Integer"), index_offsets_by_depth: {}, sections, toSections: range ? [...sections.slice(0, -1), "5"] : [...sections], isSpanning: false, warnings: [], versions: [version] };
  const input = { source: source(ref), edition, language: "he" as const };
  return { body, version, input, parse: () => parseSourceSegments(body, input) };
}
function permutations(depth: number): string[][] {
  return depth === 0 ? [[]] : permutations(depth - 1).flatMap(prefix => ["Integer", "Perek", "Pasuk"].map(type => [...prefix, type]));
}
function inherited(key: string, descriptor: PropertyDescriptor, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, { ...descriptor, configurable: true });
  try { run(); } finally { if (previous) Object.defineProperty(Object.prototype, key, previous); else Reflect.deleteProperty(Object.prototype, key); }
}

test.each([2, 3, 4])("every explicit allowed address type at every depth-%i position preserves parent and range observations", depth => {
  for (const range of [false, true]) for (const types of permutations(depth)) {
    const f = fixture(depth, range); f.body.addressTypes = types;
    const value = f.parse(), parentRef = range ? f.input.source.ref.replace(/:[0-9]+-[0-9]+$/, "") : f.input.source.ref;
    expect(value.ref).toBe(f.input.source.ref);
    expect(value.extent).toEqual({ kind: range ? "range" : "parent", parentRef, requestedStart: range ? "3" : null, requestedEnd: range ? "5" : null, observedStart: range ? "3" : "1", observedEnd: range ? "5" : "3" });
    expect(value.segments).toEqual([
      { ref: `${parentRef}:${range ? 3 : 1}`, status: "text", text: "Invented first." },
      { ref: `${parentRef}:${range ? 4 : 2}`, status: "missing", text: null },
      { ref: `${parentRef}:${range ? 5 : 3}`, status: "text", text: " Invented e\u0301.\n" },
    ]);
    expect(parseSourceContentResponse(f.body, f.input)).toEqual(value);
  }
});

test("absent and own-empty missings preserve empty/all-missing observations and copy frozen snapshots", () => {
  for (const text of [[], ["", ""], ["Invented"]]) for (const present of [false, true]) {
    const f = fixture(3, false, text); f.body.addressTypes = ["Perek", "Integer", "Pasuk"];
    if (present) f.body.missings = [];
    const result = f.parse();
    expect(result.segments).toHaveLength(text.length);
    expect(result.extent.observedStart).toBe(text.length ? "1" : null);
    expect(result.extent.observedEnd).toBe(text.length ? String(text.length) : null);
    if (text.length === 2) expect(result.segments.map(row => row.status)).toEqual(["missing", "missing"]);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.segments)).toBe(true);
    expect(Object.isFrozen(result.extent)).toBe(true); expect(Object.isFrozen(result.edition)).toBe(true); expect(Object.isFrozen(result.provenance)).toBe(true);
    if (result.segments.length) expect(Object.isFrozen(result.segments[0])).toBe(true);
    const before = JSON.stringify(result); text.push("Changed"); (f.body.addressTypes as string[])[0] = "Talmud";
    expect(JSON.stringify(result)).toBe(before);
    text.pop();
  }
});

test.each([undefined, null, {}, "", false, ["hebrew"], Array(1), Object.assign([], { extra: true }), Object.setPrototypeOf([], null)])("own malformed missings %j remains unavailable", missings => {
  const f = fixture(); f.body.missings = missings; expect(f.parse).toThrow(SourceContentUnavailable);
});

test("own or inherited missings accessors and inherited data never invoke getters or count as absence", () => {
  const getter = vi.fn(() => []), own = fixture();
  Object.defineProperty(own.body, "missings", { get: getter }); expect(own.parse).toThrow(SourceContentUnavailable);
  inherited("missings", { value: [] }, () => expect(fixture().parse).toThrow(SourceContentUnavailable));
  inherited("missings", { get: getter }, () => expect(fixture().parse).toThrow(SourceContentUnavailable));
  expect(getter).not.toHaveBeenCalled();
});

test("required own empty warnings cannot be replaced by absent missings", () => {
  for (const value of [undefined, null, {}, "", [101], Array(1), Object.assign([], { extra: true })]) {
    const f = fixture(); f.body.warnings = value; expect(f.parse).toThrow(SourceContentUnavailable);
  }
  const absent = fixture(); delete absent.body.warnings; expect(absent.parse).toThrow(SourceContentUnavailable);
  const getter = vi.fn(() => []), accessor = fixture(); Object.defineProperty(accessor.body, "warnings", { get: getter }); expect(accessor.parse).toThrow(SourceContentUnavailable);
  inherited("warnings", { get: getter }, () => { const f = fixture(); delete f.body.warnings; expect(f.parse).toThrow(SourceContentUnavailable); });
  expect(getter).not.toHaveBeenCalled();
});

test.each(["Talmud", "Folio", "String", "Aliyah", "Year", "Dictionary", "Mishnah", "Volume", "Siman", "Halakhah", "Seif", "SeifKatan", "Section", "AddressInteger", "AddressPerek", "AddressPasuk", "integer", "perek", "pasuk", "PEREK", "Pasuk ", "Unknown", "", 1, null, undefined])("nonallowlisted address type %j fails even with canonical decimal coordinates", type => {
  for (const position of [0, 1, 2]) { const f = fixture(); (f.body.addressTypes as unknown[])[position] = type; expect(f.parse).toThrow(SourceContentUnavailable); }
});

test("address arrays require own dense data descriptors with the exact depth", () => {
  const sparse = Array(3); sparse[1] = "Perek"; sparse[2] = "Pasuk";
  for (const types of [undefined, null, "Perek", ["Perek", "Pasuk"], Array(4).fill("Integer"), sparse, Object.assign(["Perek", "Integer", "Pasuk"], { extra: true }), Object.setPrototypeOf(["Perek", "Integer", "Pasuk"], null)]) {
    const f = fixture(); f.body.addressTypes = types; expect(f.parse).toThrow(SourceContentUnavailable);
  }
  const getter = vi.fn(() => "Perek"), indexed = fixture(), outer = fixture();
  Object.defineProperty(indexed.body.addressTypes, "0", { get: getter }); expect(indexed.parse).toThrow(SourceContentUnavailable);
  Object.defineProperty(outer.body, "addressTypes", { get: getter }); expect(outer.parse).toThrow(SourceContentUnavailable);
  expect(getter).not.toHaveBeenCalled();
});

test("new address names retain exact node, reference, depth and positive ASCII string coordinate proof", () => {
  for (const patch of [{ ref: `${work} 2:4` }, { indexTitle: "Invented Other Work" }, { isComplex: true }, { isSpanning: true }, { spanningRefs: ["Invented"] }, { textDepth: 2 }, { textDepth: "3" }, { sections: [2, 3] }, { sections: ["02", "3"] }, { sections: ["２", "3"] }, { sections: ["0", "3"] }, { toSections: ["2", "4"] }]) {
    const f = fixture(); Object.assign(f.body, { addressTypes: ["Perek", "Pasuk", "Perek"] }, patch); expect(f.parse).toThrow(SourceContentUnavailable);
  }
  const getter = vi.fn(() => "2");
  for (const key of ["sections", "toSections"]) { const f = fixture(); Object.defineProperty(f.body[key], "0", { get: getter }); expect(f.parse).toThrow(SourceContentUnavailable); }
  expect(getter).not.toHaveBeenCalled();
  for (const ref of [`${work} 0:3`, `${work} 02:3`, `${work} ２:3`, `${work} +2:3`, `${work} 2:3:1-2:3:3`, `${work} 2:3:1-4:3`, `${work} 2:3:3-3`, `${work} 2:3:5-3`, `${work} 2:3:1-65`, `${work} 2147483648:3`]) {
    const f = fixture(); f.body.ref = ref; f.input.source.ref = ref; expect(f.parse).toThrow();
  }
  for (const depth of [1, 5]) expect(fixture(depth).parse).toThrow();
});

test("new address names still require own plain empty offsets", () => {
  for (const offsets of [undefined, null, [], { "3": 0 }, { "3": [] }, Object.assign({}, { extra: undefined })]) {
    const f = fixture(); f.body.addressTypes = ["Perek", "Pasuk", "Integer"]; f.body.index_offsets_by_depth = offsets; expect(f.parse).toThrow(SourceContentUnavailable);
  }
  const absent = fixture(); delete absent.body.index_offsets_by_depth; expect(absent.parse).toThrow(SourceContentUnavailable);
  const getter = vi.fn(() => ({})), accessor = fixture(); Object.defineProperty(accessor.body, "index_offsets_by_depth", { get: getter }); expect(accessor.parse).toThrow(SourceContentUnavailable);
  inherited("index_offsets_by_depth", { get: getter }, () => { const f = fixture(); delete f.body.index_offsets_by_depth; expect(f.parse).toThrow(SourceContentUnavailable); });
  expect(getter).not.toHaveBeenCalled();
  const nullPrototype = fixture(); nullPrototype.body.index_offsets_by_depth = Object.create(null); expect(nullPrototype.parse().segments).toHaveLength(3);
});

test("absent missings cannot substitute for exactly one eligible unchanged edition and no merged sources", () => {
  for (const versions of [[], [fixture().version, fixture().version], Array(1)]) { const f = fixture(); f.body.versions = versions; expect(f.parse).toThrow(SourceContentUnavailable); }
  for (const patch of [{ versionTitle: "Changed" }, { language: "he" }, { actualLanguage: "en" }, { languageFamilyName: "english" }, { versionSource: "Changed" }, { license: "Public Domain" }, { license: "CC-BY" }, { sources: ["Invented other edition"] }, { sources: null }, { sources: undefined }]) {
    const f = fixture(); Object.assign(f.version, patch); expect(f.parse).toThrow(SourceContentUnavailable);
  }
  const getter = vi.fn(() => []), accessor = fixture(); Object.defineProperty(accessor.version, "sources", { get: getter }); expect(accessor.parse).toThrow(SourceContentUnavailable); expect(getter).not.toHaveBeenCalled();
  const empty = fixture(); empty.version.sources = []; expect(empty.parse().segments).toHaveLength(3);
  const publicDomain = fixture(); publicDomain.version.license = "Public Domain";
  expect(parseSourceSegments(publicDomain.body, { ...publicDomain.input, edition: { ...edition, license: "Public Domain" } }).provenance.license).toBe("Public Domain");
});

test("new profiles preserve dense flat text, exact range counts, no tail padding and segment/aggregate caps", () => {
  for (const text of [Array(1), [null], [["nested"]], ["   "], ["<b>Invented</b>"], ["&amp;"], ["\ud800"], ["x\u202ey"], Array(65).fill("")]) expect(fixture(3, false, text).parse).toThrow(SourceContentUnavailable);
  const getter = vi.fn(() => "Invented"), accessor = fixture(); Object.defineProperty(accessor.version.text, "0", { get: getter }); expect(accessor.parse).toThrow(SourceContentUnavailable); expect(getter).not.toHaveBeenCalled();
  for (const text of [[], [""], ["", ""], ["", "", "", ""]]) expect(fixture(3, true, text).parse).toThrow(SourceContentUnavailable);
  const bounded = fixture(3, false, Array(64).fill("")); bounded.body.addressTypes = ["Perek", "Pasuk", "Perek"]; expect(bounded.parse().segments).toHaveLength(64);
  expect(fixture(3, false, ["a".repeat(32768), "b".repeat(32768)]).parse().segments).toHaveLength(2);
  expect(fixture(3, false, ["א".repeat(32768)]).parse().segments).toHaveLength(1);
  expect(fixture(3, false, ["a".repeat(32769), "b".repeat(32768)]).parse).toThrow(SourceContentUnavailable);
  expect(fixture(3, false, ["א".repeat(32768), "a"]).parse).toThrow(SourceContentUnavailable);
});

test("scalar v1 pure parser and dispatcher keep their old contract without new extent proof", () => {
  const f = fixture(3, false, "Invented scalar."); f.body.textDepth = 2;
  delete f.body.isComplex; delete f.body.addressTypes; delete f.body.index_offsets_by_depth;
  const expected = parseSourceContent(f.body, f.input);
  expect(expected).toMatchObject({ schema: "study-source-text/v1", text: "Invented scalar." });
  expect(parseSourceContentResponse(f.body, f.input)).toEqual(expected);
  const getter = vi.fn(() => ["hebrew"]); Object.defineProperty(f.body, "missings", { get: getter });
  expect(parseSourceContent(f.body, f.input)).toEqual(expected); expect(parseSourceContentResponse(f.body, f.input)).toEqual(expected); expect(getter).not.toHaveBeenCalled();
});
