import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createRuntimeMediaOidc, MEDIA_IDENTITY, type MediaCredential } from "./runtime-oidc";
import type { MediaSlot, MediaFacts, MediaResult, MediaOperation } from "./types";

export const MEDIA_LIMITS = Object.freeze({ totalMs: 10000, idleMs: 5000, emptyReads: 64, headers: 16384, json: 8192, error: 4096, body: 1048576, etag: 256 });
const store = MEDIA_IDENTITY.storeId.slice(6), origin = `https://${store.toLowerCase()}.private.blob.vercel-storage.com`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const need = (v: unknown): void => { if (!v) throw 0; };
const strong = (v: unknown): v is string => typeof v === "string" && v.length <= 256 && /^"[\x21\x23-\x7e]+"$/.test(v);
const marker = (kind: "permit" | "retire") => Uint8Array.from({ length: kind === "permit" ? 31 : 33 }, (_, i) => kind === "permit" ? (i * 3 + 7) % 256 : (i * 5 + 193) % 256);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const intrinsic = (name: "byteLength" | "byteOffset" | "buffer", value: Uint8Array) => Reflect.apply(Object.getOwnPropertyDescriptor(typedArrayPrototype, name)!.get!, value, []);
function copyChunk(value: Uint8Array | undefined, expected: number) {
  need(value instanceof Uint8Array);
  // Never inspect shadowable .length/.byteLength/.buffer/.byteOffset or pass the
  // original array to Buffer.from. A fresh bounded view owns the copy boundary.
  const length = intrinsic("byteLength", value!), offset = intrinsic("byteOffset", value!), buffer = intrinsic("buffer", value!);
  need(Number.isSafeInteger(length) && length === expected && length >= 2 && length <= MEDIA_LIMITS.body && Number.isSafeInteger(offset) && offset >= 0);
  return Buffer.from(new Uint8Array(buffer, offset, length));
}
type Representation = "chunk" | "permit" | "retire";
type Dependencies = {
  storeGeneration: string; request?: typeof httpsRequest;
  credentials?: ReturnType<typeof createRuntimeMediaOidc>;
  totalMs?: number; idleMs?: number;
};
/** Internal only; no route/callsite is installed. User/receipt authority belongs
 * to the separately reviewed caller, never to a slot descriptor or OIDC token. */
