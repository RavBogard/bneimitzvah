import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { SHORT_SOURCE_FFMPEG_TAGS, shortSourceFFmpegMetadataArgs } from "../../src/lib/reference-audio/short-source-tags";
import { createShortSourceManifestLoader, lookupShortSource, type ShortSourceEntry } from "../../src/server/reference-audio/short-source-manifest";
import { verifyShortSourceBody, readVerifiedShortSourceBody, type VerifiedShortSourceBody } from "../../src/server/reference-audio/short-source-body";
import { ReferenceUnavailable } from "../../src/server/reference-audio/catalog";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const asset = `ra_${"1".repeat(32)}`, parentSHA = "a".repeat(64);
const set32 = (b: Uint8Array, p: number, v: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(p, v);
function put(b: Uint8Array, p: number, text: string) { b.set(new TextEncoder().encode(text), p); }
function fixture(rate = 24000, channels: 1 | 2 = 1) {
  const t = SHORT_SOURCE_FFMPEG_TAGS, fields = [["TIT2", t.title], ["TPE1", t.artist], ["TCOP", t.copyright], ["TXXX", `comment\0${t.comment}`], ["TENC", t.encoded_by], ["TXXX", `source\0${t.source}`], ["TSSE", "Lavf63.1.101"]];
  const tags = fields.map(([id, text]) => { const b = new Uint8Array(12 + text.length); put(b, 0, id); set32(b, 4, text.length + 2); put(b, 11, text); return b; });
  const id3size = tags.reduce((n, b) => n + b.length, 10), start = 10 + id3size;
  const version = rate >= 32000 ? 3 : rate >= 16000 ? 2 : 0, rateIndex = [44100, 48000, 32000].findIndex(v => v / (version === 3 ? 1 : version === 2 ? 2 : 4) === rate);
  const frameLength = Math.floor((version === 3 ? 144 : 72) * 64000 / rate), samples = version === 3 ? 1152 : 576;
  const presentation = Math.round(rate * 0.8), count = Math.ceil((presentation + 576) / samples), padding = count * samples - 576 - presentation;
  const b = new Uint8Array(start + frameLength * (count + 1)); put(b, 0, "ID3"); b[3] = 3;
  b[6] = (id3size >>> 21) & 127; b[7] = (id3size >>> 14) & 127; b[8] = (id3size >>> 7) & 127; b[9] = id3size & 127;
  let p = 10; for (const tag of tags) { b.set(tag, p); p += tag.length; }
  const header = 0xffe00000 | (version << 19) | (1 << 17) | (1 << 16) | ((version === 3 ? 5 : 8) << 12) | (rateIndex << 10) | (channels === 1 ? 3 << 6 : 0);
  for (let i = 0; i <= count; i++) set32(b, start + i * frameLength, header >>> 0);
  const side = version === 3 ? channels === 1 ? 17 : 32 : channels === 1 ? 9 : 17, info = start + 4 + side, encoder = info + 120;
  put(b, info, "Info"); set32(b, info + 4, 15); set32(b, info + 8, count); set32(b, info + 12, b.length - start);
  for (let i = 0; i < 100; i++) b[info + 16 + i] = i === 99 ? 255 : Math.floor(i * 256 / 100);
  put(b, encoder, "Lavc63.1."); b[encoder + 21] = 576 >>> 4; b[encoder + 22] = ((576 & 15) << 4) | (padding >>> 8); b[encoder + 23] = padding & 255;
  set32(b, encoder + 28, b.length - start);
  return { b, rate, channels, presentation, start, frameLength, info, encoder };
}
async function entry(f: ReturnType<typeof fixture>, body: Uint8Array = f.b, presentation = f.presentation): Promise<ShortSourceEntry> {
  const parent = json({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-1.mp3", sha256: parentSHA, bytes: 7,
    verses: [{ schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset, clip: { start: 0, end: presentation / f.rate } }, words: { status: "unavailable", reason: "no-words" }, attribution: REFERENCE_ATTRIBUTION }] }] });
  const hash = sha(body), manifest = json({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: sha(parent), recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION,
    entries: [{ schema: "reference-short-source/v1", id: `rs_${hash}`, parent: { asset, sha256: parentSHA, bytes: 7 }, sha256: hash, bytes: body.byteLength, path: `/reference-audio/short-v1/${hash}.mp3`, codec: "mp3", bitrate: 64000,
      sampleRate: f.rate, channels: f.channels, presentationFrames: presentation, origin: { firstFrame: 0, parentRate: f.rate }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version }] });
  const load = createShortSourceManifestLoader({ sha256: sha(manifest), parentCatalogSHA256: sha(parent), parentCatalogBytes: parent, get: async () => new ReadableStream({ start(c) { c.enqueue(manifest); c.close(); } }) });
  return lookupShortSource(await load(), `rs_${hash}`)!;
}

