import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { planShortSourceBuild } from "../../src/server/reference-audio/short-source-build";
import { createShortSourceManifestLoader, lookupShortSource, readShortSourceEntry, SHORT_BODY_VERIFICATION_REQUIRED } from "../../src/server/reference-audio/short-source-manifest";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex"), bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const asset = "ra_" + "1".repeat(32), parentSHA = "a".repeat(64);
const clips = [{ start: 1.00002, end: 3.00001 }, { start: 4, end: 6 }];
function parent() { return { schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-1.mp3", sha256: parentSHA, bytes: 7,
  verses: clips.map((clip, i) => ({ schema: "reference-verse/v1", ref: `Genesis 1:${i + 1}`, table: "torah", playback: { status: "ready", asset, clip },
    words: { status: "unavailable", reason: "no-words" }, attribution: REFERENCE_ATTRIBUTION })) }] }; }
function fact(index = 0) { const clip = { ...clips[index] }; return { parentAsset: asset, parentSHA256: parentSHA, parentBytes: 7, sampleRate: 44100, channels: 2, parentFrames: 264600, clip,
  encoded: { sha256: (index ? "c" : "b").repeat(64), bytes: 17000, codec: "mp3", bitrate: 64000, sampleRate: 44100, channels: 2,
    presentationFrames: Math.ceil(clip.end * 44100) - Math.floor(clip.start * 44100), recipe: SHORT_SOURCE_RECIPE } }; }
function input(facts: unknown = [fact()], raw = parent()) { const parentCatalogBytes = bytes(raw); return { parentCatalogBytes, parentCatalogSHA256: sha(parentCatalogBytes), facts }; }

test("pure planning uses real pinned manifest acceptance and fixed public attribution without claiming encoded verification", async () => {
  const args = input(), plan = await planShortSourceBuild(args); expect(plan.status).toBe("planned"); if (plan.status !== "planned") throw Error("Synthetic plan refused");
  expect(plan.bodyVerification).toBe("unverified-caller-facts"); expect(Object.isFrozen(plan)).toBe(true);
  const body = new TextEncoder().encode(plan.manifestJSON); expect(sha(body)).toBe(plan.manifestSHA256);
  const raw = JSON.parse(plan.manifestJSON); expect(raw.attribution).toEqual(SHORT_SOURCE_ATTRIBUTION); expect(raw.recipe).toBe(SHORT_SOURCE_RECIPE);
  expect(raw.entries[0].origin).toEqual({ firstFrame: 44100, parentRate: 44100 }); expect(raw.entries[0].presentationFrames).toBe(88201);
  for (const privateKey of ["clip", "ref", "words", "parentFrames", "canonicalPCM16", "studentId"]) expect(raw.entries[0]).not.toHaveProperty(privateKey);
  const load = createShortSourceManifestLoader({ sha256: plan.manifestSHA256, parentCatalogSHA256: args.parentCatalogSHA256, parentCatalogBytes: args.parentCatalogBytes,
    get: async () => new ReadableStream({ start(c) { c.enqueue(body); c.close(); } }) });
  const receipt = lookupShortSource(await load(), `rs_${"b".repeat(64)}`)!;
  expect(readShortSourceEntry(receipt).requiredBodyVerification).toBe(SHORT_BODY_VERIFICATION_REQUIRED);
});

test("ordering and exact bytes are deterministic; input mutation cannot rewrite an already captured plan", async () => {
  const first = await planShortSourceBuild(input([fact(1), fact()])), second = await planShortSourceBuild(input([fact(), fact(1)]));
  expect(first).toEqual(second); if (first.status !== "planned") throw Error("Synthetic plan refused");
  expect(JSON.parse(first.manifestJSON).entries.map((row: { id: string }) => row.id)).toEqual([`rs_${"b".repeat(64)}`, `rs_${"c".repeat(64)}`]);
  const args = input(), pending = planShortSourceBuild(args); args.parentCatalogBytes.fill(0); (args.facts as ReturnType<typeof fact>[])[0].encoded.sha256 = "d".repeat(64);
  const result = await pending; expect(result.status).toBe("planned"); if (result.status === "planned") expect(result.manifestJSON).toContain(`rs_${"b".repeat(64)}`);
});

test("last decoded frame fits exactly; one-frame overrun is HOLD with no clamp, padding or partial manifest", async () => {
  const valid = fact(); valid.parentFrames = Math.ceil(valid.clip.end * valid.sampleRate);
  expect((await planShortSourceBuild(input([valid]))).status).toBe("planned");
  const short = structuredClone(valid); short.parentFrames--;
  expect(await planShortSourceBuild(input([short]))).toEqual({ status: "hold", code: "capacity" });
  const rounded = fact(); rounded.encoded.presentationFrames = Math.round(rounded.clip.end * 44100) - Math.round(rounded.clip.start * 44100);
  expect(await planShortSourceBuild(input([rounded]))).toEqual({ status: "hold", code: "encoded-geometry" });
});

