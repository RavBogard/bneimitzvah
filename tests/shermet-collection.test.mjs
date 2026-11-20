import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInventory, saveInventory, acquireCollection, mapInventory, generateManifest } from '../scripts/shermet-collection.mjs';
import { loadCanonicalReading } from '../scripts/shermet-source-runtime.mjs';

const page = (suffix = 'a') => ({ url: `https://www.templeisraelomaha.com/synthetic-${suffix}`, title: 'Synthetic metadata fixture',
  links: [{ text: 'Synthetic chapter', href: 'https://www.templeisraelomaha.com/synthetic-b' }],
  rows: [{ label: 'Synthetic verse label', sources: ['https://images.shulcloud.com/14396/123.mp3'] }] });

test('accepts only explicit observed public audio sources and bounded metadata', () => {
  assert.equal(validateInventory({ version: 1, pages: [page()] }).pages.length, 1);
  for (const mutate of [
    p => p.url = 'https://example.test/private',
    p => p.rows[0].sources = ['https://example.test/123.mp3'],
    p => p.rows[0].sources = ['https://images.shulcloud.com/14396/123.mp3?token=synthetic'],
    p => p.rows[0].label = 'x'.repeat(301),
    p => p.links[0].href = 'javascript:alert(1)',
  ]) { const value = page(); mutate(value); assert.throws(() => validateInventory({ version: 1, pages: [value] })); }
});

