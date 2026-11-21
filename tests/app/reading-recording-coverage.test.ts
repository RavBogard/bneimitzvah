import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { createReadingCoverage } from "../../src/server/reference-audio/reading-coverage";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import type { ShermetTiming } from "../../src/lib/reference-audio/shermet-timing";
import { parseRecordingCoverage } from "../../src/components/portal/workspace/reading-recording-coverage";
import { previewPages } from "../../src/server/students/preview";
import { syntheticUiStudyPage } from "../helpers/study-ui";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hebrew = normalizeHebrew("אָב אָב");
const asset = "ra_" + "1".repeat(32);
const parentHash = sha("synthetic reference");
const cutHash = sha("synthetic verse");
const shermetHash = sha("synthetic cantor");
const ranges = ["Genesis 1:1-5"];
const { verses, pages } = previewPages(ranges, "torah");
const selection = { kind: "torah" as const, ranges, verses };
const offsets = pages.map(page => page.offset);
const timing = (ref: string, readingTextSha256 = sha(hebrew.readingText)): ShermetTiming => ({
  version: 1, status: "ready", kind: "torah", ref, audioSha256: shermetHash, readingTextSha256,
  wordCount: 2, duration: 2, words: [{ start: 0.1, end: 0.3 }, { start: 0.5, end: 0.9 }],
});
async function fixture() {
  const cuts = [verses[1], verses[2]].map((ref, index) => ({
    schema: "reference-verse/v1", ref, table: "torah", playback: { status: "ready", asset, clip: { start: 1 + index * 2, end: 3 + index * 2 } },
    words: { status: "ready", readingTextSha256: sha(hebrew.readingText), starts: [1 + index * 2, 2 + index * 2] }, attribution: REFERENCE_ATTRIBUTION,
  }));
  const parent = { schema: "reference-catalog/v1", source: "PockettorahAudioFiles",
    assets: [{ id: asset, archiveFile: "Synthetic-1.mp3", sha256: parentHash, bytes: 7, verses: cuts }] };
  const catalog = parseReferenceCatalog(parent);
  if (!catalog) throw new Error("Invalid synthetic catalog");
  const parentBytes = json(parent);
  const son = { schema: "reference-short-source/v1", id: "rs_" + cutHash, parent: { asset, sha256: parentHash, bytes: 7 }, sha256: cutHash,
    bytes: 16500, path: `/reference-audio/short-v1/${cutHash}.mp3`, codec: "mp3", bitrate: 64000, sampleRate: 44100,
    channels: 2, presentationFrames: 88200, origin: { firstFrame: 44100, parentRate: 44100 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version };
  const manifestBytes = json({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: sha(parentBytes),
    recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: [son] });
  const manifest = await createShortSourceManifestLoader({ sha256: sha(manifestBytes), parentCatalogSHA256: sha(parentBytes),
    parentCatalogBytes: parentBytes, get: async () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(manifestBytes); c.close(); } }) })();
  return {
    learnerRelease: true, loadCatalog: vi.fn(async () => catalog), loadManifest: vi.fn(async () => manifest),
    loadText: vi.fn(async (request: Parameters<typeof syntheticUiStudyPage>[0]) => {
      const page = syntheticUiStudyPage(request);
      return { ...page, verses: page.verses.map(row => ({ ...row, hebrew })) };
    }),
    shermetRecordings: vi.fn(async () => new Map([[verses[0], shermetHash], [verses[1], shermetHash], [verses[3], shermetHash]])),
    shermetTiming: vi.fn(async (ref: string) => ref === verses[0] ? timing(ref) : ref === verses[1] ? timing(ref, sha("different text")) : null),
  };
}

it("uses exact Hebrew, published cuts, and separate source preference for verse and word practice", async () => {
  const input = await fixture();
  const coverage = await createReadingCoverage(input)(selection, offsets);
  expect(parseRecordingCoverage(coverage, verses)).toEqual({ status: "checked", verses: [
    { ref: verses[0], verse: "shermet", word: "shermet" },
    { ref: verses[1], verse: "shermet", word: "pockettorah" },
    { ref: verses[2], verse: "missing", word: "missing" }, // Parent media alone does not make a published short clip.
    { ref: verses[3], verse: "shermet", word: "missing" },
    { ref: verses[4], verse: "missing", word: "missing" },
  ] });
  expect(() => parseRecordingCoverage(coverage, [...verses].reverse())).toThrow();
  expect(() => parseRecordingCoverage({ ...coverage, manifest: "hidden" }, verses)).toThrow();
});

it("keeps known verse playback when timing or catalog checks fail", async () => {
  const input = await fixture();
  input.loadManifest.mockRejectedValueOnce(new Error("Synthetic catalog failure"));
  input.loadText.mockRejectedValueOnce(new Error("Synthetic text failure"));
  const coverage = await createReadingCoverage(input)(selection, offsets);
  expect(coverage).toMatchObject({ status: "checked", verses: [
    { ref: verses[0], verse: "shermet", word: "unknown" },
    { ref: verses[1], verse: "shermet", word: "unknown" },
    { ref: verses[2], verse: "unknown", word: "unknown" },
    { ref: verses[3], verse: "shermet", word: "missing" },
    { ref: verses[4], verse: "missing", word: "missing" },
  ] });
  input.loadCatalog.mockClear(); input.loadText.mockClear(); input.shermetRecordings.mockClear();
  expect(await createReadingCoverage({ ...input, learnerRelease: false })(selection, offsets)).toEqual({ status: "listening-disabled" });
  expect(input.loadCatalog).not.toHaveBeenCalled();
  expect(input.loadText).not.toHaveBeenCalled();
  expect(input.shermetRecordings).not.toHaveBeenCalled();
});

it("retains the order of a special haftarah and covers a long range across text pages", async () => {
  const input = await fixture();
  const coverage = createReadingCoverage(input);
  const special = ["Hosea 14:2-10", "Micah 7:18-20", "Joel 2:15-27"];
  const haftarah = previewPages(special, "haftarah");
  expect((await coverage({ kind: "haftarah", ranges: special, verses: haftarah.verses }, haftarah.pages.map(page => page.offset))))
    .toEqual({ status: "checked", verses: haftarah.verses.map(ref => ({ ref, verse: "missing", word: "missing" })) });
  expect(input.loadText).not.toHaveBeenCalled();
  const longRanges = ["Genesis 1:1-6:8"];
  const long = previewPages(longRanges, "torah");
  const last = long.verses.at(-1)!;
  input.shermetRecordings.mockResolvedValueOnce(new Map([[verses[0], shermetHash], [last, shermetHash]]));
  input.shermetTiming.mockImplementation(async ref => timing(ref));
  const checked = await coverage({ kind: "torah", ranges: longRanges, verses: long.verses }, long.pages.map(page => page.offset));
  expect(checked.status).toBe("checked");
  if (checked.status !== "checked") throw Error("Expected checked coverage");
  expect(checked.verses).toHaveLength(146);
  expect(checked.verses.at(-1)).toEqual({ ref: last, verse: "shermet", word: "shermet" });
  expect(input.loadText).toHaveBeenCalledTimes(2);
});
