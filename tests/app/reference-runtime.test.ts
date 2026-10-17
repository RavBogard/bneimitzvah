import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => ({ context: vi.fn<() => { headers?: Record<string, string> }>(() => ({})), get: vi.fn(), sdkImports: 0 }));
vi.mock("@vercel/oidc", () => ({ getContext: native.context }));
vi.mock("@vercel/blob", () => { native.sdkImports++; return { get: native.get }; });
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { randomBytes, createHash } from "node:crypto";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";
import { createRuntimeReferenceLoader } from "../../src/server/runtime/composition";
import { ReferenceUnavailable } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
const env = () => {
  const url = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic"); url.username = "synthetic_login"; url.password = randomBytes(24).toString("hex"); url.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": url.href, "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
};
const catalog = { schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: "ra_" + "1".repeat(32), archiveFile: "Synthetic.mp3", sha256: "a".repeat(64), bytes: 4, verses: [{ schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset: "ra_" + "1".repeat(32), clip: { start: 1, end: 3 } }, words: { status: "unavailable", reason: "portal-text-unavailable" }, attribution: REFERENCE_ATTRIBUTION }] }] };
const bytes = new TextEncoder().encode(JSON.stringify(catalog)), hash = createHash("sha256").update(bytes).digest("hex"), config = { catalogSha256: hash, storeId: "store_synthetic123", studentRelease: false };
const stream = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); native.context.mockReset().mockReturnValue({}); native.get.mockReset(); });

test("reference config selector is atomic without activating on globally existing store ID", () => {
  const base = env(); expect(loadRuntimeConfig({ ...base, BLOB_STORE_ID: "store_synthetic123" }).referenceAudio).toBeUndefined();
  expect(loadRuntimeConfig({ ...base, REFERENCE_AUDIO_STUDENT_RELEASE: "false" }).referenceAudio).toBeUndefined();
  const configured = loadRuntimeConfig({ ...base, REFERENCE_AUDIO_CATALOG_SHA256: hash, BLOB_STORE_ID: config.storeId }); expect(configured.referenceAudio).toEqual(config); expect(Object.isFrozen(configured.referenceAudio)).toBe(true);
  for (const change of [{ REFERENCE_AUDIO_STUDENT_RELEASE: "true" }, { REFERENCE_AUDIO_STUDENT_RELEASE: "1" }, { REFERENCE_AUDIO_CATALOG_SHA256: "" }, { REFERENCE_AUDIO_CATALOG_SHA256: hash }, { REFERENCE_AUDIO_CATALOG_SHA256: hash.toUpperCase(), BLOB_STORE_ID: config.storeId }, { REFERENCE_AUDIO_CATALOG_SHA256: hash, BLOB_STORE_ID: "wrong" }]) expect(() => loadRuntimeConfig({ ...base, ...change })).toThrow(RuntimeUnavailable);
  expect(loadRuntimeConfig({ ...base, REFERENCE_AUDIO_CATALOG_SHA256: hash, BLOB_STORE_ID: config.storeId, REFERENCE_AUDIO_STUDENT_RELEASE: "true" }).referenceAudio?.studentRelease).toBe(true);
});

test("default and configured constructors are I/O-free; missing native context never falls back to static/env tokens", async () => {
  const before = native.sdkImports, disabled = createRuntimeReferenceLoader(undefined), configured = createRuntimeReferenceLoader(config);
  expect(native.context).not.toHaveBeenCalled(); expect(native.get).not.toHaveBeenCalled(); expect(native.sdkImports).toBe(before);
  await expect(disabled()).rejects.toBeInstanceOf(ReferenceUnavailable); expect(native.context).not.toHaveBeenCalled();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "unused"); vi.stubEnv("VERCEL_OIDC_TOKEN", "unused");
  await expect(configured()).rejects.toBeInstanceOf(ReferenceUnavailable); expect(native.get).not.toHaveBeenCalled();
  for (const token of ["", " ", "x".repeat(16385), "x\ny"]) { native.context.mockReturnValue({ headers: { "x-vercel-oidc-token": token } }); await expect(configured()).rejects.toBeInstanceOf(ReferenceUnavailable); }
  expect(native.get).not.toHaveBeenCalled();
});

