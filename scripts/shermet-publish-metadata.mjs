// Publish verified metadata only; source media and text never enter this tree.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCanonicalReading } from './shermet-source-runtime.mjs';
import { insideGitWorkingTree } from './private-paths.mjs';

export async function publishMetadata(directory, seedManifests = []) {
  if (await insideGitWorkingTree(directory)) throw new Error('Source metadata must be read from outside Git');
  const root = resolve(directory), { canonicalReadingRef } = await loadCanonicalReading(root);
  const manifest = JSON.parse(await readFile(join(root, 'public-verse-manifest.json'), 'utf8'));
  const rows = new Map();
  for (const entry of manifest.recordings) rows.set(`${entry.kind}:${entry.ref}`, entry);
  for (const path of seedManifests) {
    const seed = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
    for (const entry of seed.recordings) {
      const sourceId = entry.sourceId ?? Number(/^https:\/\/images\.shulcloud\.com\/14396\/(\d+)\.mp3$/.exec(entry.sourceUrl)?.[1]);
      rows.set(`${entry.kind}:${entry.ref}`, { ...entry, sourceId });
    }
  }
  const recordings = [...rows.values()].map(entry => {
    const parsed = canonicalReadingRef(entry.ref, entry.kind);
    if (!parsed || parsed.verses.length !== 1 || parsed.verses[0] !== entry.ref || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.sourceId) || entry.sourceId < 1 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw new Error(`Invalid verified public entry: ${entry.ref}`);
    return { kind: entry.kind, ref: entry.ref, sourceId: entry.sourceId, sha256: entry.sha256, bytes: entry.bytes, mimeType: entry.mimeType ?? 'audio/mpeg' };
  });
  const generated = '// Generated verified metadata only. Source receipts and media remain outside Git.\n'
    + 'export type ShermetRecording = Readonly<{kind: "torah" | "haftarah"; ref: string; sourceId: number; sha256: string; bytes: number; mimeType: "audio/mpeg" | "audio/wav"}>;\n'
    + `export const SHERMET_PILOT_RECORDINGS: readonly ShermetRecording[] = ${JSON.stringify(recordings, null, 2)};\n`;
  await writeFile(new URL('../src/server/shermet-audio/collection-metadata.ts', import.meta.url), generated);
  await writeFile(new URL('../src/server/shermet-audio/pilot-metadata.ts', import.meta.url), '// Public metadata only; source media stays outside Git.\n// Attribution: https://www.templeisraelomaha.com/cantors-classroom\n// Source provenance is retained in the external collection inventory and acquisition receipts.\nexport { SHERMET_PILOT_RECORDINGS } from "./collection-metadata";\n');
  const catalog = JSON.parse(await readFile(join(root, 'nonverse-catalog.json'), 'utf8'));
  await writeFile(new URL('../src/server/shermet-audio/nonverse-catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
  return { ordinaryRecordings: recordings.length, libraryItems: catalog.items.length, availableLibraryItems: catalog.items.filter(i => i.status === 'available').length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, ...seeds] = process.argv.slice(2);
  if (!directory) throw new Error('Supply the external collection directory and optional independently verified seed manifests');
  console.log(JSON.stringify(await publishMetadata(directory, seeds)));
}
