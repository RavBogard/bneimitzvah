import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseServiceFeed, serviceUnitsForSlot, ServiceFeedInvalid, SERVICE_FEED_LIMITS,
  type ServiceFeedPins } from "../../src/server/service-learning/feed";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
// Invented Hebrew syllables and labels only. No producer prayer text or licensed fixture.
function fixture() {
  const units = ["bm-shacharit", "bm-maariv"].map((family, index) => ({
    id: `sample.part@${family}`, name: `Synthetic part ${index}`, section: index,
    caption: "Synthetic attribution — Example Author", group: null, standalone: true,
    render: "interleave", shortName: "Example", printedFolio: index + 1, folios: [index + 1],
    renderStructure: { kind: "short-prayer", groups: [1, 1] },
    blocks: [{ type: "display", he: "א֑ב\u200f", bare: "אב", tr: "hidden-synthetic",
      en: [{ t: "Synthetic " }, { em: [{ strong: [{ t: "nested" }] }] }, { footnote: [{ t: "Example credit" }] }],
      footnote: [{ t: "Synthetic author credit" }], label: "Example 1", verse: "Example 1",
      folio: index + 1, phys: index + 1, marks: [{ type: "ritual", label: "Synthetic cue" }], gold: false },
    { type: "english", he: "גּד", tr: "hidden-two", en: "First synthetic. Second synthetic.",
      folio: index + 1, phys: index + 1 }],
    sourceBoundaries: { en: [{ block: 1, endAfter: "First synthetic." }] },
  }));
  return {
    feed: { schemaVersion: 1, volume: "legacy-beit-mitzvah", title: { en: "Synthetic service", he: "אב" },
      printing: { gitSha: "abcdef1-LICENSED", pages: 8, builtAt: "2026-10-15T12:00:00Z",
        source: { gitSha: "abcdef1-LICENSED", pages: 8, builtAt: "2026-10-15T12:00:00Z", lane: "licensed" } },
      license: { spdx: "LicenseRef-Synthetic-CRC", attribution: "Synthetic credit; CRC use only; not redistribution permission." },
      sections: [{ idx: 0, en: "Synthetic morning", he: "אב", folio: 1 }, { idx: 1, en: "Synthetic evening", he: null, folio: 2 }],
      units, front: [{ type: "rubric", text: [{ t: "Synthetic preface" }], footnote: [{ t: "Synthetic preface credit" }] }],
      pageIndex: { "1": [{ unit: units[0].id, block: 0 }], "2": [{ unit: units[1].id, block: 0 }] } },
    provenance: { schemaVersion: 1, producedBy: "build/build-app.sh via .github/workflows/build-siddur.yml",
      sourceRepo: "Example/SyntheticSiddur", sourceSha: "1".repeat(40), sourceShaShort: "1111111", sourceRef: "refs/heads/main",
      builtAt: "2026-10-16T12:00:00Z", runId: "12345", runUrl: "https://github.com/Example/SyntheticSiddur/actions/runs/12345",
      bookCount: 2, books: ["legacy-beit-mitzvah", "synthetic-other"], lane: "licensed", laneWhy: "Synthetic licensed artifact" },
  };
}
type Fixture = ReturnType<typeof fixture>;
function bytes(value = fixture()) {
  const feedBytes = encode(value.feed), provenanceBytes = encode(value.provenance);
  const pins: ServiceFeedPins = { feedSha256: sha(feedBytes), provenanceSha256: sha(provenanceBytes),
    artifactRepo: "Example/SyntheticSiddur", artifactCommit: "1".repeat(40), artifactRunId: "12345", sourceGitSha: "abcdef1-LICENSED" };
  return { feedBytes, provenanceBytes, pins };
}
function parse(value = fixture()) { const b = bytes(value); return parseServiceFeed(b.feedBytes, b.provenanceBytes, b.pins); }
function rejected(value: Fixture) { expect(() => parse(value)).toThrowError(new ServiceFeedInvalid()); }

