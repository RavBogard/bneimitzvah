import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { parseReferenceSource } from "../../src/lib/reference-audio/source";
import { parseShortReferenceSource, shortSourceOriginalSeconds, shortSourceRange, SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { createShortSourceManifestLoader, lookupShortSource, readShortSourceEntry, SHORT_BODY_VERIFICATION_REQUIRED, SHORT_MANIFEST_LIMITS, type ShortSourceEntry, type ShortSourceManifest } from "../../src/server/reference-audio/short-source-manifest";
import { ReferenceUnavailable } from "../../src/server/reference-audio/catalog";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const asset = "ra_" + "1".repeat(32), content = "b".repeat(64);
const source = () => ({ schema: "reference-short-source/v1", id: `rs_${content}`, parent: { asset, sha256: "a".repeat(64), bytes: 7 }, sha256: content, bytes: 16500,
  path: `/reference-audio/short-v1/${content}.mp3`, codec: "mp3", bitrate: 64000, sampleRate: 44100, channels: 2, presentationFrames: 88200,
  origin: { firstFrame: 44100, parentRate: 44100 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version });
const parent = () => ({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-1.mp3", sha256: "a".repeat(64), bytes: 7,
  verses: [{ schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset, clip: { start: 1, end: 3 } }, words: { status: "unavailable", reason: "no-words" }, attribution: REFERENCE_ATTRIBUTION }] }] });
const manifest = (parents = bytes(parent())) => ({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: sha(parents), recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: [source()] });
function fixture(raw: unknown = manifest(), parentBytes = bytes(parent())) {
  const data = bytes(raw), get = vi.fn(async (_path: string, _options: Readonly<{ signal: AbortSignal }>) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } }));
  const load = createShortSourceManifestLoader({ sha256: sha(data), parentCatalogSHA256: sha(parentBytes), parentCatalogBytes: parentBytes, get });
  return { load, get, data };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("normalization recipe and changed public attribution are v2 while descriptor and namespace remain v1", async () => {
  expect(SHORT_SOURCE_RECIPE).toBe("pockettorah-mp3-64k-gapless/v2"); expect(SHORT_SOURCE_ATTRIBUTION.version).toBe("pockettorah-short-attribution/v2");
  expect(SHORT_SOURCE_ATTRIBUTION.changes).toContain("endpoint and checksum metadata normalized");
  expect(source().schema).toBe("reference-short-source/v1"); expect(source().path).toMatch(/^\/reference-audio\/short-v1\//);
  await expect(fixture({ ...manifest(), recipe: "pockettorah-mp3-64k-gapless/v1" }).load()).rejects.toThrow(ReferenceUnavailable);
  await expect(fixture({ ...manifest(), attribution: { ...SHORT_SOURCE_ATTRIBUTION, version: "pockettorah-short-attribution/v1" } }).load()).rejects.toThrow(ReferenceUnavailable);
});

test("closed short descriptor snapshots native frame grid and maps original coordinates without padding or clamping", () => {
  const raw = source(), parsed = parseShortReferenceSource(raw)!;
  expect(parsed).not.toBeNull(); expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.origin)).toBe(true); expect(Object.isFrozen(parsed.parent)).toBe(true);
  raw.origin.firstFrame = 0; raw.parent.bytes = 999;
  expect(parsed.origin.firstFrame).toBe(44100); expect(parsed.parent.bytes).toBe(7);
  expect(shortSourceRange(parsed, { start: 1.25, end: 2.75 })).toEqual({ firstFrame: 11025, endFrame: 77175, sampleRate: 44100 });
  expect(shortSourceOriginalSeconds(parsed, 88200)).toBe(3);
  for (const range of [{ start: 0.999999, end: 2 }, { start: 2, end: 3.000001 }, { start: 2, end: 2 }, { start: NaN, end: 2 }, { start: 1, end: Infinity }]) expect(shortSourceRange(parsed, range)).toBeNull();
  expect(shortSourceRange(parsed, { start: 1, end: 1 + 0.1 / 44100 })).toEqual({ firstFrame: 0, endFrame: 1, sampleRate: 44100 });
  for (const firstFrame of [1, 100009, 600000001]) {
    const grid = { ...source(), origin: { firstFrame, parentRate: 44100 } };
    expect(shortSourceRange(grid, { start: shortSourceOriginalSeconds(grid, 0)!, end: shortSourceOriginalSeconds(grid, 88200)! })).toEqual({ firstFrame: 0, endFrame: 88200, sampleRate: 44100 });
  }
  for (const frame of [-1, 88201, .5, Infinity]) expect(shortSourceOriginalSeconds(parsed, frame)).toBeNull();
});