test('upserts page batches while retaining append-only provenance receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shermet-inventory-'));
  try {
    await saveInventory(root, { version: 1, pages: [page()] });
    const updated = page(); updated.rows[0].sources = [];
    const result = await saveInventory(root, { version: 1, pages: [updated, page('b')] });
    assert.deepEqual(result, { saved: 2, totalPages: 2, totalRows: 2 });
    const inventory = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8'));
    assert.deepEqual(inventory.pages[0].rows[0].sources, []);
    assert.equal((await readFile(join(root, 'inventory-receipts.jsonl'), 'utf8')).trim().split('\n').length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('acquisition refuses repository destinations before reading inventory or fetching', async () => {
  await assert.rejects(acquireCollection(process.cwd()), /outside every Git/);
});

test('maps exact ordinary refs while keeping holiday performances and Megillot separate', () => {
  const ordinary = page(); ordinary.title = 'Genesis Chapter 1'; ordinary.rows[0].label = 'Genesis 1:1';
  const holiday = page('holiday'); holiday.title = 'High Holiday Torah'; holiday.rows[0].label = 'Genesis 1:1';
  const megillah = page('megillah'); megillah.title = 'Esther'; megillah.rows[0].label = 'Esther 1:1';
  const ambiguous = page('ambiguous'); ambiguous.rows[0].label = '1';
  const mapped = mapInventory({ version: 1, pages: [ordinary, holiday, megillah, ambiguous] }, { '123': { status: 'verified', sha256: 'a'.repeat(64) } });
  assert.deepEqual(mapped.recordings, [{ kind: 'torah', ref: 'Genesis 1:1', sourceId: 123, sha256: 'a'.repeat(64), mimeType: 'audio/mpeg' }]);
  assert.deepEqual(mapped.variants.map(r => r.category), ['holiday-variant', 'megillah', 'unclassified']);
});

test('defers multiple row sources and conflicting ordinary performances', () => {
  const first = page(); first.rows[0].label = 'Genesis 1:1';
  const second = page('b'); second.rows[0].label = 'Genesis 1:1'; second.rows[0].sources = ['https://images.shulcloud.com/14396/124.mp3'];
  const alternatives = page('c'); alternatives.rows[0].label = 'Genesis 1:2'; alternatives.rows[0].sources.push('https://images.shulcloud.com/14396/125.mp3');
  const mapped = mapInventory({ version: 1, pages: [first, second, alternatives] });
  assert.deepEqual(mapped.recordings, []);
  assert.equal(mapped.conflicts.length, 2); assert.equal(mapped.deferred.length, 1);
});

test('uses portal Roman names and refuses a contradictory source book without a complete correction sequence', async () => {
  const roman = page(); roman.title = 'I Kings 2:1-12'; roman.rows[0].label = 'I Kings 2:1';
  const wrong = page('wrong'); wrong.title = 'Numbers 8:1-12:16'; wrong.rows[0].label = 'Exodus 8:1';
  const mapped = mapInventory({ version: 1, pages: [roman, wrong] }, { '123': { status: 'verified', sha256: 'a'.repeat(64) } });
  assert.equal(mapped.recordings[0].ref, 'I Kings 2:1'); assert.equal(mapped.deferred.length, 1);
  const root = await mkdtemp(join(tmpdir(), 'shermet-canonical-'));
  try {
    const { canonicalReadingRef } = await loadCanonicalReading(root);
    assert.equal(canonicalReadingRef('I Kings 2:1', 'haftarah')?.verses[0], 'I Kings 2:1');
    assert.equal(canonicalReadingRef('1 Kings 2:1', 'haftarah'), null);
    assert.equal(canonicalReadingRef('Numbers 8:99', 'torah'), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('holds equal audio bytes assigned distinct refs, then accepts only a digest-bound adjudicated identity', () => {
  const a = page(); a.rows[0].label = 'Genesis 1:1';
  const b = page('b'); b.rows[0].label = 'Genesis 1:2'; b.rows[0].sources = ['https://images.shulcloud.com/14396/124.mp3'];
  const media = { '123': { status: 'verified', sha256: 'a'.repeat(64) }, '124': { status: 'verified', sha256: 'a'.repeat(64) } };
  const inventory = { version: 1, pages: [a, b] };
  assert.equal(mapInventory(inventory, media).recordings.length, 0);
  const decision = [{ sourceId: 123, sha256: 'a'.repeat(64), ref: 'Genesis 1:1', evidenceSha256: 'b'.repeat(64) }];
  assert.deepEqual(mapInventory(inventory, media, decision).recordings.map(r => r.ref), ['Genesis 1:1']);
  const mislabeled = { ...a, rows: [{ ...a.rows[0], label: 'Genesis 1:2' }] };
  const correction = mapInventory({ version: 1, pages: [mislabeled] }, media, decision).deferred[0];
  assert.equal(Object.hasOwn(correction, 'ref'), false);
  assert.equal(Object.hasOwn(correction, 'kind'), false);
  assert.equal(correction.rowLabel, 'Genesis 1:2');
  // The same exact source and bytes have a separately accepted ordinary row.
  const duplicate = mapInventory({ version: 1, pages: [a, { ...mislabeled, url: 'https://www.templeisraelomaha.com/synthetic-secondary' }] }, media, decision).deferred[0];
  assert.equal(duplicate.ref, 'Genesis 1:1'); assert.equal(duplicate.kind, 'torah');
  assert.equal(duplicate.rowLabel, 'Genesis 1:2');
  // A matching recording under another source ID cannot corroborate this row.
  const otherSource = { ...a, rows: [{ ...a.rows[0], sources: ['https://images.shulcloud.com/14396/124.mp3'] }] };
  assert.equal(Object.hasOwn(mapInventory({ version: 1, pages: [otherSource, mislabeled] }, media, decision).deferred[0], 'ref'), false);
  decision[0].sha256 = 'c'.repeat(64);
  assert.equal(mapInventory(inventory, media, decision).recordings.length, 0);
});
test('canonical rejection removes a deferred correction identity before public library publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shermet-correction-'));
  try {
    const ordinary = page('accepted'); ordinary.title = 'Numbers Ch 8'; ordinary.rows[0].label = 'Numbers 8:99';
    const secondary = page('secondary'); secondary.title = 'Numbers Ch 8'; secondary.rows[0].label = 'Numbers 8:98';
    const inventory = { version: 1, pages: [ordinary, secondary] };
    const media = { '123': { status: 'verified', sha256: 'a'.repeat(64), duration: 1, bytes: 100, mimeType: 'audio/mpeg' } };
    const records = [{ sourceId: 123, sha256: 'a'.repeat(64), ref: 'Numbers 8:99', evidenceSha256: 'b'.repeat(64) }];
    await writeFile(join(root, 'inventory.json'), JSON.stringify(inventory));
    await writeFile(join(root, 'acquisition.json'), JSON.stringify({ media }));
    await writeFile(join(root, 'source-adjudications.json'), JSON.stringify({ records }));
    await generateManifest(root);
    const library = JSON.parse(await readFile(join(root, 'nonverse-catalog.json'), 'utf8'));
    const held = library.items.find(row => row.label === 'Numbers 8:98');
    assert.ok(held); assert.equal(Object.hasOwn(held, 'ref'), false); assert.equal(Object.hasOwn(held, 'kind'), false);
    assert.equal(held.status, 'available'); // Playback remains explicitly unconfirmed, not falsely titled.
  } finally { await rm(root, { recursive: true, force: true }); }
});