test("bounded both-family feed preserves exact Unicode, nested spans, footnotes, credits and source order without transliteration", () => {
  const value = fixture(), result = parse(value);
  expect(result.units.map(x => x.id)).toEqual(value.feed.units.map(x => x.id));
  expect(result.units[0].blocks[0].he).toBe(value.feed.units[0].blocks[0].he);
  expect(result.units[0].blocks[0].en).toEqual(value.feed.units[0].blocks[0].en);
  expect(result.units[0].blocks[0].footnote).toEqual(value.feed.units[0].blocks[0].footnote);
  expect(result.units[0].caption).toBe(value.feed.units[0].caption);
  expect(result.license).toEqual(value.feed.license);
  expect(result.front).toEqual(value.feed.front);
  expect(result.units[0].renderStructure).toEqual(value.feed.units[0].renderStructure);
  expect(result.units[0].sourceBoundaries).toEqual(value.feed.units[0].sourceBoundaries);
  expect(JSON.stringify(result)).not.toContain('"tr"');
  expect(JSON.stringify(result)).not.toContain("hidden-synthetic");
  expect(Object.isFrozen(result.units[0].blocks[0].en)).toBe(true);
});

test("verified source identity is separate from artifact commit, deterministic, byte-bound, and not a rights grant", () => {
  const value = fixture(), first = parse(value);
  expect(first.source.gitSha).toBe("abcdef1-LICENSED"); expect(first.artifact.commit).toBe("1".repeat(40));
  expect(first.identity).toBe(parse(value).identity);
  value.feed.license.attribution += " Synthetic correction.";
  expect(parse(value).identity).not.toBe(first.identity);
  expect(first.license.attribution).toContain("not redistribution permission");
  const b = bytes(); b.feedBytes[0] = 32;
  expect(() => parseServiceFeed(b.feedBytes, b.provenanceBytes, b.pins)).toThrow(ServiceFeedInvalid);
  const c = bytes(); c.provenanceBytes[0] = 32;
  expect(() => parseServiceFeed(c.feedBytes, c.provenanceBytes, c.pins)).toThrow(ServiceFeedInvalid);
});

test("slot grouping is explicit and does not select a religious subset or fall back for unknown slot", () => {
  const result = parse();
  expect(serviceUnitsForSlot(result, "morning").map(x => x.family)).toEqual(["bm-shacharit"]);
  expect(serviceUnitsForSlot(result, "havdalah").map(x => x.family)).toEqual(["bm-maariv"]);
  expect(serviceUnitsForSlot(result, "unknown")).toEqual([]);
  expect(() => serviceUnitsForSlot(result, "other" as "unknown")).toThrow(ServiceFeedInvalid);
});

