import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { request as Request, RequestOptions } from "node:https";
import { afterEach, expect, test, vi } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
vi.mock("server-only", () => ({}));
import { createPrivateMediaTransport, MEDIA_LIMITS } from "../../src/server/media/private-transport";
import { MEDIA_IDENTITY } from "../../src/server/media/runtime-oidc";
import type { MediaSlot } from "../../src/server/media/types";

const data = Uint8Array.from([2, 4, 6, 8, 10, 12]), tag = '"current"', store = MEDIA_IDENTITY.storeId.slice(6), origin = `https://${store.toLowerCase()}.private.blob.vercel-storage.com`;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const slot = (): MediaSlot => ({ storeGeneration: "synthetic-v1", assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slotIndex: 0, expectedBytes: data.length, bodySha256: digest(data) });
const key = `recordings/v1/${slot().assetId}/chunk-00`;
const facts = (etag = tag, size = data.length) => ({ url: `${origin}/${key}`, pathname: key, size, contentType: "application/octet-stream", etag });
const credentials = () => ({ acquire: () => ({ token: "synthetic", assertFresh() {} }) });
type Answer = { status?: number; bytes?: Uint8Array; headers?: Record<string, string>; chunks?: Uint8Array[]; mutate?: (r: EventEmitter) => void; complete?: boolean; tls?: boolean };
function wire(answer: Answer = {}, automatic = true) {
  let callback: ((r: unknown) => void) | undefined, destroyed = 0;
  const requests: { options: RequestOptions; bytes: Buffer }[] = [];
  let req: EventEmitter & { destroy: () => void; end: (b?: Uint8Array) => void };
  const send = () => {
    const bytes = answer.bytes ?? Buffer.from(JSON.stringify(facts())), headers = answer.headers ?? { "content-length": String(bytes.length), "content-type": "application/octet-stream", etag: tag };
    const res = Object.assign(new EventEmitter(), { statusCode: answer.status ?? 200, headers, rawHeaders: Object.entries(headers).flat(), complete: answer.complete ?? true, socket: { encrypted: true, authorized: answer.tls ?? true }, destroy: () => { destroyed++; } });
    callback!(res); answer.mutate?.(res); for (const chunk of answer.chunks ?? [bytes]) res.emit("data", chunk); res.emit("end");
  };
  const request = ((options: RequestOptions, cb: (r: unknown) => void) => {
    callback = cb;
    req = Object.assign(new EventEmitter(), { destroy: () => { destroyed++; }, end: (b?: Uint8Array) => {
      requests.push({ options, bytes: Buffer.from(b ?? []) });
      queueMicrotask(() => { const socket = Object.assign(new EventEmitter(), { encrypted: true, authorized: answer.tls ?? true, destroy: () => { destroyed++; } }); req.emit("socket", socket); socket.emit("secureConnect"); if (automatic) send(); });
    } }); return req;
  }) as unknown as typeof Request;
  return { request, requests, send, get destroyed() { return destroyed; } };
}
const transport = (w: ReturnType<typeof wire>, overrides: Partial<Parameters<typeof createPrivateMediaTransport>[0]> = {}) => createPrivateMediaTransport({ storeGeneration: "synthetic-v1", request: w.request, credentials: credentials(), ...overrides });
const blocked = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
afterEach(() => { vi.unstubAllEnvs(); });

