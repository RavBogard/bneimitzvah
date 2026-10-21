import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { syntheticReferenceReview } from "../helpers/reference-review";
import { parseBatch, parseDetail, reviewApi, reviewPath, type Batch, type Entry } from "../../src/components/portal/workspace/reference-review/api";
import { PortalRequestError } from "../../src/components/portal/api";

const origin = "https://synthetic.invalid";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
  const f = syntheticReferenceReview();
  const batch: Batch = { id: f.batchId, manifestSha256: f.prepared.sha256, catalogSha256: f.plan.catalogSha256, generation: 1, entryCount: 1, expiresAt: new Date(Date.now() + 60000).toISOString(), studentReady: false, timing: "unavailable" };
  const entry = { ...f.prepared.manifest.entries[0], decision: null } as Entry;
  return { ...f, batch, entry };
}
function response(body: BodyInit, path: string, type: string, status = 200) {
  const result = new Response(body, { status, headers: { "content-type": type } }); Object.defineProperty(result, "url", { value: origin + path }); return result;
}
test("review projection rejects extra private metadata, released states and mismatched entry identities", () => {
  const f = fixture(), value = { ok: true, batch: f.batch, entries: [f.entry] };
  expect(parseDetail(value, f.batch.id).entries[0].text[0].readingText).toBe("א");
  for (const changed of [
    { ...value, sourceTitle: "PRIVATE_TITLE_CANARY" }, { ...value, batch: { ...f.batch, studentReady: true } },
    { ...value, batch: { ...f.batch, timing: "ready" } }, { ...value, entries: [{ ...f.entry, text: [{ ...f.entry.text[0], ref: "Genesis 1:2" }] }] },
    { ...value, entries: [{ ...f.entry, objectPath: "PRIVATE_PATH_CANARY" }] },
  ]) expect(() => parseDetail(changed, f.batch.id)).toThrow(PortalRequestError);
  expect(() => parseBatch({ ...f.batch, expiresAt: new Date(Date.now() - 1).toISOString() })).toThrow();
});
test("closed review paths reject query injection, private object paths and arbitrary provider URLs before fetch", () => {
  const f = fixture();
  expect(reviewPath(f.batch.id, "media", f.assetKey)).toBe(`/api/reference-review/batches/${f.batch.id}/media/${f.assetKey}`);
  for (const id of [f.batch.id + "?token=PRIVATE_CANARY", "https://synthetic.invalid", "../private"]) expect(() => reviewPath(id)).toThrow(PortalRequestError);
  expect(() => reviewPath(f.batch.id, "media", "reference-review/private.mp3")).toThrow(PortalRequestError);
});
test("private audio accepts only complete matching bytes through authenticated exact-origin fetch", async () => {
  const f = fixture(); vi.stubGlobal("location", { origin });
  const fetcher = vi.fn(async () => response(f.media, reviewPath(f.batch.id, "media", f.assetKey), "audio/mpeg")); vi.stubGlobal("fetch", fetcher);
  const blob = await reviewApi.audio(f.batch, f.entry, new AbortController().signal);
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(f.media);
  expect(fetcher.mock.calls[0]).toMatchObject([reviewPath(f.batch.id, "media", f.assetKey), { credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" }]);
});
test("private audio retains hash, overflow, content-type and endpoint errors instead of returning a playable blob", async () => {
  const f = fixture(); vi.stubGlobal("location", { origin }); const path = reviewPath(f.batch.id, "media", f.assetKey);
  for (const r of [response(new Uint8Array(f.media.length).fill(1), path, "audio/mpeg"), response(new Uint8Array(f.media.length + 1), path, "audio/mpeg"), response(f.media, path, "text/html"), response(f.media, path + "/other", "audio/mpeg")]) {
    vi.stubGlobal("fetch", vi.fn(async () => r)); await expect(reviewApi.audio(f.batch, f.entry, new AbortController().signal)).rejects.toBeInstanceOf(PortalRequestError);
  }
});
test("private media refuses expired or externally cancelled reads even when the server supplies valid bytes", async () => {
  const f = fixture(); vi.stubGlobal("location", { origin }); vi.useFakeTimers();
  const path = reviewPath(f.batch.id, "media", f.assetKey);
  vi.stubGlobal("fetch", vi.fn(async () => { vi.setSystemTime(Date.parse(f.batch.expiresAt) + 1); return response(f.media, path, "audio/mpeg"); }));
  await expect(reviewApi.audio(f.batch, f.entry, new AbortController().signal)).rejects.toBeInstanceOf(PortalRequestError);
  const controller = new AbortController(); controller.abort(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(reviewApi.audio(f.batch, f.entry, controller.signal)).rejects.toBeInstanceOf(PortalRequestError); expect(fetcher).not.toHaveBeenCalled();
});
test("authority denials stay explicit and no successful media fallback occurs", async () => {
  const f = fixture(); vi.stubGlobal("location", { origin });
  vi.stubGlobal("fetch", vi.fn(async () => response("{}", reviewPath(f.batch.id, "media", f.assetKey), "application/json", 403)));
  await expect(reviewApi.audio(f.batch, f.entry, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
});
