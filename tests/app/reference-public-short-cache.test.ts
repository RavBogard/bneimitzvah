import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => ({ context: vi.fn<() => { headers?: Record<string, string> }>(() => ({})), get: vi.fn() }));
vi.mock("@vercel/oidc", () => ({ getContext: native.context }));
vi.mock("@vercel/blob", () => ({ get: native.get }));
import { createPublicShortHandler } from "../../src/server/reference-audio/public-short";
import { createRuntimePublicShort } from "../../src/server/reference-audio/runtime-short";
import { createRuntimeShortMetadata } from "../../src/server/reference-audio/runtime-short-metadata";
import { createShortSourceManifestLoader, shortSourceManifestMatches, type ShortSourceManifest } from "../../src/server/reference-audio/short-source-manifest";
import { publicShortFixture, publicOrigin, byteStream, sha } from "./reference-public-short-fixture";
type Fixture = ReturnType<typeof publicShortFixture>;
let sequence = 0;
function profile(f: Fixture, storeId = `store_cache${++sequence}synthetic`, origin = publicOrigin) {
  const env: Record<string, string | undefined> = { REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: "true", PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production",
    BETTER_AUTH_URL: origin, REFERENCE_AUDIO_CATALOG_SHA256: f.parentCatalogSHA256, REFERENCE_AUDIO_SHORT_MANIFEST_SHA256: f.manifestSHA256, BLOB_STORE_ID: storeId };
  const config = { origin, deployment: { environment: "production" as const, deployment: "production" }, referenceAudio: { storeId, catalogSha256: f.parentCatalogSHA256, studentRelease: false } };
  return { env, config };
}
function ready(f: Fixture) {
  native.context.mockReturnValue({ headers: { "x-vercel-oidc-token": "synthetic.native.context" } });
  native.get.mockImplementation(async (path: string) => ({ statusCode: 200, stream: byteStream(f.files.get(path)!) }));
}
const req = (f: Fixture, method = "GET", origin = publicOrigin, signal?: AbortSignal) => new Request(origin + f.source.path, { method, signal });
async function sealed(f: Fixture) { return createShortSourceManifestLoader({ sha256: f.manifestSHA256, parentCatalogSHA256: f.parentCatalogSHA256, parentCatalogBytes: f.parent, get: async () => byteStream(f.manifest) })(); }
function variant(parentChanged: boolean, manifestSpace = false) {
  const f = publicShortFixture(), parent = parentChanged ? new TextEncoder().encode(new TextDecoder().decode(f.parent) + " ") : f.parent;
  const parentCatalogSHA256 = sha(parent), row = JSON.parse(new TextDecoder().decode(f.manifest)); row.parentCatalogSHA256 = parentCatalogSHA256;
  const manifest = new TextEncoder().encode(JSON.stringify(row) + (manifestSpace ? " " : "")), manifestSHA256 = sha(manifest);
  const parentKey = `reference-audio/pockettorah/catalog/${parentCatalogSHA256}.json`, manifestKey = `reference-audio/short-v1/manifests/${manifestSHA256}.json`;
  return { ...f, parent, manifest, parentCatalogSHA256, manifestSHA256, parentKey, manifestKey, files: new Map([[parentKey, parent], [manifestKey, manifest], [f.bodyKey, f.body]]) };
}
afterEach(() => { vi.useRealTimers(); native.context.mockReset().mockReturnValue({}); native.get.mockReset(); });

test("genuine identity requires both exact configured pins, never receipt shape or coercion", async () => {
  const f = publicShortFixture(), manifest = await sealed(f), getter = vi.fn();
  expect(shortSourceManifestMatches(manifest, f.parentCatalogSHA256, f.manifestSHA256)).toBe(true);
  for (const forged of [{}, { ...manifest }, Object.defineProperty({}, "identity", { get: getter }), null, "manifest"]) expect(shortSourceManifestMatches(forged, f.parentCatalogSHA256, f.manifestSHA256)).toBe(false);
  expect(shortSourceManifestMatches(manifest, "a".repeat(64), f.manifestSHA256)).toBe(false);
  expect(shortSourceManifestMatches(manifest, f.parentCatalogSHA256, "b".repeat(64))).toBe(false);
  expect(shortSourceManifestMatches(manifest, { toString: getter }, f.manifestSHA256)).toBe(false); expect(getter).not.toHaveBeenCalled();
});

test("public callback rejects forged AND wrong-pin genuine manifests before lookup or any media get", async () => {
  const f = publicShortFixture(), otherManifest = await sealed(variant(false, true)), otherParent = await sealed(variant(true));
  for (const manifest of [{} as ShortSourceManifest, otherManifest, otherParent]) {
    const get = vi.fn(async () => byteStream(f.body)), handler = createPublicShortHandler({ ...f, get, loadManifest: async () => manifest });
    const response = await handler(req(f)); expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store"); expect(get).not.toHaveBeenCalled();
  }
  const genuine = await sealed(f), get = vi.fn(async () => byteStream(f.body));
  expect((await createPublicShortHandler({ ...f, get, loadManifest: async () => genuine })(req(f))).status).toBe(200); expect(get).toHaveBeenCalledOnce();
});

