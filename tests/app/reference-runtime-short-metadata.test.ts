import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => ({ context: vi.fn<() => { headers?: Record<string, string> }>(() => ({})), get: vi.fn() }));
vi.mock("@vercel/oidc", () => ({ getContext: native.context }));
vi.mock("@vercel/blob", () => ({ get: native.get }));
import { createRuntimeShortMetadata } from "../../src/server/reference-audio/runtime-short-metadata";
import { lookupShortSource } from "../../src/server/reference-audio/short-source-manifest";
import { publicShortFixture, byteStream, publicOrigin, sha } from "./reference-public-short-fixture";
import { REFERENCE_CATALOG_LIMITS } from "../../src/server/reference-audio/catalog";
const f = publicShortFixture(); let sequence = 0;
function profile() {
  const storeId = `store_synthetic${++sequence}`, env: Record<string, string | undefined> = { REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: "true", PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production",
    BETTER_AUTH_URL: publicOrigin, REFERENCE_AUDIO_CATALOG_SHA256: f.parentCatalogSHA256, REFERENCE_AUDIO_SHORT_MANIFEST_SHA256: f.manifestSHA256, BLOB_STORE_ID: storeId };
  const config = { origin: publicOrigin, deployment: { environment: "production" as const, deployment: "production" }, referenceAudio: { storeId, catalogSha256: f.parentCatalogSHA256, studentRelease: true } };
  return { config, env };
}
function ready() {
  native.context.mockReturnValue({ headers: { "x-vercel-oidc-token": "synthetic.native.context" } });
  native.get.mockImplementation(async (path: string) => ({ statusCode: 200, stream: byteStream(f.files.get(path)!) }));
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); native.context.mockReset().mockReturnValue({}); native.get.mockReset(); });

test("default off/confused profile performs no native work and cannot borrow public or v1 configuration", async () => {
  const { config, env } = profile();
  for (const e of [{}, ...[{ REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: undefined }, { REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: "1" }, { VERCEL: undefined }, { VERCEL_ENV: "preview" },
    { PORTAL_ENVIRONMENT: "preview" }, { PORTAL_DEPLOYMENT: "other" }, { NODE_ENV: "development" }, { BETTER_AUTH_URL: publicOrigin + "/" },
    { BLOB_STORE_ID: "store_other1234" }, { REFERENCE_AUDIO_CATALOG_SHA256: "b".repeat(64) }, { REFERENCE_AUDIO_SHORT_MANIFEST_SHA256: "bad" },
    { VERCEL_BLOB_API_URL: "https://example.test" }, { NEXT_PUBLIC_VERCEL_BLOB_API_URL: "" }].map(change => ({ ...env, ...change }))]) {
    const loader = createRuntimeShortMetadata(config, e); await expect(loader.loadCatalog()).rejects.toThrow("Reference unavailable");
  }
  await expect(createRuntimeShortMetadata({ ...config, referenceAudio: undefined }, env).loadManifest()).rejects.toThrow();
  await expect(createRuntimeShortMetadata({ ...config, origin: "https://example.test" }, env).loadCatalog()).rejects.toThrow();
  expect(native.context).not.toHaveBeenCalled(); expect(native.get).not.toHaveBeenCalled();
});

test("one chain feeds both callbacks; only complete genuine successes are reused across page owners", async () => {
  ready(); const { config, env } = profile(), loader = createRuntimeShortMetadata(config, env);
  const catalog = await loader.loadCatalog(), manifest = await loader.loadManifest();
  expect(catalog.assets[0].sha256).toBe(f.source.parent.sha256); expect(lookupShortSource(manifest, f.source.id)).not.toBeNull();
  expect(native.get.mock.calls.map(c => c[0])).toEqual([f.parentKey, f.manifestKey]);
  const second = createRuntimeShortMetadata(config, env); expect(await second.loadCatalog()).toBe(catalog); expect(await second.loadManifest()).toBe(manifest);
  expect(native.get).toHaveBeenCalledTimes(2);
  for (const [, options] of native.get.mock.calls) { expect(Object.keys(options).sort()).toEqual(["abortSignal", "access", "oidcToken", "storeId", "useCache"]);
    expect(options).toMatchObject({ access: "private", storeId: config.referenceAudio.storeId, oidcToken: "synthetic.native.context", useCache: false }); }
  const abort = new AbortController(); abort.abort(); await expect(second.loadCatalog(abort.signal)).rejects.toThrow();
  env.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE = "false"; await expect(second.loadManifest()).rejects.toThrow(); expect(native.get).toHaveBeenCalledTimes(2);
});