test("closed ordinary verbs derive fixed keys and validate PUT metadata and whole identity bytes", async () => {
  const p = wire({ bytes: Buffer.from(JSON.stringify(facts('"permit"'))) });
  expect(await transport(p).putPermit(slot())).toEqual({ ok: true, value: { etag: '"permit"' } });
  const u = wire(); expect(await transport(u).putChunk(slot(), data, '"permit"')).toEqual({ ok: true, value: { etag: tag } });
  const r = wire({ bytes: Buffer.from(JSON.stringify(facts('"retired"'))) }); expect((await transport(r).putRetirement(slot(), tag, '"permit"')).ok).toBe(true);
  expect(p.requests[0].bytes.length).toBe(31); expect(r.requests[0].bytes.length).toBe(33);
  const h = wire(); expect(await transport(h).metadata(slot())).toEqual({ ok: true, value: { byteLength: data.length, etag: tag } });
  const g = wire({ bytes: data }); const read = await transport(g).read(slot(), "chunk", tag); expect(read.ok && Array.from(read.value.bytes)).toEqual(Array.from(data));
  expect(g.requests[0].options).toMatchObject({ hostname: new URL(origin).hostname, port: 443, method: "GET", path: `/${key}?cache=0`, rejectUnauthorized: true, agent: false, maxHeaderSize: 16384 });
  expect(g.requests[0].options.headers).toMatchObject({ "If-Match": tag, "Accept-Encoding": "identity" });
  expect(h.requests[0].options.path).toBe(`/api/blob?url=${encodeURIComponent(key)}`);
});

test("invalid bindings/input never acquire credentials or dispatch; caller mutation cannot alter the snapshot", async () => {
  let acquired = 0;
  const w = wire(), t = transport(w, { credentials: { acquire: () => { acquired++; return credentials().acquire(); } } });
  for (const bad of [{ ...slot(), url: "https://example.test" }, { ...slot(), storeGeneration: "other" }, { ...slot(), slotIndex: 28 }, { ...slot(), expectedBytes: 3 }, { ...slot(), assetId: "../other" }, { ...slot(), bodySha256: "other" }]) expect(await t.putChunk(bad, data, tag)).toEqual({ ok: false, outcome: "unavailable" });
  expect(await t.putChunk(slot(), Uint8Array.of(1, 2), tag)).toEqual({ ok: false, outcome: "unavailable" });
  const huge = new Uint8Array(MEDIA_LIMITS.body + 1), copy = vi.spyOn(Buffer, "from");
  expect(await t.putChunk(slot(), huge, tag)).toEqual({ ok: false, outcome: "unavailable" });
  expect(copy.mock.calls.some(call => call[0] === huge)).toBe(false); copy.mockRestore();
  expect(acquired).toBe(0); expect(w.requests.length).toBe(0);
  const bytes = Uint8Array.from(data), binding = { ...slot() }, held = wire({}, false), pending = transport(held).putChunk(binding, bytes, '"permit"');
  bytes.fill(0); binding.assetId = "changed"; await Promise.resolve(); held.send(); expect((await pending).ok).toBe(true);
  expect(held.requests[0].bytes).toEqual(Buffer.from(data)); expect(held.requests[0].options.path).toContain(encodeURIComponent(key));
});

test("specific completed condition errors are distinct from every uncertain write and current read absence", async () => {
  for (const [status, code, expected] of [[412, "precondition_failed", "precondition-failed"], [412, "other", "unknown-write"], [500, "precondition_failed", "unknown-write"], [302, "other", "unknown-write"], [404, "not_found", "unknown-write"]] as const) {
    const w = wire({ status, bytes: Buffer.from(JSON.stringify({ error: { code } })) }); expect(await transport(w).putChunk(slot(), data, tag)).toEqual({ ok: false, outcome: expected }); expect(w.requests.length).toBe(1);
  }
  expect(await transport(wire({ status: 404, bytes: Buffer.from("absent") })).read(slot(), "chunk", tag)).toEqual({ ok: false, outcome: "not-found" });
  expect(await transport(wire({ status: 404, bytes: Buffer.from('{"error":{"code":"not_found"}}') })).metadata(slot())).toEqual({ ok: false, outcome: "not-found" });
  expect(await transport(wire({ status: 404, bytes: Buffer.from('{"error":{"code":"store_not_found"}}') })).metadata(slot())).toEqual({ ok: false, outcome: "unavailable" });
  expect(await transport(wire({ bytes: Buffer.from("malformed") })).putPermit(slot())).toEqual({ ok: false, outcome: "unknown-write" });
});