test.each([
  ["schema", (v: Fixture) => { v.feed.schemaVersion = 2; }],
  ["volume", (v: Fixture) => { v.feed.volume = "shabbat-shacharit"; }],
  ["source lane", (v: Fixture) => { v.feed.printing.source.lane = "public"; }],
  ["source commit", (v: Fixture) => { v.feed.printing.source.gitSha = "2222222-LICENSED"; }],
  ["flat source commit", (v: Fixture) => { v.feed.printing.gitSha = "2222222-LICENSED"; }],
  ["source pages", (v: Fixture) => { v.feed.printing.source.pages = 7; }],
  ["source time", (v: Fixture) => { v.feed.printing.source.builtAt = "2026-10-14T12:00:00Z"; }],
  ["invalid time", (v: Fixture) => { v.provenance.builtAt = "2026-02-31T12:00:00Z"; }],
  ["artifact version", (v: Fixture) => { v.provenance.schemaVersion = 2; }],
  ["artifact lane", (v: Fixture) => { v.provenance.lane = "public"; }],
  ["artifact producer", (v: Fixture) => { v.provenance.producedBy = "other"; }],
  ["artifact repo", (v: Fixture) => { v.provenance.sourceRepo = "Other/Repo"; }],
  ["artifact sha", (v: Fixture) => { v.provenance.sourceSha = "2".repeat(40); }],
  ["artifact short sha", (v: Fixture) => { v.provenance.sourceShaShort = "2222222"; }],
  ["artifact ref", (v: Fixture) => { v.provenance.sourceRef = "refs/heads/untrusted"; }],
  ["artifact run", (v: Fixture) => { v.provenance.runId = "999"; }],
  ["artifact URL", (v: Fixture) => { v.provenance.runUrl = "https://example.test/"; }],
  ["missing book", (v: Fixture) => { v.provenance.books[0] = "other"; }],
  ["duplicate book", (v: Fixture) => { v.provenance.books[1] = v.provenance.books[0]; }],
  ["book count", (v: Fixture) => { v.provenance.bookCount = 3; }],
  ["duplicate unit", (v: Fixture) => { v.feed.units[1].id = v.feed.units[0].id; }],
  ["foreign unit", (v: Fixture) => { v.feed.units[0].id = "sample.part@other"; }],
  ["missing section", (v: Fixture) => { v.feed.units[0].section = 42; }],
  ["duplicate section", (v: Fixture) => { v.feed.sections[1].idx = 0; }],
  ["missing page unit", (v: Fixture) => { v.feed.pageIndex["1"][0].unit = "missing.part@bm-shacharit"; }],
  ["missing page block", (v: Fixture) => { v.feed.pageIndex["1"][0].block = 9; }],
  ["nonfirst page block", (v: Fixture) => { v.feed.pageIndex["1"][0].block = 1; }],
  ["wrong page", (v: Fixture) => { v.feed.units[0].blocks[0].folio = 3; }],
  ["duplicate page locator", (v: Fixture) => { v.feed.pageIndex["1"].push(v.feed.pageIndex["1"][0]); }],
  ["missing page locator", (v: Fixture) => { v.feed.pageIndex["1"] = []; }],
  ["out of range folio", (v: Fixture) => { v.feed.units[0].folios = [SERVICE_FEED_LIMITS.pages + 1]; }],
  ["unknown block", (v: Fixture) => { v.feed.units[0].blocks[0].type = "html"; }],
  ["contradictory verse label", (v: Fixture) => { v.feed.units[0].blocks[0].verse = "Other"; }],
  ["unknown structure", (v: Fixture) => { v.feed.units[0].renderStructure.kind = "new-renderer"; }],
  ["bad group count", (v: Fixture) => { v.feed.units[0].renderStructure.groups = [3]; }],
  ["unknown render", (v: Fixture) => { v.feed.units[0].render = "html"; }],
  ["bad boundary block", (v: Fixture) => { v.feed.units[0].sourceBoundaries.en[0].block = 9; }],
  ["missing boundary anchor", (v: Fixture) => { v.feed.units[0].sourceBoundaries.en[0].endAfter = "absent"; }],
  ["terminal boundary", (v: Fixture) => { v.feed.units[0].sourceBoundaries.en[0].endAfter = "Second synthetic."; }],
  ["repeated boundary", (v: Fixture) => { v.feed.units[0].sourceBoundaries.en.push(v.feed.units[0].sourceBoundaries.en[0]); }],
] as const)("atomically rejects %s even when altered bytes are independently re-pinned", (_name, mutate) => {
  const v = fixture(); mutate(v); rejected(v);
});

test("closed contracts reject absent required fields and unrecognized/reader-authored metadata", () => {
  const cases: [string, string][] = [["root", "schemaVersion"], ["printing", "source"], ["unit", "id"], ["block", "type"]];
  for (const [scope, key] of cases) {
    const v = fixture(); const target = scope === "root" ? v.feed : scope === "printing" ? v.feed.printing : scope === "unit" ? v.feed.units[0] : v.feed.units[0].blocks[0];
    delete (target as Record<string, unknown>)[key]; rejected(v);
  }
  for (const scope of ["root", "printing", "unit", "block", "span", "provenance"]) {
    const v = fixture(), target = scope === "root" ? v.feed : scope === "printing" ? v.feed.printing : scope === "unit" ? v.feed.units[0] : scope === "block" ? v.feed.units[0].blocks[0] : scope === "span" ? v.feed.units[0].blocks[0].en[0] : v.provenance;
    Object.assign(target!, { unsupported: "Synthetic unexpected field" }); rejected(v);
  }
  const v = fixture(); Object.assign(v.feed.printing, { carry: { edits: 0 } }); rejected(v);
});