test("all four cache identities participate and configuration drift refuses even an immediate cached callback", async () => {
  ready(); const { config, env } = profile(), loader = createRuntimeShortMetadata(config, env); await loader.loadCatalog();
  const pending = loader.loadCatalog(); env.BLOB_STORE_ID = "store_other1234"; await expect(pending).rejects.toThrow();
  const other = profile(); await createRuntimeShortMetadata(other.config, other.env).loadManifest(); expect(native.get).toHaveBeenCalledTimes(4);
  const origin = "https://bneimitzvah.centralreform.org"; await createRuntimeShortMetadata({ ...other.config, origin }, { ...other.env, BETTER_AUTH_URL: origin }).loadCatalog(); expect(native.get).toHaveBeenCalledTimes(6);
  for (const field of ["parent", "manifest"] as const) {
    const p = profile(); p.env.BLOB_STORE_ID = other.config.referenceAudio.storeId; p.config.referenceAudio.storeId = other.config.referenceAudio.storeId;
    if (field === "parent") { p.config.referenceAudio.catalogSha256 = "b".repeat(64); p.env.REFERENCE_AUDIO_CATALOG_SHA256 = "b".repeat(64); }
    else p.env.REFERENCE_AUDIO_SHORT_MANIFEST_SHA256 = "c".repeat(64);
    native.get.mockImplementationOnce(async () => { throw new Error("synthetic unavailable pin"); });
    await expect(createRuntimeShortMetadata(p.config, p.env).loadCatalog()).rejects.toThrow();
  }
  expect(native.get).toHaveBeenCalledTimes(8);
});

test("failed chain retries and a late failing owner cannot delete another completed success", async () => {
  ready(); const p = profile(), loader = createRuntimeShortMetadata(p.config, p.env);
  native.get.mockRejectedValueOnce(new Error("synthetic provider failure")); await expect(loader.loadCatalog()).rejects.toThrow("Reference unavailable");
  await loader.loadCatalog(); expect(native.get).toHaveBeenCalledTimes(3);
  const q = profile(), competing = createRuntimeShortMetadata(q.config, q.env); let reject!: (reason: Error) => void;
  native.get.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const old = competing.loadCatalog(); await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
  await competing.loadManifest(); const calls = native.get.mock.calls.length; reject(new Error("synthetic late failure")); await expect(old).rejects.toThrow();
  await competing.loadCatalog(); expect(native.get).toHaveBeenCalledTimes(calls);
});

test("missing native credential never borrows ambient tokens; late credential/config drift cancels streams", async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "not-used"); vi.stubEnv("VERCEL_OIDC_TOKEN", "not-used");
  for (const token of [undefined, "", " ", "x\ny", "x".repeat(16385)]) {
    const p = profile(); native.context.mockReturnValue({ headers: token === undefined ? {} : { "x-vercel-oidc-token": token } });
    await expect(createRuntimeShortMetadata(p.config, p.env).loadCatalog()).rejects.toThrow("Reference unavailable");
  }
  expect(native.get).not.toHaveBeenCalled();
  for (const change of ["context", "release", "config"] as const) {
    ready(); const p = profile(); let cancelled = false;
    native.get.mockImplementationOnce(async () => { if (change === "context") native.context.mockReturnValue({}); else if (change === "release") p.env.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE = "false"; else p.config.origin = "https://example.test";
      return { statusCode: 200, stream: new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }) }; });
    await expect(createRuntimeShortMetadata(p.config, p.env).loadCatalog()).rejects.toThrow(); expect(cancelled).toBe(true);
  }
});