test("GET refuses encoding/status/length/type/tag/hash/incomplete bodies and owns received byte memory", async () => {
  const headers = { "content-length": String(data.length), "content-type": "application/octet-stream", etag: tag };
  const variants: Answer[] = [{ status: 206 }, { headers: { ...headers, "content-encoding": "identity" } }, { headers: { ...headers, "content-length": "06" } }, { headers: { ...headers, "content-length": "7" } }, { headers: { ...headers, "content-type": "audio/wav" } }, { headers: { ...headers, etag: 'W/"current"' } }, { headers: { ...headers, etag: '"other"' } }, { bytes: Uint8Array.from(data, v => v + 1) }, { complete: false }, { tls: false }];
  for (const variant of variants) expect(await transport(wire({ bytes: data, ...variant })).read(slot(), "chunk", tag)).toEqual({ ok: false, outcome: "unavailable" });
  const chunk = Buffer.from(data), w = wire({ bytes: data, chunks: [chunk], mutate: r => { r.on("data", () => chunk.fill(0)); } });
  const read = await transport(w).read(slot(), "chunk", tag); expect(read.ok && Array.from(read.value.bytes)).toEqual(Array.from(data));
});

test("raw control/error/header caps, empty bounds and absolute byte progress cannot be bypassed", async () => {
  for (const answer of [{ bytes: Buffer.alloc(8193) }, { status: 412, bytes: Buffer.alloc(4097) }, { headers: { "huge": "x".repeat(16385) } }]) expect(await transport(wire(answer)).putPermit(slot())).toEqual({ ok: false, outcome: "unknown-write" });
  const empty = wire({ bytes: data, chunks: Array.from({ length: 65 }, () => new Uint8Array()) }); expect((await transport(empty).read(slot(), "chunk", tag)).ok).toBe(false); expect(empty.destroyed).toBeGreaterThan(0);
  const starved = wire({ bytes: data, mutate: () => { blocked(20); } }); expect((await transport(starved, { idleMs: 5 }).read(slot(), "chunk", tag)).ok).toBe(false);
  const deadline = wire({ mutate: () => { blocked(20); } }); expect(await transport(deadline, { totalMs: 5 }).putPermit(slot())).toEqual({ ok: false, outcome: "unknown-write" });
});

test("abort/parent deadline and late responses destroy resources without future success or retry", async () => {
  const expired = wire(); expect(await transport(expired).putPermit(slot(), { deadline: performance.now() - 1 })).toEqual({ ok: false, outcome: "unavailable" }); expect(expired.requests.length).toBe(0);
  const w = wire({}, false), controller = new AbortController(), pending = transport(w).putPermit(slot(), { signal: controller.signal });
  await Promise.resolve(); controller.abort(); expect(await pending).toEqual({ ok: false, outcome: "unknown-write" }); const before = w.destroyed; w.send(); expect(w.destroyed).toBeGreaterThan(before); expect(w.requests.length).toBe(1);
  const hostile = Object.defineProperty({}, "signal", { get() { throw Error("synthetic-private-detail"); } }); expect(await transport(wire()).putPermit(slot(), hostile)).toEqual({ ok: false, outcome: "unavailable" });
});

test("initial socket/header idle is bounded and a delayed first response cannot renew progress", async () => {
  const silent = wire({}, false), pending = transport(silent, { idleMs: 5 }).putPermit(slot());
  expect(await pending).toEqual({ ok: false, outcome: "unknown-write" }); const before = silent.destroyed; silent.send(); expect(silent.destroyed).toBeGreaterThan(before);
  const starved = wire({}, false), late = transport(starved, { idleMs: 5 }).putPermit(slot());
  blocked(20); starved.send(); expect(await late).toEqual({ ok: false, outcome: "unknown-write" }); expect(starved.requests.length).toBe(1);
  const setup = wire(), request = ((...args: Parameters<typeof Request>) => { const result = setup.request(...args); blocked(20); return result; }) as typeof Request;
  expect(await transport(setup, { request, totalMs: 5 }).putPermit(slot())).toEqual({ ok: false, outcome: "unknown-write" });
  expect(setup.requests.length).toBe(0); expect(setup.destroyed).toBeGreaterThan(0);
});