test("coordinated segments retain Hebrew/English and folios, never transliteration, and must match canonical blocks", () => {
  const v = fixture(), u = v.feed.units[0];
  u.blocks[0].en = [{ t: "Synthetic" }]; // nested spans cannot be flattened to pretend a segment mapping
  Object.assign(u, { renderSegments: { he: ["א֑ב\u200fגּד"], en: ["SyntheticFirst synthetic. Second synthetic."], tr: ["hidden-synthetichidden-two"], folios: [1] } });
  rejected(v);
  // A separately authored simple unit supports exact segments without text rewriting.
  const v2 = fixture(), u2 = v2.feed.units[0];
  Object.assign(u2.blocks[0], { en: "Synthetic" });
  Object.assign(u2, { renderSegments: { he: ["א֑ב\u200f", "גּד"], en: ["Synthetic", "First synthetic. Second synthetic."], tr: ["hidden-synthetic", "hidden-two"], folios: [1, 1] } });
  const result = parse(v2);
  expect(result.units[0].renderSegments).toEqual({ he: ["א֑ב\u200f", "גּד"], en: ["Synthetic", "First synthetic. Second synthetic."], folios: [1, 1] });
  expect(JSON.stringify(result)).not.toContain('"tr"');
  Object.assign(u2, { renderSegments: { he: ["wrong"], en: ["wrong"], tr: ["wrong"] } }); rejected(v2);
});

test("companion references must resolve in the same family and preserve paired metadata", () => {
  const v = fixture(), companion = structuredClone(v.feed.units[0]);
  companion.id = "sample.companion@bm-shacharit";
  Object.assign(companion, { companionOf: v.feed.units[0].id, companionRole: "preparation" });
  v.feed.units.push(companion); v.feed.pageIndex["1"].push({ unit: companion.id, block: 0 });
  expect(parse(v).units[2].companionRole).toBe("preparation");
  Object.assign(companion, { companionOf: v.feed.units[1].id }); rejected(v);
  Object.assign(companion, { companionOf: "missing.part@bm-shacharit" }); rejected(v);
  Object.assign(companion, { companionOf: companion.id }); rejected(v);
});

test("text containing markup stays inert exact data, and invalid input errors contain no supplied text", () => {
  const v = fixture(); v.feed.units[0].name = '<script>synthetic-private-marker</script>';
  expect(parse(v).units[0].name).toBe(v.feed.units[0].name);
  v.feed.units[0].render = v.feed.units[0].name;
  try { parse(v); throw new Error("Expected rejection"); } catch (error) {
    expect(error).toBeInstanceOf(ServiceFeedInvalid); expect(String(error)).toBe("ServiceFeedInvalid: Service feed unavailable");
    expect(JSON.stringify(error)).not.toContain("synthetic-private-marker"); expect(error).not.toHaveProperty("cause");
  }
});

test("pins are independent required exact hashes and artifact/source identities", () => {
  const b = bytes();
  for (const change of [{ feedSha256: "0".repeat(64) }, { provenanceSha256: "0".repeat(64) }, { artifactCommit: "2".repeat(40) },
    { artifactRepo: "Other/Repo" }, { artifactRunId: "9" }, { sourceGitSha: "2222222-LICENSED" }, { feedSha256: "bad" }]) {
    expect(() => parseServiceFeed(b.feedBytes, b.provenanceBytes, { ...b.pins, ...change })).toThrow(ServiceFeedInvalid);
  }
});

