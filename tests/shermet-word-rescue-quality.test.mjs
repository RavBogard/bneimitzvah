import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qualifyWordRescue } from '../scripts/shermet-word-rescue-quality.mjs';
const fixture = () => {
  const source = { kind: 'torah', ref: 'Genesis 1:1', sha256: 'a'.repeat(64) };
  const target = { readingText: 'synthetic fixture', words: ['synthetic', 'fixture'] };
  const timing = { ...source, version: 1, status: 'ready', audioSha256: source.sha256, readingTextSha256: createHash('sha256').update(target.readingText).digest('hex'), wordCount: 2,
    duration: 2, words: [{ start: .1, end: .8 }, { start: 1, end: 1.8 }] };
  const candidate = { pipelineVersion: 'shermet-word-consensus-dc-v1', rescueCodeVersion: 'word-consensus-dc-v1-feature-and-unit-binding', status: 'candidate', reasons: [], timing,
    quality: { wordComparison: { medianStart: .003, maxStart: .017, maxEnd: .02 }, primaryFeatureMaxDifference: 1e-7, longestUnassignedVoicedGap: .04,
      meanPhoneScore: .4, minimumWordScore: .12, firstStableAcoustic: .08, lastStableAcoustic: 1.8, endpoints: [{}, {}] } };
  return { source, target, candidate };
};
const parse = value => value;
test('requires source/text identity and independent word/acoustic checks', () => {
  const { source, target, candidate } = fixture();
  assert.equal(qualifyWordRescue(candidate, source, target, parse), candidate.timing);
  for (const mutate of [
    c => c.status = 'hold', c => c.quality.wordComparison.maxStart = .2,
    c => c.quality.primaryFeatureMaxDifference = .01, c => c.quality.longestUnassignedVoicedGap = .2,
    c => c.quality.meanPhoneScore = NaN, c => c.timing.audioSha256 = 'b'.repeat(64),
    c => c.timing.readingTextSha256 = 'b'.repeat(64), c => c.quality.minimumWordScore = .01,
  ]) { const changed = fixture().candidate; mutate(changed); assert.equal(qualifyWordRescue(changed, source, target, parse), null); }
});
test('independent poor corroboration vetoes only the exact audio binding', () => {
  const { source, target, candidate } = fixture();
  const audit = { ref: source.ref, audioSha256: source.sha256, lexical: .081, medianOverlap: .8, zeroOverlapFraction: 0 };
  assert.equal(qualifyWordRescue(candidate, source, target, parse, audit), null);
  assert.equal(qualifyWordRescue(candidate, source, target, parse, { ...audit, audioSha256: 'b'.repeat(64) }), candidate.timing);
});
test('lower phone confidence needs exact-unit independent evidence for the same audio', () => {
  const { source, target, candidate } = fixture(); candidate.quality.minimumWordScore = .05;
  candidate.quality.independentWhisper = { audioSha256: source.sha256, wordUnitsExact: true, lexical: .9, minimumOverlap: .8, medianOverlap: .85, zeroOverlapWords: 0 };
  assert.equal(qualifyWordRescue(candidate, source, target, parse), candidate.timing);
  candidate.quality.independentWhisper.audioSha256 = 'b'.repeat(64);
  assert.equal(qualifyWordRescue(candidate, source, target, parse), null);
});