test("only pinned approved parent bytes and exact ready original clips can be planned", async () => {
  const wrongPin = input(); wrongPin.parentCatalogSHA256 = "f".repeat(64); expect(await planShortSourceBuild(wrongPin)).toEqual({ status: "hold", code: "parent-pin" });
  for (const patch of [{ parentAsset: "ra_" + "2".repeat(32) }, { parentSHA256: "f".repeat(64) }, { parentBytes: 8 }])
    expect(await planShortSourceBuild(input([{ ...fact(), ...patch }]))).toEqual({ status: "hold", code: "parent-binding" });
  const shifted = fact(); shifted.clip.start += 0.000001;
  expect(await planShortSourceBuild(input([shifted]))).toEqual({ status: "hold", code: "unapproved-clip" });
  const held = parent(); Object.assign(held.assets[0].verses[0].playback, { status: "needs-review", review: "start-moved" });
  expect(await planShortSourceBuild(input([fact()], held))).toEqual({ status: "hold", code: "unapproved-clip" });
});

test("native codec/rate/channel/75-second and compressed-byte profiles reject unsupported facts explicitly", async () => {
  for (const update of [(f: ReturnType<typeof fact>) => { f.sampleRate = f.encoded.sampleRate = 96000; },
    (f: ReturnType<typeof fact>) => { f.sampleRate = f.encoded.sampleRate = 12345; f.encoded.presentationFrames = Math.ceil(f.clip.end * 12345) - Math.floor(f.clip.start * 12345); }, (f: ReturnType<typeof fact>) => { f.channels = f.encoded.channels = 3; },
    (f: ReturnType<typeof fact>) => { f.encoded.sampleRate = 48000; }, (f: ReturnType<typeof fact>) => { f.encoded.channels = 1; },
    (f: ReturnType<typeof fact>) => { f.encoded.codec = "flac"; }, (f: ReturnType<typeof fact>) => { f.encoded.bitrate = 128000; },
    (f: ReturnType<typeof fact>) => { f.encoded.bytes = 1048577; }, (f: ReturnType<typeof fact>) => { f.encoded.bytes = 0; },
    (f: ReturnType<typeof fact>) => { f.encoded.recipe = "unreviewed" as typeof SHORT_SOURCE_RECIPE; }]) {
    const f = fact(); update(f); expect(await planShortSourceBuild(input([f]))).toEqual({ status: "hold", code: "profile" });
  }
  for (const duration of [75, 75 + 1 / 44100]) {
    const raw = parent(), f = fact(); raw.assets[0].verses[0].playback.clip = f.clip = { start: 1, end: 1 + duration };
    f.parentFrames = Math.ceil(f.clip.end * 44100); f.encoded.presentationFrames = f.parentFrames - 44100;
    expect((await planShortSourceBuild(input([f], raw))).status).toBe(duration === 75 ? "planned" : "hold");
  }
});

test("duplicate and conflicting encoded content identities HOLD instead of guessing aliases or silently deduplicating", async () => {
  expect(await planShortSourceBuild(input([fact(), fact()]))).toEqual({ status: "hold", code: "duplicate-body" });
  const other = fact(1); other.encoded.sha256 = "b".repeat(64);
  expect(await planShortSourceBuild(input([fact(), other]))).toEqual({ status: "hold", code: "conflicting-body" });
});

test("closed facts reject getters, coercion, sparse arrays and excess private fields without invoking input code", async () => {
  const getter = vi.fn(), coercion = vi.fn(); const accessed = Object.defineProperty(fact(), "encoded", { get: getter });
  expect(await planShortSourceBuild(input([accessed]))).toEqual({ status: "hold", code: "facts-shape" }); expect(getter).not.toHaveBeenCalled();
  const f = fact(); (f.encoded as Record<string, unknown>).sha256 = { toString: coercion };
  expect(await planShortSourceBuild(input([f]))).toEqual({ status: "hold", code: "profile" }); expect(coercion).not.toHaveBeenCalled();
  for (const values of [[], new Array(1), [{ ...fact(), sourceURL: "https://example.test" }], [Object.assign(Object.create({ extra: true }), fact())]])
    expect(await planShortSourceBuild(input(values))).toEqual({ status: "hold", code: "facts-shape" });
});