test("descriptor refuses free URLs, private prefixes, wrong codec/profile/hash/identity and budgets; v1 is not interchangeable", () => {
  for (const change of [{ schema: "reference-source/v1" }, { id: asset }, { id: `rs_${"c".repeat(64)}` }, { path: `/private/${content}.mp3` },
    { path: `https://example.test/reference-audio/short-v1/${content}.mp3` }, { path: source().path + "?token=synthetic" }, { path: source().path + "#x" },
    { codec: "flac" }, { bitrate: 128000 }, { bytes: 0 }, { bytes: 1048577 }, { sampleRate: 96000 }, { sampleRate: 12345 }, { sampleRate: NaN },
    { channels: 3 }, { presentationFrames: 0 }, { presentationFrames: .5 }, { presentationFrames: 44100 * 75 + 1 }, { sha256: "B".repeat(64) },
    { origin: { firstFrame: -1, parentRate: 44100 } }, { origin: { firstFrame: 44100, parentRate: 48000 } },
    { origin: { firstFrame: 44100 * 14400, parentRate: 44100 } }, { attributionVersion: "unreviewed" }, { parent: { ...source().parent, bytes: 33554433 } }, { extra: true }])
    expect(parseShortReferenceSource({ ...source(), ...change })).toBeNull();
  const legacy = { schema: "reference-source/v1", asset, url: "https://archive.org/download/PockettorahAudioFiles/Synthetic-1.mp3", sha256: "a".repeat(64), bytes: 7 };
  expect(parseReferenceSource(legacy)).not.toBeNull(); expect(parseShortReferenceSource(legacy)).toBeNull(); expect(parseReferenceSource(source())).toBeNull();
  const max = source(); max.presentationFrames = 44100 * 75; max.bytes = 1048576; expect(parseShortReferenceSource(max)).not.toBeNull();
});

test("no input getters, prototype inheritance, symbol extras or sparse nested data become descriptor authority", () => {
  const getter = vi.fn(); const raw = Object.defineProperty(source(), "path", { get: getter });
  expect(parseShortReferenceSource(raw)).toBeNull(); expect(getter).not.toHaveBeenCalled();
  expect(parseShortReferenceSource(Object.assign(Object.create({ inherited: true }), source()))).toBeNull();
  expect(parseShortReferenceSource({ ...source(), [Symbol("extra")]: 1 })).toBeNull();
  expect(parseShortReferenceSource({ ...source(), origin: Object.defineProperty({ firstFrame: 44100, parentRate: 44100 }, "firstFrame", { get: getter }) })).toBeNull();
  expect(getter).not.toHaveBeenCalled();
  expect(parseShortReferenceSource(Object.assign(Object.create(null), source()))).not.toBeNull();
});

test("pinned loader is lazy fixed-path; opaque handles and entries reject clones and unknown IDs never read source bytes", async () => {
  const f = fixture(); expect(f.get).not.toHaveBeenCalled();
  const handle = await f.load(), receipt = lookupShortSource(handle, source().id)!;
  expect(f.get).toHaveBeenCalledTimes(1); expect(f.get.mock.calls[0]?.[0]).toBe(`reference-audio/short-v1/manifests/${sha(f.data)}.json`);
  expect(Object.keys(handle)).toEqual([]); expect(Object.keys(receipt)).toEqual([]);
  const entry = readShortSourceEntry(receipt);
  expect(entry).toEqual({ source: parseShortReferenceSource(source()), blobKey: `reference-audio/short-v1/${content}.mp3`, requiredBodyVerification: SHORT_BODY_VERIFICATION_REQUIRED });
  expect(Object.isFrozen(entry)).toBe(true);
  expect(lookupShortSource(handle, `rs_${"c".repeat(64)}`)).toBeNull(); expect(lookupShortSource(handle, "../private")).toBeNull(); expect(f.get).toHaveBeenCalledTimes(1);
  expect(() => lookupShortSource({ ...handle } as ShortSourceManifest, source().id)).toThrow(ReferenceUnavailable);
  expect(() => readShortSourceEntry({ ...receipt } as ShortSourceEntry)).toThrow(ReferenceUnavailable);
});