test("parent hash/UTF8/shape/size/empty framing and manifest integrity must all pass before caching", async () => {
  for (const bytes of [f.parent.slice(0, -1), new Uint8Array(REFERENCE_CATALOG_LIMITS.bytes + 1), new Uint8Array([255]), new TextEncoder().encode("{}")]) {
    ready(); const p = profile();
    // Exact pins on malformed semantic inputs ensure UTF8/JSON/schema checks
    // are exercised after successful digest verification, not hidden by SHA.
    if (bytes.length <= 2) { p.config.referenceAudio.catalogSha256 = sha(bytes); p.env.REFERENCE_AUDIO_CATALOG_SHA256 = sha(bytes); }
    native.get.mockImplementationOnce(async () => ({ statusCode: 200, stream: byteStream(bytes) }));
    await expect(createRuntimeShortMetadata(p.config, p.env).loadCatalog()).rejects.toThrow();
    p.config.referenceAudio.catalogSha256 = f.parentCatalogSHA256; p.env.REFERENCE_AUDIO_CATALOG_SHA256 = f.parentCatalogSHA256;
    await createRuntimeShortMetadata(p.config, p.env).loadManifest(); // Failed value was not cached.
  }
  ready(); const p = profile(); native.get.mockImplementationOnce(async () => ({ statusCode: 200, stream: new ReadableStream({ start(c) { for (let i = 0; i < 65; i++) c.enqueue(new Uint8Array()); c.close(); } }) }));
  await expect(createRuntimeShortMetadata(p.config, p.env).loadCatalog()).rejects.toThrow();
  ready(); const q = profile(); native.get.mockImplementationOnce(async () => ({ statusCode: 200, stream: byteStream(f.parent) })).mockImplementationOnce(async () => ({ statusCode: 200, stream: byteStream(f.manifest.slice(0, -1)) }));
  await expect(createRuntimeShortMetadata(q.config, q.env).loadCatalog()).rejects.toThrow();
  expect(sha(f.parent)).toBe(f.parentCatalogSHA256);
});

test("native SDK statuses and invalid streams fail closed; tiny framing and shadow getters preserve exact owned bytes", async () => {
  for (const result of [null, { statusCode: 304, stream: null }, { statusCode: 200, stream: null }, { statusCode: 200, stream: "not-stream" }]) {
    ready(); const p = profile(); native.get.mockResolvedValueOnce(result); await expect(createRuntimeShortMetadata(p.config, p.env).loadCatalog()).rejects.toThrow("Reference unavailable");
  }
  ready(); const p = profile(), getter = vi.fn(() => { throw new Error("shadow must not run"); });
  const chunk = f.parent.slice(); Object.defineProperty(chunk, "byteLength", { get: getter });
  native.get.mockImplementationOnce(async () => ({ statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(chunk); c.close(); } }) }));
  await createRuntimeShortMetadata(p.config, p.env).loadCatalog(); expect(getter).not.toHaveBeenCalled();
  ready(); const q = profile();
  native.get.mockImplementationOnce(async () => ({ statusCode: 200, stream: new ReadableStream({ start(c) { for (const byte of f.parent) c.enqueue(new Uint8Array([byte])); c.close(); } }) }));
  expect((await createRuntimeShortMetadata(q.config, q.env).loadCatalog()).assets[0].sha256).toBe(f.source.parent.sha256);
});

test("parent stalled open/read/abort are bounded and late cancellation does not block settlement", async () => {
  ready(); vi.useFakeTimers(); const p = profile(); let resolve!: (value: unknown) => void, cancelled = false;
  native.get.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = createRuntimeShortMetadata(p.config, p.env).loadCatalog(), rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(10001); await rejected;
  resolve({ statusCode: 200, stream: new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }) }); await vi.advanceTimersByTimeAsync(0); expect(cancelled).toBe(true);
  ready(); const q = profile(); native.get.mockImplementationOnce(async () => ({ statusCode: 200, stream: new ReadableStream() }));
  const stalled = createRuntimeShortMetadata(q.config, q.env).loadCatalog(), stalledRejected = expect(stalled).rejects.toThrow(); await vi.advanceTimersByTimeAsync(5001); await stalledRejected;
  ready(); const r = profile(), abort = new AbortController(); native.get.mockImplementationOnce(async () => ({ statusCode: 200, stream: new ReadableStream() }));
  const aborted = createRuntimeShortMetadata(r.config, r.env).loadManifest(abort.signal), abortedRejected = expect(aborted).rejects.toThrow(); abort.abort(); await abortedRejected;
});
