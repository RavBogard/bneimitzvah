import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { createStepSourceLoader, type StepSourceDescriptor } from "../../src/server/study/lexical/source-loader";
import { createStepSource } from "../../src/server/study/lexical/source";
import { STEP_SOURCE_MANIFEST, STEP_SOURCE_PIN, STEP_BOOK_GROUPS } from "../../src/server/study/lexical/source-manifest";
import { parseTahot, parseTbesh, StepSourceUnavailable } from "../../src/server/study/lexical/step";

const row = (book: string) => `${book}.1.1#1=L\tבָּג\tDISCARDED\tSynthetic sense\t{H0001}\tHNcmsa\t`;
const bookText = row("Gen") + "\n" + row("Exo"), lexText = "H0001#1\tH0001\tH0001\tבָּג\tDISCARDED\tHNcmsa\tSynthetic dictionary sense";
const bytes = (text: string) => new TextEncoder().encode(text);
const descriptor = (text: string, id = "Gen-Deu"): StepSourceDescriptor => {
  const official = Object.values(STEP_SOURCE_MANIFEST).find(value => value.id === id)!;
  return Object.freeze({ id, pin: official.pin, url: official.url, bytes: bytes(text).byteLength, sha256: createHash("sha256").update(text).digest("hex") });
};
function response(body: BodyInit | ReadableStream<Uint8Array> | null, url: string, options?: ResponseInit): Response {
  const value = new Response(body, options); Object.defineProperty(value, "url", { value: url }); return value;
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function fixture(options: Partial<Parameters<typeof createStepSourceLoader>[0]> = {}) {
  const book = descriptor(bookText), lexicon = descriptor(lexText, "TBESH");
  const fetch = vi.fn(async (url: string, _options: RequestInit) => response(url === lexicon.url ? lexText : bookText, url));
  const parseBook = vi.fn(parseTahot), parseLexicon = vi.fn(parseTbesh);
  const loader = createStepSourceLoader({ books: { Gen: book, Exo: book }, lexicon, fetch, parseBook, parseLexicon, ...options });
  return { loader, fetch, parseBook, parseLexicon, book, lexicon };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("constructs production without I/O and selects only exact fixed supported sources, never a URL or poetic book", async () => {
  const fetch = vi.fn(async (url: string) => response(bookText, url)); vi.stubGlobal("fetch", fetch);
  const source = createStepSource(); expect(fetch).not.toHaveBeenCalled(); expect(Object.isFrozen(source)).toBe(true);
  for (const code of ["Job", "Psa", "Gen/../Exo", "https://example.test", "__proto__", ""]) await expect(source.book(code)).rejects.toBeInstanceOf(StepSourceUnavailable);
  expect(fetch).not.toHaveBeenCalled(); await expect(source.book("Gen")).rejects.toBeInstanceOf(StepSourceUnavailable);
  expect(fetch.mock.calls[0][0]).toBe(STEP_SOURCE_MANIFEST.torah.url);
  expect(STEP_SOURCE_PIN).toBe("bd09545c7a44b39ace20f16c0359915f2aa23a62");
  expect(Object.keys(STEP_BOOK_GROUPS)).toHaveLength(26);
  for (const value of Object.values(STEP_SOURCE_MANIFEST)) {
    const url = new URL(value.url); expect(url.hostname).toBe("raw.githubusercontent.com"); expect(url.pathname).toContain(`/${STEP_SOURCE_PIN}/`);
    expect(url.username || url.password || url.search || url.hash || url.port).toBe(""); expect(Object.isFrozen(value)).toBe(true);
  }
});

it("verifies actual bytes/digest before immutable parse and shares only success source facts", async () => {
  const f = fixture(), value = await f.loader.book("Gen"), lexicon = await f.loader.lexicon();
  expect(value[0]).toMatchObject({ ref: "Genesis 1:1", status: "ready" }); expect(lexicon[0]).toMatchObject({ lemma: "H0001", status: "ready" });
  expect(Object.isFrozen(value) && Object.isFrozen(value[0]) && Object.isFrozen(lexicon[0])).toBe(true);
  expect(await f.loader.book("Gen")).toBe(value); expect(await f.loader.lexicon()).toBe(lexicon);
  expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.parseBook).toHaveBeenCalledTimes(1); expect(f.parseLexicon).toHaveBeenCalledTimes(1);
  for (const [, options] of f.fetch.mock.calls) expect(options).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
  expect(f.fetch.mock.calls.every(([, options]) => !options.headers && !options.body && !options.method)).toBe(true);
});

it("coalesces exactly sixteen same-key callers, refuses excess and different books without queueing", async () => {
  const gate = deferred<Response>(); const fetch = vi.fn(() => gate.promise), f = fixture({ fetch });
  const waiting = Array.from({ length: 16 }, () => f.loader.book("Gen"));
  await expect(f.loader.book("Gen")).rejects.toBeInstanceOf(StepSourceUnavailable);
  await expect(f.loader.book("Exo")).rejects.toBeInstanceOf(StepSourceUnavailable);
  await flush(); expect(fetch).toHaveBeenCalledTimes(1); gate.resolve(response(bookText, f.book.url));
  const results = await Promise.all(waiting); expect(results.every(value => value === results[0])).toBe(true);
  expect(f.parseBook).toHaveBeenCalledTimes(1);
});

it("has a separate single lexicon producer while one book acquisition occupies its only slot", async () => {
  const bookGate = deferred<Response>(), lexGate = deferred<Response>(); const f = fixture({ fetch: (url: string) => url === STEP_SOURCE_MANIFEST.lexicon.url ? lexGate.promise : bookGate.promise });
  const book = f.loader.book("Gen"), lex = f.loader.lexicon(), lex2 = f.loader.lexicon();
  await expect(f.loader.book("Exo")).rejects.toBeInstanceOf(StepSourceUnavailable);
  lexGate.resolve(response(lexText, f.lexicon.url)); expect(await lex).toBe(await lex2);
  bookGate.resolve(response(bookText, f.book.url)); await book;
  expect(f.parseLexicon).toHaveBeenCalledTimes(1);
});

it("evicts one completed book before a different book and parses the requested book even within the same raw group", async () => {
  const f = fixture(), gen = await f.loader.book("Gen"), exo = await f.loader.book("Exo");
  expect(exo[0].ref).toBe("Exodus 1:1"); expect(exo).not.toBe(gen);
  expect(await f.loader.book("Gen")).not.toBe(gen); expect(f.fetch).toHaveBeenCalledTimes(3);
  expect(f.parseBook.mock.calls.map(([, code]) => code)).toEqual(["Gen", "Exo", "Gen"]);
});

it("a partially canceled coalesced request cannot abort the producer or another caller", async () => {
  const gate = deferred<Response>(), controller = new AbortController(), fetch = vi.fn((_url: string, options: RequestInit) => gate.promise); const f = fixture({ fetch });
  const first = f.loader.book("Gen", controller.signal), second = f.loader.book("Gen"); await flush();
  controller.abort(); await expect(first).rejects.toBeInstanceOf(StepSourceUnavailable);
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(false);
  gate.resolve(response(bookText, f.book.url)); const value = await second;
  expect(await f.loader.book("Gen")).toBe(value); expect(fetch).toHaveBeenCalledTimes(1);
});

it("last-caller cancellation holds the occupied slot through late response cancellation and never caches it", async () => {
  const gate = deferred<Response>(), canceled = deferred<void>(), cancel = vi.fn(() => canceled.promise), controller = new AbortController();
  const fetch = vi.fn().mockImplementationOnce(() => gate.promise).mockImplementation((url: string) => Promise.resolve(response(bookText, url))), f = fixture({ fetch });
  const first = f.loader.book("Gen", controller.signal); await flush(); controller.abort(); await expect(first).rejects.toBeInstanceOf(StepSourceUnavailable);
  await expect(f.loader.book("Gen")).rejects.toBeInstanceOf(StepSourceUnavailable);
  gate.resolve(response(new ReadableStream<Uint8Array>({ cancel }), f.book.url)); await flush();
  expect(cancel).toHaveBeenCalledTimes(1); await expect(f.loader.book("Exo")).rejects.toBeInstanceOf(StepSourceUnavailable);
  expect(f.parseBook).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  canceled.resolve(); await flush(); const next = await f.loader.book("Exo");
  expect(next[0].ref).toBe("Exodus 1:1"); expect(await f.loader.book("Exo")).toBe(next); expect(fetch).toHaveBeenCalledTimes(2);
});

it("pre-abort and same-turn last abort produce no fetch; canceled cache hits cannot return source", async () => {
  const f = fixture(), pre = new AbortController(); pre.abort(); await expect(f.loader.book("Gen", pre.signal)).rejects.toBeInstanceOf(StepSourceUnavailable);
  const current = new AbortController(), pending = f.loader.book("Gen", current.signal); current.abort(); await expect(pending).rejects.toBeInstanceOf(StepSourceUnavailable); await flush();
  expect(f.fetch).not.toHaveBeenCalled(); await f.loader.book("Gen");
  const hit = new AbortController(), cached = f.loader.book("Gen", hit.signal); hit.abort(); await expect(cached).rejects.toBeInstanceOf(StepSourceUnavailable);
});

it.each(["short", "long", "hash", "utf8"])("rejects %s actual bytes before parsing and never retains the failure", async kind => {
  const body = kind === "short" ? bytes(bookText).slice(1) : kind === "long" ? bytes(bookText + "x") : kind === "hash" ? bytes(bookText.replace("Synthetic", "Invented!")) : new Uint8Array([0xff]);
  const expected = kind === "utf8" ? { ...descriptor("x"), bytes: 1, sha256: createHash("sha256").update(body).digest("hex") } : descriptor(bookText);
  const fetch = vi.fn(async (url: string) => response(body, url)); const f = fixture({ books: { Gen: expected }, fetch });
  for (let i = 0; i < 2; i++) await expect(f.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable());
  expect(fetch).toHaveBeenCalledTimes(2); expect(f.parseBook).not.toHaveBeenCalled();
});

it.each(["status", "url", "redirect", "headers", "length"])("cancels a refused %s response without reading or exposing provider details", async kind => {
  const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel });
  const source = descriptor(bookText), value = response(body, kind === "url" ? source.url + "/wrong" : source.url, { status: kind === "status" ? 403 : 200, headers: kind === "headers" ? { "x-large": "x".repeat(4097) } : kind === "length" ? { "content-length": "9999999999" } : undefined });
  if (kind === "redirect") Object.defineProperty(value, "redirected", { value: true });
  const f = fixture({ fetch: async () => value }); await expect(f.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable()); await flush();
  expect(cancel).toHaveBeenCalledTimes(1); expect(f.parseBook).not.toHaveBeenCalled();
});