test("configured loader uses only fixed key/explicit native OIDC+store and rejects endpoint overrides/status/late context", async () => {
  native.context.mockReturnValue({ headers: { "x-vercel-oidc-token": "synthetic.native.context" } }); native.get.mockImplementation(async () => ({ statusCode: 200, stream: stream() }));
  expect((await createRuntimeReferenceLoader(config)()).assets.length).toBe(1);
  const [path, options] = native.get.mock.calls[0]; expect(path).toBe(`reference-audio/pockettorah/catalog/${hash}.json`);
  expect(Object.keys(options).sort()).toEqual(["abortSignal", "access", "oidcToken", "storeId", "useCache"]); expect(options.access).toBe("private"); expect(options.storeId).toBe(config.storeId); expect(options.oidcToken).toBe("synthetic.native.context"); expect(options.useCache).toBe(false);
  native.get.mockClear(); vi.stubEnv("VERCEL_BLOB_API_URL", "https://example.test"); await expect(createRuntimeReferenceLoader({ ...config, storeId: "store_override" })()).rejects.toBeInstanceOf(ReferenceUnavailable); expect(native.get).not.toHaveBeenCalled(); vi.unstubAllEnvs();
  let ordinal = 0;
  for (const result of [null, { statusCode: 304, stream: null }, { statusCode: 200, stream: null }]) { native.get.mockResolvedValue(result); await expect(createRuntimeReferenceLoader({ ...config, storeId: `store_invalid${ordinal++}` })()).rejects.toBeInstanceOf(ReferenceUnavailable); }
  let cancelled = false; native.get.mockImplementation(async () => { native.context.mockReturnValue({}); return { statusCode: 200, stream: new ReadableStream({ cancel() { cancelled = true; } }) }; });
  await expect(createRuntimeReferenceLoader({ ...config, storeId: "store_latecontext" })()).rejects.toBeInstanceOf(ReferenceUnavailable); expect(cancelled).toBe(true);
});

test("actual pinned SDK get sends explicit native authorization despite ambient static token and never uses caller URLs", async () => {
  const actual = await vi.importActual<typeof import("@vercel/blob")>("@vercel/blob");
  native.context.mockReturnValue({ headers: { "x-vercel-oidc-token": "synthetic.native.context" } });
  native.get.mockImplementation(actual.get); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "unused"); vi.stubEnv("VERCEL_OIDC_TOKEN", "unused");
  const previous = getGlobalDispatcher(), agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  try {
    let requests = 0;
    agent.get("https://syntheticsdk123.private.blob.vercel-storage.com").intercept({ method: "GET", path: `/reference-audio/pockettorah/catalog/${hash}.json?cache=0` }).reply(request => {
      requests++;
      const headers = new Headers(request.headers as HeadersInit); expect(headers.get("authorization")).toBe("Bearer synthetic.native.context");
      return { statusCode: 200, data: Buffer.from(bytes), responseOptions: { headers: { "content-type": "application/json", "content-length": String(bytes.length) } } };
    });
    expect((await createRuntimeReferenceLoader({ ...config, storeId: "store_syntheticSdk123" })()).assets.length).toBe(1); expect(requests).toBe(1); agent.assertNoPendingInterceptors();
  } finally { setGlobalDispatcher(previous); await agent.close(); }

});


test("single immutable success cache shares only exact store+SHA; abort/failure never poison a later read", async () => {
  native.context.mockReturnValue({ headers: { "x-vercel-oidc-token": "synthetic.native.context" } });
  native.get.mockImplementation(async () => ({ statusCode: 200, stream: stream() }));
  const c = { ...config, storeId: "store_cacheCase" }, one = createRuntimeReferenceLoader(c);
  const first = await one(), second = await createRuntimeReferenceLoader(c)(); expect(second).toBe(first); expect(native.get).toHaveBeenCalledTimes(1); expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.assets)).toBe(true);
  const controller = new AbortController(); controller.abort(); await expect(one(controller.signal)).rejects.toBeInstanceOf(ReferenceUnavailable); expect(native.get).toHaveBeenCalledTimes(1);
  const otherStore = createRuntimeReferenceLoader({ ...c, storeId: "store_otherCache" }); await otherStore(); expect(native.get).toHaveBeenCalledTimes(2);
  const changed = { ...catalog, assets: [{ ...catalog.assets[0], bytes: 5 }] }, changedBytes = new TextEncoder().encode(JSON.stringify(changed)), changedSha = createHash("sha256").update(changedBytes).digest("hex");
  native.get.mockImplementation(async () => ({ statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(changedBytes); c.close(); } }) }));
  const otherHash = createRuntimeReferenceLoader({ ...c, catalogSha256: changedSha }); expect((await otherHash()).assets[0].bytes).toBe(5); expect(native.get).toHaveBeenCalledTimes(3);
  native.get.mockRejectedValue(new Error("Synthetic private provider failure")); const recovery = createRuntimeReferenceLoader({ ...c, storeId: "store_recoveryCase" }); await expect(recovery()).rejects.toBeInstanceOf(ReferenceUnavailable);
  native.get.mockImplementation(async () => ({ statusCode: 200, stream: stream() })); await recovery(); expect(native.get).toHaveBeenCalledTimes(5);
  // Cache stays only one entry, so the old exact store+SHA must fetch again.
  await one(); expect(native.get).toHaveBeenCalledTimes(6);
});
