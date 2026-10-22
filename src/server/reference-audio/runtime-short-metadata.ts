import "server-only";
import { createHash } from "node:crypto";
import { PRODUCTION_ORIGINS, type RuntimeConfig } from "../runtime/config";
import { parseReferenceCatalog, REFERENCE_CATALOG_LIMITS, ReferenceUnavailable, type ReferenceCatalog } from "./catalog";
import { createShortSourceManifestLoader, type ShortSourceManifest } from "./short-source-manifest";
import type { ReferenceCatalogGet } from "./storage";

type Environment = Readonly<Record<string, string | undefined>>;
type Runtime = Pick<RuntimeConfig, "referenceAudio" | "origin" | "deployment">;
type Selection = Readonly<{ origin: string; storeId: string; parent: string; manifest: string }>;
type Metadata = Readonly<{ catalog: ReferenceCatalog; manifest: ShortSourceManifest }>;
let success: Readonly<{ key: string; metadata: Metadata }> | undefined;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function select(config: Runtime, env: Environment): Selection | null {
  const reference = config.referenceAudio;
  if (!reference || config.deployment.environment !== "production" || config.deployment.deployment !== "production"
    || !PRODUCTION_ORIGINS.includes(config.origin) || env.BETTER_AUTH_URL !== config.origin
    || env.PORTAL_ENVIRONMENT !== "production" || env.PORTAL_DEPLOYMENT !== "production" || env.VERCEL !== "1"
    || env.VERCEL_ENV !== "production" || env.NODE_ENV !== "production" || env.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE !== "true"
    || !digest(reference.catalogSha256) || env.REFERENCE_AUDIO_CATALOG_SHA256 !== reference.catalogSha256
    || !digest(env.REFERENCE_AUDIO_SHORT_MANIFEST_SHA256) || !/^store_[A-Za-z0-9]{8,64}$/.test(reference.storeId)
    || env.BLOB_STORE_ID !== reference.storeId || env.VERCEL_BLOB_API_URL !== undefined || env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined) return null;
  return Object.freeze({ origin: config.origin, storeId: reference.storeId, parent: reference.catalogSha256, manifest: env.REFERENCE_AUDIO_SHORT_MANIFEST_SHA256 });
}

/** A single owned buffer prevents tiny upstream chunks amplifying retained
 * object memory. All bytes are copied and hashed before parsing or sealing. */
async function parentBytes(get: ReferenceCatalogGet, path: string, expected: string, signal: AbortSignal, live: () => void): Promise<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, incoming: ReadableStream<Uint8Array> | undefined;
  const wait = async <T>(work: Promise<T>, ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => {
      stop = () => reject(new ReferenceUnavailable()); signal.addEventListener("abort", stop, { once: true });
      timer = setTimeout(stop, ms); if (signal.aborted) stop();
    })]); } finally { clearTimeout(timer); if (stop) signal.removeEventListener("abort", stop); }
  };
  try {
    live(); const pending = Promise.resolve().then(() => { live(); return get(path, { signal }); });
    void pending.then(stream => { incoming = stream; if (signal.aborted) void stream.cancel().catch(() => {}); }).catch(() => {});
    const stream = await wait(pending, 10000); live(); reader = stream.getReader();
    const owned = new Uint8Array(REFERENCE_CATALOG_LIMITS.bytes), hash = createHash("sha256");
    let total = 0, empty = 0, progress = performance.now();
    const proto = Object.getPrototypeOf(Uint8Array.prototype), field = (name: string, v: Uint8Array) => Object.getOwnPropertyDescriptor(proto, name)!.get!.call(v);
    for (;;) {
      const item = await wait(reader.read(), Math.max(1, 5000 - (performance.now() - progress))); live();
      if (performance.now() - progress >= 5000) throw new ReferenceUnavailable(); if (item.done) break;
      if (!(item.value instanceof Uint8Array)) throw new ReferenceUnavailable();
      const size = Number(field("byteLength", item.value));
      if (!size) { if (++empty > 64) throw new ReferenceUnavailable(); continue; }
      if (total + size > owned.length) throw new ReferenceUnavailable();
      owned.set(new Uint8Array(field("buffer", item.value) as ArrayBuffer, Number(field("byteOffset", item.value)), size), total);
      hash.update(owned.subarray(total, total + size)); total += size; empty = 0; progress = performance.now();
    }
    if (!total || hash.digest("hex") !== expected) throw new ReferenceUnavailable(); live(); return owned.subarray(0, total);
  } finally {
    if (!reader && incoming) { try { void incoming.cancel().catch(() => {}); } catch {} }
    if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
  }
}