test("manifest binds actual pinned parent membership, approved exact cut, license, recipe and private-field exclusion", async () => {
  const wrongs = [
    { ...manifest(), schema: "reference-catalog/v1" }, { ...manifest(), source: "other" }, { ...manifest(), parentCatalogSHA256: "f".repeat(64) },
    { ...manifest(), recipe: "other" }, { ...manifest(), attribution: { ...SHORT_SOURCE_ATTRIBUTION, license: "CC0" } },
    { ...manifest(), attribution: { ...SHORT_SOURCE_ATTRIBUTION, changes: "No changes" } }, { ...manifest(), studentId: "synthetic" },
    { ...manifest(), entries: [] }, { ...manifest(), entries: [source(), source()] },
    ...[{ parent: { ...source().parent, asset: "ra_" + "2".repeat(32) } }, { parent: { ...source().parent, sha256: "f".repeat(64) } },
      { parent: { ...source().parent, bytes: 8 } }, { origin: { firstFrame: 44101, parentRate: 44100 } }, { presentationFrames: 88199 },
      { ref: "Genesis 1:1" }, { words: [] }, { timeline: [] }, { blobKey: "private/other" }].map(change => ({ ...manifest(), entries: [{ ...source(), ...change }] })),
  ];
  for (const raw of wrongs) await expect(fixture(raw).load()).rejects.toBeInstanceOf(ReferenceUnavailable);
  const held = parent(); Object.assign(held.assets[0].verses[0].playback, { status: "needs-review", review: "start-moved" }); const p = bytes(held);
  await expect(fixture(manifest(p), p).load()).rejects.toBeInstanceOf(ReferenceUnavailable);
});

test("parent bytes are copied and pinned at construction, malformed or mutable trust anchors cannot bypass membership", async () => {
  const p = bytes(parent()), f = fixture(manifest(p), p); p.fill(0); expect(lookupShortSource(await f.load(), source().id)).not.toBeNull();
  for (const bad of [new Uint8Array([255]), bytes({}), new Uint8Array(8 * 1024 * 1024 + 1)])
    expect(() => createShortSourceManifestLoader({ sha256: "a".repeat(64), parentCatalogSHA256: sha(bad), parentCatalogBytes: bad, get: vi.fn() })).toThrow(ReferenceUnavailable);
  expect(() => createShortSourceManifestLoader({ sha256: "a".repeat(64), parentCatalogSHA256: "f".repeat(64), parentCatalogBytes: bytes(parent()), get: vi.fn() })).toThrow(ReferenceUnavailable);
});

test("manifest requires the exact enclosing floor/ceil approved geometry, not nearest rounding or a tolerance", async () => {
  const p = parent(); p.assets[0].verses[0].playback.clip = { start: 1.00002, end: 3.00001 };
  const parentBytes = bytes(p), raw = manifest(parentBytes), firstFrame = Math.floor(1.00002 * 44100), endFrame = Math.ceil(3.00001 * 44100);
  raw.entries[0].origin.firstFrame = firstFrame; raw.entries[0].presentationFrames = endFrame - firstFrame;
  const f = fixture(raw, parentBytes), entry = readShortSourceEntry(lookupShortSource(await f.load(), source().id)!);
  expect(entry.source.origin.firstFrame / 44100).toBeLessThanOrEqual(1.00002);
  expect((entry.source.origin.firstFrame + entry.source.presentationFrames) / 44100).toBeGreaterThanOrEqual(3.00001);
  expect(shortSourceRange(entry.source, { start: 1.00002, end: 3.00001 })).toEqual({ firstFrame: 0, endFrame: endFrame - firstFrame, sampleRate: 44100 });
  const rounded = structuredClone(raw); rounded.entries[0].origin.firstFrame = Math.round(1.00002 * 44100); rounded.entries[0].presentationFrames = Math.round(3.00001 * 44100) - rounded.entries[0].origin.firstFrame;
  await expect(fixture(rounded, parentBytes).load()).rejects.toBeInstanceOf(ReferenceUnavailable);
});

test("manifest hash, UTF8/JSON, byte bounds and nonprogress streams fail closed with cancellation", async () => {
  for (const data of [new Uint8Array([255]), bytes({}), new Uint8Array(8 * 1024 * 1024 + 1)]) {
    const p = bytes(parent()), load = createShortSourceManifestLoader({ sha256: sha(data), parentCatalogSHA256: sha(p), parentCatalogBytes: p,
      get: async () => new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }) });
    await expect(load()).rejects.toBeInstanceOf(ReferenceUnavailable);
  }
  const p = bytes(parent()), valid = bytes(manifest()); let cancelled = false, reads = 0;
  const load = createShortSourceManifestLoader({ sha256: sha(valid), parentCatalogSHA256: sha(p), parentCatalogBytes: p,
    get: async () => new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array()); }, cancel() { cancelled = true; } }) });
  await expect(load()).rejects.toBeInstanceOf(ReferenceUnavailable); expect(reads).toBeLessThanOrEqual(66); expect(cancelled).toBe(true);
  await expect(createShortSourceManifestLoader({ sha256: "f".repeat(64), parentCatalogSHA256: sha(p), parentCatalogBytes: p,
    get: async () => new ReadableStream({ start(c) { c.enqueue(valid); c.close(); } }) })()).rejects.toBeInstanceOf(ReferenceUnavailable);
});

