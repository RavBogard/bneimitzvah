// Synthetic catalogs and manifests only. The rebind may change word timings and the parent binding,
// never an asset, a clip or a manifest entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCatalogGeometry, compareManifests } from "../scripts/reference-short-manifest-rebind.mjs";

const verse = (ref, starts, ends) => ({ schema: "reference-verse/v1", ref, table: "torah",
  playback: { status: "ready", asset: "ra_" + "a".repeat(32), clip: { start: 1, end: 4 } },
  words: { status: "ready", readingTextSha256: "b".repeat(64), starts, ...(ends ? { ends } : {}) }, attribution: { title: "t" } });
const catalog = (starts, ends, over = {}) => ({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles",
  assets: [{ id: "ra_" + "a".repeat(32), archiveFile: "Alpha-1.mp3", sha256: "c".repeat(64), bytes: 10, verses: [verse("Genesis 1:1", starts, ends)], ...over }] });
const clone = x => JSON.parse(JSON.stringify(x));

test("catalog geometry: refined word timings pass; any asset, clip, playback or word-count change refuses", () => {
  assert.deepEqual(compareCatalogGeometry(catalog([1.1, 2]), catalog([1.08, 1.98], [1.9, 3.5])), { assets: 1, verses: 1, wordsChanged: 1 });
  assert.deepEqual(compareCatalogGeometry(catalog([1.1, 2]), catalog([1.1, 2])).wordsChanged, 0);
  const mutations = [
    c => { c.assets[0].sha256 = "d".repeat(64); },
    c => { c.assets[0].bytes = 11; },
    c => { c.assets[0].verses[0].playback.clip.end = 4.001; },
    c => { c.assets[0].verses[0].playback = { status: "needs-review", review: "start-moved", asset: c.assets[0].id, clip: { start: 1, end: 4 } }; },
    c => { c.assets[0].verses[0].words.starts = [1.1]; },
    c => { c.assets[0].verses[0].words.readingTextSha256 = "e".repeat(64); },
    c => { c.assets[0].verses[0].ref = "Genesis 1:2"; },
    c => { c.assets.push(clone(c.assets[0])); },
  ];
  for (const mutate of mutations) { const next = catalog([1.08, 1.98], [1.9, 3.5]); mutate(next); assert.throws(() => compareCatalogGeometry(catalog([1.1, 2]), next), /refused/); }
});

test("manifests: identical entries with a new parent pass; any entry change or a same parent refuses", () => {
  const old = { schema: "s", source: "PockettorahAudioFiles", parentCatalogSHA256: "1".repeat(64), recipe: "r", attribution: { a: 1 }, entries: [{ id: "rs_x", sha256: "f".repeat(64), bytes: 5 }] };
  const next = { ...clone(old), parentCatalogSHA256: "2".repeat(64) };
  assert.deepEqual(compareManifests(old, next, { oldParent: "1".repeat(64), newParent: "2".repeat(64) }), { entries: 1 });
  const changed = clone(next); changed.entries[0].bytes = 6;
  assert.throws(() => compareManifests(old, changed, { oldParent: "1".repeat(64), newParent: "2".repeat(64) }), /refused/);
  assert.throws(() => compareManifests(old, clone(old), { oldParent: "1".repeat(64), newParent: "1".repeat(64) }), /refused/);
  assert.throws(() => compareManifests(old, next, { oldParent: "1".repeat(64), newParent: "3".repeat(64) }), /refused/);
});