test("fixed FFmpeg metadata emits only the six public credit fields and returns fresh argument arrays", () => {
  expect(Object.keys(SHORT_SOURCE_FFMPEG_TAGS)).toEqual(["title", "artist", "copyright", "comment", "encoded_by", "source"]);
  expect(Object.isFrozen(SHORT_SOURCE_FFMPEG_TAGS)).toBe(true); const a = shortSourceFFmpegMetadataArgs(); a.fill("changed");
  expect(shortSourceFFmpegMetadataArgs()).toEqual(Object.entries(SHORT_SOURCE_FFMPEG_TAGS).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]));
});

test("selected MPEG1/2/2.5 native-rate mono/stereo profiles verify against genuine sealed manifest entries", async () => {
  // Structural fixtures, not claims of codec or perceptual verification.
  for (const rate of [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]) for (const channels of [1, 2] as const) {
    const f = fixture(rate, channels), verified = verifyShortSourceBody(await entry(f), f.b), body = readVerifiedShortSourceBody(verified);
    expect(Object.isFrozen(verified)).toBe(true); expect(body.bytes).toEqual(f.b); expect(body.source.presentationFrames).toBe(f.presentation);
  }
});

test("receipt authenticity, full hash and exact size precede any verified body, with no cloned authority", async () => {
  const f = fixture(), sealed = await entry(f); const wrong = f.b.slice(); wrong[wrong.length - 1] ^= 1;
  for (const body of [wrong, f.b.subarray(1), new Uint8Array(f.b.length + 1)]) expect(() => verifyShortSourceBody(sealed, body)).toThrow(ReferenceUnavailable);
  expect(() => verifyShortSourceBody({ ...sealed }, f.b)).toThrow(ReferenceUnavailable);
  const verified = verifyShortSourceBody(sealed, f.b);
  for (const fake of [{}, { ...verified }, new Proxy(verified, {})]) expect(() => readVerifiedShortSourceBody(fake as VerifiedShortSourceBody)).toThrow(ReferenceUnavailable);
});

test("intrinsic byte snapshot ignores shadow properties and privately retains bytes across caller and consumer mutation", async () => {
  const f = fixture(), sealed = await entry(f), getter = vi.fn(() => { throw Error("must not run"); });
  Object.defineProperties(f.b, { byteLength: { get: getter }, buffer: { get: getter }, byteOffset: { get: getter }, slice: { get: getter } });
  const verified = verifyShortSourceBody(sealed, f.b); expect(getter).not.toHaveBeenCalled();
  f.b.fill(0); const first = readVerifiedShortSourceBody(verified); expect(first.bytes[0]).toBe(73); first.bytes.fill(0);
  expect(readVerifiedShortSourceBody(verified).bytes[0]).toBe(73);
  const large = new Uint8Array(1024 * 1024 + 1); Object.defineProperty(large, "byteLength", { value: 1 });
  expect(() => verifyShortSourceBody(sealed, large)).toThrow(ReferenceUnavailable);
});

