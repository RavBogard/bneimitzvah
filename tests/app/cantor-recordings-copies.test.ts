import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { NextRequest } from "next/server";
import { CRC_IDENTITY, cantorRecordingsEnabled, resolveIdentity } from "../../src/lib/site/identity";
import { IdentityProvider } from "../../src/components/site/identity-context";
import { RecordingCollections } from "../../src/components/shermet-library/collections";
import { runtimeShermetAudio } from "../../src/server/shermet-audio/service";
import { runtimeShermetLibrary } from "../../src/server/shermet-audio/library";
import { SHERMET_PILOT_RECORDINGS } from "../../src/server/shermet-audio/pilot-metadata";
import { getPublishedShermetTiming } from "../../src/server/shermet-audio/timing-catalog";
import { runtimeHumanTrack } from "../../src/server/human-tracks/runtime-media";
import { HUMAN_TRACKS, availableHumanTracks, humanTracksForVerses } from "../../src/lib/reference-audio/human-tracks";
import { proxy } from "../../src/proxy";

// Daniel 2026-11-23: another congregation's own copy plays the cantor recordings that stream from their publishers (Shermet, Karaite).
// Cantor Finkel's tracks stay in CRC's private store, so a copy never lists, offers, counts or serves them. No network: fetch is stubbed.
const FORK = "https://bneimitzvah.example.org";
const fork = { BETTER_AUTH_URL: FORK, CANONICAL_ORIGIN: FORK, CONGREGATION_NAME: "Example Congregation", PORTAL_ENVIRONMENT: "production", NODE_ENV: "production" };
const forkOff = { ...fork, CANTOR_RECORDINGS: "false" };
const crc = { BETTER_AUTH_URL: "https://torah.centralreform.org", NODE_ENV: "production" };
const finkel = HUMAN_TRACKS.find(track => track.voice === "josh-finkel")!;
const karaite = HUMAN_TRACKS.find(track => track.voice === "rotem-cohen")!;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("the cantor-recordings switch", () => {
  it("is always on for CRC, on by default for a copy, and off only for exactly \"false\"", () => {
    expect(CRC_IDENTITY.cantorRecordings).toBe(true);
    expect(cantorRecordingsEnabled({ ...crc, CANTOR_RECORDINGS: "false" })).toBe(true);
    expect(cantorRecordingsEnabled(fork)).toBe(true);
    for (const value of ["FALSE", "0", "no", "off", ""]) expect(cantorRecordingsEnabled({ ...fork, CANTOR_RECORDINGS: value })).toBe(true);
    expect(cantorRecordingsEnabled(forkOff)).toBe(false);
    expect(resolveIdentity(fork)).toMatchObject({ crc: false, cantorRecordings: true });
    expect(resolveIdentity(forkOff)).toMatchObject({ crc: false, cantorRecordings: false });
  });
});

describe("Shermet verse audio, timing and library on a copy", () => {
  it("verse audio lists the published recordings and reaches their source on a copy; refuses with the switch off", async () => {
    const refs = SHERMET_PILOT_RECORDINGS.map(entry => entry.ref);
    expect((await (await runtimeShermetAudio(fork).catalog(new Request(`${FORK}/api/shermet-audio/catalog`))).json()).refs).toEqual(refs);
    expect((await (await runtimeShermetAudio(forkOff).catalog(new Request(`${FORK}/api/shermet-audio/catalog`))).json()).refs).toEqual([]);
    const manifest = await (await runtimeShermetAudio(fork).catalog(new Request(`${FORK}/api/shermet-audio/catalog?format=manifest`))).json();
    expect(manifest.recordings.length).toBeGreaterThan(0);
    const calls: string[] = [];
    // Synthetic bytes never match the pinned digest, so the answer is 404 either way: what differs is whether the source is reached.
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => { calls.push(String(url)); return new Response("synthetic"); }));
    const ask = (env: Record<string, string>) => runtimeShermetAudio(env).audio(new Request(`${FORK}/api/shermet-audio?${new URLSearchParams({ ref: refs[0] })}`));
    expect((await ask(forkOff)).status).toBe(404);
    expect(calls).toHaveLength(0);
    await ask(fork);
    expect(calls).toEqual([`https://images.shulcloud.com/14396/${SHERMET_PILOT_RECORDINGS[0].sourceId}.mp3`]);
  });

  it("timing answers on a copy and refuses with the switch off", async () => {
    let ref: string | undefined;
    for (const entry of SHERMET_PILOT_RECORDINGS) if (await getPublishedShermetTiming(entry.ref)) { ref = entry.ref; break; }
    expect(ref).toBeDefined();
    const ask = async (env: Record<string, string>) => {
      vi.unstubAllEnvs(); for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      vi.resetModules();
      const { GET } = await import("../../src/app/api/shermet-audio/timing/route");
      return (await (await GET(new Request(`${FORK}/api/shermet-audio/timing?${new URLSearchParams({ ref: ref! })}`))).json()).timing;
    };
    expect(await ask(fork)).not.toBeNull();
    expect(await ask(forkOff)).toBeNull();
    expect(await ask(crc)).not.toBeNull();
  });

  it("the recordings library and its media answer on a copy and refuse with the switch off", async () => {
    const request = (query: string) => new Request(`${FORK}/api/shermet-library${query}`);
    expect(runtimeShermetLibrary(forkOff).catalog(request("")).status).toBe(404);
    const answer = runtimeShermetLibrary(fork).catalog(request("?course=service"));
    expect(answer.status).toBe(200);
    const items = (await answer.json()).items as { id: string; status: string; recordings: { sha256: string }[] }[];
    const item = items.find(entry => entry.status === "available" && entry.recordings.length)!;
    expect(item).toBeDefined();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => { calls.push(String(url)); return new Response("synthetic"); }));
    const media = `?${new URLSearchParams({ id: item.id, recording: item.recordings[0].sha256 })}`;
    expect((await runtimeShermetLibrary(forkOff).media(new Request(`${FORK}/api/shermet-library/media${media}`))).status).toBe(404);
    expect(calls).toHaveLength(0);
    await runtimeShermetLibrary(fork).media(new Request(`${FORK}/api/shermet-library/media${media}`));
    expect(calls).toHaveLength(1);
  });
});

