// Human-source timing adapter for benchmark lane B-human (schema chant-human-retime/v1).
// A reviewed spoken recording, bound to one target passage by trope/human-alignment.mjs, is moved
// onto that target's executed note timeline (the same identity map and B speech plan the pack
// emitted), and the score F0 with a voicing mask is prepared for score-conditioned SVC.
//
// Timing rule (the existing B plan's, trope/speech2sing.py impose): each vowel starts on its first
// note. Between two vowel onsets sit the vowel, its coda and the next syllable's onset consonants.
// Consonants keep their reviewed length unless they would take more than maxConsonantShare of that
// span; then they are shortened together, never below minConsonantRatio, or the passage is
// rejected. The vowel nucleus takes the rest, across every note of a melisma, so a held syllable
// never repeats a consonant or invents a syllable. A phrase's first onset sits in the preceding
// rest, ending on the first note. Final codas sit inside the phrase's last note.
// Source pauses and breaths are dropped; target rests are digital silence. Nothing is normalised.
import { downmix, resample, mapSample, wsola, fade, floatWav, npyFloat32, RESAMPLER, WSOLA } from "./audio-dsp.mjs";
import { bindAlignment } from "./human-alignment.mjs";
import { scoreF0 } from "./speech2sing.mjs";
import { canonicalJson, sha256, BENCHMARK_LIMITS } from "./benchmark-pack.mjs";

export const RETIME_SCHEMA = "chant-human-retime/v1";
export const RETIME_DEFAULTS = Object.freeze({ outputRate: 24000, maxConsonantShare: 0.6, minConsonantRatio: 0.5, minVowelMs: 20,
  fadeMs: 5, maxSplitShiftMs: 2000, f0Fps: 50, warnVowelRatio: 8, warnNoteVowelCoverage: 0.5, releaseMs: 150, releaseGapMs: 40 });
export const OUTPUT_RATES = Object.freeze([16000, 22050, 24000, 44100, 48000]);
// Phonikud characters that carry no voicing; the F0 sent to SVC is 0 over them, as in speech2sing.py.
export const VOICELESS = Object.freeze(["p", "t", "k", "f", "s", "ʃ", "χ", "h", "ʔ", "ts"]);
const voiceless = new Set(VOICELESS);
const SCORE_F0 = Object.freeze({ fps: 1000, glideMs: 80, vibratoHz: 5.5, vibratoCents: 20, leadMs: 200, tailMs: 80 });

export class RetimeError extends Error {
  constructor(code) { super(`Human retiming rejected (${code}); private details withheld`); this.name = "RetimeError"; this.code = code; }
}
const fail = code => { throw new RetimeError(code); };
const round6 = v => Math.round(v * 1e6) / 1e6;

