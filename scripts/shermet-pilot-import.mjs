// Selective, explicit public-sheet acquisition. All downloaded material stays outside Git.
// Usage: node scripts/shermet-pilot-import.mjs <outside-git-directory> <sheet-id> [...]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { insideGitWorkingTree } from './private-paths.mjs';

const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = html => String(html ?? '').replace(/<[^>]*>/g, '').trim();
const TORAH = /^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy) \d+:\d+$/;
const PROPHETS = /^(Joshua|Judges|[12] Samuel|[12] Kings|Isaiah|Jeremiah|Ezekiel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi) \d+:\d+$/;

export function extractFullVerses(sheet) {
  if (sheet.status !== 'public' || !Array.isArray(sheet.sources)) throw new Error('Expected a public source sheet');
  const credit = sheet.sources.map(s => plain(s.comment)).find(t => /All audio recordings by Cantor Wendy Shermet .*used with permission/.test(t));
  if (!credit) throw new Error('Missing explicit Shermet attribution');
  const recordings = [];
  let ref;
  const seen = new Set();
  for (let i = 0; i < sheet.sources.length; i++) {
    const source = sheet.sources[i];
    if (source.ref) ref = source.ref;
    if (plain(source.comment) !== 'Full Verse Chanted') continue;
    const kind = TORAH.test(ref) ? 'torah' : PROPHETS.test(ref) ? 'haftarah' : undefined;
    if (!kind) throw new Error('Full verse must follow an unambiguous single-verse reference');
    const media = sheet.sources[i + 1];
    if (!media?.media || media.ref || media.comment) throw new Error('Full verse must immediately precede media');
    const url = new URL(media.media);
    if (url.protocol !== 'https:' || url.hostname !== 'images.shulcloud.com' || !/^\/14396\/\d+\.mp3$/.test(url.pathname) || url.search || url.hash) throw new Error('Unexpected full-verse media origin or path');
    if (seen.has(ref)) throw new Error('Duplicate verse reference');
    seen.add(ref);
    recordings.push({ kind, ref, sourceUrl: url.href, sourceNode: media.node });
  }
  if (!recordings.length) throw new Error('No explicitly labeled full verses');
  return { credit, recordings };
}

async function get(url, maxBytes) {
  const response = await fetch(url, { redirect: 'error', headers: { 'User-Agent': 'CRC-Torah selective human-recording research importer' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Public source request failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Public source exceeds acquisition size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function importSheets(outputDirectory, sheetIds) {
  if (!sheetIds.length || sheetIds.length > 5 || sheetIds.some(id => !/^\d+$/.test(id))) throw new Error('Supply one to five explicit public sheet IDs');
  const output = resolve(outputDirectory);
  if (await insideGitWorkingTree(output)) throw new Error('Acquired material must stay outside every Git working tree');
  await mkdir(output, { recursive: true });
  const records = [], sources = [];
  for (const id of sheetIds) {
    const apiUrl = `https://www.sefaria.org/api/sheets/${id}`;
    const bytes = await get(apiUrl, 5_000_000);
    const sheet = JSON.parse(bytes.toString('utf8'));
    if (String(sheet.id) !== id) throw new Error('Sheet ID mismatch');
    const parsed = extractFullVerses(sheet);
    if (records.length + parsed.recordings.length > 30) throw new Error('Pilot is limited to thirty explicitly selected verses');
    await writeFile(join(output, `sheet-${id}.json`), bytes);
    sources.push({ id, url: `https://voices.sefaria.org/sheets/${id}`, apiUrl, sha256: hash(bytes), credit: parsed.credit });
    for (const record of parsed.recordings) {
      if (records.some(r => r.ref === record.ref)) throw new Error('Overlapping sheet references');
      const audio = await get(record.sourceUrl, 15_000_000);
      const sha256 = hash(audio), file = `${sha256}.mp3`, path = join(output, file);
      await writeFile(path, audio);
      const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,sample_rate,channels', '-of', 'json', path], { windowsHide: true });
      const metadata = JSON.parse(probe.stdout), duration = Number(metadata.format?.duration);
      if (!Number.isFinite(duration) || duration < 2 || duration > 300 || !metadata.streams?.some(s => s.codec_type === 'audio' && s.codec_name === 'mp3')) throw new Error('Expected a playable MP3 whole verse');
      await run('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { windowsHide: true });
      records.push({ ...record, file, sha256, bytes: audio.length, duration, streams: metadata.streams, decode: 'passed', sheetId: id });
    }
  }
  const catalogPath = join(output, 'catalog.json');
  let previous = { version: 1, recordings: [] };
  try { previous = JSON.parse(await readFile(catalogPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous.version !== 1 || !Array.isArray(previous.recordings)) throw new Error('Unsupported existing catalog');
  const recordings = new Map(previous.recordings.map(r => [`${r.kind}:${r.ref}`, r]));
  for (const { kind, ref, file } of records) recordings.set(`${kind}:${ref}`, { kind, ref, file });
  await writeFile(catalogPath, JSON.stringify({ version: 1, recordings: [...recordings.values()] }, null, 2) + '\n');
  const manifest = { version: 1, acquiredAt: new Date().toISOString(), scope: 'Selective local pilot; source permission statement documents its use, not a grant to CRC. No publication by this importer.', sources, recordings: records };
  await writeFile(join(output, 'sefaria-source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { recordings: records.length, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...ids] = process.argv.slice(2);
  if (!output) throw new Error('Supply an output directory outside Git');
  console.log(JSON.stringify(await importSheets(output, ids)));
}
