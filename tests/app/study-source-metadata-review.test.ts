// Synthetic metadata only; no provider rows, source text, or live network.
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseRelatedMetadata, parseEditionMetadata, SourceMetadataUnavailable } from "../../src/server/study/sources/metadata";
import { createSefariaMetadataReader } from "../../src/server/study/sources/sefaria-metadata";

const verse = "Genesis 1:1", work = "Invented Commentary on Genesis";
function link(n = 1) { return { _id: n.toString(16).padStart(24, "0"), sourceRef: "Invented Complex Work, Section Alpha 2:3-5", index_title: work, category: "Commentary", anchorRef: verse,
  collectiveTitle: { en: "Invented commentary", he: "דָּג" } }; }
function edition() { return { title: work, versionTitle: "Invented edition", language: "en", license: "Invented rights metadata", versionSource: "https://example.invalid/provenance" }; }
const response = (value: unknown, url: string) => { const r = new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: url }); return r; };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("review explicit complete work identity and complex citation are copied/frozen, while untyped provider metadata is discarded", () => {
  const row = { ...link(), ref: link().sourceRef, isSheet: "false", isPrimary: "yes", purchaseInformationURL: "https://example.invalid/not-a-fetch-target", actor: { ignored: true } };
  const result = parseRelatedMetadata([row], verse);
  expect(result).toEqual({ schema: "study-related-metadata/v1", verse, receivedRows: 1, heldCount: 0, duplicateCount: 0, entries: [{ id: row._id, ref: row.sourceRef, indexTitle: work, category: "Commentary", labels: { en: row.collectiveTitle.en, he: row.collectiveTitle.he.normalize("NFC") } }] });
  expect(Object.isFrozen(result) && Object.isFrozen(result.entries) && Object.isFrozen(result.entries[0]) && Object.isFrozen(result.entries[0].labels)).toBe(true);
  row.collectiveTitle.en = "Changed"; expect(result.entries[0].labels.en).toBe("Invented commentary"); expect(JSON.stringify(result)).not.toMatch(/purchaseInformationURL|isSheet|actor|not-a-fetch-target/);
  expect(parseRelatedMetadata([{ ...link(), index_title: undefined }], verse).heldCount).toBe(1);
});

it("review only exact anchor or a fully valid unique expanded canonical vector can prove the requested verse", () => {
  const expanded = { ...link(), anchorRef: "Genesis 1:1-2", anchorRefExpanded: ["Genesis 1:1", "Genesis 1:2"] };
  expect(parseRelatedMetadata([expanded], verse).entries).toHaveLength(1);
  for (const change of [{ anchorRef: "Genesis 1:10" }, { anchorRef: "Genesis 1:1-2" }, { anchorRef: "Genesis 1:1-2", expandedRefs: [verse] },
    { anchorRef: "Genesis 1:1-2", anchorRefExpanded: [verse, "Genesis 1:999"] }, { anchorRef: "Genesis 1:1-2", anchorRefExpanded: [verse, verse] },
    { anchorRef: "Genesis 1:1-2", anchorRefExpanded: ["Genesis 1:2"] }]) {
    const result = parseRelatedMetadata([{ ...link(), ...change }], verse); expect(result.entries).toHaveLength(0); expect(result.heldCount).toBe(1);
  }
  expect(parseRelatedMetadata([{ ...link(), ref: "Invented different citation" }], verse).heldCount).toBe(1);
  expect(() => parseRelatedMetadata([link()], "Genesis 1:1-2")).toThrow(SourceMetadataUnavailable);
});

it("review a conflicting or malformed identity poisons its full group in either order instead of choosing the first", () => {
  const a = link(), duplicate = structuredClone(a), conflict = { ...link(), category: "Other" }, malformed = { ...link(), index_title: "<b>unsafe</b>" };
  expect(parseRelatedMetadata([a, duplicate], verse)).toMatchObject({ heldCount: 0, duplicateCount: 1, entries: [expect.objectContaining({ id: a._id })] });
  for (const rows of [[a, conflict], [conflict, a], [a, malformed], [malformed, a], [a, duplicate, conflict]]) {
    const value = parseRelatedMetadata(rows, verse); expect(value.entries).toHaveLength(0); expect(value.heldCount).toBe(rows.length); expect(value.duplicateCount).toBe(0);
  }
});

