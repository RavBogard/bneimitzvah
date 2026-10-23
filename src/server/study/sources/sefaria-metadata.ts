import "server-only";
import { parseRelatedMetadata, parseEditionMetadata, SOURCE_METADATA_LIMITS, SourceMetadataUnavailable, sourceMetadataVerse, sourceMetadataWork } from "./metadata";
import { parseShelfLinks } from "../shelf";

export const SEFARIA_METADATA_BOUNDS = Object.freeze({ totalMs: 10000, idleMs: 5000, emptyReads: 64, headerLength: 128 });
const fail = (): never => { throw new SourceMetadataUnavailable(); };
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArray, "byteOffset")!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
/** Stateless public-metadata I/O only. No cache or process concurrency claim. */
export function createSefariaMetadataReader(input: { fetch?: typeof globalThis.fetch } = {}) {
  const fetcher = input.fetch ?? globalThis.fetch;
  async function request<T>(url: URL, signal: AbortSignal, parse: (value: unknown) => T): Promise<T> {
    const abort = new AbortController(), start = performance.now(), end = start + SEFARIA_METADATA_BOUNDS.totalMs;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, incoming: Response | undefined, receivedAt = start;
    const canceled = new WeakSet<object>();
    const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { if (body && !canceled.has(body)) { canceled.add(body); void body.cancel().catch(() => {}); } } catch {} };
    const cancelResponse = (value?: Response) => { try { cancel(value?.body); } catch {} };
    const onAbort = () => abort.abort(); if (signal.aborted) onAbort(); signal.addEventListener("abort", onAbort, { once: true });
    const totalTimer = setTimeout(() => abort.abort(), SEFARIA_METADATA_BOUNDS.totalMs);
    const live = () => { if (signal.aborted || abort.signal.aborted || performance.now() >= end) return fail(); };
    async function wait<V>(pending: Promise<V>, until: number, late?: (value: V) => void): Promise<V> {
      let expired = false, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
      const observed = pending.then(value => { if (expired || abort.signal.aborted) { late?.(value); return fail(); } return value; });
      try {
        const value = await Promise.race([observed, new Promise<never>((_, reject) => {
          stop = () => { expired = true; reject(new SourceMetadataUnavailable()); }; abort.signal.addEventListener("abort", stop, { once: true });
          timer = setTimeout(() => { expired = true; reject(new SourceMetadataUnavailable()); }, Math.max(1, Math.min(end, until) - performance.now()));
          if (abort.signal.aborted) stop();
        })]);
        try { live(); if (performance.now() >= until) return fail(); return value; } catch (error) { late?.(value); throw error; }
      } finally { if (timer) clearTimeout(timer); if (stop) abort.signal.removeEventListener("abort", stop); }
    }
    try {
      live();
      const pending = Promise.resolve(fetcher(url.href, { method: "GET", headers: { accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store", signal: abort.signal }))
        .then(value => { incoming = value; receivedAt = performance.now(); if (abort.signal.aborted) cancelResponse(value); return value; });
      const response = await wait(pending, end, cancelResponse);
      const type = response.headers.get("content-type"), length = response.headers.get("content-length");
      if (response.status !== 200 || response.redirected || response.url && response.url !== url.href || !response.body
        || !type || type.length > SEFARIA_METADATA_BOUNDS.headerLength || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-?8)?$/i.test(type)
        || length !== null && (!/^(?:0|[1-9][0-9]{0,9})$/.test(length) || Number(length) > SOURCE_METADATA_LIMITS.bytes)) return fail();
      live(); reader = response.body.getReader();
      const bytes = new Uint8Array(SOURCE_METADATA_LIMITS.bytes); let count = 0, empty = 0, progress = receivedAt;
      while (true) {
        live(); const idleEnd = progress + SEFARIA_METADATA_BOUNDS.idleMs; if (performance.now() >= idleEnd) return fail();
        const part = await wait(reader.read(), idleEnd); if (performance.now() >= idleEnd) return fail();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) return fail();
        const length: number = byteLength.call(part.value);
        if (length > bytes.length - count) return fail();
        if (!length) { if (++empty > SEFARIA_METADATA_BOUNDS.emptyReads) return fail(); continue; }
        // Never trust shadowable .buffer/.byteLength or caller iteration hooks.
        bytes.set(new Uint8Array(arrayBuffer.call(part.value), byteOffset.call(part.value), length), count); count += length; progress = performance.now(); empty = 0;
      }
      live(); const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count))); live();
      const result = parse(decoded); live(); return result;
    } catch { abort.abort(); return fail(); }
    finally {
      clearTimeout(totalTimer); signal.removeEventListener("abort", onAbort);
      if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
      else cancelResponse(incoming);
    }
  }
  return Object.freeze({
    async related(value: string, signal: AbortSignal) {
      try { const verse = sourceMetadataVerse(value), url = new URL(`https://www.sefaria.org/api/links/${encodeURIComponent(verse)}`); url.searchParams.set("with_text", "0"); url.searchParams.set("with_sheet_links", "0"); return await request(url, signal, data => parseRelatedMetadata(data, verse)); }
      catch { return fail(); }
    },
    /** The public shelf's projection of the same links request (bounds as related()); the signed-in catalog is untouched. */
    async shelfLinks(value: string, signal: AbortSignal) {
      try { const verse = sourceMetadataVerse(value), url = new URL(`https://www.sefaria.org/api/links/${encodeURIComponent(verse)}`); url.searchParams.set("with_text", "0"); url.searchParams.set("with_sheet_links", "0"); return await request(url, signal, data => parseShelfLinks(data, verse)); }
      catch { return fail(); }
    },
    async editions(value: string, signal: AbortSignal) {
      try { const work = sourceMetadataWork(value), url = new URL(`https://www.sefaria.org/api/texts/versions/${encodeURIComponent(work)}`); return await request(url, signal, data => parseEditionMetadata(data, work)); }
      catch { return fail(); }
    },
  });
}
