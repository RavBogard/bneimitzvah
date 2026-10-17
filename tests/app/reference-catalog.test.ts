import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { parseReferenceSource, parseReferenceResolution } from "../../src/lib/reference-audio/source";
import { parseReferenceCatalog, resolveReference, ReferenceUnavailable } from "../../src/server/reference-audio/catalog";
import { createReferenceCatalogLoader } from "../../src/server/reference-audio/storage";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const id = "ra_" + "1".repeat(32), text = "אָב ג׃";
const study = { ref: "Genesis 1:1", english: null, hebrew: { text, readingText: text, segments: [{ kind: "text" as const, text }], paragraphAfter: null } };
const dto = () => ({ schema: "reference-verse/v1", ref: study.ref, table: "torah", playback: { status: "ready", asset: id, clip: { start: 1, end: 3 } }, words: { status: "ready", readingTextSha256: sha(text), starts: [1, 2] }, attribution: REFERENCE_ATTRIBUTION });
const raw = () => ({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id, archiveFile: "Synthetic-1.mp3", sha256: "a".repeat(64), bytes: 7, verses: [dto()] }] });
const source = () => ({ schema: "reference-source/v1", asset: id, url: "https://archive.org/download/PockettorahAudioFiles/Synthetic-1.mp3", sha256: "a".repeat(64), bytes: 7 });
afterEach(() => vi.useRealTimers());

test("closed source and catalog reject getters, paths, aliases, extras and inconsistent identity", () => {
  expect(parseReferenceSource(source())).not.toBeNull();
  for (const change of [{ url: source().url + "?x=1" }, { url: source().url.replace("archive.org", "other.archive.org") }, { bytes: 33554433 }, { bytes: 0 }, { url: source().url.replace("Synthetic-1", "../Synthetic-1") }, { sha256: "A".repeat(64) }, { extra: 1 }]) expect(parseReferenceSource({ ...source(), ...change })).toBeNull();
  const getter = vi.fn(); expect(parseReferenceSource(Object.defineProperty(source(), "url", { get: getter }))).toBeNull(); expect(getter).not.toHaveBeenCalled();
  expect(parseReferenceCatalog(raw())).not.toBeNull();
  for (const bad of [{ ...raw(), extra: 1 }, { ...raw(), source: "other" }, { ...raw(), assets: [...raw().assets, ...raw().assets] }, { ...raw(), assets: [{ ...raw().assets[0], verses: [{ ...dto(), playback: { ...dto().playback, asset: "ra_" + "2".repeat(32) } }] }] }]) expect(parseReferenceCatalog(bad)).toBeNull();
  expect(parseReferenceResolution({ verse: dto(), source: source() })).not.toBeNull();
  expect(parseReferenceResolution({ verse: dto(), source: { ...source(), asset: "ra_" + "2".repeat(32) } })).toBeNull();
});

test("current text and projected word count bind timings; held and duplicate refs cannot produce a source", () => {
  const catalog = parseReferenceCatalog(raw())!;
  expect(resolveReference(catalog, study).source?.asset).toBe(id);
  const changed = { ...study, hebrew: { ...study.hebrew, readingText: "ג אָב׃", text: "ג אָב׃", segments: [{ kind: "text" as const, text: "ג אָב׃" }] } };
  expect(resolveReference(catalog, changed)).toMatchObject({ source: null, verse: { playback: { status: "needs-review", review: "text-mismatch" } } });
  const wrongCount = raw(); wrongCount.assets[0].verses[0].words.starts = [1];
  expect(resolveReference(parseReferenceCatalog(wrongCount)!, study).source).toBeNull();
  const unavailable = { ...study, hebrew: { ...study.hebrew, segments: [] } };
  expect(resolveReference(catalog, unavailable)).toMatchObject({ source: source(), verse: { words: { status: "unavailable", reason: "portal-text-unavailable" } } });
  const held = raw(); Object.assign(held.assets[0].verses[0].playback, { status: "needs-review", review: "start-moved" });
  expect(resolveReference(parseReferenceCatalog(held)!, study).source).toBeNull();
  const both = raw(), second = structuredClone(both.assets[0]); second.id = "ra_" + "2".repeat(32); second.archiveFile = "Other.mp3"; second.verses[0].playback.asset = second.id; both.assets.push(second);
  const duplicate = parseReferenceCatalog(both)!;
  expect(resolveReference(duplicate, study).source).toBeNull();
  expect(resolveReference(duplicate, study, id).source?.asset).toBe(id);
  expect(resolveReference(catalog, { ...study, ref: "Genesis 1:2" }).source).toBeNull();
});

test("storage is lazy fixed-path, hash-bound and strict UTF8/JSON; oversized and empty-progress streams close", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(raw())), digest = sha(new TextDecoder().decode(bytes)); let calls = 0;
  const load = createReferenceCatalogLoader({ sha256: digest, get: async (path, options) => {
    calls++; expect(path).toBe(`reference-audio/pockettorah/catalog/${digest}.json`); expect(options.signal).toBeInstanceOf(AbortSignal);
    return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  } });
  expect(calls).toBe(0); expect((await load()).assets.length).toBe(1); expect(calls).toBe(1);
  for (const value of [new Uint8Array([255]), new TextEncoder().encode("{}"), new Uint8Array(8 * 1024 * 1024 + 1)]) {
    const bad = createReferenceCatalogLoader({ sha256: digest, get: async () => new ReadableStream({ start(c) { c.enqueue(value); c.close(); } }) });
    await expect(bad()).rejects.toBeInstanceOf(ReferenceUnavailable);
  }
  let reads = 0, cancelled = false;
  const empty = createReferenceCatalogLoader({ sha256: digest, get: async () => new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array()); }, cancel() { cancelled = true; } }) });
  await expect(empty()).rejects.toBeInstanceOf(ReferenceUnavailable); expect(reads).toBeLessThanOrEqual(66); expect(cancelled).toBe(true);
});

test("aborted catalog work never delivers and late streams are cancelled without awaiting cancellation", async () => {
  const controller = new AbortController(); controller.abort(); const get = vi.fn();
  await expect(createReferenceCatalogLoader({ sha256: "a".repeat(64), get })(controller.signal)).rejects.toBeInstanceOf(ReferenceUnavailable); expect(get).not.toHaveBeenCalled();
  vi.useFakeTimers(); let finish!: (s: ReadableStream<Uint8Array>) => void, cancelled = false;
  const pending = createReferenceCatalogLoader({ sha256: "a".repeat(64), get: () => new Promise(resolve => { finish = resolve; }) })();
  const observed = expect(pending).rejects.toBeInstanceOf(ReferenceUnavailable);
  await vi.advanceTimersByTimeAsync(10001); await observed;
  finish(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } })); await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(true);
});

test("stream intrinsic byte bounds cannot be shadowed; abort interrupts an ignoring catalog getter promptly", async () => {
  const huge = new Uint8Array(8 * 1024 * 1024 + 1); Object.defineProperty(huge, "byteLength", { value: 1 });
  await expect(createReferenceCatalogLoader({ sha256: "a".repeat(64), get: async () => new ReadableStream({ start(c) { c.enqueue(huge); } }) })()).rejects.toBeInstanceOf(ReferenceUnavailable);
  const controller = new AbortController(), get = vi.fn(() => new Promise<ReadableStream<Uint8Array>>(() => {}));
  const pending = createReferenceCatalogLoader({ sha256: "a".repeat(64), get })(controller.signal);
  await Promise.resolve(); controller.abort(); await expect(pending).rejects.toBeInstanceOf(ReferenceUnavailable); expect(get).toHaveBeenCalledTimes(1);
});
