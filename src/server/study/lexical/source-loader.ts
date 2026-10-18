import "server-only";
import { createHash } from "node:crypto";
import { StepSourceUnavailable, type StepVerse, type StepLexiconEntry } from "./step";
import { STEP_BOOK_GROUPS, STEP_SOURCE_MANIFEST } from "./source-manifest";

export type StepSourceDescriptor = Readonly<{ id: string; pin: string; url: string; bytes: number; sha256: string }>;
export type StepSourceLoader = Readonly<{ book(code: string, signal?: AbortSignal): Promise<readonly StepVerse[]>; lexicon(signal?: AbortSignal): Promise<readonly StepLexiconEntry[]> }>;
type SourceResult = readonly StepVerse[] | readonly StepLexiconEntry[];
type Subscriber = { resolve(value: SourceResult): void; reject(error: StepSourceUnavailable): void; detach(): void };
type Producer = { key: string; controller: AbortController; subscribers: Set<Subscriber>; valid: boolean; delivered: boolean; done: boolean; io: number; deadline: number;
  timer?: ReturnType<typeof setTimeout>; response?: Response; reader?: ReadableStreamDefaultReader<Uint8Array>; cancelled: boolean };
type Slot = { producer?: Producer; cache?: { key: string; value: SourceResult } };
const fail = (): never => { throw new StepSourceUnavailable(); };
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const getSize = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const getBuffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
const getOffset = Object.getOwnPropertyDescriptor(typedArray, "byteOffset")!.get!;

/** Trusted construction seam for synthetic fixtures. Production uses source.ts,
 * which supplies fixed descriptors/parsers and exposes no configuration input. */
