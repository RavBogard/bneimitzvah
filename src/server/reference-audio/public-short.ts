import "server-only";
import { createHash } from "node:crypto";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_PREFIX, SHORT_SOURCE_LIMITS } from "../../lib/reference-audio/short-source";
import { SHORT_SOURCE_FFMPEG_TAGS } from "../../lib/reference-audio/short-source-tags";
import { PRODUCTION_ORIGINS } from "../runtime/config";
import { REFERENCE_CATALOG_LIMITS, ReferenceUnavailable } from "./catalog";
import { createShortSourceManifestLoader, lookupShortSource, readShortSourceEntry } from "./short-source-manifest";
import { verifyShortSourceBody, readVerifiedShortSourceBody } from "./short-source-body";
import type { ReferenceCatalogGet } from "./storage";

export type PublicShortHandler = (request: Request) => Promise<Response>;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const refuse = (): never => { throw new ReferenceUnavailable(); };
const failure = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store", "vercel-cdn-cache-control": "no-store", "x-content-type-options": "nosniff", ...(status === 405 ? { allow: "GET, HEAD" } : {}) } });

function selectedFile(request: Request, origin: string): string | null {
  try {
    if (request.url.length > 2048) return null;
    const url = new URL(request.url), expected = new URL(origin);
    if (url.origin !== origin || url.username || url.password || url.hash || url.search || request.url !== origin + url.pathname) return null;
    const file = new RegExp(`^${SHORT_SOURCE_PREFIX}([a-f0-9]{64})\\.mp3$`).exec(url.pathname)?.[1];
    if (!file) return null;
    for (const key of ["host", "x-forwarded-host"]) {
      const host = request.headers.get(key); if (host !== null && host !== expected.host) return null;
    }
    const proto = request.headers.get("x-forwarded-proto"), port = request.headers.get("x-forwarded-port");
    if (proto !== null && proto !== "https" || port !== null && port !== "443" || request.headers.has("forwarded")) return null;
    if (request.headers.has("transfer-encoding") || request.headers.has("content-length") && request.headers.get("content-length") !== "0") return null;
    return file;
  } catch { return null; }
}

/** Anonymous reference bytes only. Configuration is server-owned; construction
 * performs no I/O. No auth/session, database, request token or provider URL. */
export function createPublicShortHandler(input?: Readonly<{
  origin: string; parentCatalogSHA256: string; manifestSHA256: string; get: ReferenceCatalogGet; live?: () => boolean;
}>): PublicShortHandler {
  if (!input || !PRODUCTION_ORIGINS.includes(input.origin) || !digest(input.parentCatalogSHA256) || !digest(input.manifestSHA256)) return async () => failure(404);
  const { origin, parentCatalogSHA256, manifestSHA256, get } = input, configured = input.live ?? (() => true);
  return async request => {
    if (!configured()) return failure(404);
    const hash = selectedFile(request, origin); if (!hash) return failure(404);
    if (request.method !== "GET" && request.method !== "HEAD") return failure(405);
    if (request.headers.has("range") || request.headers.has("if-range")) return failure(416);
    const controller = new AbortController(), abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const started = performance.now(), deadline = setTimeout(abort, 30000);
    const live = () => { if (request.signal.aborted || controller.signal.aborted || !configured() || performance.now() - started >= 30000) refuse(); };
    async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined, stopped: (() => void) | undefined;
      try {
        const value = await Promise.race([work, new Promise<never>((_, reject) => {
          stopped = () => reject(new ReferenceUnavailable()); controller.signal.addEventListener("abort", stopped, { once: true });
          if (controller.signal.aborted) return stopped();
          timer = setTimeout(() => { abort(); reject(new ReferenceUnavailable()); }, ms);
        })]); live(); return value;
      } finally { clearTimeout(timer); if (stopped) controller.signal.removeEventListener("abort", stopped); }
    }
    async function read(path: string, cap: number): Promise<Uint8Array<ArrayBuffer>> {
      live(); let incoming: ReadableStream<Uint8Array> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const pending = Promise.resolve().then(() => { live(); return get(path, { signal: controller.signal }); });
      void pending.then(stream => { incoming = stream; if (controller.signal.aborted) { try { void stream.cancel().catch(() => {}); } catch {} } }).catch(() => {});
      try {
        const stream = await bounded(pending, 10000); if (!(stream instanceof ReadableStream)) refuse(); reader = stream.getReader();
        const bytes = new Uint8Array(cap); let size = 0, empty = 0, progress = performance.now();
        for (;;) {
          const item = await bounded(reader.read(), Math.max(1, 5000 - (performance.now() - progress))); live();
          if (performance.now() - progress >= 5000) refuse(); if (item.done) break;
          if (!(item.value instanceof Uint8Array)) refuse();
          const proto = Object.getPrototypeOf(Uint8Array.prototype), length = Number(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(item.value));
          if (!length) { if (++empty > 64) refuse(); continue; }
          if (size + length > cap) refuse();
          const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(item.value) as ArrayBuffer;
          const offset = Number(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(item.value));
          bytes.set(new Uint8Array(buffer, offset, length), size); size += length; empty = 0; progress = performance.now();
        }
        live(); if (!size) refuse(); return bytes.subarray(0, size);
      } finally {
        if (!reader && incoming) { try { void incoming.cancel().catch(() => {}); } catch {} }
        if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
      }
    }
    try {
      live();
      const parent = await read(`reference-audio/pockettorah/catalog/${parentCatalogSHA256}.json`, REFERENCE_CATALOG_LIMITS.bytes);
      if (createHash("sha256").update(parent).digest("hex") !== parentCatalogSHA256) refuse();
      const manifest = await createShortSourceManifestLoader({ sha256: manifestSHA256, parentCatalogSHA256, parentCatalogBytes: parent, get })(controller.signal); live();
      const entry = lookupShortSource(manifest, `rs_${hash}`); if (!entry) return failure(404);
      const metadata = readShortSourceEntry(entry);
      if (metadata.source.path !== `${SHORT_SOURCE_PREFIX}${hash}.mp3` || metadata.source.sha256 !== hash || metadata.source.bytes > SHORT_SOURCE_LIMITS.bytes) refuse();
      const raw = await read(metadata.blobKey, metadata.source.bytes); live();
      const proof = verifyShortSourceBody(entry, raw), verified = readVerifiedShortSourceBody(proof); live();
      const a = SHORT_SOURCE_ATTRIBUTION;
      const headers = new Headers({ "content-type": "audio/mpeg", "content-length": String(verified.bytes.byteLength), "cache-control": "public, max-age=31536000, immutable", "vercel-cdn-cache-control": "public, s-maxage=31536000, immutable",
        etag: `"sha256-${hash}"`, "x-content-type-options": "nosniff", "accept-ranges": "none",
        "x-reference-title": a.title, "x-reference-creator": a.creator, "x-reference-license": a.license, "x-reference-license-url": a.licenseUrl,
        "x-reference-changes": a.changes, "x-reference-attribution-version": a.version,
        link: `<${SHORT_SOURCE_FFMPEG_TAGS.source}>; rel="original", <${a.licenseUrl}>; rel="license"` });
      // Conditional headers deliberately do not bypass verification or produce
      // a304. Cookies/Authorization neither select bytes nor vary this response.
      const response = new Response(request.method === "HEAD" ? null : Uint8Array.from(verified.bytes), { status: 200, headers }); live(); return response;
    } catch { abort(); return failure(503); }
    finally { clearTimeout(deadline); request.signal.removeEventListener("abort", abort); }
  };
}