it("bounds empty reads and uses intrinsic byte views rather than spoofable chunk properties/iterators", async () => {
  const source = bytes(bookText), fake = new Uint8Array(source);
  Object.defineProperty(fake, "byteLength", { get: () => 0 }); Object.defineProperty(fake, "byteOffset", { get: () => 999999 });
  Object.defineProperty(fake, Symbol.iterator, { value: () => { throw new Error("Synthetic iterator must not run"); } });
  const f = fixture({ fetch: async url => response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(fake); c.close(); } }), url) });
  expect((await f.loader.book("Gen"))[0].status).toBe("ready");
  let calls = 0; const cancel = vi.fn(), empty = fixture({ fetch: async url => response(new ReadableStream<Uint8Array>({ pull(c) { calls++; c.enqueue(new Uint8Array()); }, cancel }), url) });
  await expect(empty.loader.book("Gen")).rejects.toBeInstanceOf(StepSourceUnavailable); expect(calls).toBeLessThanOrEqual(67); expect(cancel).toHaveBeenCalledTimes(1);
});

it("an absolute producer timeout rejects all waiters while a nonsettling fetch still blocks replacement", async () => {
  vi.useFakeTimers(); let clock = 0; const gate = deferred<Response>(), fetch = vi.fn(() => gate.promise); const f = fixture({ fetch, now: () => clock, deadlineMs: 50 });
  const pending = expect(f.loader.book("Gen")).rejects.toBeInstanceOf(StepSourceUnavailable); await flush(); clock = 50; await vi.advanceTimersByTimeAsync(50); await pending;
  await expect(f.loader.book("Gen")).rejects.toBeInstanceOf(StepSourceUnavailable); expect(fetch).toHaveBeenCalledTimes(1);
  gate.resolve(response(bookText, f.book.url)); await flush(); expect(f.parseBook).not.toHaveBeenCalled();
});