test("intrinsic stream bounds reject shadowed huge chunks and abort interrupts ignoring I/O without late delivery", async () => {
  const p = bytes(parent()), data = bytes(manifest()), huge = new Uint8Array(8 * 1024 * 1024 + 1); Object.defineProperty(huge, "byteLength", { value: 1 });
  await expect(createShortSourceManifestLoader({ sha256: sha(data), parentCatalogSHA256: sha(p), parentCatalogBytes: p,
    get: async () => new ReadableStream({ start(c) { c.enqueue(huge); } }) })()).rejects.toBeInstanceOf(ReferenceUnavailable);
  const controller = new AbortController(), get = vi.fn(() => new Promise<ReadableStream<Uint8Array>>(() => {}));
  const load = createShortSourceManifestLoader({ sha256: sha(data), parentCatalogSHA256: sha(p), parentCatalogBytes: p, get });
  const pending = load(controller.signal); await Promise.resolve(); controller.abort(); await expect(pending).rejects.toBeInstanceOf(ReferenceUnavailable); expect(get).toHaveBeenCalledTimes(1);
  const aborted = new AbortController(); aborted.abort(); await expect(load(aborted.signal)).rejects.toBeInstanceOf(ReferenceUnavailable); expect(get).toHaveBeenCalledTimes(1);
});

test("late manifest streams are cancelled at fixed deadline even when cancellation never settles", async () => {
  vi.useFakeTimers(); const p = bytes(parent()), data = bytes(manifest()); let finish!: (s: ReadableStream<Uint8Array>) => void, cancelled = false;
  const load = createShortSourceManifestLoader({ sha256: sha(data), parentCatalogSHA256: sha(p), parentCatalogBytes: p,
    get: () => new Promise(resolve => { finish = resolve; }) });
  const observed = expect(load()).rejects.toBeInstanceOf(ReferenceUnavailable); await vi.advanceTimersByTimeAsync(10001); await observed;
  finish(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } })); await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(true);
});

test("fragmented valid bytes retain exact hash/UTF8 semantics and load the same sealed entry", async () => {
  const p = bytes(parent()), data = bytes(manifest()); let offset = 0, pulls = 0;
  const load = createShortSourceManifestLoader({ sha256: sha(data), parentCatalogSHA256: sha(p), parentCatalogBytes: p,
    get: async () => new ReadableStream({ pull(c) {
      if (offset === data.length) { c.close(); return; }
      const end = Math.min(data.length, offset + [1, 3, 17, 2][pulls++ % 4]); c.enqueue(data.subarray(offset, end)); offset = end;
    } }) });
  const entry = readShortSourceEntry(lookupShortSource(await load(), source().id)!);
  expect(entry.source).toEqual(parseShortReferenceSource(source())); expect(pulls).toBeGreaterThan(64);
});

test("one-byte progress uses one fixed accumulator and a corrupt byte still refuses the exact pinned manifest", async () => {
  const p = bytes(parent()), data = bytes(manifest()), originalSet = Uint8Array.prototype.set, targets = new Set<ArrayBufferLike>(); let writes = 0;
  vi.spyOn(Uint8Array.prototype, "set").mockImplementation(function (this: Uint8Array, array: ArrayLike<number>, offset?: number) {
    if (this.byteLength === SHORT_MANIFEST_LIMITS.bytes) { targets.add(this.buffer); writes++; }
    return originalSet.call(this, array, offset);
  });
  let cursor = 0;
  const load = createShortSourceManifestLoader({ sha256: sha(data), parentCatalogSHA256: sha(p), parentCatalogBytes: p,
    get: async () => new ReadableStream({ pull(c) {
      if (cursor === data.length) { c.close(); return; }
      const value = data.subarray(cursor, cursor + 1); cursor++;
      c.enqueue(cursor === data.length ? new Uint8Array([value[0] ^ 1]) : value);
    } }) });
  await expect(load()).rejects.toBeInstanceOf(ReferenceUnavailable);
  expect(cursor).toBe(data.length); expect(writes).toBe(data.length); expect(targets.size).toBe(1);
});
