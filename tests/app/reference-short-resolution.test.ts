import { expect, test, vi } from "vitest";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { parseReferenceResolution } from "../../src/lib/reference-audio/source";
import { SHORT_SOURCE_ATTRIBUTION } from "../../src/lib/reference-audio/short-source";
import { parseReferenceShortResolution, REFERENCE_SHORT_RESOLUTION_SCHEMA } from "../../src/lib/reference-audio/short-resolution";
const asset = `ra_${"1".repeat(32)}`, hash = "b".repeat(64);
function ready(start = 123.00002, end = 125.00001, rate = 44100) {
  const first = Math.floor(start * rate), last = Math.ceil(end * rate);
  return { schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse: { schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah",
    playback: { status: "ready", asset, clip: { start, end } }, words: { status: "ready", readingTextSha256: "c".repeat(64), starts: [start + 0.1, start + 1] }, attribution: REFERENCE_ATTRIBUTION },
    source: { schema: "reference-short-source/v1", id: `rs_${hash}`, parent: { asset, sha256: "a".repeat(64), bytes: 7000 }, sha256: hash, bytes: 16500,
      path: `/reference-audio/short-v1/${hash}.mp3`, codec: "mp3", bitrate: 64000, sampleRate: rate, channels: 2, presentationFrames: last - first,
      origin: { firstFrame: first, parentRate: rate }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version } };
}
const unavailable = () => ({ schema: "reference-verse/v1", ref: "Genesis 1:1", playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } });

