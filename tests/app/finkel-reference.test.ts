import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createFinkelReferenceService, resetFinkelManifestCache } from "../../src/server/reference-audio/finkel-service";
import { FINKEL_MANIFEST_SCHEMA, FinkelUnavailable, findFinkelClips, finkelAudioKey, finkelManifestKey, parseFinkelManifest } from "../../src/server/reference-audio/finkel-manifest";
import { handleFinkelReferenceRequest } from "../../src/server/http/finkel-reference";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { finkelCredit, finkelRangeLabel, parseFinkelClip, parseFinkelClips } from "../../src/lib/reference-audio/finkel";
import { FinkelPassagePlayer, finkelPageClips, finkelRanges } from "../../src/components/portal/workspace/study/finkel-player";
import { FlowingStudyText } from "../../src/components/portal/workspace/study/annotations";
import { explorationPage } from "./exploration-client-helper";
import { handlePortalRequest } from "../../src/server/http/portal";
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { finkelRequestMode } from "../../src/components/portal/workspace/study/finkel-api";
// The real off-repo builder output must satisfy the app's own parser.
import { buildFinkelManifest } from "../../scripts/finkel-reference-build.mjs";

// Synthetic clips only: invented asset keys and bytes, never real recordings.
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const media = [1, 2, 3].map(n => new TextEncoder().encode(`synthetic-finkel-mp3-${n}`));
const clip = (n: number, overrides: Record<string, unknown> = {}) => ({ asset: `fj_${String(n).repeat(20)}`, kind: "torah", mode: n === 2 ? "spoken" : "chant",
  verses: n === 3 ? ["Genesis 22:4"] : ["Genesis 22:1", "Genesis 22:2", "Genesis 22:3"], sha256: hash(media[n - 1]), bytes: media[n - 1].byteLength, durationSeconds: 10 + n, preferred: n !== 2, ...overrides });
const manifestBytes = (clips = [clip(1), clip(2), clip(3)]) => new TextEncoder().encode(JSON.stringify({ schema: FINKEL_MANIFEST_SCHEMA, clips }));
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
beforeEach(() => resetFinkelManifestCache());
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });

async function fixture(options: { release?: boolean; manifest?: Uint8Array; configured?: boolean } = {}) {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const bytes = options.manifest ?? manifestBytes(), pin = hash(bytes);
  const objects = new Map<string, Uint8Array>([[finkelManifestKey(pin), bytes], ...media.map(m => [finkelAudioKey(hash(m)), m] as [string, Uint8Array])]);
  const get = vi.fn(async (path: string) => {
    const body = objects.get(path); if (!body) throw new Error("absent");
    return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(body.slice()); c.close(); } });
  });
  const finkel = createFinkelReferenceService({ access: f.service, manifestSha256: options.configured === false ? undefined : pin, get, studentRelease: options.release === true });
  const call = (path: string, who: NonNullable<Parameters<typeof f.request>[1]>["who"] = "admin", headers: Record<string, string> = {}, origin?: string) =>
    handleFinkelReferenceRequest(f.request(path, { who, headers, origin }), finkel).then(r => r!);
  return { ...f, pin, objects, get, finkel, call };
}
const clipsPath = (mode: string, from = "Genesis 22:1", to = "Genesis 22:3") => `/api/reference-audio/finkel/clips?${new URLSearchParams({ mode, from, to })}`;
const mediaPath = (mode: string, n = 1) => `/api/reference-audio/finkel/media/${hash(media[n - 1])}.mp3?mode=${mode}`;