test("byte, nesting, string, unit, block and pointer limits reject before unbounded normalization", () => {
  const b = bytes();
  for (const [feedBytes, provenanceBytes] of [[new Uint8Array(SERVICE_FEED_LIMITS.feedBytes + 1), b.provenanceBytes], [b.feedBytes, new Uint8Array(SERVICE_FEED_LIMITS.provenanceBytes + 1)]])
    expect(() => parseServiceFeed(feedBytes, provenanceBytes, b.pins)).toThrow(ServiceFeedInvalid);
  const rawCases = ['['.repeat(SERVICE_FEED_LIMITS.depth + 1) + '0' + ']'.repeat(SERVICE_FEED_LIMITS.depth + 1),
    JSON.stringify({ x: "x".repeat(SERVICE_FEED_LIMITS.string + 1) }), '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{bad}', '"unterminated'];
  for (const raw of rawCases) {
    const feedBytes = new TextEncoder().encode(raw);
    expect(() => parseServiceFeed(feedBytes, b.provenanceBytes, { ...b.pins, feedSha256: sha(feedBytes) })).toThrow(ServiceFeedInvalid);
  }
  const invalidUtf8 = new Uint8Array([0xc0, 0xaf]);
  expect(() => parseServiceFeed(invalidUtf8, b.provenanceBytes, { ...b.pins, feedSha256: sha(invalidUtf8) })).toThrow(ServiceFeedInvalid);
  const v = fixture(); v.feed.units = Array.from({ length: SERVICE_FEED_LIMITS.units + 1 }, () => v.feed.units[0]); rejected(v);
  const w = fixture(); w.feed.units[0].blocks = Array.from({ length: SERVICE_FEED_LIMITS.blocksPerUnit + 1 }, () => w.feed.units[0].blocks[0]); rejected(w);
  const x = fixture(); x.feed.pageIndex["1"] = Array.from({ length: SERVICE_FEED_LIMITS.pointers + 1 }, () => x.feed.pageIndex["1"][0]); rejected(x);
});

test("aggregate block, section and token budgets apply independently of individual-unit size", () => {
  const v = fixture();
  v.feed.sections = Array.from({ length: SERVICE_FEED_LIMITS.sections + 1 }, (_, idx) => ({ idx, en: "Synthetic", he: null, folio: 1 })); rejected(v);
  const w = fixture();
  // Each unit is individually within bounds; the accumulated 17 x 256 is not.
  w.feed.units = Array.from({ length: 17 }, (_, i) => {
    const unit = structuredClone(w.feed.units[0]); unit.id = `sample.part-${i}@bm-shacharit`;
    Object.assign(unit, { blocks: Array.from({ length: 256 }, () => ({ type: "english", en: "First synthetic. Second synthetic.", folio: 1 })) });
    return unit;
  });
  w.feed.front = [];
  w.feed.pageIndex = { "1": w.feed.units.map(unit => ({ unit: unit.id, block: 0 })), "2": [] };
  const near = structuredClone(w); near.feed.units.pop(); near.feed.pageIndex["1"].pop();
  delete (near.feed.pageIndex as Record<string, unknown>)["2"];
  expect(parse(near).units.reduce((sum, unit) => sum + unit.blocks.length, 0)).toBe(SERVICE_FEED_LIMITS.blocks);
  rejected(w);
  const b = bytes(), tokens = new TextEncoder().encode('[' + '0,'.repeat(SERVICE_FEED_LIMITS.nodes) + '0]');
  expect(tokens.byteLength).toBeLessThan(SERVICE_FEED_LIMITS.feedBytes);
  expect(() => parseServiceFeed(tokens, b.provenanceBytes, { ...b.pins, feedSha256: sha(tokens) })).toThrow(ServiceFeedInvalid);
  const exact = fixture(); exact.feed.title.en = "א".repeat(SERVICE_FEED_LIMITS.string);
  expect(parse(exact).title).toEqual(exact.feed.title);
});