it("review source text is refused globally, but nested language title labels and unrelated boolean-looking fields remain metadata", () => {
  for (const field of ["text", "he", "en", "body", "content"]) expect(() => parseRelatedMetadata([{ ...link(), [field]: "Invented prohibited source body" }], verse)).toThrow(SourceMetadataUnavailable);
  expect(parseRelatedMetadata([{ ...link(), isSheet: "false", display: { en: "Ignored label" } }], verse).entries).toHaveLength(1);
  for (const value of ["<b>Invented</b>", "hidden\u202evalue", "\ud800", "bad\u0001value"]) expect(parseRelatedMetadata([{ ...link(), category: value }], verse).heldCount).toBe(1);
  const held = parseRelatedMetadata([{ ...link(), collectiveTitle: { en: "Invented <span>unsafe</span>", he: "דג" } }], verse); expect(held.heldCount).toBe(1);
  const getter = vi.fn(() => "Invented withheld getter value"), hostile = Object.defineProperty(link(), "sourceRef", { get: getter });
  expect(parseRelatedMetadata([hostile], verse).heldCount).toBe(1); expect(getter).not.toHaveBeenCalled();
  expect(parseRelatedMetadata([{ ...link(), collectiveTitle: { en: "Invente\u0301d", he: "דג" } }], verse).entries[0].labels.en).toBe("Inventéd");
});

it("review observed-scale catalogs are not truncated at64, while top-level row limits fail as a whole", () => {
  const rows = Array.from({ length: 1828 }, (_, i) => link(i + 1)), parsed = parseRelatedMetadata(rows, verse); expect(parsed.entries).toHaveLength(1828); expect(parsed.heldCount + parsed.duplicateCount).toBe(0);
  expect(() => parseRelatedMetadata(Array.from({ length: 4097 }, (_, i) => link(i + 1)), verse)).toThrow(SourceMetadataUnavailable);
  expect(() => parseEditionMetadata(Array.from({ length: 513 }, (_, i) => ({ ...edition(), versionTitle: `Invented ${i}` })), work)).toThrow(SourceMetadataUnavailable);
});

it("review edition provenance is inert nullable metadata and its complete requested work cannot be forged", () => {
  const rows = [{ ...edition(), isPrimary: "true", notes: "Discarded invented notes", purchaseInformationURL: "https://example.invalid/not-active" }, { ...edition(), versionTitle: "Invented other", license: null, versionSource: null }];
  const result = parseEditionMetadata(rows, work); expect(result).toMatchObject({ schema: "study-edition-metadata/v1", workTitle: work, heldCount: 0, duplicateCount: 0 });
  expect(result.entries).toHaveLength(2); expect(result.entries[0]).toMatchObject({ versionTitle: "Invented edition", language: "en", license: "Invented rights metadata", source: "https://example.invalid/provenance" });
  expect(result.entries[1]).toMatchObject({ license: null, source: null }); expect(Object.isFrozen(result.entries) && Object.isFrozen(result.entries[0])).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/isPrimary|notes|purchaseInformationURL|permission|approved/);
  expect(parseEditionMetadata([{ ...edition(), title: "Invented other work" }], work).heldCount).toBe(1);
  const actualLanguageConflict = [{ ...edition(), language: "he", actualLanguage: "en" }, { ...edition(), language: "he", actualLanguage: "fr" }];
  for (const rows of [actualLanguageConflict, [...actualLanguageConflict].reverse()]) { const held = parseEditionMetadata(rows, work); expect(held.entries).toHaveLength(0); expect(held.heldCount).toBe(2); expect(held.duplicateCount).toBe(0); }
  const separateSelectors = parseEditionMetadata([{ ...edition(), language: "he", actualLanguage: "en" }, { ...edition(), language: "en", actualLanguage: "en" }], work);
  expect(separateSelectors.entries.map(row => [row.language, row.actualLanguage])).toEqual([["he", "en"], ["en", "en"]]);
  const conflict = parseEditionMetadata([edition(), { ...edition(), license: "Invented different rights" }], work); expect(conflict.entries).toHaveLength(0); expect(conflict.heldCount).toBe(2); expect(conflict.duplicateCount).toBe(0);
});

