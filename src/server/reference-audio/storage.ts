import "server-only";
import { createHash } from "node:crypto";
import { parseReferenceCatalog, ReferenceUnavailable, REFERENCE_CATALOG_LIMITS, type ReferenceCatalog } from "./catalog";

export type ReferenceCatalogGet = (path: string, options: Readonly<{ signal: AbortSignal }>) => Promise<ReadableStream<Uint8Array>>;
/** Construction performs no I/O. No URL/token/store or environment fallback. */
export function createReferenceCatalogLoader(input: { sha256: string; get: ReferenceCatalogGet }) {
  if (typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new ReferenceUnavailable();
  const digest = input.sha256, get = input.get, path = `reference-audio/pockettorah/catalog/${digest}.json`;
  return async function load(signal?: AbortSignal): Promise<ReferenceCatalog> {
    const controller = new AbortController(); let incoming: ReadableStream<Uint8Array> | undefined; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    const start = performance.now(); let progress = start, timer: ReturnType<typeof setTimeout> | undefined;
    const live = () => { if (signal?.aborted || controller.signal.aborted || performance.now() - start >= 30000) throw new ReferenceUnavailable(); };
    const bounded = async <T>(work: Promise<T>, ms: number): Promise<T> => {
      let stopped: (() => void) | undefined;
      const until = Math.min(start + 30000, performance.now() + ms);
      try {
        const value = await Promise.race([work, new Promise<never>((_, reject) => {
          stopped = () => reject(new ReferenceUnavailable());
          controller.signal.addEventListener("abort", stopped, { once: true });
          if (controller.signal.aborted) return stopped();
          timer = setTimeout(() => { controller.abort(); reject(new ReferenceUnavailable()); }, Math.max(1, until - performance.now()));
        })]);
        live(); if (performance.now() >= until) throw new ReferenceUnavailable(); return value;
      } finally { clearTimeout(timer); if (stopped) controller.signal.removeEventListener("abort", stopped); }
    };
    try {
      live();
      const pending = Promise.resolve().then(() => { live(); return get(path, { signal: controller.signal }); });
      void pending.then(stream => { incoming = stream; if (controller.signal.aborted) void stream.cancel().catch(() => {}); }).catch(() => {});
      const stream = await bounded(pending, 10000); live(); reader = stream.getReader(); progress = performance.now();
      const chunks: Uint8Array[] = []; let bytes = 0, empty = 0; const hash = createHash("sha256");
      while (true) {
        const item = await bounded(reader.read(), Math.max(1, 5000 - (performance.now() - progress))); live();
        if (performance.now() - progress >= 5000) throw new ReferenceUnavailable();
        if (item.done) break;
        if (!(item.value instanceof Uint8Array)) throw new ReferenceUnavailable();
        // Native stream bytes, copied once; never retain an unbounded empty-chunk list.
        const prototype = Object.getPrototypeOf(Uint8Array.prototype);
        const size = Number(Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!.call(item.value));
        if (!size) { if (++empty > 64) throw new ReferenceUnavailable(); continue; }
        if (bytes + size > REFERENCE_CATALOG_LIMITS.bytes) throw new ReferenceUnavailable();
        const buffer = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(item.value) as ArrayBuffer;
        const offset = Number(Object.getOwnPropertyDescriptor(prototype, "byteOffset")!.get!.call(item.value));
        const copy = new Uint8Array(new Uint8Array(buffer, offset, size)); chunks.push(copy); hash.update(copy); bytes += copy.byteLength; empty = 0; progress = performance.now();
      }
      if (!bytes || hash.digest("hex") !== digest) throw new ReferenceUnavailable();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)); live();
      const catalog = parseReferenceCatalog(JSON.parse(text)); live(); if (!catalog) throw new ReferenceUnavailable(); return catalog;
    } catch { controller.abort(); throw new ReferenceUnavailable(); }
    finally {
      signal?.removeEventListener("abort", abort); clearTimeout(timer);
      if (!reader && incoming) { try { void incoming.cancel().catch(() => {}); } catch {} }
      if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
    }
  };
}