test("nested and orientation metadata cannot smuggle unsupported shapes or unresolved pointers", () => {
  const b = fixture(); Object.assign(b.feed.units[0].blocks[0].en[0], { em: [{ t: "Synthetic" }] }); rejected(b);
  const c = fixture(); Object.assign(c.feed.units[0], { companionOf: c.feed.units[1].id }); rejected(c);
  for (const structure of [{ kind: "short-prayer", head: 3 }, { kind: "refrain-song", refrain: 2 },
    { kind: "short-prayer", groups: [0] }, { kind: "short-prayer", script: "Synthetic" }]) {
    const v = fixture(); Object.assign(v.feed.units[0], { renderStructure: structure }); rejected(v);
  }
  const v = fixture(), companion = structuredClone(v.feed.units[0]); companion.id = "sample.companion@bm-shacharit";
  Object.assign(v.feed.units[0], { companionOf: companion.id, companionRole: "preparation" });
  Object.assign(companion, { companionOf: v.feed.units[0].id, companionRole: "preparation" });
  v.feed.units.push(companion); v.feed.pageIndex["1"].push({ unit: companion.id, block: 0 }); rejected(v);
  const repeated = fixture(); Object.assign(repeated.feed.units[0].blocks[1], { en: "First synthetic. First synthetic. End." }); rejected(repeated);
});

test("producer block granularity is explicit, preserved and never defaulted", () => {
  expect(parse()).not.toHaveProperty("blockGranularity");
  for (const blockGranularity of ["line", "stanza"]) {
    const v = fixture(); Object.assign(v.feed, { blockGranularity });
    expect(parse(v)).toHaveProperty("blockGranularity", blockGranularity);
  }
  for (const blockGranularity of [null, 1, "paragraph", ""]) {
    const v = fixture(); Object.assign(v.feed, { blockGranularity }); rejected(v);
  }
});

test("rendering counts fit their body and refrain indices address groups rather than blocks", () => {
  for (const renderStructure of [
    { kind: "paired-passages", head: 1, groups: [1], tail: 0 },
    { kind: "short-sequence", head: 1, rows: [1], tail: 0 },
    { kind: "refrain-song", groups: [2], refrainGroups: [0] },
    { kind: "stanza-groups", groups: [1, 1], tail: 0, refrainGroups: [] },
  ]) {
    const v = fixture(); Object.assign(v.feed.units[0], { renderStructure });
    expect(parse(v).units[0].renderStructure).toEqual(renderStructure);
  }
  for (const renderStructure of [
    { kind: "paired-passages", head: 1, groups: [2], tail: 0 },
    { kind: "paired-passages", head: 0, groups: [1], tail: 0 },
    { kind: "short-sequence", head: 2, rows: [1], tail: 0 },
    { kind: "short-sequence", head: 1, rows: 2, tail: 0 },
    { kind: "refrain-song", groups: [2], refrainGroups: [1] },
    { kind: "refrain-song", groups: [1, 1], refrainGroups: [0, 0] },
    { kind: "refrain-song", groups: [2], refrainGroups: [] },
    { kind: "short-prayer", head: 2, tail: 1 },
  ]) {
    const v = fixture(); Object.assign(v.feed.units[0], { renderStructure }); rejected(v);
  }
});

test("page-key cardinality is rejected before scanning a dynamic field allowlist", () => {
  const v = fixture();
  Object.assign(v.feed, { pageIndex: Object.fromEntries(Array.from({ length: 32_000 }, (_, i) => ["0".repeat(32) + i, []])) });
  expect(encode(v.feed).byteLength).toBeLessThan(SERVICE_FEED_LIMITS.feedBytes);
  rejected(v);
});

test("producer section-opener booleans, original-English role and empty captions survive without inference", () => {
  const v = fixture();
  Object.assign(v.feed.sections[0], { opener: true }); Object.assign(v.feed.sections[1], { opener: false });
  Object.assign(v.feed.units[0].blocks[1], { role: "original" });
  v.feed.units[0].caption = "";
  const result = parse(v);
  expect(result.sections[0].opener).toBe(true); expect(result.sections[1].opener).toBe(false);
  expect(result.units[0].blocks[1].role).toBe("original"); expect(result.units[0].caption).toBe("");
  expect(result.units[0].blocks[0].footnote).toEqual(v.feed.units[0].blocks[0].footnote);
  expect(result.license).toEqual(v.feed.license);
  const absent = parse();
  expect(absent.sections[0]).not.toHaveProperty("opener");
  expect(absent.units[0].blocks[1]).not.toHaveProperty("role");
  expect(JSON.stringify(result)).not.toContain('"tr"');
});

