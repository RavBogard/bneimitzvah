import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => ({ context: vi.fn<() => { headers?: Record<string, string> }>(() => ({})), get: vi.fn(), imports: 0 }));
vi.mock("@vercel/oidc", () => ({ getContext: native.context }));
vi.mock("@vercel/blob", () => { native.imports++; return { get: native.get }; });
import * as route from "../../src/app/reference-audio/short-v1/[file]/route";
import { createRuntimePublicShort } from "../../src/server/reference-audio/runtime-short";
import { publicShortFixture, publicOrigin, byteStream, sha } from "./reference-public-short-fixture";
const f = publicShortFixture();
const env = () => ({ REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: "true", PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production",
  BETTER_AUTH_URL: publicOrigin, REFERENCE_AUDIO_CATALOG_SHA256: f.parentCatalogSHA256, REFERENCE_AUDIO_SHORT_MANIFEST_SHA256: f.manifestSHA256, BLOB_STORE_ID: "store_synthetic123" });
const request = (extra?: HeadersInit) => new Request(publicOrigin + f.source.path, { headers: extra });
afterEach(() => { vi.unstubAllEnvs(); native.context.mockReset().mockReturnValue({}); native.get.mockReset(); });
function ready() {
  native.context.mockReturnValue({ headers: { "x-vercel-oidc-token": "synthetic.native.context" } });
  native.get.mockImplementation(async (path: string) => ({ statusCode: 200, stream: byteStream(f.files.get(path)!) }));
}

test("default off and every incomplete/confused environment stay closed without provider/context work", async () => {
  const base = env(), before = native.imports;
  for (const config of [{}, { BLOB_STORE_ID: base.BLOB_STORE_ID }, ...[
    { REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: undefined }, { REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: "1" }, { REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: "false" },
    { PORTAL_ENVIRONMENT: "preview" }, { PORTAL_DEPLOYMENT: "preview" }, { VERCEL_ENV: "preview" }, { VERCEL: undefined }, { NODE_ENV: "development" },
    { BETTER_AUTH_URL: "https://example.test" }, { BETTER_AUTH_URL: publicOrigin + "/" }, { REFERENCE_AUDIO_CATALOG_SHA256: "bad" }, { REFERENCE_AUDIO_SHORT_MANIFEST_SHA256: "bad" },
    { BLOB_STORE_ID: "bad" }, { VERCEL_BLOB_API_URL: "https://example.test" }, { NEXT_PUBLIC_VERCEL_BLOB_API_URL: "" },
  ].map(change => ({ ...base, ...change }))]) {
    const response = await createRuntimePublicShort(config)(request()); expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  }
  expect(native.context).not.toHaveBeenCalled(); expect(native.get).not.toHaveBeenCalled(); expect(native.imports).toBe(before);
});
test("valid runtime construction is lazy and request host/range gates precede native credential work", async () => {
  const handler = createRuntimePublicShort(env()); expect(native.context).not.toHaveBeenCalled();
  expect((await handler(request({ host: "example.test" }))).status).toBe(404); expect((await handler(request({ range: "bytes=0-1" }))).status).toBe(416);
  expect(native.context).not.toHaveBeenCalled(); expect(native.get).not.toHaveBeenCalled();
});
test("only native OIDC and explicit fixed store/keys reach the private SDK; public caller credentials never do", async () => {
  ready(); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "ignored-static"); vi.stubEnv("VERCEL_OIDC_TOKEN", "ignored-static");
  const handler = createRuntimePublicShort(env()), response = await handler(request({ authorization: "Bearer caller", cookie: "caller=ignored", "x-vercel-oidc-token": "caller" }));
  expect(response.status).toBe(200); expect(sha(new Uint8Array(await response.arrayBuffer()))).toBe(f.hash);
  expect(native.get.mock.calls.map(c => c[0])).toEqual([f.parentKey, f.manifestKey, f.bodyKey]);
  for (const [, options] of native.get.mock.calls) {
    expect(Object.keys(options).sort()).toEqual(["abortSignal", "access", "oidcToken", "storeId", "useCache"]);
    expect(options).toMatchObject({ access: "private", oidcToken: "synthetic.native.context", storeId: "store_synthetic123", useCache: false }); expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  }
  expect(response.headers.has("set-cookie")).toBe(false); expect(response.headers.has("vary")).toBe(false);
});
test("missing/invalid native context never falls back to caller or ambient tokens", async () => {
  for (const token of [undefined, "", " ", "x\ny", "x".repeat(16385)]) {
    native.context.mockReturnValue({ headers: token === undefined ? {} : { "x-vercel-oidc-token": token } });
    const response = await createRuntimePublicShort(env())(request({ "x-vercel-oidc-token": "caller" })); expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(native.get).not.toHaveBeenCalled();
});
test("late context/store/release drift cancels provider streams and cannot publish a success", async () => {
  for (const drift of ["context", "store", "release"] as const) {
    ready(); const config = env(); let cancelled = false;
    native.get.mockImplementation(async () => {
      if (drift === "context") native.context.mockReturnValue({}); else if (drift === "store") config.BLOB_STORE_ID = "store_other12345"; else config.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE = "false";
      return { statusCode: 200, stream: new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }) };
    });
    const response = await createRuntimePublicShort(config)(request()); expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store"); expect(cancelled).toBe(true);
  }
});
test("provider status/error/invalid stream remain generic no-store without leaking upstream headers or details", async () => {
  for (const result of [null, { statusCode: 304, stream: null }, { statusCode: 200, stream: null }, { statusCode: 200, stream: "not-stream" }]) {
    ready(); native.get.mockResolvedValue(result); const response = await createRuntimePublicShort(env())(request()); expect(response.status).toBe(503); expect(await response.text()).toBe(""); expect(response.headers.get("cache-control")).toBe("no-store");
  }
  ready(); native.get.mockRejectedValue(new Error("upstream details must never escape")); const response = await createRuntimePublicShort(env())(request()); expect(response.status).toBe(503); expect(await response.text()).toBe("");
});

test("actual Next route exports remain default-off without auth/DB/provider initialization", async () => {
  vi.stubEnv("REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE", undefined);
  expect(route.runtime).toBe("nodejs"); expect(route.dynamic).toBe("force-dynamic");
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
    const response = await route[method](new Request(publicOrigin + f.source.path, { method }));
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(native.get).not.toHaveBeenCalled(); expect(native.context).not.toHaveBeenCalled();
});