export function createPrivateMediaTransport({ storeGeneration, request = httpsRequest, credentials = createRuntimeMediaOidc(), totalMs = MEDIA_LIMITS.totalMs, idleMs = MEDIA_LIMITS.idleMs }: Dependencies) {
  need(typeof storeGeneration === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(storeGeneration));
  need(Number.isInteger(totalMs) && totalMs > 0 && totalMs <= MEDIA_LIMITS.totalMs && Number.isInteger(idleMs) && idleMs > 0 && idleMs <= MEDIA_LIMITS.idleMs);
  function binding(input: MediaSlot) {
    need(input && typeof input === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(input)));
    const keys = ["storeGeneration", "assetId", "slotIndex", "expectedBytes", "bodySha256"];
    need(Reflect.ownKeys(input).length === keys.length && keys.every(k => Object.hasOwn(input, k) && Object.getOwnPropertyDescriptor(input, k)?.get === undefined && Object.getOwnPropertyDescriptor(input, k)?.set === undefined));
    const value = { ...input };
    need(value.storeGeneration === storeGeneration && typeof value.assetId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.assetId));
    need(Number.isInteger(value.slotIndex) && value.slotIndex >= 0 && value.slotIndex <= 27 && Number.isInteger(value.expectedBytes) && value.expectedBytes >= 2 && value.expectedBytes <= MEDIA_LIMITS.body && value.expectedBytes % 2 === 0 && typeof value.bodySha256 === "string" && /^[a-f0-9]{64}$/.test(value.bodySha256));
    return Object.freeze({ ...value, key: `recordings/v1/${value.assetId}/chunk-${String(value.slotIndex).padStart(2, "0")}` });
  }
  function metadata(value: unknown, key: string): MediaFacts {
    need(value && typeof value === "object" && !Array.isArray(value));
    const v = value as Record<string, unknown>;
    need(typeof v.url === "string" && v.url.length <= 2048);
    const u = new URL(v.url as string);
    need(u.origin === origin && u.pathname === `/${key}` && !u.search && !u.hash && !u.username && !u.password && v.pathname === key && v.contentType === "application/octet-stream" && strong(v.etag));
    need(Number.isSafeInteger(v.size) && (v.size as number) >= 0 && (v.size as number) <= MEDIA_LIMITS.body);
    return Object.freeze({ byteLength: v.size as number, etag: v.etag as string });
  }
  async function operate<T>(method: "PUT" | "GET", input: MediaSlot, options: MediaOperation | undefined, prepare: (b: ReturnType<typeof binding>) => { url: URL; headers?: Record<string, string>; body?: Uint8Array; parse: (status: number, bytes: Buffer, response: IncomingMessage, b: ReturnType<typeof binding>) => T }): Promise<MediaResult<T>> {
    const started = performance.now(); let attempted = false, req: ClientRequest | undefined, res: IncomingMessage | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, idleTimer: ReturnType<typeof setTimeout> | undefined, stop = () => {}, finished = false;
    let signal: AbortSignal | undefined;
    try {
      need(options === undefined || options !== null && typeof options === "object" && Reflect.ownKeys(options).every(k => k === "signal" || k === "deadline"));
      need(options === undefined || Reflect.ownKeys(options).every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(options, k)!, "value")));
      signal = options?.signal;
      need(signal === undefined || signal instanceof AbortSignal);
      need(options?.deadline === undefined || Number.isFinite(options.deadline));
      const deadline = Math.min(started + totalMs, options?.deadline ?? Infinity), b = binding(input), job = prepare(b), credential: MediaCredential = credentials.acquire();
      let progress = started, empty = 0, total = 0;
      const live = () => { need(!finished && !signal?.aborted && performance.now() < deadline); credential.assertFresh(); };
      live();
      const result = await new Promise<MediaResult<T>>((resolve, reject) => {
        const fail = () => { if (finished) return; finished = true; try { res?.destroy(); } catch {} try { req?.destroy(); } catch {} reject(0); };
        stop = fail;
        const guarded = <A extends unknown[]>(action: (...args: A) => void) => (...args: A) => { if (finished) return; try { live(); action(...args); } catch { fail(); } };
        const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(fail, Math.max(1, idleMs - (performance.now() - progress))); };
        need(performance.now() - progress < idleMs);
        timer = setTimeout(fail, Math.max(1, deadline - performance.now())); armIdle(); signal?.addEventListener("abort", fail, { once: true });
        const wire: RequestOptions = { protocol: "https:", hostname: job.url.hostname, port: 443, path: job.url.pathname + job.url.search, method, rejectUnauthorized: true, agent: false, maxHeaderSize: MEDIA_LIMITS.headers,
          headers: { ...job.headers, authorization: `Bearer ${credential.token}` } };
        attempted = method === "PUT";
        try {
          req = request(wire, response => {
            if (finished) { response.on("error", () => {}); try { response.destroy(); } catch {} return; }
            res = response;
            try {
              // Own error delivery before any rejecting TLS/header/body check.
              // Keep this listener through destroy and repeated late events.
              response.on("error", fail); response.once("aborted", fail); response.once("close", () => { if (!response.complete) fail(); });
              live(); need(performance.now() - progress < idleMs); need((response.socket as import("node:tls").TLSSocket)?.encrypted && (response.socket as import("node:tls").TLSSocket).authorized);
              const headerBytes = response.rawHeaders.reduce((n, s) => n + Buffer.byteLength(s) + 2, 0); need(headerBytes <= MEDIA_LIMITS.headers);
              const status = response.statusCode; need(Number.isInteger(status));
              const success = status === 200 || method === "PUT" && status === 201;
              const limit = success ? method === "GET" && job.url.hostname !== "vercel.com" ? MEDIA_LIMITS.body : MEDIA_LIMITS.json : MEDIA_LIMITS.error;
              const lengths = response.rawHeaders.filter((_, i) => i % 2 === 0 && response.rawHeaders[i].toLowerCase() === "content-length"); need(lengths.length <= 1);
              const declared = response.headers["content-length"]; need(declared === undefined || typeof declared === "string" && /^(0|[1-9][0-9]*)$/.test(declared) && Number(declared) <= limit);
              need(response.headers["content-encoding"] === undefined);
              const storage = Buffer.alloc(limit); armIdle();
              response.on("data", guarded((chunk: Buffer) => {
                need(performance.now() - progress < idleMs && chunk instanceof Uint8Array);
                total += chunk.byteLength; need(total <= limit);
                if (chunk.byteLength) { storage.set(chunk, total - chunk.byteLength); empty = 0; progress = performance.now(); } else need(++empty <= MEDIA_LIMITS.emptyReads);
                armIdle();
              }));
              response.once("end", guarded(() => {
                need(performance.now() - progress < idleMs && response.complete === true && (declared === undefined || total === Number(declared)));
                const bytes = storage.subarray(0, total);
                if (success) { const value = job.parse(status!, bytes, response, b); live(); finished = true; resolve(Object.freeze({ ok: true, value })); }
                else {
                  // Pinned private get() recognizes a completed404 directly;
                  // control metadata requires the specific JSON not_found code.
                  if (method === "GET" && status === 404 && job.url.hostname !== "vercel.com") { live(); finished = true; resolve(Object.freeze({ ok: false, outcome: "not-found" })); return; }
                  const value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as { error?: { code?: unknown } };
                  live();
                  if (status === 412 && value?.error?.code === "precondition_failed") { finished = true; resolve(Object.freeze({ ok: false, outcome: "precondition-failed" })); }
                  else if (method === "GET" && status === 404 && value?.error?.code === "not_found") { finished = true; resolve(Object.freeze({ ok: false, outcome: "not-found" })); }
                  else fail();
                }
              }));
            } catch { fail(); }
          });
          req.on("error", fail);
          req.once("socket", socket => { socket.on("error", fail); socket.once("secureConnect", () => { if (finished) { socket.destroy(); return; } try { live(); need(performance.now() - progress < idleMs && (socket as import("node:tls").TLSSocket).encrypted && (socket as import("node:tls").TLSSocket).authorized); } catch { fail(); } }); });
          live(); need(performance.now() - progress < idleMs);
          req.end(job.body);
        } catch { fail(); }
      });
      need(!signal?.aborted && performance.now() < deadline); credential.assertFresh();
      return result;
    } catch { return Object.freeze({ ok: false, outcome: attempted ? "unknown-write" : "unavailable" }); }
    finally { clearTimeout(timer); clearTimeout(idleTimer); try { signal?.removeEventListener("abort", stop); } catch {} try { req?.destroy(); } catch {} try { res?.destroy(); } catch {} }
  }
  const controlHeaders = () => ({ "x-api-version": "13", "x-vercel-blob-store-id": store, "x-api-blob-request-attempt": "0", "x-api-blob-request-id": `${store}:${Date.now()}:${randomBytes(8).toString("hex")}` });
  function put(input: MediaSlot, kind: Representation, body: Uint8Array | undefined, condition: string | undefined, permit: string | undefined, options?: MediaOperation) {
    return operate<Readonly<{ etag: string }>>("PUT", input, options, b => {
      need(kind === "permit" ? condition === undefined : strong(condition));
      const bytes = kind === "chunk" ? copyChunk(body, b.expectedBytes) : marker(kind);
      need(kind !== "chunk" || sha(bytes) === b.bodySha256);
      need(kind === "permit" ? permit === undefined : strong(permit));
      const url = new URL("https://vercel.com/api/blob/"); url.searchParams.set("pathname", b.key);
      return { url, body: bytes, headers: { ...controlHeaders(), "content-length": String(bytes.length), "x-vercel-blob-access": "private", "x-content-type": "application/octet-stream", "x-add-random-suffix": "0", "x-allow-overwrite": kind === "permit" ? "0" : "1", "x-cache-control-max-age": "60", ...(condition ? { "x-if-match": condition } : {}) },
        parse: (_status, bytesResponse) => {
          const raw = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytesResponse));
          // PUT's pinned SDK response has no size; the owned request establishes
          // only attempted length, not a verified current object body.
          const value = metadata({ ...raw, size: bytes.length }, b.key); need(value.etag !== condition && value.etag !== permit); return Object.freeze({ etag: value.etag });
        } };
    });
  }
  return Object.freeze({
    putPermit: (input: MediaSlot, options?: MediaOperation) => put(input, "permit", undefined, undefined, undefined, options),
    putChunk: (input: MediaSlot, bytes: Uint8Array, permitTag: string, options?: MediaOperation) => put(input, "chunk", bytes, permitTag, permitTag, options),
    putRetirement: (input: MediaSlot, currentTag: string, permitTag: string, options?: MediaOperation) => put(input, "retire", undefined, currentTag, permitTag, options),
    metadata: (input: MediaSlot, options?: MediaOperation) => operate<MediaFacts>("GET", input, options, b => { const url = new URL("https://vercel.com/api/blob"); url.searchParams.set("url", b.key); return { url, headers: controlHeaders(), parse: (_s, bytes) => metadata(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)), b.key) }; }),
    read: (input: MediaSlot, representation: Representation, expectedTag: string, options?: MediaOperation) => operate<Readonly<{ bytes: Uint8Array; etag: string }>>("GET", input, options, b => {
      need(["chunk", "permit", "retire"].includes(representation) && strong(expectedTag));
      const expected = representation === "chunk" ? { length: b.expectedBytes, hash: b.bodySha256 } : (() => { const bytes = marker(representation); return { length: bytes.length, hash: sha(bytes) }; })();
      const url = new URL(`${origin}/${b.key}`); url.searchParams.set("cache", "0");
      return { url, headers: { "If-Match": expectedTag, "Accept-Encoding": "identity" }, parse: (status, bytes, response) => {
        need(status === 200 && response.headers["content-type"] === "application/octet-stream" && response.headers.etag === expectedTag && response.headers["content-length"] === String(expected.length) && bytes.length === expected.length && sha(bytes) === expected.hash);
        return Object.freeze({ bytes: Uint8Array.from(bytes), etag: expectedTag });
      } };
    }),
  });
}
