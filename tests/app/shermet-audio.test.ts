import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createShermetAudio, runtimeShermetAudio } from "../../src/server/shermet-audio/service";
import { SHERMET_PILOT_RECORDINGS } from "../../src/server/shermet-audio/pilot-metadata";
import { createShermetPlayback } from "../../src/components/portal/workspace/study/shermet-playback";
import type { ReferenceAudioElement } from "../../src/lib/reference-audio/playback";

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "shermet-test-")); directories.push(dir);
  // Synthetic bytes only; no human recording is used by a repository test.
  const bytes = Buffer.from("synthetic recording bytes");
  const file = createHash("sha256").update(bytes).digest("hex") + ".mp3";
  const entry = { kind: "torah", ref: "Genesis 1:1", file };
  await writeFile(path.join(dir, file), bytes);
  const catalog = (recordings: unknown[]) => writeFile(path.join(dir, "catalog.json"), JSON.stringify({ version: 1, recordings }));
  await catalog([entry]);
  return { dir, bytes, entry, catalog, api: createShermetAudio(dir) };
}
const request = (ref: string) => new Request(`http://localhost/api/shermet-audio?${new URLSearchParams({ ref })}`);
describe("operator configured Shermet recordings", () => {
  it("limits public metadata to CRC and keeps local-only extras out of production and forks", async () => {
    const f = await fixture();
    // A local-only reference must stay outside the public pilot as it grows.
    const localRef = "Genesis 1:2";
    expect(SHERMET_PILOT_RECORDINGS.some(entry => String(entry.ref) === localRef)).toBe(false);
    await f.catalog([{ ...f.entry, ref: localRef }]);
    const local = { BETTER_AUTH_URL: "http://localhost:3000", NODE_ENV: "development", SHERMET_AUDIO_DIR: f.dir };
    expect((await (await runtimeShermetAudio(local).catalog(request(localRef))).json()).refs).toContain(localRef);
    for (const env of [{ ...local, BETTER_AUTH_URL: "https://other.example.test" }, { ...local, BETTER_AUTH_URL: "https://torah.centralreform.org", NODE_ENV: "production" }]) {
      expect((await (await runtimeShermetAudio(env).catalog(request(localRef))).json()).refs).toEqual([]);
    }
    const fork = runtimeShermetAudio({ BETTER_AUTH_URL: "https://other.example.test" });
    expect((await (await fork.catalog(new Request("http://localhost/catalog"))).json()).refs).toEqual([]);
  });
  it("discovers public entries without media fetch and pins public retrieval to its exact URL and digest", async () => {
    const calls: { url: string; options?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response("synthetic wrong bytes"); };
    const api = createShermetAudio(undefined, true, fetcher);
    const metadata = await (await api.catalog(new Request("http://localhost/catalog"))).json();
    expect(metadata.refs).toEqual(SHERMET_PILOT_RECORDINGS.map(entry => entry.ref)); expect(calls).toHaveLength(0);
    const entry = SHERMET_PILOT_RECORDINGS[0];
    expect((await api.audio(request(entry.ref))).status).toBe(404);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://images.shulcloud.com/14396/${entry.sourceId}.mp3`);
    expect(calls[0].options).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
    expect(calls[0].options?.headers).toBeUndefined();
    await api.audio(request("Genesis 1:2")); expect(calls).toHaveLength(1);
  });
  it("is absent without configuration and only serves a verified canonical verse", async () => {
    expect((await createShermetAudio(undefined).audio(request("Genesis 1:1"))).status).toBe(404);
    const f = await fixture();
    const audio = await f.api.audio(request("Genesis 1:1"));
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(f.bytes);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
    expect(audio.headers.get("cache-control")).toBe("no-store");
    expect(await (await f.api.catalog(request("Genesis 1:1"))).json()).toEqual({ refs: ["Genesis 1:1"] });
    for (const ref of ["Genesis 1:2", "Genesis 1:1-2", "../../catalog.json", "Genesis 1:999"]) expect((await f.api.audio(request(ref))).status).toBe(404);
  });
  it("rejects changed media, duplicate refs, traversal, and wrong corpus", async () => {
    const f = await fixture();
    for (const entries of [[{ ...f.entry, file: "../outside.mp3" }], [f.entry, f.entry], [{ ...f.entry, kind: "haftarah" }]]) {
      await f.catalog(entries); expect((await f.api.audio(request("Genesis 1:1"))).status).toBe(404);
    }
    await f.catalog([f.entry]); await writeFile(path.join(f.dir, f.entry.file), "changed");
    expect((await f.api.audio(request("Genesis 1:1"))).status).toBe(404);
    // Metadata remains listed; the media digest is checked on every playback.
    expect(await (await f.api.catalog(request("Genesis 1:1"))).json()).toEqual({ refs: ["Genesis 1:1"] });
  });
});
function fakeAudio() {
  const events = new Map<string, EventListenerOrEventListenerObject>();
  let plays = 0, pauses = 0;
  const audio = { src: "", preload: "", duration: 4, currentTime: 0, playbackRate: 1, preservesPitch: true,
    play: async () => { plays++; }, pause: () => { pauses++; }, load() {}, removeAttribute() { audio.src = ""; },
    addEventListener: (name: string, listener: EventListenerOrEventListenerObject) => { events.set(name, listener); },
    removeEventListener: (name: string) => { events.delete(name); },
  } as ReferenceAudioElement;
  return { audio, get plays() { return plays; }, get pauses() { return pauses; }, ended() { (events.get("ended") as EventListener)({} as Event); } };
}
describe("Shermet verse transport", () => {
  it("loops the selected verse, never supplies word timings, and suspends media", async () => {
    const f = fakeAudio(); let allowed = true;
    const player = createShermetPlayback({ verses: [{ ref: "Genesis 1:1" }, { ref: "Genesis 1:2" }], available: new Set(["Genesis 1:1"]), canContinue: () => allowed, audio: () => f.audio, onState() {}, onActiveWord(value) { expect(value).toBeNull(); } });
    await player.select(0);
    expect(player.state.playback.status).toBe("playing"); expect(player.state.playback.wordsReady).toBe(false);
    expect(f.audio.src).toContain("ref=Genesis+1%3A1");
    player.setRepeat(true); f.ended(); await Promise.resolve();
    expect(f.plays).toBe(2);
    await player.select(0, 0); expect(player.state.timingHeld).toBe(true); expect(f.plays).toBe(2);
    await player.select(1); expect(player.state.playback.status).toBe("unavailable"); expect(f.plays).toBe(2);
    await player.select(0); allowed = false; player.suspend();
    expect(f.audio.src).toBe(""); expect(f.pauses).toBeGreaterThan(0);
    await player.play(); expect(f.plays).toBe(3); player.dispose();
  });
  it("does not let a late play promise resume a replaced selection", async () => {
    const f = fakeAudio(); let resolve!: () => void;
    f.audio.play = () => new Promise<void>(done => { resolve = done; });
    const player = createShermetPlayback({ verses: [{ ref: "Genesis 1:1" }], available: new Set(["Genesis 1:1"]), canContinue: () => true, audio: () => f.audio, onState() {}, onActiveWord() {} });
    const pending = player.select(0); player.suspend(); resolve(); await pending;
    expect(player.state.playback.status).toBe("ready"); expect(player.state.suspended).toBe(true); expect(f.pauses).toBeGreaterThan(0);
  });
});

