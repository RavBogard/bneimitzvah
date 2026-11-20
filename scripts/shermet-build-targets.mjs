// Reuse the authorized untimed-pack tool; source text and phones stay outside Git.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { insideGitWorkingTree } from './private-paths.mjs';
import { loadCanonicalReading } from './shermet-source-runtime.mjs';
const run = promisify(execFile);
const [inventoryFile, existingPacks, outputRoot, packTool] = process.argv.slice(2);
if (!packTool || await insideGitWorkingTree(outputRoot)) throw new Error('Supply inventory, existing packs, external output and authorized existing packs.mjs tool');
await mkdir(outputRoot, { recursive: true });
const { canonicalReadingRef } = await loadCanonicalReading(outputRoot);
const found = new Set();
for (const root of [existingPacks, outputRoot]) for (const directory of await readdir(root, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  try { const manifest = JSON.parse(await readFile(join(root, directory.name, 'manifest.json'), 'utf8')); for (const row of manifest.passages ?? []) found.add(row.ref); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const inventory = JSON.parse(await readFile(inventoryFile, 'utf8'));
const entries = inventory.provenance ?? inventory.recordings;
const groups = new Map();
for (const row of entries) {
  const parsed = canonicalReadingRef(row.ref, row.kind);
  if (found.has(row.ref) || !parsed || parsed.verses.length !== 1) continue;
  const chapter = row.ref.replace(/:\d+$/, ''), list = groups.get(chapter) ?? { kind: row.kind, verses: new Set() }; list.verses.add(Number(row.ref.split(':').at(-1))); groups.set(chapter, list);
}
const receipts = [];
for (const [chapter, data] of groups) {
  const book = chapter.replace(/ \d+$/, ''), number = Number(chapter.split(' ').at(-1));
  const first = Math.min(...data.verses), last = Math.max(...data.verses), range = `${book} ${number}:${first} - ${number}:${last}`;
  const key = `Shermet-${book.replace(/ /g, '')}-${number}-${first}-${last}`;
  try {
    const result = await run(process.execPath, [resolve(packTool), key, range, data.kind, resolve(outputRoot)], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    receipts.push({ chapter, requested: data.verses.size, status: 'built', result: JSON.parse(result.stdout.trim().split('\n').at(-1)) });
  } catch (error) {
    await writeFile(join(outputRoot, key + '-error.txt'), String(error.stderr ?? error.message));
    receipts.push({ chapter, requested: data.verses.size, status: 'held', reason: 'Existing untimed-pack build failed; details retained outside Git' });
  }
  await writeFile(join(outputRoot, 'target-build-receipts.json'), JSON.stringify(receipts, null, 2));
  console.log(JSON.stringify(receipts.at(-1)));
  await new Promise(yes => setTimeout(yes, 250));
}
console.log(JSON.stringify({ chapters: groups.size, built: receipts.filter(r => r.status === 'built').length, held: receipts.filter(r => r.status === 'held').length }));