/** Integer split of total in proportion to weights (largest remainder, ties to the earlier item). */
export function spread(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  const raw = weights.map(w => sum > 0 ? w / sum * total : total / weights.length), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

function options(input = {}) {
  const o = { ...RETIME_DEFAULTS, ...input };
  if (Object.keys(input).some(key => !Object.hasOwn(RETIME_DEFAULTS, key)) || !OUTPUT_RATES.includes(o.outputRate)
    || !(o.maxConsonantShare > 0 && o.maxConsonantShare < 1) || !(o.minConsonantRatio > 0 && o.minConsonantRatio <= 1)
    || !(o.minVowelMs > 0) || !(o.fadeMs >= 0 && o.fadeMs <= 20) || !(o.maxSplitShiftMs >= 0) || o.f0Fps !== 50
    || !(o.releaseMs >= 0 && o.releaseMs <= 400) || !(o.releaseGapMs >= 0 && o.releaseGapMs <= 200)) fail("options");
  return Object.freeze(o);
}

/**
 * The deterministic timing plan: every source span, where it lands, at what ratio and by which
 * method; the notes each vowel nucleus carries; and the SVC slice cuts. No audio is touched.
 */
export function planRetime(bound, input) {
  const o = options(input), R = o.outputRate, srcRate = bound.record.recording.sampleRate, { identity, plan } = bound;
  const toSample = ms => Math.round(ms * R / 1000), map = s => mapSample(s, srcRate, R);
  const notes = new Map(identity.notes.map(n => [n.id, n]));
  const totalMs = identity.notes.reduce((end, n) => Math.max(end, n.startMs + n.durationMs), 0);
  if (Math.round(plan.seconds * 1000) !== totalMs || totalMs > BENCHMARK_LIMITS.seconds * 1000) fail("timeline");
  const total = toSample(totalMs);

  // Target syllables from the identity map's executed notes; their notes must be one contiguous run.
  const syllables = identity.syllables.map((s, index) => {
    const own = s.noteIds.map(id => notes.get(id));
    if (own.some(n => !n || n.rest || n.syllableId !== s.id)) fail("note-join");
    own.forEach((n, i) => { if (i && n.startMs !== own[i - 1].startMs + own[i - 1].durationMs) fail("note-join"); });
    return { index, id: s.id, startMs: own[0].startMs, endMs: own.at(-1).startMs + own.at(-1).durationMs, notes: own };
  });
  const phrases = [];
  syllables.forEach((s, i) => { if (!i || syllables[i - 1].endMs !== s.startMs) phrases.push([]); phrases.at(-1).push(s); });
  if (phrases.length !== plan.phrases.length || phrases.some((p, i) => p.length !== plan.phrases[i].syllables.length
    || Math.round(plan.phrases[i].start * 1000) !== p[0].startMs || Math.round(plan.phrases[i].end * 1000) !== p.at(-1).endMs)) fail("phrase-parity");

  const bySyllable = syllables.map(() => ({ onset: [], vowel: null, coda: [] }));
  for (const item of bound.items) {
    const phone = { ...item, voiced: item.role === "vowel" || !voiceless.has(item.phone) };
    if (!item.absent) { phone.srcStart = map(item.start); phone.srcEnd = map(item.end); if (phone.srcEnd <= phone.srcStart) fail("span-too-short"); }
    if (item.role === "vowel") bySyllable[item.syllable].vowel = phone; else bySyllable[item.syllable][item.role].push(phone);
  }
  const pieces = [], warnings = [];
  const length = x => x.absent ? 0 : x.srcEnd - x.srcStart;
  const fit = (consonants, cap, where) => {
    const natural = consonants.reduce((n, c) => n + length(c), 0);
    if (natural <= cap) return consonants.map(length);
    const ratio = cap / natural;
    if (ratio < o.minConsonantRatio) fail("consonant-fit");
    warnings.push({ code: "consonants-compressed", at: where, ratio: round6(ratio) });
    return spread(cap, consonants.map(length)).map((n, i) => consonants[i].absent ? 0 : n);
  };
  const push = (phone, dstStart, dstLength, syllable) => {
    const srcLength = length(phone), method = phone.absent ? "absent" : dstLength === srcLength ? "copy" : "wsola";
    if (!phone.absent && dstLength < 1) fail("consonant-fit");
    pieces.push({ kind: "phone", role: phone.role, syllableId: syllable.id, syllable: syllable.index, position: phone.position, phone: phone.phone,
      voiced: phone.voiced, method, srcStart: phone.srcStart ?? null, srcEnd: phone.srcEnd ?? null, dstStart, dstEnd: dstStart + dstLength,
      ratio: phone.absent ? null : round6(dstLength / srcLength) });
    if (phone.absent) warnings.push({ code: "consonant-absent", at: syllable.id, phone: phone.phone });
  };
  const silence = (from, to) => { if (to > from) pieces.push({ kind: "silence", method: "silence", voiced: false, dstStart: from, dstEnd: to }); };
  let cursor = 0, pendingRelease = null;
  const vowelMin = Math.ceil(o.minVowelMs * R / 1000);
  // A phrase's last sound is released into the following rest instead of stopping dead: the take's own
  // decay or breath when the speaker paused there, otherwise the final vowel (or voiced continuant)
  // carried on. Either way it fades out completely before the next phrase's lead consonant.
  const sourceAfter = new Map([...bound.events.map(e => [map(e.start), map(e.end)]), [map(bound.sourceRegion.end), map(bound.record.recording.frames)]]);
  const CONTINUANT = new Set(["l", "m", "n", "ʁ", "v", "z", "j"]);
  // Returns where the released phrase now ends (the cursor), or null when nothing was released.
  const release = limit => {
    if (!pendingRelease) return null;
    const last = pendingRelease, room = limit - last.dstEnd - Math.round(o.releaseGapMs * R / 1000);
    let len = Math.min(Math.round(o.releaseMs * R / 1000), room);
    pendingRelease = null;
    if (len < Math.round(0.02 * R)) return null;
    const decayEnd = sourceAfter.get(last.srcEnd);
    if (decayEnd !== undefined) {
      len = Math.min(len, decayEnd - last.srcEnd);
      if (len < Math.round(0.02 * R)) return null;
      pieces.push({ kind: "release", method: "copy", role: "release", syllableId: last.syllableId, syllable: last.syllable, phone: null, voiced: false,
        srcStart: last.srcEnd, srcEnd: last.srcEnd + len, dstStart: last.dstEnd, dstEnd: last.dstEnd + len, ratio: 1, source: "take-decay" });
    } else if (last.role === "vowel" || CONTINUANT.has(last.phone)) {
      last.releaseSamples = len; last.dstEnd += len; last.method = "wsola"; last.ratio = round6((last.dstEnd - last.dstStart) / (last.srcEnd - last.srcStart));
    } else return null;
    releases.push({ syllableId: last.syllableId, phone: last.phone, samples: len, source: decayEnd !== undefined ? "take-decay" : "sustained" });
    return last.dstEnd + (decayEnd !== undefined ? len : 0);
  };
  const releases = [];
  for (const phrase of phrases) {
    const b = [...phrase.map(s => toSample(s.startMs)), toSample(phrase.at(-1).endMs)];
    const leadOnsets = bySyllable[phrase[0].index].onset;
    const naturalLead = leadOnsets.reduce((n, c) => n + length(c), 0);
    // The last piece may be a zero-length absent consonant, so the cursor follows the release itself.
    cursor = Math.max(cursor, release(b[0] - Math.min(naturalLead, b[0] - cursor)) ?? cursor);
    const lead = fit(leadOnsets, b[0] - cursor, phrase[0].id), leadLength = lead.reduce((a, c) => a + c, 0);
    silence(cursor, b[0] - leadLength);
    let at = b[0] - leadLength;
    leadOnsets.forEach((c, i) => { push(c, at, lead[i], phrase[0]); at += lead[i]; });
    phrase.forEach((s, k) => {
      const span = b[k + 1] - b[k], own = bySyllable[s.index], next = phrase[k + 1];
      const consonants = [...own.coda, ...(next ? bySyllable[next.index].onset : [])];
      const sizes = fit(consonants, Math.floor(o.maxConsonantShare * span), s.id);
      const vowelLength = span - sizes.reduce((a, c) => a + c, 0);
      if (vowelLength < vowelMin) fail("vowel-fit");
      push(own.vowel, b[k], vowelLength, s);
      const ratio = vowelLength / length(own.vowel);
      if (ratio > o.warnVowelRatio) warnings.push({ code: "vowel-stretch-high", at: s.id, ratio: round6(ratio) });
      let c = b[k] + vowelLength;
      consonants.forEach((phone, i) => { push(phone, c, sizes[i], i < own.coda.length ? s : next); c += sizes[i]; });
      if (c !== b[k + 1]) fail("timeline");
    });
    cursor = b.at(-1);
    pendingRelease = pieces.filter(p => p.kind === "phone" && p.dstEnd > p.dstStart).at(-1);
  }
  cursor = Math.max(cursor, release(total) ?? cursor);
  silence(cursor, total);
  const sounding = pieces.filter(p => p.dstEnd > p.dstStart);
  for (let i = 1; i < sounding.length; i++) if (sounding[i].dstStart !== sounding[i - 1].dstEnd) fail("timeline");
  if (!sounding.length || sounding[0].dstStart !== 0 || sounding.at(-1).dstEnd !== total) fail("timeline");

  // Every note of the passage, with how much of it the syllable's vowel nucleus actually covers.
  const noteMap = syllables.flatMap(s => {
    const vowel = pieces.find(p => p.kind === "phone" && p.role === "vowel" && p.syllable === s.index);
    return s.notes.map(n => {
      const a = toSample(n.startMs), z = toSample(n.startMs + n.durationMs), covered = Math.max(0, Math.min(z, vowel.dstEnd) - Math.max(a, vowel.dstStart));
      const coverage = round6(covered / (z - a));
      if (coverage < o.warnNoteVowelCoverage) warnings.push({ code: "note-mostly-consonant", at: n.id, coverage });
      return { noteId: n.id, syllableId: s.id, midi: n.midi, slur: n.slur, dstStart: a, dstEnd: z, vowelCoverage: coverage };
    });
  });
  const melismas = syllables.filter(s => s.notes.length > 1).map(s => ({ syllableId: s.id, notes: s.notes.length,
    vowelPieces: pieces.filter(p => p.role === "vowel" && p.syllable === s.index).length,
    consonantPieces: pieces.filter(p => p.kind === "phone" && p.role !== "vowel" && p.syllableId === s.id).length }));
  if (melismas.some(m => m.vowelPieces !== 1)) fail("melisma");

  // SVC slices follow the target's split points. A cut inside sound moves back to the latest silence
  // midpoint or syllable attack (onset start, or vowel start without an onset) so no phone is cut.
  const attacks = syllables.map(s => pieces.find(p => p.kind === "phone" && p.syllable === s.index && p.dstEnd > p.dstStart && (p.role === "onset" || p.role === "vowel") && p.syllableId === s.id))
    .map(p => p.dstStart);
  const cuts = [{ at: 0, nominal: 0, by: "start" }];
  for (const segment of identity.segments.slice(1)) {
    const nominal = toSample(segment.startMs), previous = cuts.at(-1).at;
    // A cut is clean only inside silence or exactly at a syllable attack. A cut on a vowel start
    // would leave that syllable's onset consonant at the end of the previous slice.
    const here = sounding.find(p => p.dstStart <= nominal && nominal < p.dstEnd);
    let cut = { at: nominal, nominal, by: "segment-boundary" };
    if (here && here.kind !== "silence" && !attacks.includes(nominal)) {
      const candidates = [
        ...sounding.filter(p => p.kind === "silence" && p.dstEnd <= nominal).map(p => ({ at: Math.floor((p.dstStart + p.dstEnd) / 2), nominal, by: "silence-midpoint" })),
        ...attacks.filter(a => a <= nominal).map(a => ({ at: a, nominal, by: "syllable-attack" })),
      ].filter(c => c.at > previous).sort((a, b) => b.at - a.at);
      if (!candidates.length) fail("split-join");
      cut = candidates[0];
    }
    if (nominal - cut.at > o.maxSplitShiftMs * R / 1000) fail("split-join");
    cuts.push(cut);
  }
  const slices = cuts.map((c, k) => ({ index: k, dstStart: c.at, dstEnd: k + 1 < cuts.length ? cuts[k + 1].at : total, nominalStart: c.nominal, cutBy: c.by }));
  if (slices.some(s => s.dstEnd <= s.dstStart || (s.dstEnd - s.dstStart) > BENCHMARK_LIMITS.segmentSeconds * R)) fail("split-bounds");
  for (const s of slices.slice(1)) {
    if (sounding.some(p => p.kind === "phone" && p.dstStart < s.dstStart && s.dstStart < p.dstEnd)) fail("split-join");
    const before = new Set(pieces.filter(p => p.kind === "phone" && p.dstEnd > p.dstStart && p.dstEnd <= s.dstStart).map(p => p.syllableId));
    if (pieces.some(p => p.kind === "phone" && p.dstEnd > p.dstStart && p.dstStart >= s.dstStart && before.has(p.syllableId))) fail("split-join");
  }

  const dropped = [{ kind: "leading", srcStart: 0, srcEnd: map(bound.sourceRegion.start) }, ...bound.events.map(e => ({ kind: e.kind, srcStart: map(e.start), srcEnd: map(e.end) })),
    { kind: "trailing", srcStart: map(bound.sourceRegion.end), srcEnd: map(bound.record.recording.frames) }].filter(d => d.srcEnd > d.srcStart);
  return { options: o, rate: R, totalSamples: total, totalMs, pieces, noteMap, melismas, slices, dropped, releases, warnings };
}

/** Render the plan from the original samples. Same input bytes and plan give the same samples. */
export function renderRetime(plan, sourceAtRate) {
  const out = new Float64Array(plan.totalSamples), n = Math.round(plan.options.fadeMs * plan.rate / 1000);
  const phones = plan.pieces.filter(p => (p.kind === "phone" || p.kind === "release") && p.dstEnd > p.dstStart);
  for (const p of phones) {
    if (p.srcEnd > sourceAtRate.length) fail("render-bounds");
    const piece = sourceAtRate.slice(p.srcStart, p.srcEnd);
    out.set(p.method === "copy" ? piece : wsola(piece, p.dstEnd - p.dstStart, plan.rate), p.dstStart);
  }
  // Fade only where the waveform is discontinuous: next to silence or across a dropped source pause.
  phones.forEach((p, i) => {
    const before = phones[i - 1], after = phones[i + 1];
    if (!before || before.dstEnd !== p.dstStart || before.srcEnd !== p.srcStart) fade(out, p.dstStart, p.dstEnd, n, "in");
    if (p.kind === "release") fade(out, p.dstStart, p.dstEnd, p.dstEnd - p.dstStart, "out");
    else if (p.releaseSamples) fade(out, p.dstStart, p.dstEnd, p.releaseSamples, "out");
    else if (!after || after.dstStart !== p.dstEnd || after.srcStart !== p.srcEnd) fade(out, p.dstStart, p.dstEnd, n, "out");
  });
  return out;
}

/** Score F0 (Hz, 0 = unvoiced) and voicing per 50 fps frame over [from, to) of the target timeline. */
export function f0Voicing(plan, speechPlan, from = 0, to = plan.totalSamples) {
  const curve = scoreF0(speechPlan.notes, { ...SCORE_F0, seconds: plan.totalMs / 1000 });
  const nearest = new Int32Array(curve.length).fill(-1);
  for (let i = 0, last = -1; i < curve.length; i++) { if (curve[i] > 0) last = i; nearest[i] = last; }
  for (let i = curve.length - 1, next = -1; i >= 0; i--) {
    if (curve[i] > 0) next = i;
    if (next >= 0 && (nearest[i] < 0 || next - i < i - nearest[i])) nearest[i] = next;
  }
  const hop = plan.rate / plan.options.f0Fps, frames = Math.ceil((to - from) / hop), f0 = [], voicing = [];
  const counts = { frames, voiced: 0, silence: 0, voicelessConsonant: 0, unvoicedRelease: 0, filledFromNearest: 0 };
  const pieces = plan.pieces.filter(p => p.dstEnd > p.dstStart);
  let k = 0;
  for (let j = 0; j < frames; j++) {
    const centre = from + Math.floor((j + 0.5) * hop), ms = Math.min(curve.length - 1, Math.floor((from + j * hop) * 1000 / plan.rate));
    while (k < pieces.length - 1 && pieces[k].dstEnd <= centre) k++;
    const p = centre < to ? pieces[k] : null;
    if (!p || p.kind === "silence") { counts.silence++; f0.push(0); voicing.push(0); continue; }
    if (!p.voiced) { counts[p.kind === "release" ? "unvoicedRelease" : "voicelessConsonant"]++; f0.push(0); voicing.push(0); continue; }
    let hz = curve[ms];
    if (!(hz > 0)) { if (nearest[ms] < 0) fail("f0"); hz = curve[nearest[ms]]; counts.filledFromNearest++; }
    counts.voiced++; f0.push(hz); voicing.push(1);
  }
  return { fps: plan.options.f0Fps, hopSamples: hop, sampleRate: plan.rate, startSample: from, frames, f0, voicing, counts };
}

const PATHS = { speech: "retimed-speech.wav", f0: "target-f0.npy", voicing: "f0-voicing.json", map: "retime-map.json" };

/**
 * Bind, plan, render and package. `pack` = { manifestBytes, identityMapBytes, speechPlanBytes };
 * `audio` = { bytes, wav }; `code` = { revision, fileHashes }; alignmentFileSha256 = the exact
 * record file's hash. Returns canonical artifacts (paths -> bytes) with manifest.json last.
 */
export function buildHumanRetime(record, pack, audio, { code, alignmentFileSha256, options: input = {} }) {
  try {
    const bound = bindAlignment(record, pack, audio), plan = planRetime(bound, input), r = record.recording;
    const source = resample(downmix(audio.wav, r.downmix), r.sampleRate, plan.rate);
    const speech = renderRetime(plan, source);
    const full = f0Voicing(plan, bound.plan), artifacts = {}, roles = {};
    const add = (path, bytes, role) => { artifacts[path] = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes); roles[path] = role; };
    add(PATHS.speech, floatWav(speech, plan.rate), "retimed-speech");
    add(PATHS.f0, npyFloat32(full.f0), "target-f0");
    const slices = plan.slices.map(s => {
      const f = f0Voicing(plan, bound.plan, s.dstStart, s.dstEnd), base = `slices/s${s.index}`;
      add(`${base}.wav`, floatWav(speech.subarray(s.dstStart, s.dstEnd), plan.rate), "retimed-speech-slice");
      add(`${base}-f0.npy`, npyFloat32(f.f0), "target-f0-slice");
      return { ...s, wav: `${base}.wav`, f0: `${base}-f0.npy`, frames: f.frames, voicedFrames: f.counts.voiced };
    });
    add(PATHS.voicing, canonicalJson({ schema: "chant-human-f0-voicing/v1", source: "score F0 sampled at each frame start from a 1 kHz scoreF0 curve; voicing from the retime map at each frame centre",
      scoreF0: SCORE_F0, voiceless: VOICELESS, full, slices: plan.slices.map(s => f0Voicing(plan, bound.plan, s.dstStart, s.dstEnd)) }), "f0-voicing");
    const peak = speech.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    add(PATHS.map, canonicalJson({ schema: "chant-human-retime-map/v1", targetHash: record.target.targetHash, passageId: record.target.passageId,
      units: { source: `original samples mapped to ${plan.rate} Hz by mapSample`, target: `${plan.rate} Hz samples of the executed timeline` },
      totalSamples: plan.totalSamples, totalMs: plan.totalMs, pieces: plan.pieces, notes: plan.noteMap, melismas: plan.melismas, slices, dropped: plan.dropped, releases: plan.releases,
      warnings: plan.warnings, absentConsonants: plan.pieces.filter(p => p.method === "absent").length, peakAbsolute: round6(peak), reviewDeviation: bound.reviewDeviation }), "retime-map");
    const manifest = { schema: RETIME_SCHEMA, releaseStatus: "private-unreleased", lane: "B-human", stage: "retime",
      targetReview: "pending", targetReviewAssertion: record.target.targetReviewRecordId
        ? { recordId: record.target.targetReviewRecordId, meaning: "asserted by the alignment record only; not verified here" } : null,
      binding: { benchmarkId: record.target.benchmarkId, passageId: record.target.passageId, targetHash: record.target.targetHash,
        packManifestSha256: record.target.manifestSha256, identityMapSha256: record.target.identityMapSha256, speechPlanSha256: record.target.speechPlanSha256,
        alignmentId: record.alignmentId, alignmentCanonicalSha256: sha256(canonicalJson(record)), alignmentFileSha256, targetReviewRecordId: record.target.targetReviewRecordId,
        annotationReviewRecordId: record.annotation.reviewRecordId, annotationMethod: record.annotation.method,
        reviewGranularity: record.annotation.reviewGranularity ?? "phone" },
      original: { role: "original-speech", sha256: r.audioSha256, encoding: r.encoding, sampleRate: r.sampleRate, channels: r.channels, frames: r.frames,
        downmix: r.downmix, handling: "read-only input to this stage: not copied, rewritten or normalised; the CLI re-hashes it before writing outputs" },
      consent: { recordId: r.consentRecordId, scope: r.consentScope, verification: "recorded-only; the record identifier does not establish consent" },
      speaker: { speakerId: r.speakerId, sampleId: r.sampleId, takeNumber: r.takeNumber },
      method: { resampler: RESAMPLER, timeScale: WSOLA, timing: "vowel onset on first note; consonants kept unless over maxConsonantShare; vowel nucleus spans every note of its syllable",
        rests: "digital silence after each phrase's release; source pauses and breaths otherwise dropped",
        release: "a phrase's last sound fades over up to releaseMs into the rest: the take's own decay where the speaker paused, else the final vowel or voiced continuant sustained", options: plan.options, normalisation: "none", outputFormat: "float32 mono WAV" },
      outputs: { originalSpeech: "not-copied", retimedSpeech: PATHS.speech, dspPitchBaseline: "not-produced", neuralOutput: "not-produced" },
      code, f0Parity: "score F0 from the same B speech plan notes; not a claim about any rendered pitch",
      artifacts: Object.fromEntries(Object.entries(artifacts).map(([path, bytes]) => [path, { role: roles[path], sha256: sha256(bytes), bytes: bytes.length }])) };
    const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
    artifacts["manifest.json"] = manifestBytes;
    return Object.freeze({ manifest, manifestSha256: sha256(manifestBytes), artifacts: Object.freeze(artifacts), plan });
  } catch (error) {
    if (error instanceof RetimeError || error?.name === "AlignmentError" || error?.name === "AudioDspError") throw error;
    fail("internal");
  }
}