test("sequential runtime GET/HEAD reuse one metadata chain but read and fully verify every individual body", async () => {
  const f = publicShortFixture(), p = profile(f); ready(f);
  for (const method of ["GET", "HEAD", "GET"]) {
    const response = await createRuntimePublicShort(p.env)(req(f, method)); expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(f.body.length)); expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=31536000, immutable"); expect(response.headers.has("set-cookie")).toBe(false); expect(response.headers.has("vary")).toBe(false);
    const bytes = new Uint8Array(await response.arrayBuffer()); expect(method === "HEAD" ? bytes.length : sha(bytes)).toBe(method === "HEAD" ? 0 : f.hash);
  }
  expect(native.get.mock.calls.map(c => c[0])).toEqual([f.parentKey, f.manifestKey, f.bodyKey, f.bodyKey, f.bodyKey]);
  f.files.set(f.bodyKey, f.body.slice(0, -1)); const refused = await createRuntimePublicShort(p.env)(req(f, "HEAD")); expect(refused.status).toBe(503);
  expect(native.get.mock.calls.filter(c => c[0] === f.parentKey)).toHaveLength(1); expect(native.get.mock.calls.filter(c => c[0] === f.bodyKey)).toHaveLength(4);
});

test("assigned metadata and public media use exactly the same completed pair, without caching body receipts", async () => {
  const f = publicShortFixture(), p = profile(f); ready(f);
  const metadata = createRuntimeShortMetadata(p.config, p.env); await metadata.loadCatalog(); const manifest = await metadata.loadManifest();
  expect(shortSourceManifestMatches(manifest, f.parentCatalogSHA256, f.manifestSHA256)).toBe(true); expect(native.get).toHaveBeenCalledTimes(2);
  expect((await createRuntimePublicShort(p.env)(req(f))).status).toBe(200); expect(native.get).toHaveBeenCalledTimes(3); expect(native.get.mock.calls[2][0]).toBe(f.bodyKey);
  expect((await metadata.loadManifest())).toBe(manifest); expect(native.get).toHaveBeenCalledTimes(3);
});

test("store/origin/either SHA change requires a fresh genuine metadata chain", async () => {
  const f = publicShortFixture(), p = profile(f); ready(f); expect((await createRuntimePublicShort(p.env)(req(f))).status).toBe(200);
  const store = profile(f); expect((await createRuntimePublicShort(store.env)(req(f))).status).toBe(200);
  const origin = "https://bneimitzvah.centralreform.org", moved = profile(f, store.config.referenceAudio.storeId, origin);
  expect((await createRuntimePublicShort(moved.env)(req(f, "GET", origin))).status).toBe(200);
  for (const changed of [variant(false, true), variant(true)]) {
    ready(changed); const pin = profile(changed, moved.config.referenceAudio.storeId, origin);
    expect((await createRuntimePublicShort(pin.env)(req(changed, "GET", origin))).status).toBe(200);
  }
  expect(native.get).toHaveBeenCalledTimes(15); // five distinct keys, each parent+manifest+body.
});

test("unknown id uses cached metadata only; body failures and config/abort refusal cannot poison completed success", async () => {
  const f = publicShortFixture(), p = profile(f); ready(f); const handler = createRuntimePublicShort(p.env);
  expect((await handler(req(f))).status).toBe(200); const calls = native.get.mock.calls.length;
  expect((await handler(new Request(publicOrigin + `/reference-audio/short-v1/${"f".repeat(64)}.mp3`))).status).toBe(404); expect(native.get).toHaveBeenCalledTimes(calls);
  const abort = new AbortController(); abort.abort(); expect((await handler(req(f, "GET", publicOrigin, abort.signal))).status).toBe(503); expect(native.get).toHaveBeenCalledTimes(calls);
  native.get.mockRejectedValueOnce(new Error("synthetic body failure")); expect((await handler(req(f))).status).toBe(503); expect((await handler(req(f))).status).toBe(200);
  expect(native.get.mock.calls.filter(c => c[0] === f.parentKey)).toHaveLength(1);
  p.env.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE = "false"; const stopped = await handler(req(f)); expect(stopped.status).toBe(404); expect(stopped.headers.get("vercel-cdn-cache-control")).toBe("no-store");
});

test("failed metadata is retried and late cancelled metadata cannot erase another completed success", async () => {
  const f = publicShortFixture(), p = profile(f); ready(f); native.get.mockRejectedValueOnce(new Error("synthetic parent failure"));
  const handler = createRuntimePublicShort(p.env); expect((await handler(req(f))).status).toBe(503); expect((await handler(req(f))).status).toBe(200);
  const q = profile(f); let reject!: (reason: Error) => void;
  native.get.mockImplementationOnce(() => new Promise((_, no) => { reject = no; })); const controller = new AbortController();
  const old = createRuntimePublicShort(q.env)(req(f, "GET", publicOrigin, controller.signal)); await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
  expect((await createRuntimePublicShort(q.env)(req(f))).status).toBe(200); controller.abort(); expect((await old).status).toBe(503);
  reject(new Error("synthetic late parent failure")); await Promise.resolve(); const before = native.get.mock.calls.length;
  expect((await createRuntimePublicShort(q.env)(req(f))).status).toBe(200); expect(native.get).toHaveBeenCalledTimes(before + 1); expect(native.get.mock.calls.at(-1)?.[0]).toBe(f.bodyKey);
});