it.each(["fetch", "headers", "parse"])("checks elapsed deadline after synchronous %s starvation rather than relying on timers", async stage => {
  let clock = 0; const cancel = vi.fn(); const f = fixture({ now: () => clock, deadlineMs: 50,
    fetch: async url => {
      const value = response(stage === "parse" ? bookText : new ReadableStream<Uint8Array>({ cancel }), url);
      if (stage === "fetch") clock = 51;
      if (stage === "headers") Object.defineProperty(value.headers, Symbol.iterator, { value: function* () { clock = 51; yield ["x-synthetic", "value"]; } });
      return value;
    }, parseBook: (text, code) => { const parsed = parseTahot(text, code); clock = 51; return parsed; } });
  await expect(f.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable());
  if (stage !== "parse") expect(cancel).toHaveBeenCalledTimes(1);
});

it("last-subscriber cancellation during synchronous parse cannot cache the completed result", async () => {
  const controller = new AbortController(); let calls = 0;
  const f = fixture({ parseBook: (text, code) => { calls++; if (calls === 1) controller.abort(); return parseTahot(text, code); } });
  await expect(f.loader.book("Gen", controller.signal)).rejects.toBeInstanceOf(StepSourceUnavailable); await flush();
  expect((await f.loader.book("Gen"))[0].status).toBe("ready"); expect(calls).toBe(2);
});