describe("the cantors' collections", () => {
  it("serves Karaite tracks on a copy, never Finkel's, and both on CRC", () => {
    expect(finkel).toBeDefined(); expect(karaite).toBeDefined();
    expect(runtimeHumanTrack(karaite.id, fork)).toBe(karaite);
    expect(runtimeHumanTrack(finkel.id, fork)).toBeUndefined();
    expect(runtimeHumanTrack(karaite.id, forkOff)).toBeUndefined();
    expect(runtimeHumanTrack(finkel.id, forkOff)).toBeUndefined();
    expect(runtimeHumanTrack(karaite.id, crc)).toBe(karaite);
    expect(runtimeHumanTrack(finkel.id, crc)).toBe(finkel);
    expect(runtimeHumanTrack(finkel.id, { ...crc, CANTOR_RECORDINGS: "false" })).toBe(finkel);
  });

  it("never lists, offers or counts Finkel on a copy", () => {
    const voices = (place: { crc: boolean; cantorRecordings: boolean }) => new Set(availableHumanTracks(place).map(track => track.voice));
    expect(voices(resolveIdentity(fork))).toEqual(new Set(["rotem-cohen"]));
    expect(voices(resolveIdentity(forkOff))).toEqual(new Set());
    expect(voices(CRC_IDENTITY)).toEqual(new Set(["rotem-cohen", "josh-finkel"]));
    // A reader's matches come only from the available list.
    const verses = (finkel.passages ?? []).map(passage => `${passage.book} ${passage.startChapter}:${passage.startVerse}`);
    expect(humanTracksForVerses(verses, availableHumanTracks(resolveIdentity(fork))).some(track => track.voice === "josh-finkel")).toBe(false);
    const render = (identity: ReturnType<typeof resolveIdentity>) =>
      renderToStaticMarkup(createElement(IdentityProvider, { identity, children: createElement(RecordingCollections, { initialCategory: "" }) }));
    const copy = render(resolveIdentity(fork));
    expect(copy).toContain('value="shermet"');
    expect(copy).toContain('value="rotem-cohen"');
    expect(copy).not.toContain('value="josh-finkel"');
    expect(render(CRC_IDENTITY)).toContain('value="josh-finkel"');
  });
});

describe("what stays CRC only", () => {
  it("the brand art still 404s on a copy that plays the recordings", () => {
    for (const [key, value] of Object.entries(fork)) vi.stubEnv(key, value);
    expect(resolveIdentity().cantorRecordings).toBe(true);
    expect(proxy(new NextRequest(`${FORK}/brand/mural-512.png`)).status).toBe(404);
  });
  it("the siddur, guide and service-plan lesson links still follow the CRC identity", () => {
    // A source guard: these gates are about CRC itself, not the recordings, and must not move to the new switch.
    const reading = readFileSync("src/components/portal/workspace/reading.tsx", "utf8");
    expect(reading).toMatch(/identity\.crc && authorizedReading && <p className="field-help"><a href=\{links\.siddurUrl\}/);
    expect(reading).toMatch(/const guideLink = !identity\.crc \? null/);
    expect(readFileSync("src/components/portal/workspace/service-learning/panel.tsx", "utf8")).toContain("if (!identity.crc || plan.needsReview) return null;");
  });
});
