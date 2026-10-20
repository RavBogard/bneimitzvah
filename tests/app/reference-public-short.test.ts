import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPublicShortHandler } from "../../src/server/reference-audio/public-short";
import { createShortSourceManifestLoader, lookupShortSource } from "../../src/server/reference-audio/short-source-manifest";
import { verifyShortSourceBody } from "../../src/server/reference-audio/short-source-body";
import { SHORT_SOURCE_ATTRIBUTION } from "../../src/lib/reference-audio/short-source";
import { publicShortFixture, publicOrigin, byteStream, sha } from "./reference-public-short-fixture";
const request = (path: string, init?: RequestInit) => new Request(publicOrigin + path, init);
function setup(f = publicShortFixture()) {
  const get = vi.fn(async (key: string) => { const bytes = f.files.get(key); if (!bytes) throw Error("unexpected key"); return byteStream(bytes); });
  return { f, get, handler: createPublicShortHandler({ ...f, get }) };
}
const failed = async (response: Response, status: number) => { expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store"); expect(response.headers.has("set-cookie")).toBe(false); expect(await response.text()).toBe(""); };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("closed default/invalid configuration is I/O-free", async () => {
  const { f, get } = setup();
  for (const handler of [createPublicShortHandler(), createPublicShortHandler({ ...f, get, origin: "https://example.test" }), createPublicShortHandler({ ...f, get, manifestSHA256: "bad" })]) await failed(await handler(request(f.source.path)), 404);
  expect(get).not.toHaveBeenCalled();
});
test("exact anonymous GET and HEAD fully verify genuine metadata/body and return only public immutable credit headers", async () => {
  const { f, get, handler } = setup();
  for (const method of ["GET", "HEAD"]) {
    const response = await handler(request(f.source.path, { method, headers: { host: new URL(publicOrigin).host, "x-forwarded-host": new URL(publicOrigin).host, "x-forwarded-proto": "https", "x-forwarded-port": "443", forwarded: 'host="unterminated;proto=http', cookie: "ignored=synthetic", authorization: "Bearer ignored", "if-none-match": `"sha256-${f.hash}"` } }));
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("audio/mpeg"); expect(response.headers.get("content-length")).toBe(String(f.body.length));
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable"); expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=31536000, immutable"); expect(response.headers.get("etag")).toBe(`"sha256-${f.hash}"`);
    for (const key of ["set-cookie", "vary", "www-authenticate", "access-control-allow-credentials"]) expect(response.headers.has(key)).toBe(false);
    expect(response.headers.get("x-reference-creator")).toBe(SHORT_SOURCE_ATTRIBUTION.creator); expect(response.headers.get("x-reference-changes")).toBe(SHORT_SOURCE_ATTRIBUTION.changes);
    expect(response.headers.get("x-reference-attribution-version")).toBe(SHORT_SOURCE_ATTRIBUTION.version); expect(response.headers.get("link")).toContain(`<${SHORT_SOURCE_ATTRIBUTION.licenseUrl}>; rel="license"`);
    const received = new Uint8Array(await response.arrayBuffer()); expect(method === "HEAD" ? received.length : sha(received)).toBe(method === "HEAD" ? 0 : f.hash);
  }
  expect(get.mock.calls.map(c => c[0])).toEqual([f.parentKey, f.manifestKey, f.bodyKey, f.parentKey, f.manifestKey, f.bodyKey]);
});
test("path, host, query and forwarding confusion are refused before metadata or body work", async () => {
  const { f, get, handler } = setup();
  for (const path of [f.source.path + "?x=1", f.source.path + "?", f.source.path + "#x", f.source.path.toUpperCase(), f.source.path.replace(".mp3", ".json"), "/reference-audio/short-v1/", f.source.path.replace(".mp3", "%2Emp3"), "/booklet/" + f.hash]) await failed(await handler(request(path)), 404);
  const conflicts: HeadersInit[] = [{ host: "example.test" }, { "x-forwarded-host": "example.test" }, { "x-forwarded-host": new URL(publicOrigin).host + ",example.test" }, { "x-forwarded-proto": "http" }, { "x-forwarded-port": "80" }];
  for (const conflict of conflicts) {
    const headers = new Headers(conflict); headers.set("forwarded", `host=${new URL(publicOrigin).host};proto=https`);
    await failed(await handler(request(f.source.path, { headers })), 404);
  }
  await failed(await handler(new Request("https://example.test" + f.source.path, { headers: { forwarded: `host=${new URL(publicOrigin).host};proto=https` } })), 404); expect(get).not.toHaveBeenCalled();
});
test("non-GET/HEAD and Range refuse early and unknown content identities never read a media key", async () => {
  const { f, get, handler } = setup();
  await failed(await handler(request(f.source.path, { method: "POST", body: "{}" })), 405);
  await failed(await handler(request(f.source.path, { headers: { range: "bytes=0-1" } })), 416); expect(get).not.toHaveBeenCalled();
  await failed(await handler(request(`/reference-audio/short-v1/${"f".repeat(64)}.mp3`)), 404);
  expect(get.mock.calls.map(c => c[0])).toEqual([f.parentKey, f.manifestKey]);
});

