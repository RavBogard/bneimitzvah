import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFullVerses, importSheets } from '../scripts/shermet-pilot-import.mjs';

// Synthetic structure only; no downloaded text or media is kept in this fixture.
const sheet = () => ({ status: 'public', sources: [
  { ref: 'Exodus 35:4' },
  { comment: '<small>Trope 1</small>' }, { media: 'https://example.test/clip.mp3' },
  { comment: '<p>Full Verse Chanted</p>' }, { media: 'https://images.shulcloud.com/14396/123.mp3', node: 5 },
  { comment: 'All audio recordings by Cantor Wendy Shermet (synthetic provenance fixture) and used with permission.' },
] });

test('selects only media immediately labeled Full Verse Chanted with its single verse', () => {
  assert.deepEqual(extractFullVerses(sheet()).recordings, [{ kind: 'torah', ref: 'Exodus 35:4', sourceUrl: 'https://images.shulcloud.com/14396/123.mp3', sourceNode: 5 }]);
  const prophetic = sheet(); prophetic.sources[0].ref = 'Isaiah 40:1';
  assert.equal(extractFullVerses(prophetic).recordings[0].kind, 'haftarah');
});

test('rejects missing provenance, private sheets, ranges, missing media and foreign media', () => {
  for (const mutate of [
    s => s.status = 'unlisted', s => s.sources.pop(), s => s.sources[0].ref = 'Exodus 35:4-6',
    s => s.sources.splice(4, 1), s => s.sources[4].media = 'https://example.test/audio.mp3',
    s => s.sources[4].media += '?token=synthetic',
    s => s.sources[3].comment = 'Trope 1 Full Verse Chanted',
    s => s.sources.push(...s.sources.slice(0, 5)),
  ]) { const value = sheet(); mutate(value); assert.throws(() => extractFullVerses(value)); }
});

test('refuses Git destinations and unbounded requests before fetching', async () => {
  await assert.rejects(importSheets(process.cwd(), ['1']), /outside every Git/);
  await assert.rejects(importSheets('unused', []), /one to five/);
  await assert.rejects(importSheets('unused', ['https://example.test']), /one to five/);
});
