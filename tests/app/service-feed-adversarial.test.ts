import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseServiceFeed, ServiceFeedInvalid, SERVICE_FEED_LIMITS } from "../../src/server/service-learning/feed";

// Independent minimal producer-shaped input, invented text only.
function example() {
  return {
    schemaVersion: 1, volume: "legacy-beit-mitzvah", title: "Invented service",
    printing: { gitSha: "abcdef0-LICENSED", pages: 8, builtAt: "2026-10-15T00:00:00Z",
      source: { gitSha: "abcdef0-LICENSED", pages: 8, builtAt: "2026-10-15T00:00:00Z", lane: "licensed" } },
    license: { spdx: "LicenseRef-Invented", attribution: "Invented credit" },
    sections: [{ idx: 0 }],
    units: [{ id: "invented.part@bm-shacharit", name: "Invented", section: 0,
      blocks: [{ type: "stanza", he: "דַּג\u200f", tr: "omitted-reading-a", en: "Invented A.", folio: 1 },
        { type: "stanza", he: "זֵח", tr: "omitted-reading-b", en: "Invented B.", folio: 1 }] }],
    pageIndex: { "1": [{ unit: "invented.part@bm-shacharit", block: 0 }] },
  };
}
const provenance = {
  schemaVersion: 1, producedBy: "build/build-app.sh via .github/workflows/build-siddur.yml",
  sourceRepo: "Invented/Source", sourceSha: "b".repeat(40), sourceShaShort: "b".repeat(7),
  sourceRef: "refs/heads/main", builtAt: "2026-10-16T00:00:00Z", runId: "456",
  runUrl: "https://github.com/Invented/Source/actions/runs/456", bookCount: 1,
  books: ["legacy-beit-mitzvah"], lane: "licensed", laneWhy: "Invented restricted source",
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function read(value: unknown, raw?: string) {
  const feed = raw === undefined ? encode(value) : new TextEncoder().encode(raw), proof = encode(provenance);
  return parseServiceFeed(feed, proof, { feedSha256: digest(feed), provenanceSha256: digest(proof),
    artifactRepo: "Invented/Source", artifactCommit: "b".repeat(40), artifactRunId: "456", sourceGitSha: "abcdef0-LICENSED" });
}

test("current producer's declared line granularity survives the adapter", () => {
  // extract_feed.py's _MANIFEST_FEED_FIELDS/apply_manifest/result.update emits this.
  const result = read({ ...example(), blockGranularity: "line" });
  expect(result).toHaveProperty("blockGranularity", "line");
});

test.each([
  { kind: "refrain-song", groups: [2], refrainGroups: [1] },
  { kind: "refrain-song", groups: [1, 1], refrainGroups: [0, 0] },
  { kind: "paired-passages", groups: [2], head: 1, tail: 0 },
  { kind: "short-sequence", rows: [1], head: 2, tail: 0 },
])("reject renderer metadata with unresolved or overlapping positions: %j", structure => {
  const value = example(); Object.assign(value.units[0], { render: "interleave", renderStructure: structure });
  expect(() => read(value)).toThrow(ServiceFeedInvalid);
});

test("oversized page-key cardinality rejects inside the byte and scanner-node budgets", () => {
  const value = { ...example(),
    pageIndex: Object.fromEntries(Array.from({ length: 32_000 }, (_, i) => ["0".repeat(32) + String(i), []])) };
  expect(encode(value).byteLength).toBeLessThan(SERVICE_FEED_LIMITS.feedBytes);
  expect(() => read(value)).toThrow(ServiceFeedInvalid);
});

test("escaped Hebrew, astral pairs, combining order, bidi controls and credits remain exact", () => {
  const value = example(), exact = "ד\u05b7\u05bc\u2067\u200f\u{1f3b5}\u2069";
  value.units[0].blocks[0].he = exact;
  value.license.attribution = "Invented credit — \u{1f3b5}";
  const result = read(value, JSON.stringify(value).replace("ד", "\\u05d3"));
  expect(result.units[0].blocks[0].he).toBe(exact);
  expect(result.license.attribution).toBe(value.license.attribution);
  expect(JSON.stringify(result)).not.toContain("omitted-reading-");
  expect(Object.isFrozen(result.units[0].blocks[0])).toBe(true);
});

test.each([
  '{"schemaVersion":1,"\\u0073chemaVersion":1}',
  '{"outer":{"private-marker":1,"private-\\u006darker":2}}',
  '{"outer":{"constr\\u0075ctor":{}}}',
])("duplicate or prototype keys reject atomically with a constant error", raw => {
  try { read(null, raw); throw new Error("Unexpected acceptance"); }
  catch (error) {
    expect(error).toBeInstanceOf(ServiceFeedInvalid);
    expect(String(error)).toBe("ServiceFeedInvalid: Service feed unavailable");
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("private-marker");
  }
});

test("page index must select the first block for a unit on a folio", () => {
  const value = example(); value.pageIndex["1"][0].block = 1;
  expect(() => read(value)).toThrow(ServiceFeedInvalid);
});

function separateCoordinateExample() {
  const value = example(), max = SERVICE_FEED_LIMITS.pages;
  value.printing.pages = 1; value.printing.source.pages = 1;
  value.units[0].blocks.forEach(block => { block.folio = max; Object.assign(block, { phys: max }); });
  value.units[0].blocks[1].type = "english";
  Object.assign(value.units[0].blocks[1], { role: "original" });
  const unit = { ...value.units[0], caption: "", printedFolio: 1, folios: [max],
    renderSegments: { he: value.units[0].blocks.map(block => block.he),
      en: value.units[0].blocks.map(block => block.en), tr: value.units[0].blocks.map(block => block.tr), folios: [max, max] } };
  return { ...value, sections: [{ idx: 0, opener: false, folio: max }], units: [unit],
    front: [{ type: "english", role: "original", en: "Invented front credit.", folio: max, phys: max }],
    pageIndex: { [String(max)]: [{ unit: unit.id, block: 0 }] } };
}

test("inclusive internal-coordinate ceiling keeps source pages, original role, segments and absent transliteration distinct", () => {
  const value = separateCoordinateExample(), result = read(value);
  expect(result.source.pages).toBe(1);
  expect(result.units[0].printedFolio).toBe(1);
  expect(result.sections[0]).toEqual(value.sections[0]);
  expect(result.units[0].caption).toBe("");
  expect(result.units[0].blocks[1].role).toBe("original");
  expect(result.front).toEqual(value.front);
  expect(result.units[0].renderSegments).toEqual({ he: value.units[0].renderSegments.he,
    en: value.units[0].renderSegments.en, folios: value.units[0].renderSegments.folios });
  expect(result.pageIndex).toEqual(value.pageIndex);
  expect(JSON.stringify(result)).not.toContain("omitted-reading-");
});

test.each([-1, 0.5, SERVICE_FEED_LIMITS.pages + 1, "1024"])("segment coordinates reject noninteger or out-of-bound position %j", invalid => {
  const value = separateCoordinateExample(); Object.assign(value.units[0].renderSegments, { folios: [invalid, 1024] });
  expect(() => read(value)).toThrow(ServiceFeedInvalid);
});

test("a valid high internal coordinate cannot legitimize a broken page pointer or segment text", () => {
  const wrongPointer = separateCoordinateExample(); wrongPointer.pageIndex["1024"][0].block = 1;
  expect(() => read(wrongPointer)).toThrow(ServiceFeedInvalid);
  const wrongText = separateCoordinateExample(); wrongText.units[0].renderSegments.en[1] += " Changed.";
  expect(() => read(wrongText)).toThrow(ServiceFeedInvalid);
});