it("snapshots trusted descriptors and rejects oversize or malformed configuration without I/O", async () => {
  const book = { ...descriptor(bookText) }, f = fixture({ books: { Gen: book } }); book.url = "https://example.test/changed"; book.sha256 = "b".repeat(64);
  expect((await f.loader.book("Gen"))[0].status).toBe("ready"); expect(f.fetch.mock.calls[0][0]).toBe(descriptor(bookText).url);
  for (const bad of [{ ...descriptor(bookText), bytes: 33554433 }, { ...descriptor(bookText), sha256: "bad" }, { ...descriptor(bookText), url: "http://example.test/bad" }, { ...descriptor(bookText), url: "https://example.test/a?secret=unused" }]) expect(() => fixture({ books: { Gen: bad } })).toThrow(StepSourceUnavailable);
  expect(() => fixture({ lexicon: { ...descriptor(lexText), bytes: 4194305 } })).toThrow(StepSourceUnavailable);
});

it("transport and parser exceptions expose only a new fixed unavailable error, without cause or retained failure", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("Synthetic upstream details withheld")).mockImplementation((url: string) => Promise.resolve(response(bookText, url)));
  const f = fixture({ fetch }); let error: unknown; try { await f.loader.book("Gen"); } catch (value) { error = value; }
  expect(error).toEqual(new StepSourceUnavailable()); expect(error).not.toHaveProperty("cause");
  expect((await f.loader.book("Gen"))[0].status).toBe("ready"); expect(fetch).toHaveBeenCalledTimes(2);
  const parseBook = vi.fn().mockImplementationOnce(() => { throw new Error("Synthetic parser details withheld"); }).mockImplementation(parseTahot);
  const parser = fixture({ parseBook }); await expect(parser.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable());
  expect((await parser.loader.book("Gen"))[0].status).toBe("ready"); expect(parser.fetch).toHaveBeenCalledTimes(2);
});

it("keeps parser source-format holds in a successful immutable public-source cache", async () => {
  const text = row("Gen") + "\n" + row("Gen"), f = fixture({ books: { Gen: descriptor(text) }, fetch: async url => response(text, url) });
  const value = await f.loader.book("Gen"); expect(value).toEqual([{ ref: "Genesis 1:1", status: "unavailable", reason: "source-format" }]);
  expect(await f.loader.book("Gen")).toBe(value); expect(f.parseBook).toHaveBeenCalledTimes(1);
});

it("production deadline is exactly five seconds, even when fetch ignores its signal", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const gate = deferred<Response>(), fetch = vi.fn(() => gate.promise); vi.stubGlobal("fetch", fetch);
  const source = createStepSource(), pending = source.book("Gen"), rejected = expect(pending).rejects.toBeInstanceOf(StepSourceUnavailable); let settled = false;
  void pending.catch(() => { settled = true; }); await flush(); await vi.advanceTimersByTimeAsync(4999); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await rejected;
  const cancel = vi.fn(); gate.resolve(response(new ReadableStream<Uint8Array>({ cancel }), STEP_SOURCE_MANIFEST.torah.url)); await flush();
  expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
});

it("aborts a pending body read at deadline, releases its lock, and does not cache partial bytes", async () => {
  vi.useFakeTimers(); let clock = 0; const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes(bookText).slice(0, 1)); }, cancel });
  const f = fixture({ now: () => clock, deadlineMs: 50, fetch: async url => response(body, url) });
  const pending = expect(f.loader.book("Gen")).rejects.toEqual(new StepSourceUnavailable()); await flush(); clock = 50; await vi.advanceTimersByTimeAsync(50); await pending; await flush();
  expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false); expect(f.parseBook).not.toHaveBeenCalled();
});

it("the trusted fixture seam still refuses nonofficial origin, pin, path, source identity and book mapping", () => {
  const original = descriptor(bookText);
  for (const bad of [{ ...original, url: "https://example.test/untrusted" }, { ...original, pin: "b".repeat(40) }, { ...original, url: original.url + "/extra" }, { ...original, id: "arbitrary" }, descriptor(bookText, "Isa-Mal")]) {
    expect(() => fixture({ books: { Gen: bad } })).toThrow(StepSourceUnavailable);
  }
  expect(() => fixture({ books: { Job: original } })).toThrow(StepSourceUnavailable);
});
