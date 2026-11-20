// Untimed linguistic targets only. No melody, score, note timeline or audio is built.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { insideGitWorkingTree } from './private-paths.mjs';
const [inputFile, voiceRepository, destination] = process.argv.slice(2);
if (!destination || await insideGitWorkingTree(destination)) throw new Error('Supply private input, authorized read-only engine repository and external destination');
const hash = value => createHash('sha256').update(value).digest('hex');
const root = resolve(destination), inputBytes = await readFile(inputFile), input = JSON.parse(inputBytes.toString('utf8').replace(/^\uFEFF/, ''));
if (!Array.isArray(input.passages) || input.passages.length > 12) throw new Error('Expected a bounded existing MAM input pack');
const { verseUnits } = await import(pathToFileURL(join(voiceRepository, 'trope/text.mjs')).href);
const { syllablePhones } = await import(pathToFileURL(join(voiceRepository, 'trope/speech2sing.mjs')).href);
const pronunciationBytes = await readFile(join(voiceRepository, 'trope/pronunciation.json'));
const pronunciation = JSON.parse(pronunciationBytes).profiles['israeli-v1'];
const provenance = { inputSha256: hash(inputBytes), pronunciationSha256: hash(pronunciationBytes),
  textCodeSha256: hash(await readFile(join(voiceRepository, 'trope/text.mjs'))), phoneCodeSha256: hash(await readFile(join(voiceRepository, 'trope/speech2sing.mjs'))),
  purpose: 'Untimed Hebrew word/syllable phones for alignment of existing human recordings; no melody or generated audio' };
await mkdir(root, { recursive: true });
const passages = [], artifacts = {}; let wordCount = 0;
for (const [index, passage] of input.passages.entries()) {
  if (!/^[A-Za-z0-9 ]+ [1-9]\d*:[1-9]\d*$/.test(passage.ref) || typeof passage.he !== 'string' || hash(passage.he) !== passage.textSha256) throw new Error('Invalid source reference or text digest');
  const units = verseUnits(passage.he, { ref: passage.ref, pronunciation });
  if (!units.units.length || units.warnings.length) throw new Error('Linguistic target has unresolved units; hold for review');
  const targetHash = hash(JSON.stringify({ ref: passage.ref, textSha256: passage.textSha256, provenance }));
  const words = [], syllables = [];
  for (const [unitIndex, unit] of units.units.entries()) {
    const ids = unit.words.map((he, wordIndex) => { const id = `${targetHash}:u${unitIndex}:w${wordIndex}`; words.push({ id, he, index: words.length }); return id; });
    for (const [syllableIndex, syllable] of unit.syllables.entries()) {
      if (!ids[syllable.word] || !syllable.ph.some(phone => pronunciation.symbols[phone]?.type === 'vowel')) throw new Error('A linguistic syllable lacks a real word or vowel');
      syllables.push({ wordId: ids[syllable.word], unit: unitIndex, syllable: syllableIndex, he: syllable.he, bPhones: syllablePhones(syllable, pronunciation) });
    }
  }
  const directory = `P${String(index).padStart(3, '0')}`; await mkdir(join(root, directory), { recursive: true });
  const bytes = JSON.stringify({ schema: 'shermet-untimed-identity/v1', ref: passage.ref, targetHash, words, syllables, provenance });
  await writeFile(join(root, directory, 'identity-map.json'), bytes);
  artifacts[`${directory}/identity-map.json`] = { sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
  passages.push({ ref: passage.ref, directory, id: directory, textSha256: passage.textSha256, targetHash });
  wordCount += words.length;
}
await writeFile(join(root, 'manifest.json'), JSON.stringify({ schema: 'shermet-untimed-phones/v1', passages, artifacts, provenance }, null, 2));
console.log(JSON.stringify({ passages: passages.length, words: wordCount, output: root, noTimingOrAudio: true }));
