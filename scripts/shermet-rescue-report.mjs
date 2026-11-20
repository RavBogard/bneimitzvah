// Read-only qualification report; never publishes app artifacts or source text.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadTimingParser } from './shermet-source-runtime.mjs';
import { qualifyWordRescue } from './shermet-word-rescue-quality.mjs';
const [directory, manifestFile, projectionFile, auditFile, priorityFile] = process.argv.slice(2);
if (!auditFile) throw new Error('Supply rescues, verified manifest, projection, independent audit and optional curriculum refs');
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const { parseShermetTiming } = await loadTimingParser(directory), manifest = await json(manifestFile), projected = await json(projectionFile), audit = await json(auditFile);
const source = new Map(manifest.recordings.map(row => [row.ref, row]));
const qa = new Map(audit.map(row => [`${row.ref}:${row.audioSha256}`, row]));
const priorities = new Set(priorityFile ? (await json(priorityFile)).refs : []);
let attempted = 0, candidates = 0, qualified = 0, curriculumQualified = 0;
const holds = {};
for (const file of await readdir(directory)) {
  if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
  const candidate = await json(join(directory, file)); attempted++;
  if (candidate.status === 'candidate') candidates++;
  const timing = qualifyWordRescue(candidate, source.get(candidate.timing?.ref), projected.verses[candidate.timing?.ref], parseShermetTiming,
    qa.get(`${candidate.timing?.ref}:${candidate.timing?.audioSha256}`));
  if (timing) { qualified++; if (priorities.has(timing.ref)) curriculumQualified++; }
  for (const reason of candidate.reasons ?? []) holds[reason] = (holds[reason] ?? 0) + 1;
}
console.log(JSON.stringify({ attempted, numericalCandidates: candidates, publisherQualified: qualified, curriculumQualified,
  topHoldReasons: Object.entries(holds).sort((a, b) => b[1] - a[1]).slice(0, 7) }, null, 2));