export function createStepSourceLoader(input: Readonly<{
  books: Readonly<Record<string, StepSourceDescriptor>>; lexicon: StepSourceDescriptor;
  fetch: (url: string, options: RequestInit) => Promise<Response>;
  parseBook(text: string, code: string): readonly StepVerse[];
  parseLexicon(text: string): readonly StepLexiconEntry[];
  now?: () => number; deadlineMs?: number;
}>): StepSourceLoader {
  const now = input.now ?? (() => performance.now()), duration = input.deadlineMs ?? 5000;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 5000) return fail();
  const fetchSource = input.fetch, parseBook = input.parseBook, parseLexicon = input.parseLexicon;
  const descriptor = (value: StepSourceDescriptor, cap: number): StepSourceDescriptor => {
    try {
      if (!value || typeof value.id !== "string" || !/^[A-Za-z0-9-]{1,32}$/.test(value.id) || typeof value.pin !== "string" || !/^[a-f0-9]{40}$/.test(value.pin)
        || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > cap
        || typeof value.url !== "string" || value.url.length > 1024) return fail();
      const url = new URL(value.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.href !== value.url) return fail();
      const official = Object.values(STEP_SOURCE_MANIFEST).find(source => source.id === value.id);
      if (!official || value.url !== official.url || value.pin !== official.pin) return fail();
      return Object.freeze({ id: value.id, pin: value.pin, url: value.url, bytes: value.bytes, sha256: value.sha256 });
    } catch { return fail(); }
  };
  const books = new Map<string, StepSourceDescriptor>();
  for (const [code, value] of Object.entries(input.books)) {
    if (!Object.hasOwn(STEP_BOOK_GROUPS, code) || books.size >= 40 || value?.id !== STEP_SOURCE_MANIFEST[STEP_BOOK_GROUPS[code as keyof typeof STEP_BOOK_GROUPS]].id) return fail();
    books.set(code, descriptor(value, 32 * 1024 * 1024));
  }
  if (input.lexicon?.id !== STEP_SOURCE_MANIFEST.lexicon.id) return fail();
  const lexicon = descriptor(input.lexicon, 4 * 1024 * 1024), bookSlot: Slot = {}, lexiconSlot: Slot = {};
  const release = (slot: Slot, producer: Producer) => {
    if (producer.done && producer.io === 0 && slot.producer === producer) slot.producer = undefined;
  };
  const track = <T>(slot: Slot, producer: Producer, promise: Promise<T>): Promise<T> => {
    producer.io++;
    void promise.then(() => { producer.io--; release(slot, producer); }, () => { producer.io--; release(slot, producer); });
    return promise;
  };
  const cancelBody = (slot: Slot, producer: Producer) => {
    if (producer.cancelled || !producer.response?.body) return;
    producer.cancelled = true;
    try {
      const pending = producer.reader ? producer.reader.cancel() : producer.response.body.cancel();
      void track(slot, producer, Promise.resolve(pending)).catch(() => {});
    } catch { /* Cancellation cannot expose a transport exception. */ }
  };
  const live = (producer: Producer) => {
    const time = now();
    if (!producer.valid || producer.controller.signal.aborted || !Number.isFinite(time) || time >= producer.deadline) return fail();
  };
  const bounded = async <T>(producer: Producer, pending: Promise<T>): Promise<T> => {
    let stopped: (() => void) | undefined;
    try {
      const value = await Promise.race([pending, new Promise<never>((_, reject) => {
        stopped = () => reject(new StepSourceUnavailable());
        producer.controller.signal.addEventListener("abort", stopped, { once: true });
        if (producer.controller.signal.aborted) stopped();
      })]);
      live(producer); return value;
    } finally { if (stopped) producer.controller.signal.removeEventListener("abort", stopped); }
  };
  const settle = (producer: Producer, result?: SourceResult) => {
    producer.delivered = true;
    for (const subscriber of [...producer.subscribers]) {
      subscriber.detach(); producer.subscribers.delete(subscriber);
      if (result) subscriber.resolve(result); else subscriber.reject(new StepSourceUnavailable());
    }
  };
  async function run(slot: Slot, producer: Producer, source: StepSourceDescriptor, code?: string) {
    let eof = false;
    try {
      live(producer);
      const pending = Promise.resolve().then(() => {
        live(producer);
        return fetchSource(source.url, { signal: producer.controller.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
      });
      // Establish late-response ownership before the I/O counter may release the
      // slot. A refused late body must be canceled before a successor can start.
      void pending.then(response => {
        producer.response = response;
        if (!producer.valid || producer.controller.signal.aborted) cancelBody(slot, producer);
      }).catch(() => {});
      const response = await bounded(producer, track(slot, producer, pending));
      if (response.status !== 200 || response.redirected || typeof response.url !== "string" || response.url !== source.url || !response.body) return fail();
      let headerBytes = 0, headerCount = 0;
      for (const [name, value] of response.headers) {
        if (++headerCount > 64 || name.length > 128 || value.length > 4096 || (headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value)) > 16384) return fail();
      }
      live(producer);
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^[0-9]{1,10}$/.test(declared) || Number(declared) > (code ? 32 * 1024 * 1024 : 4 * 1024 * 1024))) return fail();
      producer.reader = response.body.getReader();
      const output = new Uint8Array(source.bytes), hash = createHash("sha256"); let bytes = 0, empty = 0;
      while (true) {
        live(producer);
        const part = await bounded(producer, track(slot, producer, producer.reader.read()));
        if (part.done) { eof = true; break; }
        if (!(part.value instanceof Uint8Array)) return fail();
        const size = getSize.call(part.value) as number;
        if (!size) { if (++empty > 64) return fail(); continue; }
        if (bytes + size > source.bytes) return fail();
        const buffer = getBuffer.call(part.value) as ArrayBuffer, offset = getOffset.call(part.value) as number;
        output.set(new Uint8Array(buffer, offset, size), bytes);
        hash.update(output.subarray(bytes, bytes + size)); bytes += size; empty = 0;
      }
      live(producer);
      if (bytes !== source.bytes || hash.digest("hex") !== source.sha256) return fail();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(output); live(producer);
      const result: SourceResult = code ? parseBook(text, code) : parseLexicon(text); live(producer);
      if (!Object.isFrozen(result) || !producer.subscribers.size || slot.producer !== producer) return fail();
      slot.cache = { key: producer.key, value: result }; settle(producer, result);
    } catch {
      producer.valid = false; producer.controller.abort(); settle(producer);
    } finally {
      clearTimeout(producer.timer);
      if (!eof) cancelBody(slot, producer);
      try { producer.reader?.releaseLock(); } catch {}
      producer.done = true; release(slot, producer);
    }
  }
  function attach(slot: Slot, source: StepSourceDescriptor, signal?: AbortSignal, code?: string): Promise<SourceResult> {
    if (signal?.aborted) return Promise.reject(new StepSourceUnavailable());
    const key = `${source.pin}:${source.sha256}:${source.bytes}:${source.id}:${code ?? "lexicon"}`;
    if (slot.cache?.key === key) {
      const value = slot.cache.value;
      return Promise.resolve().then(() => { if (signal?.aborted) return fail(); return value; });
    }
    let producer = slot.producer;
    if (producer && (producer.key !== key || !producer.valid || producer.subscribers.size >= 16)) return Promise.reject(new StepSourceUnavailable());
    let created = false;
    if (!producer) {
      const started = now(); if (!Number.isFinite(started)) return Promise.reject(new StepSourceUnavailable());
      slot.cache = undefined; created = true;
      producer = { key, controller: new AbortController(), subscribers: new Set(), valid: true, delivered: false, done: false, io: 0, deadline: started + duration, cancelled: false };
      slot.producer = producer;
      const active = producer;
      active.timer = setTimeout(() => { active.valid = false; active.controller.abort(); }, duration);
    }
    const active = producer;
    const result = new Promise<SourceResult>((resolve, reject) => {
      const abort = () => {
        active.subscribers.delete(subscriber); subscriber.detach(); reject(new StepSourceUnavailable());
        if (!active.delivered && !active.subscribers.size) { active.valid = false; active.controller.abort(); }
      };
      const subscriber: Subscriber = { resolve, reject, detach: () => signal?.removeEventListener("abort", abort) };
      active.subscribers.add(subscriber); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    if (created) queueMicrotask(() => { void run(slot, active, source, code); });
    return result;
  }
  return Object.freeze({
    book(code: string, signal?: AbortSignal): Promise<readonly StepVerse[]> {
      if (typeof code !== "string" || !books.has(code)) return Promise.reject(new StepSourceUnavailable());
      return attach(bookSlot, books.get(code)!, signal, code) as Promise<readonly StepVerse[]>;
    },
    lexicon(signal?: AbortSignal): Promise<readonly StepLexiconEntry[]> { return attach(lexiconSlot, lexicon, signal) as Promise<readonly StepLexiconEntry[]>; },
  });
}