it("review only fixed metadata GET destinations and flags are used, with no construction I/O or ambient credentials", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => response(String(input).includes("/api/links/") ? [link()] : [edition()], String(input)));
  const reader = createSefariaMetadataReader({ fetch: fetcher }); expect(fetcher).not.toHaveBeenCalled();
  await reader.related(verse, new AbortController().signal); await reader.editions(work, new AbortController().signal);
  const [related, versions] = fetcher.mock.calls.map(([input, options]) => ({ url: new URL(String(input)), options }));
  expect(related.url.origin).toBe("https://www.sefaria.org"); expect(related.url.pathname).toBe(`/api/links/${encodeURIComponent(verse)}`); expect([...related.url.searchParams.entries()].sort()).toEqual([["with_sheet_links", "0"], ["with_text", "0"]]);
  expect(versions.url.origin).toBe("https://www.sefaria.org"); expect(versions.url.pathname).toBe(`/api/texts/versions/${encodeURIComponent(work)}`); expect(versions.url.search).toBe("");
  for (const call of [related, versions]) { expect(call.options).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" }); expect([...new Headers(call.options?.headers).keys()]).toEqual(["accept"]); }
  await expect(reader.related("Genesis 1:1-2", new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable);
  for (const dot of [".", ".."]) await expect(reader.editions(dot, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("review streamed 2MiB cap and64-empty progress bound ignore a misleading advertised length", async () => {
  const fetcher = vi.fn<typeof fetch>(), reader = createSefariaMetadataReader({ fetch: fetcher });
  for (const bytes of [new Uint8Array(2 * 1024 * 1024 + 1), new Uint8Array()]) {
    let pulls = 0; const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(bytes); }, cancel });
    fetcher.mockImplementationOnce(async input => { const r = new Response(body, { headers: { "content-type": "application/json", "content-length": "1" } }); Object.defineProperty(r, "url", { value: String(input) }); return r; });
    await expect(reader.related(verse, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable); expect(cancel).toHaveBeenCalledTimes(1); if (!bytes.byteLength) { expect(pulls).toBeGreaterThanOrEqual(65); expect(pulls).toBeLessThanOrEqual(66); }
  }
});

it("review caller abort returns before hostile cleanup settles and a late fetched body is still canceled", async () => {
  const pending = deferred<Response>(), entered = deferred<void>(), fetcher = vi.fn<typeof fetch>(() => { entered.resolve(); return pending.promise; }), reader = createSefariaMetadataReader({ fetch: fetcher }), controller = new AbortController();
  const work = reader.related(verse, controller.signal), refused = expect(work).rejects.toBeInstanceOf(SourceMetadataUnavailable); await entered.promise; controller.abort(); await refused;
  const cancelObserved = deferred<void>(), body = new ReadableStream<Uint8Array>({ cancel() { cancelObserved.resolve(); return new Promise<void>(() => {}); } });
  pending.resolve(new Response(body, { headers: { "content-type": "application/json" } })); await cancelObserved.promise;
});

it("review errors, redirects, malformed headers and UTF8/JSON return only the fixed unavailable error without a cause", async () => {
  const fetcher = vi.fn<typeof fetch>(), reader = createSefariaMetadataReader({ fetch: fetcher });
  const samples = [new Response("Invented withheld body", { status: 503 }), new Response("[]", { headers: { "content-type": "text/html" } }), new Response("[]", { headers: { "content-type": "application/json", "content-length": "invalid" } }), new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), new Response("{", { headers: { "content-type": "application/json" } })];
  const redirect = response([], "https://example.invalid/foreign"); Object.defineProperty(redirect, "redirected", { value: true }); samples.push(redirect);
  for (const sample of samples) { fetcher.mockImplementationOnce(async input => { if (!sample.redirected) Object.defineProperty(sample, "url", { value: String(input) }); return sample; }); const error = await reader.related(verse, new AbortController().signal).catch(value => value); expect(error).toBeInstanceOf(SourceMetadataUnavailable); expect(error.message).toBe(new SourceMetadataUnavailable().message); expect(error.cause).toBeUndefined(); expect(String(error)).not.toMatch(/withheld|foreign|invalid|Unexpected token/); }
});

it("review total elapsed time is fenced after fetch settlement and late-body cleanup does not wait", async () => {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  const canceled = vi.fn(() => new Promise<void>(() => {})), body = new ReadableStream<Uint8Array>({ cancel: canceled });
  const reader = createSefariaMetadataReader({ fetch: vi.fn(async input => { now = 10_001; const r = new Response(body, { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: String(input) }); return r; }) });
  await expect(reader.related(verse, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable); expect(canceled).toHaveBeenCalledTimes(1);
});

it("review first body-progress idle budget starts on response arrival rather than after synchronous header work", async () => {
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now); const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel });
  const reader = createSefariaMetadataReader({ fetch: vi.fn(async input => { const r = new Response(body, { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: String(input) }); const original = r.headers.get.bind(r.headers); vi.spyOn(r.headers, "get").mockImplementation(name => { if (name === "content-type") now = 5001; return original(name); }); return r; }) });
  await expect(reader.related(verse, new AbortController().signal)).rejects.toBeInstanceOf(SourceMetadataUnavailable); expect(cancel).toHaveBeenCalledTimes(1);
});

it("review intrinsic typed-array view is used instead of shadowed length, buffer, offset or iteration hooks", async () => {
  const backing = new Uint8Array([99, 91, 93, 99]), chunk = backing.subarray(1, 3), getter = vi.fn(() => { throw new Error("Invented hostile hook"); });
  for (const name of ["byteLength", "byteOffset", "buffer", Symbol.iterator]) Object.defineProperty(chunk, name, { get: getter });
  const reader = createSefariaMetadataReader({ fetch: vi.fn(async input => { const r = new Response(new ReadableStream({ start(c) { c.enqueue(chunk); c.close(); } }), { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: String(input) }); return r; }) });
  expect((await reader.related(verse, new AbortController().signal)).entries).toEqual([]); expect(getter).not.toHaveBeenCalled();
});