test("canonical Range discards RFC Forwarded without reading or logging it", async () => {
  const { f, get, handler } = setup(), sink = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const forwarded of ["", "synthetic-private-canary", "host=foreign.example.test;proto=http", 'host="unterminated', "host=a;host=b", "x".repeat(4096)])
    await failed(await handler(request(f.source.path, { headers: { range: "bytes=0-15", forwarded } })), 416);
  const unread = request(f.source.path, { headers: { range: "bytes=0-15", forwarded: "synthetic-private-canary" } });
  const originalGet = unread.headers.get.bind(unread.headers), originalHas = unread.headers.has.bind(unread.headers); let forbiddenReads = 0;
  vi.spyOn(unread.headers, "get").mockImplementation(key => { if (key.toLowerCase() === "forwarded") { forbiddenReads++; throw Error("RFC metadata must remain unread"); } return originalGet(key); });
  vi.spyOn(unread.headers, "has").mockImplementation(key => { if (key.toLowerCase() === "forwarded") { forbiddenReads++; throw Error("RFC metadata must remain unread"); } return originalHas(key); });
  await failed(await handler(unread), 416);
  expect(forbiddenReads).toBe(0); expect(get).not.toHaveBeenCalled(); expect(sink).not.toHaveBeenCalled();
});
test("parent and manifest bytes must match their exact pins before any media read", async () => {
  for (const part of ["parent", "manifest"] as const) {
    const { f, get, handler } = setup(); const bytes = f[part].slice(); bytes[bytes.length - 1] ^= 1; f.files.set(part === "parent" ? f.parentKey : f.manifestKey, bytes);
    await failed(await handler(request(f.source.path)), 503); expect(get.mock.calls.some(c => c[0] === f.bodyKey)).toBe(false);
  }
});
test("corrupt, truncated and oversized media refuse even for HEAD and matching conditionals", async () => {
  for (const method of ["GET", "HEAD"]) for (const mode of ["corrupt", "short", "long"] as const) {
    const { f, handler } = setup(); let bytes = f.body.slice(); if (mode === "corrupt") bytes[bytes.length - 1] ^= 1;
    else if (mode === "short") bytes = bytes.subarray(0, bytes.length - 1); else bytes = new Uint8Array(bytes.length + 1); f.files.set(f.bodyKey, bytes);
    await failed(await handler(request(f.source.path, { method, headers: { "if-none-match": `"sha256-${f.hash}"` } })), 503);
  }
});
test("matching full hash cannot bypass actual sealed-entry MP3 semantic verification", async () => {
  const f = publicShortFixture((body, info) => { body[info + 4] = 1; }), { handler } = setup(f);
  await failed(await handler(request(f.source.path)), 503);
  const load = createShortSourceManifestLoader({ sha256: f.manifestSHA256, parentCatalogSHA256: f.parentCatalogSHA256, parentCatalogBytes: f.parent, get: async () => byteStream(f.manifest) });
  const entry = lookupShortSource(await load(), `rs_${f.hash}`)!;
  expect(() => verifyShortSourceBody({ ...entry }, f.body)).toThrow();
});
test("fragmented intrinsic bytes are copied safely and no response escapes before final EOF/verification", async () => {
  const f = publicShortFixture(); let finish!: () => void, delivered = false;
  const get = vi.fn(async (key: string) => key === f.bodyKey ? new ReadableStream<Uint8Array>({ start(c) {
    for (let offset = 0; offset < f.body.length; offset++) c.enqueue(f.body.subarray(offset, offset + 1)); finish = () => c.close();
  } }) : byteStream(f.files.get(key)!));
  const handler = createPublicShortHandler({ ...f, get }); const pending = handler(request(f.source.path)).then(r => { delivered = true; return r; });
  await vi.waitFor(() => expect(get.mock.calls.some(c => c[0] === f.bodyKey)).toBe(true)); expect(delivered).toBe(false); finish();
  const response = await pending; expect(response.status).toBe(200); expect(sha(new Uint8Array(await response.arrayBuffer()))).toBe(f.hash);
});
test("native stream geometry cannot be spoofed and empty-progress floods refuse", async () => {
  const f = publicShortFixture(), getter = vi.fn(() => { throw Error("shadow getter must not run"); });
  const chunk = f.body.slice(); Object.defineProperties(chunk, { byteLength: { get: getter }, buffer: { get: getter }, byteOffset: { get: getter } });
  const get = vi.fn(async (key: string) => byteStream(key === f.bodyKey ? chunk : f.files.get(key)!));
  const response = await createPublicShortHandler({ ...f, get })(request(f.source.path)); expect(response.status).toBe(200); expect(getter).not.toHaveBeenCalled();
  const empty = async (key: string) => key === f.bodyKey ? new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 65; i++) c.enqueue(new Uint8Array()); c.close(); } }) : byteStream(f.files.get(key)!);
  await failed(await createPublicShortHandler({ ...f, get: empty })(request(f.source.path)), 503);
});
test("late streams, read stalls and aborts are cancelled without waiting on hostile cancellation", async () => {
  vi.useFakeTimers(); const f = publicShortFixture(); let resolve!: (s: ReadableStream<Uint8Array>) => void, cancelled = false;
  const get = vi.fn(() => new Promise<ReadableStream<Uint8Array>>(yes => { resolve = yes; })), handler = createPublicShortHandler({ ...f, get });
  const response = handler(request(f.source.path)); await vi.advanceTimersByTimeAsync(10001); await failed(await response, 503);
  resolve(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } })); await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(true);
  const stall = createPublicShortHandler({ ...f, get: async () => new ReadableStream({ cancel() { return new Promise(() => {}); } }) });
  const pending = stall(request(f.source.path)); await vi.advanceTimersByTimeAsync(5001); await failed(await pending, 503);
  const controller = new AbortController(); controller.abort(); const untouched = vi.fn(); await failed(await createPublicShortHandler({ ...f, get: untouched })(request(f.source.path, { signal: controller.signal })), 503); expect(untouched).not.toHaveBeenCalled();
});
