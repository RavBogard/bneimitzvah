import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => ({ token: "synthetic.review.native", get: vi.fn() }));
vi.mock("@vercel/oidc", () => ({ getContext: () => ({ headers: { "x-vercel-oidc-token": native.token } }) }));
vi.mock("@vercel/blob", () => ({ get: native.get }));
import { createPrivateReviewGet } from "../../src/server/reference-review/private-blob";
import { ReviewUnavailable } from "../../src/server/reference-review/batch-contract";
import { reviewManifestPath } from "../../src/server/reference-review/batch-storage";

afterEach(() => { vi.unstubAllEnvs(); native.get.mockReset(); native.token = "synthetic.review.native"; });
test("private review get pins the existing store/native request context and never uses static credentials or cache", async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "synthetic.ignored"); vi.stubEnv("VERCEL_OIDC_TOKEN", "synthetic.ignored");
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.close(); } }); native.get.mockResolvedValue({ statusCode: 200, stream });
  const path = reviewManifestPath("a".repeat(64)), signal = new AbortController().signal;
  expect(await createPrivateReviewGet({ storeId: "store_synthetic123" })(path, { signal })).toBe(stream);
  expect(native.get).toHaveBeenCalledWith(path, { storeId: "store_synthetic123", access: "private", oidcToken: native.token, abortSignal: signal, useCache: false });
});
test("unowned paths, endpoint overrides, invalid context, abort and context drift fail closed with stream cleanup", async () => {
  const get = createPrivateReviewGet({ storeId: "store_synthetic123" }), signal = new AbortController().signal, path = reviewManifestPath("a".repeat(64));
  for (const invalid of ["https://private.invalid/object", "reference-audio/short-v1/example.mp3", path + "?token=synthetic"]) await expect(get(invalid, { signal })).rejects.toThrow(ReviewUnavailable);
  vi.stubEnv("VERCEL_BLOB_API_URL", "https://override.invalid"); await expect(get(path, { signal })).rejects.toThrow(ReviewUnavailable); vi.unstubAllEnvs();
  native.token = ""; await expect(get(path, { signal })).rejects.toThrow(ReviewUnavailable); native.token = "synthetic.review.native";
  const controller = new AbortController(); controller.abort(); await expect(get(path, { signal: controller.signal })).rejects.toThrow(ReviewUnavailable); expect(native.get).not.toHaveBeenCalled();
  const cancel = vi.fn(), stream = new ReadableStream<Uint8Array>({ cancel }); native.get.mockImplementation(async () => { native.token = "synthetic.changed.context"; return { statusCode: 200, stream }; });
  await expect(get(path, { signal })).rejects.toThrow(ReviewUnavailable); expect(cancel).toHaveBeenCalledOnce();
});
