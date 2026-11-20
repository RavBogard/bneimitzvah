// Compact progress only; never prints source text, transcriptions or private data.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
async function json(path, fallback = {}) { try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
const [sourceRoot, candidates] = process.argv.slice(2);
if (!sourceRoot || !candidates) throw new Error('Supply external source root and alignment candidate directory');
const acquisition = await json(join(sourceRoot, 'acquisition.json')), inventory = await json(join(sourceRoot, 'inventory.json'), { pages: [] });
const media = Object.values(acquisition.media ?? {}), summary = (await json(join(sourceRoot, 'mapped-inventory.json'))).summary;
const rows = [];
for (const file of await readdir(candidates)) if (/^[a-f0-9]{64}\.json$/.test(file)) rows.push(await json(join(candidates, file)));
const reasons = {};
for (const row of rows) for (const reason of row.reasons ?? []) reasons[reason] = (reasons[reason] ?? 0) + 1;
const watcher = await json(join(sourceRoot, 'watcher-state.json'));
const scriptSha = createHash('sha256').update(await readFile(new URL('./shermet-collection.mjs', import.meta.url))).digest('hex');
console.log(JSON.stringify({ inventoryPages: inventory.pages.length, inventoryRows: inventory.pages.reduce((sum, page) => sum + page.rows.length, 0),
  verifiedMedia: media.filter(m => m.status === 'verified').length, failedMedia: media.filter(m => m.status === 'failed').length,
  permanentFailures: media.filter(m => m.status === 'failed' && m.retryable === false).length, sourceSummary: summary,
  sourceWorkerUsesCurrentCode: watcher.scriptSha256 === scriptSha, sourceWorkerPid: watcher.pid, hostBlock: acquisition.hostBlock ?? null,
  aligned: rows.length, numericalCandidates: rows.filter(r => r.status === 'candidate').length, alignmentHolds: rows.filter(r => r.status === 'hold').length,
  topHoldReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8), publication: await json(join(candidates, 'publication-receipt.json'), null) }, null, 2));