test("current context is checked after I/O and again after promise settlement without renewing permission", async () => {
  let valid = true;
  const w = wire({ mutate: r => { r.on("end", () => { valid = false; }); } });
  const c = { acquire: () => ({ token: "synthetic", assertFresh() { if (!valid) throw Error("synthetic-private-detail"); } }) };
  expect(await transport(w, { credentials: c }).putPermit(slot())).toEqual({ ok: false, outcome: "unknown-write" });
});

test("actual pinned SDK semantic PUT/control metadata/direct OIDC GET mapping matches without any network", async () => {
  const previous = getGlobalDispatcher(), agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); vi.stubEnv("VERCEL_BLOB_RETRIES", "0");
  try {
    const sdk = await import("@vercel/blob"), pool = agent.get("https://vercel.com");
    for (const kind of ["permit", "chunk", "retire"] as const) {
      const w = wire(), t = transport(w), condition = kind === "permit" ? undefined : kind === "chunk" ? '"permit"' : '"older"';
      if (kind === "permit") await t.putPermit(slot()); else if (kind === "chunk") await t.putChunk(slot(), data, condition!); else await t.putRetirement(slot(), condition!, '"permit"');
      const raw = w.requests[0];
      pool.intercept({ method: "PUT", path: String(raw.options.path) }).reply(options => {
        const actual = new Headers(options.headers as HeadersInit), expected = new Headers(raw.options.headers as HeadersInit);
        for (const name of ["authorization", "x-api-version", "x-vercel-blob-store-id", "x-api-blob-request-attempt", "x-vercel-blob-access", "x-content-type", "x-add-random-suffix", "x-allow-overwrite", "x-cache-control-max-age", "x-if-match"]) expect(actual.get(name)).toBe(expected.get(name));
        expect(digest(Buffer.from(options.body as Uint8Array))).toBe(digest(raw.bytes)); expect(actual.get("x-api-blob-request-id")).toMatch(new RegExp(`^${store}:`));
        return { statusCode: 200, data: facts() };
      });
      await sdk.put(key, raw.bytes, { oidcToken: "synthetic", storeId: MEDIA_IDENTITY.storeId, access: "private", contentType: "application/octet-stream", addRandomSuffix: false, allowOverwrite: kind !== "permit", multipart: false, cacheControlMaxAge: 60, ...(condition ? { ifMatch: condition } : {}) });
    }
    const h = wire(); await transport(h).metadata(slot());
    pool.intercept({ method: "GET", path: String(h.requests[0].options.path) }).reply(options => { const actual = new Headers(options.headers as HeadersInit); expect(actual.get("authorization")).toBe("Bearer synthetic"); expect(actual.get("x-vercel-blob-store-id")).toBe(store); return { statusCode: 200, data: facts() }; });
    await sdk.head(key, { oidcToken: "synthetic", storeId: MEDIA_IDENTITY.storeId });
    agent.get(origin).intercept({ method: "GET", path: `/${key}?cache=0` }).reply(options => { const actual = new Headers(options.headers as HeadersInit); expect(actual.get("authorization")).toBe("Bearer synthetic"); expect(actual.get("if-match")).toBe(tag); expect(actual.get("accept-encoding")).toBe("identity"); return { statusCode: 200, data: Buffer.from(data), responseOptions: { headers: { "content-type": "application/octet-stream", "content-length": String(data.length), etag: tag } } }; });
    const result = await sdk.get(key, { oidcToken: "synthetic", storeId: MEDIA_IDENTITY.storeId, access: "private", useCache: false, headers: { "If-Match": tag, "Accept-Encoding": "identity" } }); await result?.stream?.cancel(); agent.assertNoPendingInterceptors();
  } finally { setGlobalDispatcher(previous); await agent.close(); }
});