test("distinct short wire version preserves original word clocks and exact nonzero enclosing native geometry", () => {
  const raw = ready(), parsed = parseReferenceShortResolution(raw)!;
  expect(parsed).not.toBeNull(); expect(parsed.schema).toBe(REFERENCE_SHORT_RESOLUTION_SCHEMA); expect(parsed.source?.origin.firstFrame).toBe(Math.floor(123.00002 * 44100));
  expect(parsed.source?.presentationFrames).toBe(Math.ceil(125.00001 * 44100) - Math.floor(123.00002 * 44100));
  expect(parsed.verse.words.status === "ready" && parsed.verse.words.starts).toEqual(raw.verse.words.starts);
  expect(parsed.source?.path).toBe(`/reference-audio/short-v1/${hash}.mp3`); expect(parseReferenceResolution(raw)).toBeNull();
});
test("every supported native grid must exactly enclose the verse, not use rounded boundaries or a false origin", () => {
  for (const rate of [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]) {
    const raw = ready(1.00002, 3.00001, rate); expect(parseReferenceShortResolution(raw)).not.toBeNull();
    for (const change of [(v: ReturnType<typeof ready>) => { v.source.origin.firstFrame++; v.source.presentationFrames--; },
      (v: ReturnType<typeof ready>) => { v.source.origin.firstFrame--; v.source.presentationFrames++; },
      (v: ReturnType<typeof ready>) => { v.source.presentationFrames++; }, (v: ReturnType<typeof ready>) => { v.source.presentationFrames--; }]) {
      const bad = structuredClone(raw); change(bad); expect(parseReferenceShortResolution(bad)).toBeNull();
    }
  }
  const rounded = ready(1.00002, 3.00001); rounded.source.origin.firstFrame = Math.round(1.00002 * 44100); rounded.source.presentationFrames = Math.round(3.00001 * 44100) - rounded.source.origin.firstFrame;
  expect(parseReferenceShortResolution(rounded)).toBeNull();
  const wholeParent = ready(); wholeParent.source.origin.firstFrame = 0; wholeParent.source.presentationFrames += 44100;
  expect(parseReferenceShortResolution(wholeParent)).toBeNull();
});
test("exact rational frame endpoints retain identity without epsilon adjustments", () => {
  for (const first of [1, 100009, 600000001]) {
    const raw = ready(first / 44100, (first + 88200) / 44100);
    // Use the existing source grid's exact endpoints, not guessed rounding.
    expect(parseReferenceShortResolution(raw)).not.toBeNull();
  }
});
test("ready missing derivative and held/unavailable null remain honest; non-ready media never becomes playable", () => {
  const raw = ready(); expect(parseReferenceShortResolution({ ...raw, source: null })?.source).toBeNull();
  const held = { ...raw.verse, playback: { ...raw.verse.playback, status: "needs-review", review: "start-moved" }, words: { status: "unavailable", reason: "no-words" } };
  for (const verse of [held, unavailable()]) {
    expect(parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse, source: null })).not.toBeNull();
    expect(parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse, source: raw.source })).toBeNull();
  }
  expect(parseReferenceShortResolution({ ...raw, source: undefined })).toBeNull();
});
test("parent identity, codec/path/URL and protocol versions are closed without a legacy parent fallback", () => {
  const raw = ready(), legacy = { schema: "reference-source/v1", asset, url: "https://archive.org/download/PockettorahAudioFiles/Synthetic.mp3", sha256: "a".repeat(64), bytes: 7000 };
  for (const source of [legacy, { ...raw.source, parent: { ...raw.source.parent, asset: `ra_${"2".repeat(32)}` } },
    { ...raw.source, url: legacy.url }, { ...raw.source, path: legacy.url }, { ...raw.source, path: raw.source.path + "?x=1" },
    { ...raw.source, path: raw.source.path + "#x" }, { ...raw.source, path: "/private/" + hash + ".mp3" }, { ...raw.source, codec: "flac" },
    { ...raw.source, origin: { ...raw.source.origin, parentRate: 48000 } }]) expect(parseReferenceShortResolution({ ...raw, source })).toBeNull();
  for (const schema of [undefined, "reference-source/v1", "reference-resolution/v1", "reference-resolution/short-v2"]) expect(parseReferenceShortResolution({ ...raw, schema })).toBeNull();
  expect(parseReferenceShortResolution({ verse: raw.verse, source: legacy })).toBeNull();
});
test("wire clones are revalidated snapshots, never shared mutable input or opaque serving authority", () => {
  const raw = ready(), clone = structuredClone(raw), parsed = parseReferenceShortResolution(clone)!;
  expect(parsed).not.toBeNull(); expect(parsed).not.toBe(clone); expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.source)).toBe(true);
  expect(Object.isFrozen(parsed.source?.origin)).toBe(true); expect(Object.isFrozen(parsed.source?.parent)).toBe(true); expect(Object.isFrozen(parsed.verse.words)).toBe(true);
  clone.source.origin.firstFrame = 0; clone.source.parent.bytes = 1; clone.verse.words.starts[0] = 0;
  expect(parsed.source?.origin.firstFrame).toBe(raw.source.origin.firstFrame); expect(parsed.source?.parent.bytes).toBe(7000);
  expect(parsed.verse.words.status === "ready" && parsed.verse.words.starts[0]).toBe(raw.verse.words.starts[0]);
  expect(parseReferenceShortResolution(clone)).toBeNull();
});
test("getters, extras, inherited records and coercion never become resolution authority", () => {
  const getter = vi.fn(), coercion = vi.fn(), raw = ready();
  for (const value of [Object.defineProperty(ready(), "source", { get: getter }), { ...raw, extra: true }, { ...raw, [Symbol("extra")]: 1 }, Object.assign(Object.create({ inherited: true }), raw),
    { ...raw, source: Object.defineProperty({ ...raw.source }, "path", { get: getter }) },
    { ...raw, verse: Object.defineProperty({ ...raw.verse }, "playback", { get: getter }) },
    { ...raw, source: { ...raw.source, sha256: { toString: coercion } } }, { ...raw, source: { ...raw.source, origin: { ...raw.source.origin, extra: true } } }]) expect(parseReferenceShortResolution(value)).toBeNull();
  expect(getter).not.toHaveBeenCalled(); expect(coercion).not.toHaveBeenCalled();
});
