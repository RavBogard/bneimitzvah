// Independent tiny invented-source boundary/race fixtures; no corpus or network.
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createStepSourceLoader, type StepSourceDescriptor } from "../../src/server/study/lexical/source-loader";
import { STEP_SOURCE_MANIFEST } from "../../src/server/study/lexical/source-manifest";
import { parseTahot, parseTbesh, StepSourceUnavailable } from "../../src/server/study/lexical/step";

const row = (book: string) => `${book}.1.1#1=L\tדָּג\tIGNORED\tInvented source meaning\t{H0002}\tHNcmsa\t`;
const text = row("Gen") + "\n" + row("Exo"), lexText = "H0002#1\tH0002\tH0002\tדָּג\tIGNORED\tHNcmsa\tInvented dictionary meaning";
const encode = (value: string) => new TextEncoder().encode(value);
function descriptor(value: string, lexicon = false): StepSourceDescriptor {
  const official = lexicon ? STEP_SOURCE_MANIFEST.lexicon : STEP_SOURCE_MANIFEST.torah;
  return { ...official, bytes: encode(value).byteLength, sha256: createHash("sha256").update(value).digest("hex") };
}
function response(value: BodyInit | ReadableStream<Uint8Array>, url: string, headers?: HeadersInit) {
  const result = new Response(value, { headers }); Object.defineProperty(result, "url", { value: url }); return result;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
function fixture(extra: Partial<Parameters<typeof createStepSourceLoader>[0]> = {}) {
  const book = descriptor(text), lexicon = descriptor(lexText, true);
  const fetch = vi.fn(async (url: string, _options: RequestInit) => response(url === lexicon.url ? lexText : text, url));
  const parseBook = vi.fn(parseTahot), parseLexicon = vi.fn(parseTbesh);
  const loader = createStepSourceLoader({ books: { Gen: book, Exo: book }, lexicon, fetch, parseBook, parseLexicon, ...extra });
  return { loader, fetch, parseBook, parseLexicon, book, lexicon };
}

it("review replaces one canceled waiter within the same sixteen-caller producer without canceling its survivors", async () => {
  const gate = deferred<Response>(), aborted = new AbortController(), fetch = vi.fn((_url: string, _options: RequestInit) => gate.promise), f = fixture({ fetch });
  const first = f.loader.book("Gen", aborted.signal), rejection = expect(first).rejects.toEqual(new StepSourceUnavailable());
  const survivors = Array.from({ length: 15 }, () => f.loader.book("Gen")); await flush();
  aborted.abort(); await rejection; const replacement = f.loader.book("Gen");
  await expect(f.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable());
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].signal?.aborted).toBe(false);
  gate.resolve(response(text, f.book.url)); const values = await Promise.all([...survivors, replacement]);
  expect(values.every(value => value === values[0])).toBe(true); expect(f.parseBook).toHaveBeenCalledTimes(1);
});

it("review cancellation inside parse only cancels that caller while another subscriber may receive and cache the immutable source", async () => {
  const canceled = new AbortController();
  const f = fixture({ parseBook: (value, code) => { canceled.abort(); return parseTahot(value, code); } });
  const first = f.loader.book("Gen", canceled.signal), refusal = expect(first).rejects.toEqual(new StepSourceUnavailable()), second = f.loader.book("Gen");
  const result = await second; await refusal; expect(result[0].status).toBe("ready");
  expect(Object.isFrozen(result)).toBe(true); expect(await f.loader.book("Gen")).toBe(result); expect(f.fetch).toHaveBeenCalledTimes(1);
});

it("review lexicon cancellation owns its pending cancel until settlement but never occupies the separate book producer", async () => {
  const gate = deferred<Response>(), canceled = deferred<void>(), cancel = vi.fn(() => canceled.promise), controller = new AbortController();
  const fetch = vi.fn(async (url: string) => url === STEP_SOURCE_MANIFEST.lexicon.url ? gate.promise : response(text, url)), f = fixture({ fetch });
  const first = f.loader.lexicon(controller.signal), refusal = expect(first).rejects.toEqual(new StepSourceUnavailable()); await flush(); controller.abort(); await refusal;
  gate.resolve(response(new ReadableStream<Uint8Array>({ cancel }), f.lexicon.url)); await flush();
  await expect(f.loader.lexicon()).rejects.toEqual(new StepSourceUnavailable());
  expect((await f.loader.book("Gen"))[0].status).toBe("ready"); expect(cancel).toHaveBeenCalledTimes(1); expect(f.parseLexicon).not.toHaveBeenCalled();
  canceled.resolve(); await flush(); fetch.mockImplementation(async url => response(url === f.lexicon.url ? lexText : text, url));
  expect((await f.loader.lexicon())[0].status).toBe("ready"); expect(fetch).toHaveBeenCalledTimes(3);
});

it("review an aborted cache-hit consumer cannot evict success or cancel a concurrent valid cache hit", async () => {
  const f = fixture(), cached = await f.loader.book("Gen"), canceled = new AbortController();
  const old = f.loader.book("Gen", canceled.signal), refusal = expect(old).rejects.toEqual(new StepSourceUnavailable()), valid = f.loader.book("Gen");
  canceled.abort(); await refusal; expect(await valid).toBe(cached); expect(await f.loader.book("Gen")).toBe(cached);
  expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.parseBook).toHaveBeenCalledTimes(1);
});

it("review elapsed read settlement fails before parse even when synchronous work starves the timer, holding cancellation ownership", async () => {
  let time = 0; const canceled = deferred<void>(), cancel = vi.fn(() => canceled.promise), body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encode(text)); }, cancel });
  const acquire = body.getReader.bind(body);
  vi.spyOn(body, "getReader").mockImplementation(() => {
    const reader = acquire(), read = reader.read.bind(reader);
    vi.spyOn(reader, "read").mockImplementation(async () => { const value = await read(); time = 51; return value; });
    return reader;
  });
  const f = fixture({ now: () => time, deadlineMs: 50, fetch: async url => response(body, url) });
  await expect(f.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable());
  expect(f.parseBook).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
  await expect(f.loader.book("Exo")).rejects.toEqual(new StepSourceUnavailable()); canceled.resolve(); await flush(); expect(body.locked).toBe(false);
});

it.each(["count", "aggregate"])("review bounded %s headers are refused and their bodies canceled before any parse", async kind => {
  const headers = new Headers(Array.from({ length: kind === "count" ? 65 : 64 }, (_, i) => [`x-review-${String(i).padStart(2, "0")}`, kind === "count" ? "v" : "v".repeat(260)]));
  const cancel = vi.fn(), f = fixture({ fetch: async url => response(new ReadableStream<Uint8Array>({ cancel }), url, headers) });
  await expect(f.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable()); await flush();
  expect(cancel).toHaveBeenCalledTimes(1); expect(f.parseBook).not.toHaveBeenCalled();
});

it("review the actual body/digest remains authoritative when a bounded transfer length is misleading", async () => {
  const fetch = vi.fn(async (url: string, _options: RequestInit) => response(text, url, { "content-length": "1", "content-encoding": "gzip" })), f = fixture({ fetch });
  const result = await f.loader.book("Gen"); expect(result[0].status).toBe("ready"); expect(f.parseBook).toHaveBeenCalledTimes(1);
  expect(Object.keys(f.loader)).toEqual(["book", "lexicon"]); expect(fetch).toHaveBeenCalledTimes(1);
  expect(Object.keys(fetch.mock.calls[0][1]).sort()).toEqual(["cache", "credentials", "redirect", "referrerPolicy", "signal"]);
});
