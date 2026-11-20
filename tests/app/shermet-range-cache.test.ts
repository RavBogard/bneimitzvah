import { describe, expect, it, vi } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

vi.mock("../../src/server/shermet-audio/pilot-metadata", async () => {
  const { createHash } = await import("node:crypto");
  const contents = [Buffer.from("abc"), Buffer.alloc(17 * 1024 * 1024, 1), Buffer.alloc(17 * 1024 * 1024, 2)];
  return { SHERMET_PILOT_RECORDINGS: contents.map((bytes, index) => ({ kind: "torah", ref: `Exodus 35:${index + 1}`, sourceId: index + 1, sha256: createHash("sha256").update(bytes).digest("hex") })) };
});
import { createShermetAudio } from "../../src/server/shermet-audio/service";

function request(range?: string, method = "GET", verse = 1, extra: Record<string, string> = {}) {
  return new Request(`http://localhost/api/shermet-audio?ref=Exodus+35%3A${verse}`, { method, headers: { ...(range === undefined ? {} : { Range: range }), ...extra } });
}
describe("Shermet media ranges and verified public cache", () => {
  it("serves Safari probes, open and suffix ranges, full HEAD, and 416 without repeated public retrieval", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response("abc"); };
    // New per-request handlers still share the same process cache.
    const audio = (r: Request) => createShermetAudio(undefined, true, fetcher).audio(r);
    for (const [range, text, contentRange] of [["bytes=0-0", "a", "bytes 0-0/3"], ["bytes=1-", "bc", "bytes 1-2/3"], ["bytes=-2", "bc", "bytes 1-2/3"], ["bytes=1-99", "bc", "bytes 1-2/3"]]) {
      const response = await audio(request(range));
      expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe(contentRange);
      expect(response.headers.get("content-length")).toBe(String(text.length)); expect(await response.text()).toBe(text);
    }
    for (const range of ["bytes=3-", "bytes=2-1", "bytes=-0", "bytes=-", "bytes=0-0,2-2", "items=0-1", "bytes=9007199254740992-"]) {
      const response = await audio(request(range)); expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */3"); expect(await response.text()).toBe("");
    }
    const head = await audio(request("bytes=0-0", "HEAD"));
    expect(head.status).toBe(200); expect(head.headers.get("content-length")).toBe("3"); expect(await head.text()).toBe("");
    expect(head.headers.get("accept-ranges")).toBe("bytes"); expect(head.headers.get("cache-control")).toBe("no-store");
    const ifRange = await audio(request("bytes=0-0", "GET", 1, { "If-Range": '"unrecognized"' }));
    expect(ifRange.status).toBe(200); expect(await ifRange.text()).toBe("abc"); expect(calls).toBe(1);
  });
  it("coalesces concurrent retrievals and retries failures without caching rejected bytes", async () => {
    let calls = 0, release!: () => void;
    const fetcher: typeof fetch = async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return new Response(calls === 1 ? "wrong" : "abc"); };
    const audio = (r: Request) => createShermetAudio(undefined, true, fetcher).audio(r);
    let first = audio(request("bytes=0-0")), second = audio(request("bytes=1-"));
    // Local-catalog checks yield before the shared public fetch starts.
    await vi.waitFor(() => expect(calls).toBe(1)); release();
    expect((await first).status).toBe(404); expect((await second).status).toBe(404);
    first = audio(request("bytes=0-0")); second = audio(request("bytes=1-"));
    await vi.waitFor(() => expect(calls).toBe(2)); release();
    expect((await first).status).toBe(206); expect((await second).status).toBe(206);
    expect((await audio(request())).status).toBe(200); expect(calls).toBe(2);
  });
  it("evicts verified public bytes when the process cache would exceed 32 MiB", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async url => { calls++; const id = Number(String(url).match(/\/(\d+)\.mp3$/)![1]); return new Response(new Uint8Array(Buffer.alloc(17 * 1024 * 1024, id - 1))); };
    const api = createShermetAudio(undefined, true, fetcher);
    for (const verse of [2, 3, 2]) expect((await api.audio(request(undefined, "HEAD", verse))).status).toBe(200);
    expect(calls).toBe(3);
  });
  it("never caches local media bytes between requests", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shermet-local-cache-test-"));
    try {
      const sha256 = createHash("sha256").update("abc").digest("hex"), file = `${sha256}.mp3`;
      await writeFile(path.join(directory, "catalog.json"), JSON.stringify({ version: 1, recordings: [{ kind: "torah", ref: "Exodus 35:1", file }] }));
      await writeFile(path.join(directory, file), "abc");
      const api = createShermetAudio(directory);
      expect((await api.audio(request("bytes=0-0"))).status).toBe(206);
      await writeFile(path.join(directory, file), "changed");
      expect((await api.audio(request("bytes=0-0"))).status).toBe(404);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
