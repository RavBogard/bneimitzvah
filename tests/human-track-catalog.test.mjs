import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const content = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tracks = JSON.parse(content("../src/lib/reference-audio/human-tracks.json"));
const verseCounts = Object.fromEntries(
  [...content("../src/lib/readings/catalog.ts").matchAll(/"([^"]+)": Object\.freeze\((\[[\d,]+\])\),/g)]
    .map(([, book, counts]) => [book, JSON.parse(counts)]),
);

test("human recordings have unique stable IDs, audio fingerprints, and bounded canonical passages", () => {
  const ids = new Set();
  const hashes = new Set();
  for (const track of tracks) {
    assert.match(track.id, /^[a-z0-9][a-z0-9-]{0,95}$/);
    assert.ok(!ids.has(track.id), track.id);
    assert.match(track.sha256, /^[0-9a-f]{64}$/);
    assert.ok(!hashes.has(track.sha256), track.id);
    assert.ok(Number.isSafeInteger(track.bytes) && track.bytes > 0, track.id);
    assert.ok(Number.isFinite(track.durationSec) && track.durationSec > 0, track.id);
    ids.add(track.id);
    hashes.add(track.sha256);
    for (const range of track.passages ?? []) {
      const { book, startChapter, startVerse, endChapter, endVerse } = range;
      const counts = verseCounts[book];
      assert.ok(counts, book);
      assert.ok(startChapter <= endChapter, track.id);
      assert.ok(startVerse > 0 && startVerse <= counts[startChapter - 1], JSON.stringify([track.id, range]));
      assert.ok(endVerse > 0 && endVerse <= counts[endChapter - 1], JSON.stringify([track.id, range]));
      assert.ok(startChapter !== endChapter || startVerse <= endVerse, track.id);
    }
  }
});

test("the Karaite publisher index covers all 54 portions and two distinct Decalogue recordings", () => {
  const subset = tracks.filter((track) => track.voice === "rotem-cohen");
  assert.equal(subset.length, 110);
  const portions = new Map();
  for (const track of subset) {
    assert.equal(track.sourceUrl, "https://karaites.org/torah-audio/");
    assert.match(track.streamUrl, /^https:\/\/karaites\.org\/uploads\/.+\.mp3$/);
    const [portion] = track.portions;
    assert.equal(track.portions.length, 1);
    if (track.id.endsWith("-decalogue")) continue;
    const parts = portions.get(portion) ?? [];
    parts.push(track.kind);
    portions.set(portion, parts);
  }
  assert.equal(portions.size, 54);
  for (const parts of portions.values()) assert.deepEqual(parts.sort(), ["haftarah", "torah"]);
});