test("client and manifest contracts are closed, canonical and forward-only, and carry no timing", () => {
  expect(parseFinkelClip(clip(1))).toEqual(clip(1));
  for (const bad of [{ verses: ["Genesis 22:3", "Genesis 22:1"] }, { verses: ["Genesis 50:26", "Exodus 1:1"] }, { verses: ["Isaiah 1:1"] }, { verses: [] },
    { asset: "ra_" + "1".repeat(32) }, { bytes: 4 * 1024 * 1024 + 1 }, { durationSeconds: 0 }, { mode: "chant-drill" }, { kind: "megillah" }, { timing: [] }, { title: "x" }]) expect(parseFinkelClip(clip(1, bad))).toBeNull();
  expect(parseFinkelClip(clip(1, { kind: "haftarah", verses: ["Isaiah 40:27", "Isaiah 40:28"] }))).not.toBeNull();
  const bytes = manifestBytes(), parsed = parseFinkelManifest(bytes, hash(bytes));
  expect(parsed.clips).toHaveLength(3);
  expect(() => parseFinkelManifest(bytes, "a".repeat(64))).toThrow(FinkelUnavailable);
  for (const changed of [manifestBytes([clip(1), clip(1)]), manifestBytes([clip(1), clip(2, { sha256: hash(media[0]) })]), new TextEncoder().encode(JSON.stringify({ schema: "other", clips: [clip(1)] })),
    new TextEncoder().encode(JSON.stringify({ schema: FINKEL_MANIFEST_SCHEMA, clips: [clip(1)], extra: 1 }))]) expect(() => parseFinkelManifest(changed, hash(changed))).toThrow(FinkelUnavailable);
  expect(findFinkelClips(parsed, "Genesis 22:3", "Genesis 22:4").map(c => c.asset.slice(-1))).toEqual(["1", "2", "3"]);
  expect(findFinkelClips(parsed, "Genesis 22:5", "Genesis 22:9")).toEqual([]);
  expect(() => findFinkelClips(parsed, "Genesis 22:1", "Exodus 1:1")).toThrow(FinkelUnavailable);
  const built = buildFinkelManifest([clip(1), clip(3)]);
  expect(parseFinkelManifest(built.bytes, built.sha256).clips).toHaveLength(2);
  expect(parseFinkelClips({ schema: "finkel-clips/v1", source: "finkel", pin: "a".repeat(64), clips: [clip(1)] })?.clips).toHaveLength(1);
  expect(finkelCredit("chant")).toBe("Chanted by Cantor Josh Finkel"); expect(finkelCredit("spoken")).toBe("Read by Cantor Josh Finkel");
  expect(finkelRangeLabel(["Genesis 22:1", "Genesis 22:2", "Genesis 22:3"])).toBe("Genesis 22:1–3"); expect(finkelRangeLabel(["Genesis 21:34", "Genesis 22:1"])).toBe("Genesis 21:34–22:1");
});

test("page helpers ask once per book and show only clips that share a verse on the page, preferred chant first", () => {
  expect(finkelRanges(["Genesis 22:3", "Genesis 22:1", "Genesis 22:2"])).toEqual([{ from: "Genesis 22:1", to: "Genesis 22:3" }]);
  expect(finkelRanges(["Jeremiah 34:8", "Jeremiah 33:25"])).toEqual([{ from: "Jeremiah 33:25", to: "Jeremiah 34:8" }]);
  const parsed = [clip(2), clip(1), clip(3)].map(c => parseFinkelClip(c)!);
  expect(finkelPageClips(parsed, ["Genesis 22:1", "Genesis 22:2"]).map(c => c.asset.slice(-1))).toEqual(["1", "2"]);
  expect(finkelRequestMode("child-practice")).toBe("parent"); expect(finkelRequestMode("admin")).toBe("admin"); expect(finkelRequestMode("other")).toBeNull();
});

test("before student release only a live admin grant in admin mode lists or hears clips; every other role is denied before any provider read", async () => {
  const f = await fixture();
  const list = await f.call(clipsPath("admin"));
  expect(list.status).toBe(200); expect(list.headers.get("cache-control")).toBe("private, no-store");
  const body = await list.json();
  expect(body).toMatchObject({ schema: "finkel-clips/v1", source: "finkel", pin: f.pin });
  expect(body.clips.map((c: { asset: string }) => c.asset.slice(-1))).toEqual(["1", "2"]);
  for (const word of ["reference-review/", "blob", "title", "label", "JF-"]) expect(JSON.stringify(body)).not.toContain(word);
  const audio = await f.call(mediaPath("admin", 2));
  expect(audio.status).toBe(200); expect(audio.headers.get("content-type")).toBe("audio/mpeg"); expect(audio.headers.get("cache-control")).toBe("private, no-store");
  expect(audio.headers.get("accept-ranges")).toBe("none"); expect(new Uint8Array(await audio.arrayBuffer())).toEqual(media[1]);
  resetFinkelManifestCache(); f.get.mockClear();
  // Non-admin modes are refused before authentication, database or storage work; a non-admin
  // asking for admin mode fails the live grant check; signed-out admin mode is 401.
  for (const [who, mode, expected] of [["learner", "student", 404], ["multi", "parent", 404], ["multi", "tutor", 404], ["anonymous", "student", 404],
    ["admin", "student", 404], ["learner", "admin", 404], ["multi", "admin", 404], ["anonymous", "admin", 401]] as const) {
    for (const path of [clipsPath(mode), mediaPath(mode)]) expect([who, mode, (await f.call(path, who)).status]).toEqual([who, mode, expected]);
  }
  expect(f.get).not.toHaveBeenCalled();
  // A practice-context header never reaches this route.
  expect((await f.call(mediaPath("admin"), "admin", { "X-Practice-Context": "a".repeat(43) })).status).toBe(403);
});