test("closed ID3 profile refuses missing/wrong credits, encoding/flags/version, extra frames and arbitrary muxer metadata even with new correct SHA", async () => {
  const changes = [(f: ReturnType<typeof fixture>) => { f.b[3] = 4; }, (f: ReturnType<typeof fixture>) => { f.b[5] = 0x80; },
    (f: ReturnType<typeof fixture>) => { f.b[6] = 128; }, (f: ReturnType<typeof fixture>) => { f.b[18] = 1; }, (f: ReturnType<typeof fixture>) => { f.b[20] = 3; },
    (f: ReturnType<typeof fixture>) => { f.b[21] ^= 1; }, (f: ReturnType<typeof fixture>) => { put(f.b, 10, "APIC"); },
    (f: ReturnType<typeof fixture>) => { f.b[f.start - 1] = 1; }, (f: ReturnType<typeof fixture>) => { const p = Buffer.from(f.b).indexOf("Lavf63"); f.b[p] = 88; },
    (f: ReturnType<typeof fixture>) => { const p = Buffer.from(f.b).indexOf("creativecommons"); f.b[p] ^= 1; },
    (f: ReturnType<typeof fixture>) => { const p = Buffer.from(f.b).indexOf("archive.org"); f.b[p] ^= 1; }];
  for (const change of changes) { const f = fixture(); change(f); const sealed = await entry(f); expect(() => verifyShortSourceBody(sealed, f.b)).toThrow(ReferenceUnavailable); }
});

test("every frame must retain exact LayerIII 64k rate/channel profile and complete EOF; trailing or truncated bytes refuse", async () => {
  for (const byte of [0, 1, 2, 3]) {
    const f = fixture(); f.b[f.start + f.frameLength + byte] ^= byte === 3 ? 0x40 : 0x10;
    const sealed = await entry(f); expect(() => verifyShortSourceBody(sealed, f.b)).toThrow(ReferenceUnavailable);
  }
  for (const change of [(b: Uint8Array) => b.subarray(0, b.length - 1), (b: Uint8Array) => { const a = new Uint8Array(b.length + 1); a.set(b); return a; }]) {
    const f = fixture(), body = change(f.b);
    const sealed = await entry(f, body); expect(() => verifyShortSourceBody(sealed, body)).toThrow(ReferenceUnavailable);
  }
});

test("monotonic Info TOC may end below255; full hash and exact frame geometry still verify", async () => {
  const f = fixture(); f.b[f.info + 115] = 254;
  const verified = verifyShortSourceBody(await entry(f), f.b);
  expect(readVerifiedShortSourceBody(verified).bytes).toEqual(f.b);
});

test("Info flags/count/bytecount/TOC/Lavc delay/discard and presentation are exact, not guessed or clamped", async () => {
  const changes = [(f: ReturnType<typeof fixture>) => put(f.b, f.info, "Xing"), (f: ReturnType<typeof fixture>) => set32(f.b, f.info + 4, 3),
    (f: ReturnType<typeof fixture>) => set32(f.b, f.info + 8, 0), (f: ReturnType<typeof fixture>) => { f.b[f.info + 15] ^= 1; },
    (f: ReturnType<typeof fixture>) => { f.b[f.info + 30] = 0; }, (f: ReturnType<typeof fixture>) => put(f.b, f.encoder, "Unknown!!"),
    (f: ReturnType<typeof fixture>) => { f.b[f.encoder + 21] = 0; }, (f: ReturnType<typeof fixture>) => { f.b[f.encoder + 23] ^= 1; },
    (f: ReturnType<typeof fixture>) => { f.b[f.encoder + 10] = 1; }, (f: ReturnType<typeof fixture>) => { f.b[f.encoder + 31] ^= 1; },
    (f: ReturnType<typeof fixture>) => { f.b[f.encoder + 36] = 1; }];
  for (const change of changes) { const f = fixture(); change(f); const sealed = await entry(f); expect(() => verifyShortSourceBody(sealed, f.b)).toThrow(ReferenceUnavailable); }
  const f = fixture(); const sealed = await entry(f, f.b, f.presentation + 1); expect(() => verifyShortSourceBody(sealed, f.b)).toThrow(ReferenceUnavailable);
});
