// Invented metadata only. No source bodies, live API, corpus or credentials.
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseRelatedMetadata, parseEditionMetadata, SOURCE_METADATA_LIMITS, SourceMetadataUnavailable } from "../../src/server/study/sources/metadata";
import { createSefariaMetadataReader } from "../../src/server/study/sources/sefaria-metadata";
const verse = "Genesis 1:1", work = "Synthetic Commentary on Genesis";
const link = (id = "link-1") => ({ _id: id, sourceRef: "Synthetic Commentary, Gate 2 on Genesis 1:1:1-2", ref: "Synthetic Commentary, Gate 2 on Genesis 1:1:1-2", index_title: work, anchorRef: verse, category: "Commentary", collectiveTitle: { en: "Synthetic", he: "בָּג" } });
const edition = () => ({ title: work, versionTitle: "Synthetic edition", language: "en", actualLanguage: "fr", license: null, versionSource: null });
const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("projects only related identity/labels, normalizes NFC and keeps complex refs independent from work titles", () => {
  const raw = { ...link(), collectiveTitle: { en: "Synthétic", he: "בָּג" }, heTitle: "ignored", notes: "<p>DISCARDED</p>", unknown: { language: "discarded" } };
  const value = parseRelatedMetadata([raw], verse); expect(value).toMatchObject({ schema: "study-related-metadata/v1", verse, receivedRows: 1, heldCount: 0, duplicateCount: 0 });
  expect(value.entries[0]).toEqual({ id: raw._id, ref: raw.sourceRef, indexTitle: work, category: "Commentary", labels: { en: "Synthétic", he: "בָּג" } });
  raw.collectiveTitle.en = "changed"; expect(value.entries[0].labels.en).toBe("Synthétic"); expect(Object.isFrozen(value.entries[0].labels) && Object.isFrozen(value.entries)).toBe(true);
  expect(JSON.stringify(value)).not.toMatch(/DISCARDED|heTitle|anchorRefExpanded|unknown|notes/);
});
it("accepts exact anchor or complete bounded expanded proof, never a partial/invalid vector or source/ref mismatch", () => {
  const ranged = { ...link(), anchorRef: "Genesis 1:1-3", anchorRefExpanded: [verse, "Genesis 1:2", "Genesis 1:3"] };
  expect(parseRelatedMetadata([ranged], verse).entries).toHaveLength(1);
  for (const changed of [{ anchorRefExpanded: ["Genesis 1:2"] }, { anchorRefExpanded: [verse, "unproved"] }, { anchorRefExpanded: [verse, verse] }, { anchorRefExpanded: Array(257).fill(verse) }, { ref: "Synthetic other ref" }]) {
    expect(parseRelatedMetadata([{ ...ranged, ...changed }], verse)).toMatchObject({ entries: [], receivedRows: 1, heldCount: 1 });
  }
});
it("groups the whole conflicting identity permanently and accounts every received row", () => {
  const a = link(), conflict = { ...a, category: "Other" };
  for (const rows of [[a, a, conflict], [conflict, a, a]]) expect(parseRelatedMetadata(rows, verse)).toMatchObject({ entries: [], receivedRows: 3, duplicateCount: 0, heldCount: 3 });
  expect(parseRelatedMetadata([a, a, { ...a, sourceRef: null }], verse)).toMatchObject({ entries: [], heldCount: 3, duplicateCount: 0 });
  expect(parseRelatedMetadata([a, a, { ...link("other"), index_title: null }, {}], verse)).toMatchObject({ receivedRows: 4, duplicateCount: 1, heldCount: 2, entries: [{ id: "link-1" }] });
});
it("holds unsafe retained data/getters without touching ignored metadata types or translated title labels", () => {
  const getter = vi.fn(() => "private"), hostile = Object.defineProperty(link(), "sourceRef", { get: getter });
  const values = [hostile, { ...link("html"), category: "<b>not plain</b>" }, { ...link("bidi"), index_title: "bad\u202e" }, { ...link("unicode"), index_title: "\ud800" }, { ...link("oversized"), collectiveTitle: { en: "é".repeat(129) } }];
  expect(parseRelatedMetadata(values, verse).heldCount).toBe(5); expect(getter).not.toHaveBeenCalled();
  const safe = { ...link(), formatAsPoetry: { arbitrary: true }, collectiveTitle: { en: "Synthetic", he: "בג" } }; expect(parseRelatedMetadata([safe], verse).entries).toHaveLength(1);
  for (const field of ["text", "en", "body", "content"]) expect(() => parseRelatedMetadata([{ ...safe, [field]: "Synthetic unexpected body" }], verse)).toThrow(SourceMetadataUnavailable);
});
it("keeps exact edition work/version/languages with nullable inert rights and drops every note/purchase/URL field", () => {
  const raw = { ...edition(), versionSource: "javascript:inert provenance", license: "Unknown synthetic rights", versionNotes: "<i>DISCARDED</i>", purchaseInformationURL: "https://example.test/not-followed", formatAsPoetry: "not a boolean" };
  const value = parseEditionMetadata([raw, { ...edition(), versionTitle: "Second", actualLanguage: undefined }], work);
  expect(value.entries).toEqual([{ versionTitle: raw.versionTitle, language: "en", actualLanguage: "fr", license: raw.license, source: raw.versionSource }]); expect(value.heldCount).toBe(1);
  const missing = { ...edition() }; delete (missing as Partial<typeof missing>).actualLanguage;
  expect(parseEditionMetadata([missing], work).entries[0]).toEqual({ versionTitle: missing.versionTitle, language: "en", actualLanguage: null, license: null, source: null });
  expect(JSON.stringify(value)).not.toMatch(/DISCARDED|purchaseInformation|formatAsPoetry|approved|permission/);
});
it("holds ambiguous actual languages for one selector, conflicting rights/work identity, and deduplicates exact repeats", () => {
  const a = edition(), conflict = { ...a, actualLanguage: "de" };
  for (const rows of [[a, a, conflict], [conflict, a, a]]) expect(parseEditionMetadata(rows, work)).toMatchObject({ entries: [], heldCount: 3, duplicateCount: 0, receivedRows: 3 });
  const b = { ...a, language: "he", actualLanguage: "he" }; expect(parseEditionMetadata([a, a, b], work)).toMatchObject({ entries: [{ actualLanguage: "fr" }, { actualLanguage: "he" }], duplicateCount: 1, heldCount: 0, receivedRows: 3 });
  expect(parseEditionMetadata([a, { ...a, license: "Different" }, b], work)).toMatchObject({ entries: [{ actualLanguage: "he" }], heldCount: 2 });
  expect(parseEditionMetadata([a, { ...a, title: "Wrong work" }], work)).toMatchObject({ entries: [], heldCount: 2 });
});
it("bounds whole catalogs/arrays and validates canonical verse/complete inert work inputs without truncation", () => {
  expect(parseRelatedMetadata(Array.from({ length: 1828 }, (_, i) => link(`row-${i}`)), verse).entries).toHaveLength(1828);
  expect(() => parseRelatedMetadata(Array.from({ length: 4097 }, () => link()), verse)).toThrow(SourceMetadataUnavailable);
  expect(() => parseEditionMetadata(Array.from({ length: 513 }, () => edition()), work)).toThrow(SourceMetadataUnavailable);
  expect(() => parseRelatedMetadata(new Array(1), verse)).toThrow(SourceMetadataUnavailable);
  for (const wrong of ["Gen 1:1", "Genesis 1", "Genesis 1:01", "Genesis 1:1-2", "Genesis 99:1"]) expect(() => parseRelatedMetadata([], wrong)).toThrow(SourceMetadataUnavailable);
  for (const wrong of ["", ".", "..", "<i>title</i>", "x\n", "é".repeat(257)]) expect(() => parseEditionMetadata([], wrong)).toThrow(SourceMetadataUnavailable);
  const large = Array.from({ length: 4096 }, (_, i) => ({ ...link(`row-${i}`), sourceRef: "x".repeat(512), ref: "x".repeat(512), index_title: "y".repeat(512) }));
  expect(() => parseRelatedMetadata(large, verse)).toThrow(SourceMetadataUnavailable);
});
it("construction performs no I/O; each call uses only its fixed endpoint/flags without ambient headers or hidden retries", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json([link()])).mockResolvedValueOnce(json([edition()]));
  const reader = createSefariaMetadataReader({ fetch: fetcher }); expect(fetcher).not.toHaveBeenCalled();
  await reader.related(verse, new AbortController().signal); await reader.editions(work, new AbortController().signal);
  const [links, options] = fetcher.mock.calls[0]; expect(links).toBe("https://www.sefaria.org/api/links/Genesis%201%3A1?with_text=0&with_sheet_links=0");
  expect(fetcher.mock.calls[1][0]).toBe(`https://www.sefaria.org/api/texts/versions/${encodeURIComponent(work)}`);
  expect(options).toMatchObject({ method: "GET", headers: { accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
  await expect(reader.editions("..", new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("refuses statuses, redirects, advertised overflow, wrong types/UTF8/JSON and cancels before trusting a body", async () => {
  const variants = [new Response("Synthetic withheld", { status: 503 }), json([], { "content-length": String(SOURCE_METADATA_LIMITS.bytes + 1) }), json([], { "content-type": "text/html" }), new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }), new Response("{", { headers: { "content-type": "application/json" } }), json([]), json([])];
  Object.defineProperty(variants.at(-2)!, "redirected", { value: true }); Object.defineProperty(variants.at(-1)!, "url", { value: "https://example.test/forbidden" });
  for (const [index, value] of variants.entries()) {
    const cancel = vi.spyOn(value.body!, "cancel"), acquire = vi.spyOn(value.body!, "getReader"), fetcher = vi.fn(async () => value), reader = createSefariaMetadataReader({ fetch: fetcher });
    const error = await reader.related(verse, new AbortController().signal).catch(error => error);
    expect(error).toBeInstanceOf(SourceMetadataUnavailable); expect(error.message).toBe("Study source metadata unavailable"); expect(error.cause).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
    if (index < 3 || index >= 5) { expect(cancel).toHaveBeenCalledTimes(1); expect(acquire).not.toHaveBeenCalled(); }
    else { expect(acquire).toHaveBeenCalledTimes(1); expect(value.body!.locked).toBe(false); }
  }
});
it("enforces actual stream bytes/empty-read caps and copies intrinsic typed-array views without caller hooks", async () => {
  for (const chunks of [[new Uint8Array(SOURCE_METADATA_LIMITS.bytes + 1)], Array.from({ length: 65 }, () => new Uint8Array())]) {
    const response = new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), { headers: { "content-type": "application/json" } });
    await expect(createSefariaMetadataReader({ fetch: async () => response }).related(verse, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable);
  }
  const bytes = new TextEncoder().encode("[]"), getter = vi.fn(() => { throw new Error("Synthetic hook"); }); Object.defineProperty(bytes, "byteLength", { get: getter }); Object.defineProperty(bytes, "buffer", { get: getter });
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), { headers: { "content-type": "application/json" } });
  expect(await createSefariaMetadataReader({ fetch: async () => response }).related(verse, new AbortController().signal)).toMatchObject({ entries: [], receivedRows: 0 }); expect(getter).not.toHaveBeenCalled();
});
it("caller abort returns without awaiting hostile cleanup; a later response is canceled and cannot publish", async () => {
  const gate = deferred<Response>(), entered = deferred<void>(), abort = new AbortController();
  const reader = createSefariaMetadataReader({ fetch: () => { entered.resolve(); return gate.promise; } });
  const work = reader.related(verse, abort.signal).catch(error => error); await entered.promise; abort.abort(); expect(await work).toBeInstanceOf(SourceMetadataUnavailable);
  const canceled = deferred<void>(), body = new ReadableStream({ cancel() { canceled.resolve(); return new Promise<void>(() => {}); } }); gate.resolve(new Response(body, { headers: { "content-type": "application/json" } })); await canceled.promise;
  const pre = new AbortController(); pre.abort(); const fetcher = vi.fn(); await expect(createSefariaMetadataReader({ fetch: fetcher }).related(verse, pre.signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable); expect(fetcher).not.toHaveBeenCalled();
});
it("applies real total and idle timers even when fetch/read/cleanup never settle", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const reader = createSefariaMetadataReader({ fetch: () => new Promise<Response>(() => {}) }), work = reader.related(verse, new AbortController().signal).catch(error => error);
  await vi.advanceTimersByTimeAsync(10000); expect(await work).toBeInstanceOf(SourceMetadataUnavailable);
  const body = new ReadableStream({ cancel() { return new Promise<void>(() => {}); } }), idle = createSefariaMetadataReader({ fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }) }).related(verse, new AbortController().signal).catch(error => error);
  await vi.advanceTimersByTimeAsync(5000); expect(await idle).toBeInstanceOf(SourceMetadataUnavailable);
});
it("checks elapsed total after synchronous settlement and first-byte idle after slow header validation", async () => {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  const late = json([]), cancel = vi.spyOn(late.body!, "cancel"); const reader = createSefariaMetadataReader({ fetch: async () => { now = 10001; return late; } });
  await expect(reader.related(verse, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable); expect(cancel).toHaveBeenCalledTimes(1);
  now = 0; const response = json([]), get = response.headers.get.bind(response.headers); vi.spyOn(response.headers, "get").mockImplementation(name => { now = 5001; return get(name); });
  await expect(createSefariaMetadataReader({ fetch: async () => response }).related(verse, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable);
});