test("after the shared student release students, parents and tutors hear only the chosen takes; held configuration still denies", async () => {
  const f = await fixture({ release: true });
  for (const [who, mode] of [["learner", "student"], ["multi", "parent"], ["multi", "tutor"]] as const) {
    const list = await (await f.call(clipsPath(mode), who)).json();
    expect(list.clips.map((c: { asset: string }) => c.asset.slice(-1))).toEqual(["1"]);
    expect((await f.call(mediaPath(mode, 1), who)).status).toBe(200);
    expect((await f.call(mediaPath(mode, 2), who)).status).toBe(404); // other takes stay for the admin's review
  }
  expect((await f.call(clipsPath("student"), "multi")).status).toBe(404); // no student grant
  expect((await f.call(`/api/reference-audio/finkel/clips?mode=student`, "learner")).status).toBe(404); // full list is admin-only
  expect((await f.call(`/api/reference-audio/finkel/clips?mode=admin`, "admin")).status).toBe(200);
  const unconfigured = await fixture({ release: true, configured: false });
  expect((await unconfigured.call(clipsPath("admin"))).status).toBe(404); expect((await unconfigured.call(mediaPath("student"), "learner")).status).toBe(404);
  expect(unconfigured.get).not.toHaveBeenCalled();
});

test("another congregation is never served, even to a member with a matching role there", async () => {
  const f = await fixture({ release: true });
  const response = await f.call(clipsPath("student"), "multi", {}, "http://localhost:3101");
  expect([403, 404]).toContain(response.status);
});

test("bytes are verified whole before return and authority is checked again after provider work", async () => {
  const f = await fixture();
  f.objects.set(finkelAudioKey(hash(media[0])), new TextEncoder().encode("synthetic-finkel-mp3-X"));
  expect((await f.call(mediaPath("admin", 1))).status).toBe(503);
  f.objects.set(finkelAudioKey(hash(media[0])), media[0]);
  expect((await f.call(`/api/reference-audio/finkel/media/${"e".repeat(64)}.mp3?mode=admin`)).status).toBe(404);
  // Revoked between the two passes.
  f.get.mockImplementationOnce(async path => {
    await f.owner(() => f.db.update(s.roleGrant).set({ revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)));
    const body = f.objects.get(path)!; return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(body.slice()); c.close(); } });
  });
  expect((await f.call(mediaPath("admin", 3))).status).toBe(404);
  // Malformed requests and methods.
  expect((await f.call(`${mediaPath("admin")}&extra=1`)).status).toBe(400);
  expect((await f.call(mediaPath("admin"), "admin", { range: "bytes=0-1" })).status).toBe(400);
  expect((await f.call(`/api/reference-audio/finkel/clips?mode=admin&from=Genesis%2022%3A1`)).status).toBe(400);
  expect((await f.call(clipsPath("admin", "Genesis 22:1", "Exodus 1:1"))).status).toBe(404);
  const post = await handleFinkelReferenceRequest(f.request(mediaPath("admin"), { who: "admin", method: "POST", body: {} }), f.finkel);
  expect(post?.status).toBe(405);
});