/** Trusted config only. One immutable completed success; no promises, failures,
 * private actors, credentials or request-owned tasks enter the process cache. */
export function createRuntimeShortMetadata(config: Runtime, env: Environment) {
  const selected = select(config, env), key = selected ? JSON.stringify(selected) : "";
  const current = () => selected !== null && JSON.stringify(select(config, env)) === key;
  const get: ReferenceCatalogGet = async (path, { signal }) => {
    let stream: ReadableStream<Uint8Array> | undefined;
    try {
      if (!selected || !current() || signal.aborted || ![`reference-audio/pockettorah/catalog/${selected.parent}.json`, `reference-audio/short-v1/manifests/${selected.manifest}.json`].includes(path)) throw 0;
      const { getContext } = await import("@vercel/oidc"); if (!current() || signal.aborted) throw 0;
      const token = getContext().headers?.["x-vercel-oidc-token"];
      if (typeof token !== "string" || !token.length || token.length > 16384 || token.trim() !== token || /[\s\x00-\x1f\x7f]/.test(token)) throw 0;
      const { get: blobGet } = await import("@vercel/blob");
      if (!current() || signal.aborted || getContext().headers?.["x-vercel-oidc-token"] !== token) throw 0;
      const result = await blobGet(path, { access: "private", storeId: selected.storeId, oidcToken: token, abortSignal: signal, useCache: false });
      stream = result?.stream ?? undefined;
      if (!current() || signal.aborted || getContext().headers?.["x-vercel-oidc-token"] !== token || result?.statusCode !== 200 || !(stream instanceof ReadableStream)) throw 0;
      return stream;
    } catch { try { if (stream) void stream.cancel().catch(() => {}); } catch {} throw new ReferenceUnavailable(); }
  };
  const load = async (signal?: AbortSignal): Promise<Metadata> => {
    const controller = new AbortController(), start = performance.now(), abort = () => controller.abort();
    const live = () => { if (!selected || !current() || signal?.aborted || controller.signal.aborted || performance.now() - start >= 30000) throw new ReferenceUnavailable(); };
    live(); if (success?.key === key) return success.metadata;
    signal?.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 30000);
    try {
      live(); const raw = await parentBytes(get, `reference-audio/pockettorah/catalog/${selected!.parent}.json`, selected!.parent, controller.signal, live); live();
      const catalog = parseReferenceCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))); if (!catalog) throw 0;
      const manifest = await createShortSourceManifestLoader({ sha256: selected!.manifest, parentCatalogSHA256: selected!.parent, parentCatalogBytes: raw, get })(controller.signal); live();
      const metadata = Object.freeze({ catalog, manifest }); success = Object.freeze({ key, metadata }); return metadata;
    } catch { throw new ReferenceUnavailable(); }
    finally { controller.abort(); clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  };
  const check = (signal?: AbortSignal) => { if (!current() || signal?.aborted) throw new ReferenceUnavailable(); };
  return Object.freeze({ configured: () => current(), loadCatalog: async (signal?: AbortSignal) => { const result = await load(signal); check(signal); return result.catalog; },
    loadManifest: async (signal?: AbortSignal) => { const result = await load(signal); check(signal); return result.manifest; } });
}