test("new producer metadata has exact closed types and unsupported roles remain unavailable", () => {
  for (const opener of [null, 0, 1, "true", [], {}]) {
    const v = fixture(); Object.assign(v.feed.sections[0], { opener }); rejected(v);
  }
  for (const role of [null, 0, "", "translation", "unsupported", {}, []]) {
    const v = fixture(); Object.assign(v.feed.units[0].blocks[1], { role }); rejected(v);
  }
  const wrongBlock = fixture(); Object.assign(wrongBlock.feed.units[0].blocks[0], { role: "original" }); rejected(wrongBlock);
  const noEnglish = fixture(); Object.assign(noEnglish.feed.units[0].blocks[1], { role: "original" });
  delete (noEnglish.feed.units[0].blocks[1] as Record<string, unknown>).en; rejected(noEnglish);
  for (const caption of [null, false, {}, []]) {
    const v = fixture(); Object.assign(v.feed.units[0], { caption }); rejected(v);
  }
});

function mixedCoordinates() {
  const v = fixture(); v.feed.printing.pages = 63; v.feed.printing.source.pages = 63;
  const original = v.feed.units[0].blocks[1];
  v.feed.units[0].blocks = Array.from({ length: 85 }, (_, i) => ({ ...structuredClone(original), folio: i + 1, phys: i + 2 }));
  v.feed.units[0].folios = Array.from({ length: 85 }, (_, i) => i + 1); v.feed.units[0].printedFolio = 63;
  for (const block of v.feed.units[1].blocks) { block.folio = 85; block.phys = 86; }
  v.feed.units[1].folios = [85]; v.feed.sections[1].folio = 85;
  const index: Record<string, { unit: string; block: number }[]> = {};
  for (let i = 0; i < 85; i++) index[String(i + 1)] = [{ unit: v.feed.units[0].id, block: i }];
  index["85"].push({ unit: v.feed.units[1].id, block: 0 });
  Object.assign(v.feed, { pageIndex: index }); return v;
}
test("served-PDF pages remain separate from bounded internal folio/physical coordinates", () => {
  const v = mixedCoordinates(), result = parse(v);
  expect(result.source.pages).toBe(63); expect(result.units[0].printedFolio).toBe(63);
  expect(result.sections[1].folio).toBe(85); expect(result.units[0].folios?.at(-1)).toBe(85);
  expect(result.units[1].blocks[0].folio).toBe(85); expect(result.units[1].blocks[0].phys).toBe(86);
  expect(Object.keys(result.pageIndex)).toHaveLength(85); expect(result.pageIndex).toEqual(v.feed.pageIndex);
});
test("separate coordinates retain finite ceilings, printed-PDF bounds and exact pointer joins", () => {
  const beyond = SERVICE_FEED_LIMITS.pages + 1;
  const a = mixedCoordinates(); a.feed.units[0].blocks[0].folio = beyond; rejected(a);
  const b = mixedCoordinates(); b.feed.units[0].blocks[0].phys = beyond; rejected(b);
  const c = mixedCoordinates(); c.feed.sections[0].folio = beyond; rejected(c);
  const d = mixedCoordinates(); d.feed.units[0].folios.push(beyond); rejected(d);
  const e = mixedCoordinates(); e.feed.units[0].printedFolio = 64; rejected(e);
  const f = mixedCoordinates(); f.feed.pageIndex["1"][0].block = 84; rejected(f);
  const g = mixedCoordinates(); Object.assign(g.feed.pageIndex, { [String(beyond)]: [] }); rejected(g);
  const h = mixedCoordinates(); delete (h.feed.pageIndex as Record<string, unknown>)["85"]; rejected(h);
});
