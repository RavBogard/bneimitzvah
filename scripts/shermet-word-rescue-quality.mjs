import { createHash } from 'node:crypto';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function qualifyWordRescue(candidate, source, target, parseTiming, audit) {
  if (candidate?.pipelineVersion !== 'shermet-word-consensus-dc-v1' || candidate.status !== 'candidate' || !Array.isArray(candidate.reasons) || candidate.reasons.length
    || candidate.rescueCodeVersion !== 'word-consensus-dc-v1-feature-and-unit-binding') return null;
  const timing = parseTiming(candidate.timing), quality = candidate.quality;
  if (!timing || !source || !target || timing.audioSha256 !== source.sha256 || timing.kind !== source.kind || timing.ref !== source.ref
    || createHash('sha256').update(target.readingText.normalize('NFC')).digest('hex') !== timing.readingTextSha256 || target.words.length !== timing.wordCount) return null;
  const word = quality?.wordComparison;
  if (!word || ![word.medianStart, word.maxStart, word.maxEnd, quality.primaryFeatureMaxDifference, quality.longestUnassignedVoicedGap,
    quality.meanPhoneScore, quality.minimumWordScore, quality.firstStableAcoustic, quality.lastStableAcoustic].every(finite)
    || word.medianStart > .03 || word.maxStart > .12 || word.maxEnd > .16 || quality.primaryFeatureMaxDifference > .0001
    || quality.longestUnassignedVoicedGap > .12 || quality.endpoints?.length !== timing.wordCount
    || timing.words[0].start > quality.firstStableAcoustic + .5 || timing.words.at(-1).end < quality.lastStableAcoustic - .25) return null;
  const whisper = quality.independentWhisper;
  const corroborated = whisper && whisper.audioSha256 === timing.audioSha256 && whisper.wordUnitsExact === true && [whisper.lexical, whisper.minimumOverlap, whisper.medianOverlap].every(finite)
    && whisper.lexical >= .8 && whisper.minimumOverlap >= .45 && whisper.medianOverlap >= .75 && whisper.zeroOverlapWords === 0;
  if ((quality.meanPhoneScore < .25 || quality.minimumWordScore < .08)
    && !(corroborated && quality.meanPhoneScore >= .3 && quality.minimumWordScore >= .03)) return null;
  if (audit && audit.ref === timing.ref && audit.audioSha256 === timing.audioSha256
    && (![audit.lexical, audit.medianOverlap, audit.zeroOverlapFraction].every(finite) || audit.lexical < .6 || audit.medianOverlap < .35 || audit.zeroOverlapFraction > .34)) return null;
  return timing;
}
