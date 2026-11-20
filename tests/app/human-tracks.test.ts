import { describe, expect, it, vi } from "vitest";
import { createHumanTrackMedia, publishedKaraiteMedia } from "../../src/server/human-tracks/media";
import { HUMAN_TRACKS, humanTrackCoverage, humanTrackCut, humanTracksForVerses, karaiteTrackSource, offlineHumanTrackAvailable, offlineHumanTrackPath, type HumanTrack } from "../../src/lib/reference-audio/human-tracks";

const digest = "a".repeat(64);
const track: HumanTrack = {
  id: "example-haftarah", voice: "rotem-cohen", title: "Example haftarah", kind: "haftarah",
  streamUrl: "https://karaites.org/uploads/7/4/1/3/7413835/test.mp3", sha256: digest, bytes: 8,
  portions: ["mishpatim"], passages: [{ book: "Jeremiah", startChapter: 34, startVerse: 8, endChapter: 34, endVerse: 22 }],
};
const request = (query = "", init?: RequestInit) => new Request("https://example.test/api/human-tracks/example-haftarah" + query, init);

describe("public recorded collections", () => {
  it("uses the recording's own verse coverage, including gaps and different haftarah boundaries", () => {
    const noCoverage = { ...track, id: "unknown-haftarah", passages: [] };
    expect(humanTrackCoverage(track)).toBe("Jeremiah 34:8-22");
    expect(humanTracksForVerses(["Jeremiah 33:25", "Jeremiah 34:7"], [track, noCoverage])).toEqual([]);
    expect(humanTracksForVerses(["Jeremiah 34:8"], [track, noCoverage])).toEqual([track]);
    expect(humanTrackCut(track, "Jeremiah 34:8")).toBeNull();
    const cut = { book: "Jeremiah", chapter: 34, verse: 8, startSec: 3, endSec: 7 };
    const timed = { ...track, verseCuts: [cut] };
    expect(humanTrackCut(timed, "Jeremiah 34:8")).toEqual(cut);
    expect(humanTrackCut(timed, "Jeremiah 34:9")).toBeNull();
  });
  it("keeps packaged entries unique and binds offline copies to their current digest", () => {
    expect(new Set(HUMAN_TRACKS.map(item => item.id)).size).toBe(HUMAN_TRACKS.length);
    expect(offlineHumanTrackAvailable(track)).toBe(true);
    expect(offlineHumanTrackPath(track)).toBe("/api/human-tracks/example-haftarah?copy=" + digest);
  });
  it("rejects unrecognized sources and never follows an upstream redirect", async () => {
    expect(karaiteTrackSource(track.streamUrl)).toBe(track.streamUrl);
    for (const url of [
      "https://karaites.org.evil.test/uploads/7/4/1/3/7413835/test.mp3",
      "https://karaites.org:1234/uploads/7/4/1/3/7413835/test.mp3",
      "https://www.karaites.org/uploads/7/4/1/3/7413835/test.mp3",
      "https://karaites.org/uploads/7/4/1/3/7413835/test.mp3?redirect=https://example.test",
      "https://karaites.org/private/test.mp3",
    ]) expect(karaiteTrackSource(url)).toBeNull();
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.test" } }));
    expect(await publishedKaraiteMedia(track, { range: "bytes=0-3", head: false, signal: new AbortController().signal }, fetch)).toBeNull();
    expect(fetch).toHaveBeenCalledWith(track.streamUrl, expect.objectContaining({ redirect: "error", credentials: "omit", headers: { Range: "bytes=0-3" } }));
  });
  it("serves only public catalog IDs on CRC, with exact queries and verified range metadata", async () => {
    const upstream = vi.fn(async () => {
      const body = new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "audio/mpeg", "content-length": "4", "content-range": "bytes 0-3/8", location: "https://example.test", "set-cookie": "hidden" },
      });
      return { body: body.body, headers: body.headers };
    });
    const lookup = (id: string) => id === track.id ? track : undefined;
    const serve = createHumanTrackMedia({ enabled: true, track: lookup, upstream });
    expect((await createHumanTrackMedia({ enabled: false, track: lookup, upstream })(request(), track.id)).status).toBe(404);
    expect((await serve(request(), "other-track")).status).toBe(404);
    expect((await serve(request("?source=https://example.test"), track.id)).status).toBe(404);
    expect((await serve(request("", { headers: { range: "bytes=0-3,6-7" } }), track.id)).status).toBe(416);
    expect((await serve(request("", { headers: { range: "bytes=8-" } }), track.id)).status).toBe(416);
    expect(upstream).not.toHaveBeenCalled();
    expect((await serve(request("", { headers: { range: "bytes=2-5" } }), track.id)).status).toBe(404);
    const clip = await serve(request("?copy=" + digest, { headers: { range: "bytes=0-3" } }), track.id);
    expect(clip.status).toBe(206);
    expect(clip.headers.get("content-range")).toBe("bytes 0-3/8");
    expect(clip.headers.get("set-cookie")).toBeNull();
    expect(clip.headers.get("location")).toBeNull();
    expect([...new Uint8Array(await clip.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });
});
