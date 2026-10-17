import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { request as HttpsRequest, RequestOptions } from "node:https";
import { afterEach, expect, test, vi } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
vi.mock("server-only", () => ({}));
import { createPrivateMediaTransport } from "../../src/server/media/private-transport";
import { MEDIA_IDENTITY } from "../../src/server/media/runtime-oidc";
import type { MediaSlot } from "../../src/server/media/types";

const payload = Uint8Array.of(9, 8, 7, 6), current = '"current"', generation = "review-v1";
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const binding = (): MediaSlot => ({ storeGeneration: generation, assetId: "caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slotIndex: 27, expectedBytes: payload.length, bodySha256: digest(payload) });
const objectPath = `recordings/v1/${binding().assetId}/chunk-27`, normalized = MEDIA_IDENTITY.storeId.slice(6), privateOrigin = `https://${normalized.toLowerCase()}.private.blob.vercel-storage.com`;
const facts = (etag = current, size = payload.length) => ({ url: `${privateOrigin}/${objectPath}`, pathname: objectPath, size, contentType: "application/octet-stream", etag });
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
type Reply = { status?: number; body?: Uint8Array; headers?: Record<string, string>; rawHeaders?: string[]; chunks?: Uint8Array[]; beforeHeaders?: () => void; beforeChunk?: (index: number) => void; beforeEnd?: () => void; afterEnd?: () => void; complete?: boolean; tls?: boolean };
function fixture(reply: Reply = {}, automatic = true) {
  let cb: ((response: unknown) => void) | undefined, requestDestroyed = 0, responseDestroyed = 0, ends = 0;
  const records: { options: RequestOptions; bytes: Buffer }[] = [];
  const requestEmitter = new EventEmitter(), socket = Object.assign(new EventEmitter(), { encrypted: true, authorized: true, destroy() { requestDestroyed++; } });
  function deliver() {
    const bytes = reply.body ?? json(facts()), headers = reply.headers ?? { "content-length": String(bytes.length), "content-type": "application/octet-stream", etag: current };
    const response = Object.assign(new EventEmitter(), { statusCode: reply.status ?? 200, headers, rawHeaders: reply.rawHeaders ?? Object.entries(headers).flat(), complete: false, socket: { encrypted: true, authorized: reply.tls !== false }, destroy() { responseDestroyed++; } });
    reply.beforeHeaders?.(); cb!(response);
    (reply.chunks ?? [bytes]).forEach((chunk, index) => { reply.beforeChunk?.(index); response.emit("data", chunk); });
    reply.beforeEnd?.(); response.complete = reply.complete !== false; response.emit("end"); reply.afterEnd?.(); return response;
  }
  const request = ((options: RequestOptions, callback: (response: unknown) => void) => {
    cb = callback;
    return Object.assign(requestEmitter, { destroy() { requestDestroyed++; }, end(body?: Uint8Array) {
      ends++; records.push({ options, bytes: Buffer.from(body ?? []) });
      queueMicrotask(() => { requestEmitter.emit("socket", socket); socket.emit("secureConnect"); if (automatic) deliver(); });
    } });
  }) as unknown as typeof HttpsRequest;
  return { request, deliver, records, requestEmitter, socket, get ends() { return ends; }, get destroyed() { return requestDestroyed + responseDestroyed; } };
}
type Options = Parameters<typeof createPrivateMediaTransport>[0];
const make = (f: ReturnType<typeof fixture>, options: Partial<Options> = {}) => createPrivateMediaTransport({ storeGeneration: generation, request: f.request, credentials: { acquire: () => ({ token: "synthetic", assertFresh() {} }) }, ...options });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test("intrinsic typed-array length must bound the allocation even when byteLength is shadowed", async () => {
  const huge = new Uint8Array(1048578); Object.defineProperty(huge, "byteLength", { value: payload.length });
  const f = fixture(), copied = vi.spyOn(Buffer, "from");
  expect(await make(f).putChunk(binding(), huge, current)).toEqual({ ok: false, outcome: "unavailable" });
  expect(copied.mock.calls.some(call => call[0] === huge)).toBe(false); expect(f.ends).toBe(0);
  copied.mockRestore();
  const backing = Uint8Array.of(0, 0, ...payload, 0), view = backing.subarray(2, 6); let hooks = 0;
  for (const name of ["buffer", "byteOffset", "byteLength", "length"]) Object.defineProperty(view, name, { get() { hooks++; throw Error("shadowed-view-detail"); } });
  Object.defineProperty(view, "valueOf", { value() { hooks++; return huge; } });
  const bounded = fixture(); expect(await make(bounded).putChunk(binding(), view, '"permit"')).toEqual({ ok: true, value: { etag: current } });
  expect(hooks).toBe(0); expect(bounded.records[0].bytes).toEqual(Buffer.from(payload));
});

test("metadata URL must be a string rather than a coercible provider response array", async () => {
  const value = facts(), f = fixture({ body: json({ ...value, url: [value.url] }) });
  expect(await make(f).metadata(binding())).toEqual({ ok: false, outcome: "unavailable" });
  const p = fixture({ body: json({ ...value, url: [value.url] }) });
  expect(await make(p).putPermit(binding())).toEqual({ ok: false, outcome: "unknown-write" });
});

test("closed binding/operation descriptors and failed credential setup never acquire a wire capability", async () => {
  let credentials = 0, getter = 0;
  const f = fixture(), t = make(f, { credentials: { acquire() { credentials++; throw Error("private-detail"); } } });
  const accessor = Object.defineProperty({ ...binding() }, "assetId", { enumerable: true, get() { getter++; return binding().assetId; } });
  for (const value of [accessor, { ...binding(), [Symbol("extra")]: 1 }, Object.assign(Object.create({ inherited: true }), binding()), { ...binding(), slotIndex: 28 }, { ...binding(), expectedBytes: 1 }]) expect(await t.putPermit(value)).toEqual({ ok: false, outcome: "unavailable" });
  expect(credentials).toBe(0); expect(getter).toBe(0); expect(f.ends).toBe(0);
  expect(await t.metadata(binding())).toEqual({ ok: false, outcome: "unavailable" }); expect(credentials).toBe(1);
  const options = Object.defineProperty({}, "deadline", { enumerable: true, get() { getter++; return 0; } });
  expect(await make(f).metadata(binding(), options)).toEqual({ ok: false, outcome: "unavailable" }); expect(getter).toBe(0);
});

test("marker bodies remain fixed odd non-audio values and returned tags cannot reuse either replaced identity", async () => {
  for (const [kind, length] of [["permit", 31], ["retire", 33]] as const) {
    const f = fixture({ body: json(facts('"new"')) }), t = make(f);
    const result = kind === "permit" ? await t.putPermit(binding()) : await t.putRetirement(binding(), '"B"', '"A"');
    expect(result).toEqual({ ok: true, value: { etag: '"new"' } }); expect(f.records[0].bytes.length).toBe(length);
    expect([...f.records[0].bytes]).toEqual(Array.from({ length }, (_, i) => kind === "permit" ? (i * 3 + 7) % 256 : (i * 5 + 193) % 256));
  }
  for (const tag of ['"A"', '"B"', 'W/"new"', '"with\rnewline"']) expect(await make(fixture({ body: json(facts(tag)) })).putRetirement(binding(), '"B"', '"A"')).toEqual({ ok: false, outcome: "unknown-write" });
});

test("retirement requires its original strong permit tag before acquiring any write capability", async () => {
  const f = fixture({ body: json(facts('"A"')) });
  expect(await make(f).putRetirement(binding(), '"B"', undefined as unknown as string)).toEqual({ ok: false, outcome: "unavailable" });
  expect(f.ends).toBe(0);
});

test("raw GET validates all body evidence and returns an independent owned byte array", async () => {
  const good = { "content-length": "4", "content-type": "application/octet-stream", etag: current };
  for (const reply of [{ headers: { ...good, "content-length": "004" } }, { headers: { ...good, "content-encoding": "identity" } }, { headers: { ...good, etag: '"wrong"' } }, { headers: { ...good, "content-type": "audio/wav" } }, { body: Uint8Array.of(1, 2, 3, 4) }, { status: 206 }, { complete: false }, { tls: false }, { rawHeaders: ["content-length", "4", "Content-Length", "4"] }]) {
    expect(await make(fixture({ body: payload, headers: good, ...reply })).read(binding(), "chunk", current)).toEqual({ ok: false, outcome: "unavailable" });
  }
  const borrowed = Buffer.from(payload), f = fixture({ body: borrowed, headers: good, afterEnd: () => borrowed.fill(0) });
  const result = await make(f).read(binding(), "chunk", current); expect(result.ok && [...result.value.bytes]).toEqual([...payload]);
  expect(f.records[0].options).toMatchObject({ protocol: "https:", hostname: new URL(privateOrigin).hostname, port: 443, path: `/${objectPath}?cache=0`, rejectUnauthorized: true, agent: false });
});

test("recognized completed condition/absence differs from uncertain dispatch without error reflection", async () => {
  for (const [status, body, expected] of [[412, { error: { code: "precondition_failed", message: "private-detail" } }, "precondition-failed"], [412, { error: { code: "different" } }, "unknown-write"], [500, { error: { code: "precondition_failed" } }, "unknown-write"], [302, {}, "unknown-write"], [403, { error: { message: "private-detail" } }, "unknown-write"]] as const) {
    const f = fixture({ status, body: json(body) }); expect(await make(f).putChunk(binding(), payload, current)).toEqual({ ok: false, outcome: expected }); expect(f.ends).toBe(1);
  }
  expect(await make(fixture({ status: 404, body: json({ error: { code: "not_found" } }) })).metadata(binding())).toEqual({ ok: false, outcome: "not-found" });
  expect(await make(fixture({ status: 404, body: Buffer.alloc(4097) })).read(binding(), "chunk", current)).toEqual({ ok: false, outcome: "unavailable" });
});

test("empty floods, progress-only idle and postsettlement absolute deadlines cannot become success", async () => {
  const headers = { "content-length": "4", "content-type": "application/octet-stream", etag: current };
  expect(await make(fixture({ body: payload, headers, chunks: Array.from({ length: 65 }, () => new Uint8Array()) })).read(binding(), "chunk", current)).toEqual({ ok: false, outcome: "unavailable" });
  const initial = performance.now(); let monotonic = initial;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const starved = fixture({ body: payload, headers, chunks: [payload.subarray(0, 2), payload.subarray(2)], beforeChunk: index => { if (index === 1) monotonic += 5001; } });
  expect(await make(starved).read(binding(), "chunk", current)).toEqual({ ok: false, outcome: "unavailable" });
  monotonic = initial; const settled = fixture({ afterEnd: () => { monotonic += 10001; } });
  expect(await make(settled).putPermit(binding())).toEqual({ ok: false, outcome: "unknown-write" });
  monotonic = initial; const beforeDispatch = fixture();
  expect(await make(beforeDispatch, { credentials: { acquire() { monotonic += 10001; return { token: "synthetic", assertFresh() {} }; } } }).putPermit(binding())).toEqual({ ok: false, outcome: "unavailable" });
  expect(beforeDispatch.ends).toBe(0);
});

test("abort then late responses/socket events cannot restore outcome or initiate another request", async () => {
  const controller = new AbortController(), f = fixture({}, false), pending = make(f).putPermit(binding(), { signal: controller.signal });
  await Promise.resolve(); controller.abort(); expect(await pending).toEqual({ ok: false, outcome: "unknown-write" });
  const before = f.destroyed; f.deliver(); expect(f.destroyed).toBeGreaterThan(before); expect(f.ends).toBe(1);
  expect(() => { f.socket.emit("error", Error("private-detail")); f.requestEmitter.emit("error", Error("private-detail")); }).not.toThrow();
});

test("a response rejected before body listeners still absorbs its subsequent error event", async () => {
  const f = fixture({ headers: { "content-length": "1048577" } }, false), pending = make(f).read(binding(), "chunk", current);
  await Promise.resolve(); const rejected = f.deliver(); expect(await pending).toEqual({ ok: false, outcome: "unavailable" });
  expect(() => rejected.emit("error", Error("private-provider-detail"))).not.toThrow(); expect(f.ends).toBe(1);
});

test("pinned SDK semantic control and direct GET mapping matches independently derived slot27 wire facts", async () => {
  const previous = getGlobalDispatcher(), agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent); vi.stubEnv("VERCEL_BLOB_RETRIES", "0");
  try {
    const sdk = await import("@vercel/blob"), f = fixture(), t = make(f), api = agent.get("https://vercel.com");
    await t.putChunk(binding(), payload, '"A"');
    api.intercept({ method: "PUT", path: `/api/blob/?pathname=${encodeURIComponent(objectPath)}` }).reply(request => {
      const actual = new Headers(request.headers as HeadersInit), closed = new Headers(f.records[0].options.headers as HeadersInit);
      for (const name of ["authorization", "x-api-version", "x-vercel-blob-store-id", "x-api-blob-request-attempt", "x-vercel-blob-access", "x-content-type", "x-add-random-suffix", "x-allow-overwrite", "x-cache-control-max-age", "x-if-match"]) expect(closed.get(name)).toBe(actual.get(name));
      expect(actual.get("x-api-blob-request-id")).toMatch(new RegExp(`^${normalized}:\\d+:`)); expect(closed.get("x-api-blob-request-id")).toMatch(new RegExp(`^${normalized}:\\d+:[a-f0-9]{16}$`));
      expect(Buffer.from(request.body as Uint8Array)).toEqual(f.records[0].bytes); return { statusCode: 200, data: facts() };
    });
    await sdk.put(objectPath, Buffer.from(payload), { oidcToken: "synthetic", storeId: MEDIA_IDENTITY.storeId, access: "private", contentType: "application/octet-stream", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, multipart: false, ifMatch: '"A"', abortSignal: AbortSignal.timeout(1000) });
    api.intercept({ method: "GET", path: `/api/blob?url=${encodeURIComponent(objectPath)}` }).reply(request => { const h = new Headers(request.headers as HeadersInit); expect(h.get("authorization")).toBe("Bearer synthetic"); expect(h.get("x-vercel-blob-store-id")).toBe(normalized); return { statusCode: 200, data: facts() }; });
    await sdk.head(objectPath, { oidcToken: "synthetic", storeId: MEDIA_IDENTITY.storeId, abortSignal: AbortSignal.timeout(1000) });
    agent.get(privateOrigin).intercept({ method: "GET", path: `/${objectPath}?cache=0` }).reply(request => { const h = new Headers(request.headers as HeadersInit); expect(h.get("authorization")).toBe("Bearer synthetic"); expect(h.get("if-match")).toBe(current); expect(h.get("accept-encoding")).toBe("identity"); return { statusCode: 200, data: Buffer.from(payload), responseOptions: { headers: { "content-type": "application/octet-stream", "content-length": "4", etag: current } } }; });
    const result = await sdk.get(objectPath, { oidcToken: "synthetic", storeId: MEDIA_IDENTITY.storeId, access: "private", useCache: false, headers: { "If-Match": current, "Accept-Encoding": "identity" }, abortSignal: AbortSignal.timeout(1000) }); await result?.stream?.cancel(); agent.assertNoPendingInterceptors();
  } finally { setGlobalDispatcher(previous); await agent.close(); }
});