test("the dispatcher owns both routes and runtime configuration pins the manifest in the existing private store", async () => {
  const f = await fixture();
  const runtime = { finkelReference: f.finkel, referenceReview: f.runtime.referenceReview, resolveHost: async () => undefined } as unknown as HttpRuntime;
  const dispatch = createHttpDispatcher(async action => action(runtime));
  const response = await dispatch(f.request(clipsPath("admin"), { who: "admin" }));
  expect(response.status).toBe(200);
  expect((await dispatch(new Request(`http://localhost:3000${mediaPath("admin")}`, { method: "DELETE" }))).status).toBe(405);
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login"; database.password = randomBytes(24).toString("hex"); database.searchParams.set("sslmode", "require");
  const base = { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-review", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
  expect(loadRuntimeConfig(base).referenceFinkel).toBeUndefined();
  expect(loadRuntimeConfig({ ...base, REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256: "a".repeat(64), BLOB_STORE_ID: "store_Synthetic123" }).referenceFinkel)
    .toEqual({ manifestSha256: "a".repeat(64), storeId: "store_Synthetic123", studentRelease: false });
  expect(loadRuntimeConfig({ ...base, REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256: "a".repeat(64), BLOB_STORE_ID: "store_Synthetic123", REFERENCE_AUDIO_FINKEL_STUDENT_RELEASE: "true" }).referenceFinkel?.studentRelease).toBe(true);
  expect(() => loadRuntimeConfig({ ...base, REFERENCE_AUDIO_FINKEL_STUDENT_RELEASE: "true" })).toThrow();
  expect(() => loadRuntimeConfig({ ...base, REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256: "a".repeat(64), BLOB_STORE_ID: "store_Synthetic123", REFERENCE_AUDIO_FINKEL_STUDENT_RELEASE: "yes" })).toThrow();
  for (const bad of [{ REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256: "A".repeat(64), BLOB_STORE_ID: "store_Synthetic123" }, { REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256: "a".repeat(64) },
    { REFERENCE_AUDIO_FINKEL_MANIFEST_SHA256: "a".repeat(64), BLOB_STORE_ID: "store_Synthetic123", VERCEL_BLOB_API_URL: "https://example.test" }]) expect(() => loadRuntimeConfig({ ...base, ...bad })).toThrow();
});

test("the reading response advertises Finkel only when configured and the same release rule allows this mode", async () => {
  const f = await fixture();
  const portal = async (who: "admin" | "learner", mode: string) => (await handlePortalRequest(f.request(`/api/students/${f.students[0].id}/reading?mode=${mode}`, { who }), f.runtime))!.json();
  expect(await portal("admin", "admin")).not.toHaveProperty("finkelListeningEnabled"); // the shared fixture leaves Finkel unconfigured
  const shortService = (release: boolean) => createShortReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: async () => { throw new Error("unused"); },
    loadCatalog: async () => { throw new Error("unused"); }, loadManifest: async () => { throw new Error("unused"); }, studentRelease: release });
  Object.assign(f.runtime, { finkelReference: f.finkel, shortReferenceAudio: shortService(false) });
  expect(await portal("admin", "admin")).toMatchObject({ referenceListeningEnabled: true, finkelListeningEnabled: true });
  expect(await portal("learner", "student")).not.toHaveProperty("finkelListeningEnabled");
  const released = createFinkelReferenceService({ access: f.service, manifestSha256: f.pin, get: f.get, studentRelease: true });
  Object.assign(f.runtime, { finkelReference: released, shortReferenceAudio: shortService(true) });
  expect(await portal("learner", "student")).toMatchObject({ referenceListeningEnabled: true, finkelListeningEnabled: true });
});

test("flowing text marks the verses of a playing passage without touching word indices", () => {
  const verses = explorationPage().verses.slice(0, 3);
  const props = { verses, assignment: { kind: "torah" as const, confirmed: false, verses: [] }, group: "finkel", activeWord: null };
  const plain = renderToStaticMarkup(createElement(FlowingStudyText, props));
  const marked = renderToStaticMarkup(createElement(FlowingStudyText, { ...props, playingVerses: new Set([verses[1].ref]) }));
  expect(plain).not.toContain("data-playing"); expect(marked.match(/data-playing="true"/g)).toHaveLength(1);
  expect(marked.replace(/ data-playing="true"/g, "")).toBe(plain);
  // The player itself renders nothing until an authorized clip list arrives.
  expect(renderToStaticMarkup(createElement(FinkelPassagePlayer, { scopeKey: "s", refs: verses.map(v => v.ref), mode: "admin", active: true }))).toBe("");
});
