// Numerical timing metadata only. Never publishes an alignment hold or source text.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insideGitWorkingTree } from './private-paths.mjs';
import { loadTimingParser } from './shermet-source-runtime.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const PIPELINE = 'shermet-ctc-native-grid-energy-v3';

export async function publishTimings(candidateDirectory, manifestFile, projectionFile, independentAuditFile) {
  if (await insideGitWorkingTree(candidateDirectory)) throw new Error('Alignment candidates must stay outside Git');
  const { parseShermetTiming } = await loadTimingParser(candidateDirectory);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const projection = JSON.parse(await readFile(projectionFile, 'utf8'));
  const independentBytes = await readFile(independentAuditFile);
  const independent = JSON.parse(independentBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(independent) || !independent.some(row => row.characterMatch >= .8 && row.exactTokens >= 2 && row.medianOverlapShorterWord >= .25 && row.noOverlap <= 1)) throw new Error('A real independent acoustic/text comparison cohort is required');
  const sources = new Map(manifest.recordings.map(row => [row.ref, row]));
  const timings = new Map(); let held = 0;
  for (const file of await readdir(candidateDirectory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const candidate = JSON.parse(await readFile(join(candidateDirectory, file), 'utf8'));
    if (candidate.pipelineVersion !== PIPELINE || candidate.status !== 'candidate' || candidate.reasons?.length) { held++; continue; }
    const timing = parseShermetTiming(candidate.timing), source = sources.get(candidate.timing?.ref);
    const target = projection.verses[candidate.timing?.ref];
    const quality = candidate.quality, comparison = quality?.independentComparison;
    if (!timing || !source || source.sha256 !== timing.audioSha256 || source.kind !== timing.kind || !target
      || hash(target.readingText.normalize('NFC')) !== timing.readingTextSha256 || target.words.length !== timing.wordCount
      || !comparison || comparison.p95PhoneStartDifference > .12 || comparison.maxPhoneStartDifference > .3
      || quality.meanPhoneScore < .25 || quality.minimumWordScore < .08 || quality.endpoints?.length !== timing.wordCount) { held++; continue; }
    timings.set(timing.ref, timing);
  }
  const books = new Map();
  for (const timing of timings.values()) {
    const book = timing.ref.replace(/ \d+:\d+$/, ''), rows = books.get(book) ?? []; rows.push(timing); books.set(book, rows);
  }
  const shardDirectory = new URL('../src/server/shermet-audio/timing-shards/', import.meta.url); await mkdir(shardDirectory, { recursive: true });
  const loaders = [];
  for (const [book, rows] of books) {
    const filename = book.toLowerCase().replace(/ /g, '-') + '.ts';
    await writeFile(new URL(filename, shardDirectory), 'import type { ShermetTiming } from "../../../lib/reference-audio/shermet-timing";\nconst rows: readonly ShermetTiming[] = ' + JSON.stringify(rows) + ';\nexport default rows;\n');
    loaders.push(`${JSON.stringify(book)}: () => import(${JSON.stringify('./timing-shards/' + filename.replace(/\.ts$/, ''))})`);
  }
  const code = 'import { parseShermetTiming, type ShermetTiming } from "../../lib/reference-audio/shermet-timing";\n'
    + '// Generated SHA-bound numerical metadata. Book shards load only when requested.\n'
    + `const loaders: Record<string, () => Promise<{ default: readonly ShermetTiming[] }>> = {${loaders.join(',')}};\n`
    + 'export async function getShermetTiming(ref: string, audioSha256: string): Promise<ShermetTiming | null> {\n'
    + ' const load = loaders[ref.replace(/ [0-9]+:[0-9]+$/, "")]; if (!load) return null;\n'
    + ' const rows = (await load()).default.filter(row => row.ref === ref && row.audioSha256 === audioSha256);\n'
    + ' return rows.length === 1 ? parseShermetTiming(rows[0]) : null;\n}\n'
    + '// Compatibility seed; runtime routes use the lazy lookup above.\nexport const SHERMET_TIMINGS: readonly ShermetTiming[] = [];\n';
  await writeFile(new URL('../src/server/shermet-audio/timing-catalog.ts', import.meta.url), code);
  const result = { pipelineVersion: PIPELINE, published: timings.size, shards: books.size, held,
    independentAuditSha256: hash(independentBytes), sourceRuntimeSha256: projection.sourceRuntimeSha256, publishedAt: new Date().toISOString() };
  await writeFile(join(candidateDirectory, 'publication-receipt.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 6) throw new Error('Supply candidate directory, verified manifest, current projection and independent audit file');
  console.log(JSON.stringify(await publishTimings(...process.argv.slice(2))));
}
