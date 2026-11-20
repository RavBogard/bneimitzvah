import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { HUMAN_TRACK_CACHE, hasSavedHumanTrack, removeSavedHumanTrack, saveHumanTrack } from "../../src/lib/reference-audio/human-track-offline";
import { offlineHumanTrackPath, type HumanTrack } from "../../src/lib/reference-audio/human-tracks";

const origin = "https://example.test";
const bytes = new Uint8Array([1, 2, 3, 4]);
const track: HumanTrack = { voice: "josh-finkel", kind: "torah", id: "synthetic", title: "Synthetic",
  bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const path = origin + offlineHumanTrackPath(track);
const signal = new AbortController().signal;

function installed(body: Uint8Array<ArrayBuffer>, contentLength?: string) {
  const entries = new Map<string, Response>();
  const key = (input: string) => new URL(input, origin).href;
  const cache = {
    keys: async () => [],
    match: async (request: string) => entries.get(key(request)),
    put: async (request: string, response: Response) => { entries.set(key(request), response); },
    delete: async (request: string) => entries.delete(key(request)),
  };
  vi.stubGlobal("location", { origin });
  vi.stubGlobal("navigator", { serviceWorker: { controller: {} } });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("caches", { has: async (name: string) => name === HUMAN_TRACK_CACHE, open: async () => cache });
  vi.stubGlobal("fetch", vi.fn(async () => {
    const headers = new Headers({ "content-type": "audio/mpeg" });
    if (contentLength !== undefined) headers.set("content-length", contentLength);
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }), { headers });
    Object.defineProperty(response, "url", { value: path });
    return response;
  }));
  return entries;
}

afterEach(() => vi.unstubAllGlobals());

test("a Chromium-style response without Content-Length saves only exact verified bytes, then can be removed", async () => {
  const entries = installed(bytes);
  await saveHumanTrack(track, signal);
  const result = entries.get(path);
  expect(result?.headers.get("content-length")).toBe(String(bytes.length));
  expect(new Uint8Array(await result!.arrayBuffer())).toEqual(bytes);
  expect(await hasSavedHumanTrack(track)).toBe(true);
  await removeSavedHumanTrack(track);
  expect(await hasSavedHumanTrack(track)).toBe(false);
});

test.each([
  [new Uint8Array([1, 2, 3]), undefined],
  [new Uint8Array([1, 2, 3, 4, 5]), undefined],
  [new Uint8Array([1, 2, 3, 9]), undefined],
  [bytes, "99"],
])("invalid length or digest leaves no offline recording", async (body, length) => {
  const entries = installed(body, length);
  await expect(saveHumanTrack(track, signal)).rejects.toThrow();
  expect(entries.size).toBe(0);
});
