// Synthetic waveforms only: tones for vowels, noise for voiceless consonants, buzz for voiced ones.
// Targets come from invented syllables or existing permitted MAM fixtures. No real voice, recording,
// private text or model is used, and every CLI output stays in a temporary directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { buildBenchmarkPack, canonicalJson, sha256 } from "../trope/benchmark-pack.mjs";
import { parseWav, resample, wsola, npyFloat32, floatWav, mapSample, AudioDspError } from "../trope/audio-dsp.mjs";
import { validateAlignmentRecord, bindAlignment, applyWordListeningReview, AlignmentError } from "../trope/human-alignment.mjs";
import { buildHumanRetime, planRetime, spread, RetimeError, VOICELESS } from "../trope/human-retime.mjs";
import { buildRunRecord, buildListeningKey, RunRecordError } from "../trope/benchmark-run.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../scripts/trope-human-retime.mjs", import.meta.url));
const run = promisify(execFile), clone = value => structuredClone(value);
const load = path => readFileSync(new URL(path, import.meta.url), "utf8");
const voiceless = new Set(VOICELESS);

function packFor(he, ref, table = "torah", style = "v2", flags = {}) {
  const input = { schema: "chant-benchmark-input/v1", benchmarkId: "synthetic-benchmark",
    source: { edition: "Synthetic source", sourceRecordId: "source-test", rightsRecordId: "rights-test", approvalRecordId: "approval-test" },
    pronunciation: { profile: "israeli-v1", confirmationRecordId: "pronunciation-test", divineNames: "ceremony-adonai-elohim" },
    performance: { key: "D3", tempo: 96, table, style },
    passages: [{ id: "P01", ref, he, textSha256: sha256(he), flags: { final: false, endOfAliyah: false, endOfBook: false, special: null, ...flags } }] };
  const pack = buildBenchmarkPack(input, { tableJson: load(`../trope/cells/${table}.json`), pronunciationJson: load("../trope/pronunciation.json"),
    code: { revision: "a".repeat(40), files: { "trope/benchmark-pack.mjs": "synthetic-code" } }, inputFileSha256: null });
  const bytes = name => Buffer.from(pack.artifacts[name], "utf8");
  return { pack, files: { manifestBytes: bytes("manifest.json"), identityMapBytes: bytes("P01/identity-map.json"), speechPlanBytes: bytes("P01/b-speech-plan.json") },
    identity: JSON.parse(pack.artifacts["P01/identity-map.json"]), plan: JSON.parse(pack.artifacts["P01/b-speech-plan.json"]) };
}
const fixture = ref => JSON.parse(load("./fixtures/trope/calibration-torah.json")).verses.find(v => v.ref === ref);

function pcm24(samples, rate, channels = 1) {
  const frames = samples.length / channels, size = samples.length * 3, b = Buffer.alloc(44 + size);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + size, 4); b.write("WAVE", 8, "ascii"); b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 3 * channels, 28); b.writeUInt16LE(3 * channels, 32); b.writeUInt16LE(24, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(size, 40);
  for (let i = 0; i < samples.length; i++) b.writeIntLE(Math.max(-8388608, Math.min(8388607, Math.round(samples[i] * 8388608))), 44 + i * 3, 3);
  assert.equal(frames, Math.floor(frames)); return b;
}

/** A synthetic "speaker": each phone of the identity map gets a span; vowels are tones. */
function synthetic(identity, { rate = 24000, consonantMs = 50, vowelMs = 90, pauseAfter = new Set([1]), encoding = "pcm24", proposals = false } = {}) {
  const samples = [], syllables = [], events = [];
  let at = Math.round(0.2 * rate), seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 1073741824 - 1; };
  const lead = Array.from({ length: at }, () => 0.001 * noise());
  samples.push(...lead);
  const add = (n, gen) => { const start = at; for (let i = 0; i < n; i++) samples.push(gen(i)); at += n; return { start, end: at }; };
  const phoneSpan = (phone, ms, gen) => {
    const reviewed = add(Math.round(ms * rate / 1000), gen);
    return { phone, proposed: proposals ? { start: reviewed.start + 24, end: reviewed.end - 24 } : null, reviewed };
  };
  const consonant = phone => voiceless.has(phone) ? i => 0.2 * noise() : i => 0.2 * Math.sign(Math.sin(2 * Math.PI * 110 * i / rate));
  identity.syllables.forEach((s, k) => {
    const onset = s.bPhones.onset.map(p => phoneSpan(p, consonantMs, consonant(p)));
    const hz = 180 + 20 * (k % 5);
    const vowel = phoneSpan(s.bPhones.vowel.join(""), vowelMs, i => 0.4 * Math.sin(2 * Math.PI * hz * i / rate));
    const coda = s.bPhones.coda.map(p => phoneSpan(p, consonantMs, consonant(p)));
    syllables.push({ syllableId: s.id, onset, vowel, coda });
    if (pauseAfter.has(k) && k < identity.syllables.length - 1) {
      const reviewed = add(Math.round(0.12 * rate), () => 0.001 * noise());
      events.push({ kind: "pause", proposed: proposals ? reviewed : null, reviewed });
    }
  });
  samples.push(...Array.from({ length: Math.round(0.2 * rate) }, () => 0.001 * noise()));
  const bytes = encoding === "float32" ? Buffer.from(floatWav(Float64Array.from(samples), rate)) : pcm24(samples, rate);
  return { bytes, samples: Float64Array.from(samples), syllables, events, frames: samples.length, rate, encoding };
}
function recordFor(target, audio, extra = {}) {
  const manifest = JSON.parse(target.files.manifestBytes);
  return { schema: "chant-human-alignment/v1", alignmentId: "align-test",
    target: { benchmarkId: manifest.benchmarkId, manifestSha256: sha256(target.files.manifestBytes), passageId: "P01", targetHash: manifest.passages[0].targetHash,
      identityMapSha256: sha256(target.files.identityMapBytes), speechPlanSha256: sha256(target.files.speechPlanBytes), targetReviewRecordId: null },
    recording: { sampleId: "sample-test", role: "spoken", speakerId: "speaker-test", takeNumber: 1, audioSha256: sha256(audio.bytes), encoding: audio.encoding,
      sampleRate: audio.rate, channels: 1, frames: audio.frames, downmix: "none", consentRecordId: "consent-test",
      consentScope: { privateEvaluationPlayback: true, localProcessing: true, voiceConversion: true, cloudProcessing: false, training: false, distribution: false } },
    annotation: { units: "samples", method: extra.proposals ? "proposed-then-reviewed" : "manual", proposalSource: extra.proposals ? "aligner-test" : null, reviewState: "reviewed", reviewRecordId: "review-test" },
    syllables: clone(audio.syllables), events: clone(audio.events) };
}
const audioOf = a => ({ bytes: a.bytes, wav: parseWav(new Uint8Array(a.bytes)) });
const build = (record, target, audio, options = {}) => buildHumanRetime(record, target.files, audioOf(audio), { code: { revision: "a".repeat(40), fileHashes: {} }, alignmentFileSha256: sha256(canonicalJson(record)), options });
const json = (result, path) => JSON.parse(Buffer.from(result.artifacts[path]).toString("utf8"));

test("retimed identity and duration: vowel on every first note, consonants once each, exact copies, deterministic bytes", () => {
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity), record = recordFor(target, audio);
  const a = build(record, target, audio), b = build(clone(record), target, audio);
  assert.deepEqual(Object.keys(a.artifacts), Object.keys(b.artifacts));
  for (const path of Object.keys(a.artifacts)) assert.equal(sha256(a.artifacts[path]), sha256(b.artifacts[path]), path);
  assert.equal(a.manifestSha256, b.manifestSha256);
  const map = json(a, "retime-map.json"), manifest = a.manifest;
  assert.equal(manifest.releaseStatus, "private-unreleased"); assert.equal(manifest.targetReview, "pending");
  assert.equal(manifest.outputs.dspPitchBaseline, "not-produced"); assert.equal(manifest.outputs.neuralOutput, "not-produced");
  assert.equal(map.totalSamples, Math.round(target.plan.seconds * 24000));
  const speech = parseWav(new Uint8Array(a.artifacts["retimed-speech.wav"]));
  assert.equal(speech.frames, map.totalSamples); assert.equal(speech.sampleRate, 24000); assert.equal(speech.encoding, "float32");
  const notes = new Map(target.identity.notes.map(n => [n.id, n]));
  for (const s of target.identity.syllables) {
    const vowels = map.pieces.filter(p => p.role === "vowel" && p.syllableId === s.id);
    assert.equal(vowels.length, 1);
    assert.equal(vowels[0].dstStart, Math.round(notes.get(s.noteIds[0]).startMs * 24));
  }
  // Each reviewed phone appears exactly once, in reviewed order, and copies keep exact samples.
  const phones = map.pieces.filter(p => p.kind === "phone");
  assert.equal(phones.length, record.syllables.reduce((n, s) => n + s.onset.length + 1 + s.coda.length, 0));
  for (let i = 1; i < phones.length; i++) { assert.ok(phones[i].dstStart >= phones[i - 1].dstEnd); assert.ok(phones[i].srcStart >= phones[i - 1].srcEnd); }
  const source = audioOf(audio).wav.channelData[0];
  const copy = phones.find(p => p.method === "copy" && p.dstEnd - p.dstStart > 400);
  assert.ok(copy, "a consonant kept at its reviewed length");
  for (let i = 200; i < copy.dstEnd - copy.dstStart - 200; i++) assert.ok(Math.abs(speech.channelData[0][copy.dstStart + i] - source[copy.srcStart + i]) < 1e-6);
  assert.ok(map.pieces.filter(p => p.kind === "silence").every(p => speech.channelData[0].subarray(p.dstStart, p.dstEnd).every(v => v === 0)));
  assert.deepEqual(map.dropped.map(d => d.kind), ["leading", "pause", "trailing"]);
});

test("voiced and voiceless frames: score F0 on vowels and voiced consonants, zero over voiceless consonants and rests", () => {
  const target = packFor("שָׁ֑ פָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity, { consonantMs: 80 }), record = recordFor(target, audio);
  const result = build(record, target, audio), map = json(result, "retime-map.json"), fv = json(result, "f0-voicing.json").full;
  assert.equal(fv.frames, Math.ceil(map.totalSamples / 480)); assert.equal(fv.f0.length, fv.frames);
  const at = centre => map.pieces.find(p => p.dstStart <= centre && centre < p.dstEnd);
  let checked = { vowel: 0, voiceless: 0, silence: 0 };
  fv.f0.forEach((hz, j) => {
    const p = at(Math.floor((j + 0.5) * 480));
    if (!p || p.kind === "silence") { assert.equal(hz, 0); checked.silence++; }
    else if (p.role === "vowel") { assert.ok(hz > 100 && hz < 200); assert.equal(fv.voicing[j], 1); checked.vowel++; }
    else if (voiceless.has(p.phone)) { assert.equal(hz, 0); assert.equal(fv.voicing[j], 0); checked.voiceless++; }
  });
  assert.ok(checked.vowel > 10 && checked.voiceless > 2 && checked.silence > 2, JSON.stringify(checked));
  const npy = Buffer.from(result.artifacts["target-f0.npy"]);
  assert.equal(npy.subarray(0, 6).toString("latin1"), "\x93NUMPY"); assert.equal((10 + npy.readUInt16LE(8)) % 64, 0);
  assert.equal((npy.length - 10 - npy.readUInt16LE(8)) / 4, fv.frames);
});

test("voicedPhones carries the score F0 through a default-voiceless phone and nothing else", () => {
  const target = packFor("הָ֑ שָֽׁ׃", "Genesis 1:1"), audio = synthetic(target.identity, { consonantMs: 80 }), record = recordFor(target, audio);
  const f0At = (options, phone) => {
    const result = build(record, target, audio, options), map = json(result, "retime-map.json"), fv = json(result, "f0-voicing.json").full;
    const piece = map.pieces.find(p => p.kind === "phone" && p.phone === phone);
    const frames = fv.f0.filter((hz, j) => { const c = Math.floor((j + 0.5) * 480); return piece.dstStart <= c && c < piece.dstEnd; });
    return { piece, frames, options: JSON.parse(Buffer.from(result.artifacts["manifest.json"]).toString("utf8")) };
  };
  const plain = f0At({}, "h"), voiced = f0At({ voicedPhones: ["h"] }, "h"), sh = f0At({ voicedPhones: ["h"] }, "ʃ");
  assert.ok(plain.frames.length > 1 && plain.frames.every(hz => hz === 0) && plain.piece.voiced === false, "h is voiceless by default");
  assert.ok(voiced.frames.length > 1 && voiced.frames.every(hz => hz > 100 && hz < 200) && voiced.piece.voiced === true, "h carries the score F0 when listed");
  assert.ok(sh.frames.every(hz => hz === 0), "an unlisted voiceless phone stays voiceless");
  assert.ok(JSON.stringify(voiced.options).includes('"voicedPhones":["h"]'), "the option is recorded in the manifest");
  for (const voicedPhones of [["a"], ["h", "h"], "h", ["l"]]) assert.throws(() => build(record, target, audio, { voicedPhones }), e => e.code === "options");
});

test("melisma holds one vowel without repeated consonants; final consonants stay inside the last note; splits never cut a phone", () => {
  const row = fixture("Genesis 24:12"), target = packFor(row.he, row.ref);
  assert.ok(target.identity.segments.length > 1);
  const audio = synthetic(target.identity, { rate: 48000, pauseAfter: new Set([3, 9]) }), record = recordFor(target, audio);
  const result = build(record, target, audio), map = json(result, "retime-map.json");
  assert.ok(map.melismas.length > 0);
  for (const m of map.melismas) {
    assert.equal(m.vowelPieces, 1);
    const s = target.identity.syllables.find(x => x.id === m.syllableId);
    assert.equal(m.consonantPieces, s.bPhones.onset.length + s.bPhones.coda.length);
    const vowel = map.pieces.find(p => p.role === "vowel" && p.syllableId === m.syllableId);
    const own = map.notes.filter(n => n.syllableId === m.syllableId);
    assert.equal(own.length, m.notes); assert.ok(own.slice(0, -1).every(n => n.vowelCoverage === 1), "every melisma note but the last is pure vowel");
    assert.ok(vowel.dstEnd > own.at(-2).dstEnd);
  }
  const closed = target.identity.syllables.filter(s => s.bPhones.coda.length);
  assert.ok(closed.length);
  for (const s of closed) {
    const last = map.notes.filter(n => n.syllableId === s.id).at(-1);
    // A phrase-final continuant may carry on into the rest as its release; the coda itself sits in the last note.
    for (const c of map.pieces.filter(p => p.role === "coda" && p.syllableId === s.id)) assert.ok(c.dstStart >= last.dstStart && c.dstEnd - (c.releaseSamples ?? 0) - (c.heldSamples ?? 0) <= last.dstEnd);
  }
  const slices = map.slices;
  assert.equal(slices.length, target.identity.segments.length); assert.equal(slices[0].dstStart, 0); assert.equal(slices.at(-1).dstEnd, map.totalSamples);
  for (let k = 1; k < slices.length; k++) {
    assert.equal(slices[k].dstStart, slices[k - 1].dstEnd); assert.ok(slices[k].dstStart <= slices[k].nominalStart);
    assert.ok(!map.pieces.some(p => p.kind === "phone" && p.dstStart < slices[k].dstStart && slices[k].dstStart < p.dstEnd));
    const before = new Set(map.pieces.filter(p => p.kind === "phone" && p.dstEnd > p.dstStart && p.dstEnd <= slices[k].dstStart).map(p => p.syllableId));
    assert.ok(!map.pieces.some(p => p.kind === "phone" && p.dstEnd > p.dstStart && p.dstStart >= slices[k].dstStart && before.has(p.syllableId)), "no syllable spans a cut");
  }
  for (const s of slices) {
    assert.ok(s.dstEnd - s.dstStart <= 30 * 24000);
    const wav = parseWav(new Uint8Array(result.artifacts[s.wav])); assert.equal(wav.frames, s.dstEnd - s.dstStart);
    assert.equal(s.frames, Math.ceil(wav.frames / 480));
  }
  const whole = parseWav(new Uint8Array(result.artifacts["retimed-speech.wav"])).channelData[0];
  const joined = slices.flatMap(s => [...parseWav(new Uint8Array(result.artifacts[s.wav])).channelData[0]]);
  assert.equal(joined.length, whole.length); assert.ok(joined.every((v, i) => v === whole[i]), "slices rejoin to the exact full timeline");
  assert.ok(map.pieces.filter(p => p.method === "wsola").every(p => p.ratio > 0));
  assert.equal(result.manifest.original.sampleRate, 48000);
});

test("phrase endings release into the rest: the take's own decay after a pause, otherwise the final vowel carried on and faded", () => {
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity, { pauseAfter: new Set([1]) });
  const result = build(recordFor(target, audio), target, audio), map = json(result, "retime-map.json");
  const speech = parseWav(new Uint8Array(result.artifacts["retimed-speech.wav"])).channelData[0];
  // Syllable 1 ends phrase 1 and the speaker paused after it: its release copies the pause audio.
  const copied = map.pieces.find(p => p.kind === "release");
  assert.ok(copied && copied.method === "copy" && copied.source === "take-decay" && copied.voiced === false);
  assert.equal(copied.syllableId, target.identity.syllables[1].id);
  const vowel = map.pieces.find(p => p.role === "vowel" && p.syllableId === copied.syllableId);
  assert.equal(copied.dstStart, vowel.dstEnd); assert.equal(copied.srcStart, vowel.srcEnd);
  // The vowel is held, voiced, for most of the release; only the last 30 ms is the take's breath.
  assert.ok(vowel.heldSamples > 0 && copied.dstEnd - copied.dstStart <= Math.round(0.03 * 24000));
  const split = map.releases.find(r => r.syllableId === copied.syllableId);
  assert.equal(split.source, "held-then-take-decay"); assert.equal(split.samples, split.heldSamples + split.breathSamples);
  assert.equal(vowel.heldSamples, split.heldSamples, "the record's hold is the hold the vowel piece carries");
  assert.equal(copied.dstEnd - copied.dstStart, split.breathSamples, "the record's breath is the release piece");
  assert.equal(copied.srcEnd - copied.srcStart, split.breathSamples, "the breath is copied at natural speed");
  // The hold is one decay from its start through the breath, not a full-level tail.
  const peak = (a, z) => speech.slice(a, z).reduce((m, s) => Math.max(m, Math.abs(s)), 0), h0 = vowel.dstEnd - vowel.heldSamples, q = vowel.heldSamples >> 2;
  assert.ok(peak(vowel.dstEnd - q, vowel.dstEnd) < 0.6 * peak(h0 - q, h0), "held vowel fades from the start of its hold");
  const whole = json(build(recordFor(target, audio), target, audio, { releaseBreathMs: 150 }), "retime-map.json");
  assert.ok(whole.releases.some(r => r.source === "take-decay" && r.heldSamples === 0), "a full-length breath leaves nothing to hold");
  // The verse-final vowel has no pause after it in the take (the trailing room tone follows), so it
  // is released from the trailing region too; with no trailing audio it would be sustained instead.
  assert.ok(map.releases.length >= 1 && map.releases.every(r => r.samples > 0));
  // Releases fade to nothing, leave a gap before the next lead consonant and keep the total length.
  assert.equal(speech.length, map.totalSamples);
  for (const r of map.pieces.filter(p => p.kind === "release")) {
    assert.ok(Math.abs(speech[r.dstEnd - 1]) < 1e-3, "faded out");
    const next = map.pieces.find(p => p.dstStart >= r.dstEnd && p.kind !== "silence");
    if (next) assert.ok(next.dstStart - r.dstEnd >= Math.round(0.04 * 24000), "gap before next phrase");
  }
  const fv = json(result, "f0-voicing.json").full;
  const inRelease = j => map.pieces.some(p => p.kind === "release" && p.dstStart <= (j + 0.5) * 480 && (j + 0.5) * 480 < p.dstEnd);
  assert.ok(fv.f0.every((hz, j) => !inRelease(j) || hz === 0), "copied breath is unvoiced");
  // Without a pause after the phrase, the vowel itself is sustained and faded.
  const joined = synthetic(target.identity, { pauseAfter: new Set() }), r2 = json(build(recordFor(target, joined), target, joined), "retime-map.json");
  const held = r2.pieces.find(p => p.releaseSamples);
  assert.ok(held && held.role === "vowel" && held.method === "wsola");
  assert.ok(r2.releases.some(r => r.source === "sustained"));
  assert.throws(() => build(recordFor(target, audio), target, audio, { releaseMs: 1000 }), e => e.code === "options");
  // A breath under the 20 ms floor would be dropped, so 1-19 ms is refused rather than silently meaning 0.
  for (const releaseBreathMs of [10, 19, 401, -1]) assert.throws(() => build(recordFor(target, audio), target, audio, { releaseBreathMs }), e => e.code === "options");
  for (const releaseBreathMs of [0, 20, 400]) assert.ok(build(recordFor(target, audio), target, audio, { releaseBreathMs }));
  const none = json(build(recordFor(target, audio), target, audio, { releaseMs: 0 }), "retime-map.json");
  assert.equal(none.releases.length, 0);
});

test("a split point inside sound moves back to the syllable attack, and an unplaceable split is rejected", () => {
  const row = fixture("Genesis 24:12"), target = packFor(row.he, row.ref), audio = synthetic(target.identity), record = recordFor(target, audio);
  const bound = bindAlignment(record, target.files, audioOf(audio));
  const base = planRetime(bound), vowel = base.pieces.filter(p => p.role === "vowel" && p.dstEnd - p.dstStart > 4800)[3];
  const inside = clone(bound); inside.identity.segments[1].startMs = Math.round((vowel.dstStart + 2400) / 24);
  const moved = planRetime(inside), cut = moved.slices[1];
  assert.equal(cut.cutBy, "syllable-attack"); assert.ok(cut.dstStart < cut.nominalStart);
  const attack = moved.pieces.find(p => p.kind === "phone" && p.syllableId === vowel.syllableId && p.dstEnd > p.dstStart);
  assert.equal(cut.dstStart, attack.dstStart, "the whole syllable, onset first, starts the next slice");
  assert.ok(!moved.pieces.some(p => p.kind === "phone" && p.dstStart < cut.dstStart && cut.dstStart < p.dstEnd));
  assert.throws(() => planRetime(inside, { maxSplitShiftMs: 1 }), e => e instanceof RetimeError && e.code === "split-join");
  // A split exactly on a vowel start (no rest before it) must still carry the onset consonant with it.
  const withOnset = base.pieces.find(p => p.role === "onset" && p.dstEnd > p.dstStart && p.dstStart > 24000 && base.pieces.some(v => v.role === "vowel" && v.syllableId === p.syllableId && v.dstStart === p.dstEnd));
  const onVowel = clone(bound); onVowel.identity.segments[1].startMs = withOnset.dstEnd / 24;
  assert.ok(Number.isInteger(onVowel.identity.segments[1].startMs));
  const kept = planRetime(onVowel).slices[1];
  assert.equal(kept.cutBy, "syllable-attack"); assert.equal(kept.dstStart, base.pieces.find(p => p.syllableId === withOnset.syllableId && p.dstEnd > p.dstStart).dstStart);
});

test("reviewed boundaries alone are processed; proposals are retained separately and reported only as a diagnostic", () => {
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity, { proposals: true });
  const record = recordFor(target, audio, { proposals: true }), result = build(record, target, audio);
  const deviation = json(result, "retime-map.json").reviewDeviation;
  assert.ok(deviation.boundariesCompared > 0); assert.equal(deviation.maxAbsMs, 1); assert.match(deviation.meaning, /not an alignment-accuracy claim/);
  const moved = clone(record); moved.syllables[0].vowel.proposed = { start: 0, end: 10 };
  assert.equal(sha256(build(moved, target, audio).artifacts["retimed-speech.wav"]), sha256(result.artifacts["retimed-speech.wav"]));
  const pending = clone(record); pending.annotation.reviewState = "proposed";
  assert.throws(() => build(pending, target, audio), e => e instanceof AlignmentError && e.code === "review-pending");
  const unreviewed = clone(record); unreviewed.syllables[1].vowel.reviewed = null;
  assert.throws(() => build(unreviewed, target, audio), e => e instanceof AlignmentError && e.code === "review-incomplete");
  const manualWithProposal = clone(record); manualWithProposal.annotation.method = "manual"; manualWithProposal.annotation.proposalSource = null;
  assert.throws(() => validateAlignmentRecord(manualWithProposal), e => e.code === "annotation-method");
});

test("a word-listening review approves every word by ear and keeps machine phone boundaries labelled as such", () => {
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity, { proposals: true });
  const proposal = recordFor(target, audio, { proposals: true });
  proposal.annotation.reviewState = "proposed"; proposal.annotation.reviewRecordId = null;
  for (const s of proposal.syllables) for (const x of [...s.onset, s.vowel, ...s.coda]) { x.proposed = x.reviewed; x.reviewed = null; }
  for (const e of proposal.events) { e.proposed = e.reviewed; e.reviewed = null; }
  const before = canonicalJson(proposal), words = target.identity.words.map(w => w.id);
  assert.throws(() => build(proposal, target, audio), e => e.code === "review-pending");
  assert.throws(() => applyWordListeningReview(proposal, target.identity, words.slice(1), "review-ear"), e => e.code === "word-review-incomplete");
  assert.throws(() => applyWordListeningReview(proposal, target.identity, [...words, "x"], "review-ear"), e => e.code === "word-review");
  const reviewed = applyWordListeningReview(proposal, target.identity, words, "review-ear");
  assert.equal(canonicalJson(proposal), before, "proposal untouched");
  assert.equal(reviewed.annotation.reviewGranularity, "word-listening"); assert.equal(reviewed.annotation.reviewState, "reviewed");
  const result = build(reviewed, target, audio);
  assert.equal(result.manifest.binding.reviewGranularity, "word-listening"); assert.equal(result.manifest.binding.annotationMethod, "proposed-then-reviewed");
  const moved = clone(reviewed); moved.syllables[0].vowel.reviewed.end -= 1; moved.syllables[1].onset[0].reviewed.start -= 1;
  assert.throws(() => validateAlignmentRecord(moved), e => e.code === "word-review-moved");
  const manual = clone(reviewed); manual.annotation.method = "manual"; manual.annotation.proposalSource = null;
  assert.throws(() => validateAlignmentRecord(manual), e => e.code === "annotation-method");
  const odd = clone(reviewed); odd.annotation.reviewGranularity = "glance"; assert.throws(() => validateAlignmentRecord(odd), e => e.code === "schema");
  const plain = synthetic(target.identity); assert.equal(build(recordFor(target, plain), target, plain).manifest.binding.reviewGranularity, "phone");
});

test("malformed, stale, mismatched, incomplete and unconsented inputs are rejected before any audio is produced", () => {
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity), good = recordFor(target, audio);
  const rejects = (mutate, code, alter = {}) => {
    const r = clone(good); mutate(r);
    assert.throws(() => build(r, alter.target ?? target, alter.audio ?? audio), e => (e instanceof AlignmentError || e instanceof RetimeError || e instanceof AudioDspError) && e.code === code, code);
  };
  const s0 = r => r.syllables[0], s1 = r => r.syllables[1];
  rejects(r => { r.recording.audioSha256 = "0".repeat(64); }, "recording-mismatch");
  rejects(r => { r.recording.sampleRate = 48000; }, "recording-mismatch");
  rejects(r => { r.target.manifestSha256 = "1".repeat(64); }, "stale-target");
  rejects(r => { r.target.targetHash = "2".repeat(64); }, "stale-target");
  rejects(r => { r.target.identityMapSha256 = "3".repeat(64); }, "stale-target");
  const other = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:2");
  rejects(() => {}, "stale-target", { target: other });
  rejects(r => { r.syllables.pop(); }, "syllable-coverage");
  rejects(r => { [r.syllables[0], r.syllables[1]] = [r.syllables[1], r.syllables[0]]; }, "syllable-identity");
  rejects(r => { r.syllables[1] = clone(r.syllables[0]); }, "duplicate-syllable");
  rejects(r => { s0(r).onset[0].phone = "d"; }, "phone-identity");
  rejects(r => { s0(r).onset.push(clone(s0(r).onset[0])); }, "phone-identity");
  rejects(r => { s0(r).vowel.reviewed = { absent: true }; }, "schema");
  rejects(r => { s0(r).vowel.reviewed.end = s0(r).vowel.reviewed.start; }, "interval-order");
  rejects(r => { s0(r).vowel.reviewed.end = audio.frames + 1; }, "interval-bounds");
  rejects(r => { s0(r).vowel.reviewed.end += 10; }, "interval-overlap");
  rejects(r => { s0(r).vowel.reviewed.end -= 10; }, "coverage-gap");
  rejects(r => { s0(r).vowel.reviewed.start = s0(r).vowel.reviewed.end - 100; s0(r).onset[0].reviewed.end = s0(r).vowel.reviewed.start; }, "span-too-short");
  rejects(r => { r.events = []; }, "coverage-gap");
  rejects(r => { r.events[0].reviewed = { start: 0, end: 10 }; }, "event-bounds");
  rejects(r => { const v = s1(r).vowel.reviewed, mid = v.start + 1000; r.events.push({ kind: "breath", proposed: null, reviewed: { start: mid, end: mid + 500 } }); }, "interval-overlap");
  rejects(r => { r.recording.consentScope.localProcessing = false; }, "consent-scope");
  rejects(r => { delete r.recording.consentScope.training; }, "schema");
  rejects(r => { r.recording.role = "sung"; }, "recording-role");
  rejects(r => { r.recording.extra = true; }, "schema");
  rejects(r => { r.alignmentId = "../escape"; }, "identifier");
  rejects(r => { r.annotation.reviewRecordId = null; }, "review-record");
  rejects(r => { r.recording.downmix = "average"; }, "downmix");
  const truncated = { ...audio, bytes: audio.bytes.subarray(0, audio.bytes.length - 3) };
  assert.throws(() => audioOf(truncated), e => e instanceof AudioDspError);
  assert.throws(() => build(good, target, audio, { maxConsonantShare: 2 }), e => e instanceof RetimeError && e.code === "options");
  assert.throws(() => build(good, target, audio, { unknown: 1 }), e => e instanceof RetimeError && e.code === "options");
  // Consonants too long for a fast span, beyond the allowed compression, reject rather than smear.
  const slow = synthetic(target.identity, { consonantMs: 400 });
  assert.throws(() => build(recordFor(target, slow), target, slow), e => e instanceof RetimeError && e.code === "consonant-fit");
});

test("absent reviewed consonants and explicit compression are recorded rather than invented", () => {
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity, { consonantMs: 220 }), record = recordFor(target, audio);
  const result = build(record, target, audio), map = json(result, "retime-map.json");
  const compressed = map.warnings.filter(w => w.code === "consonants-compressed");
  assert.ok(compressed.length && compressed.every(w => w.ratio >= 0.5 && w.ratio < 1));
  assert.ok(map.pieces.some(p => p.role !== "vowel" && p.kind === "phone" && p.method === "wsola" && p.ratio < 1));
  // Only an allowed sound (here h) may be reviewed as absent; it is counted and warned, never invented.
  const elide = (r, phone) => { const s = r.syllables[1], gone = s.onset[0].reviewed; assert.equal(s.onset[0].phone, phone); r.syllables[0].vowel.reviewed.end = gone.end; s.onset[0].reviewed = { absent: true }; return s; };
  const g = clone(record); elide(g, "g");
  assert.throws(() => build(g, target, audio), e => e instanceof AlignmentError && e.code === "absent-phone");
  const hTarget = packFor("בָ־הָ֑ דָֽ׃", "Genesis 1:1"), hAudio = synthetic(hTarget.identity), h = recordFor(hTarget, hAudio), s = elide(h, "h");
  const hMap = json(build(h, hTarget, hAudio), "retime-map.json"), out = hMap.pieces.find(p => p.syllableId === s.syllableId && p.role === "onset");
  assert.equal(out.method, "absent"); assert.equal(out.dstStart, out.dstEnd); assert.equal(out.srcStart, null);
  assert.equal(hMap.absentConsonants, 1); assert.ok(hMap.warnings.some(w => w.code === "consonant-absent" && w.phone === "h"));
});

test("DSP primitives: strict WAV, band-limited resampling, pitch-preserving WSOLA and exact sample mapping", () => {
  const tone = (hz, rate, seconds) => Float64Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / rate));
  const crossings = x => { let n = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++; return n; };
  const down = resample(tone(200, 48000, 1), 48000, 24000); assert.equal(down.length, 24000); assert.ok(Math.abs(crossings(down) - 200) <= 1);
  const odd = resample(tone(200, 44100, 1), 44100, 24000); assert.equal(odd.length, mapSample(44100, 44100, 24000)); assert.ok(Math.abs(crossings(odd) - 200) <= 1);
  const alias = resample(tone(15000, 48000, 0.5), 48000, 24000); assert.ok(alias.slice(2000, -2000).every(v => Math.abs(v) < 0.02), "above-Nyquist tone removed");
  assert.deepEqual([...resample(Float64Array.of(0.1, 0.2), 24000, 24000)], [0.1, 0.2]);
  const short = tone(220, 24000, 0.08), long = wsola(short, 24000 * 0.8, 24000);
  assert.equal(long.length, 19200); assert.ok(Math.abs(crossings(long) / 0.8 - 220) < 8, `pitch kept: ${crossings(long) / 0.8}`);
  assert.equal(long[0], short[0]); assert.ok(Math.abs(long.at(-1) - short.at(-1)) < 1e-9);
  assert.deepEqual([...wsola(short, short.length, 24000)], [...short]);
  assert.throws(() => wsola(Float64Array.of(1, 2), 100, 24000), AudioDspError);
  const wav = Buffer.from(floatWav(Float64Array.of(0.25, -0.5), 24000));
  assert.deepEqual([...parseWav(new Uint8Array(wav)).channelData[0]], [0.25, -0.5]);
  const bad = Buffer.from(wav); bad.writeUInt16LE(2, 34); assert.throws(() => parseWav(new Uint8Array(bad)), AudioDspError);
  const extensible = Buffer.alloc(68); extensible.write("RIFF", 0, "ascii"); extensible.writeUInt32LE(60, 4); extensible.write("WAVEfmt ", 8, "ascii"); extensible.writeUInt32LE(40, 16);
  extensible.writeUInt16LE(0xfffe, 20); extensible.writeUInt16LE(1, 22); extensible.writeUInt32LE(24000, 24); extensible.writeUInt32LE(48000, 28); extensible.writeUInt16LE(2, 32); extensible.writeUInt16LE(16, 34);
  extensible.writeUInt16LE(22, 36); extensible.writeUInt16LE(16, 38); extensible.writeUInt16LE(1, 44);
  Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]).copy(extensible, 46);
  extensible.write("data", 60, "ascii"); extensible.writeUInt32LE(0, 64);
  const withSample = Buffer.concat([extensible, Buffer.from([0, 64])]); withSample.writeUInt32LE(2, 64); withSample.writeUInt32LE(62, 4);
  assert.equal(parseWav(new Uint8Array(withSample)).encoding, "pcm16");
  const garbled = Buffer.from(withSample); garbled[50] = 0x11; assert.throws(() => parseWav(new Uint8Array(garbled)), AudioDspError);
  const narrower = Buffer.from(withSample); narrower.writeUInt16LE(12, 38); assert.throws(() => parseWav(new Uint8Array(narrower)), AudioDspError);
  const nan = Buffer.from(wav); nan.writeFloatLE(NaN, 44); assert.throws(() => parseWav(new Uint8Array(nan)), AudioDspError);
  const stereo = pcm24([0.5, -0.5, 0.25, 0.25], 24000, 2), parsed = parseWav(new Uint8Array(stereo));
  assert.equal(parsed.channels, 2); assert.equal(parsed.frames, 2); assert.ok(Math.abs(parsed.channelData[1][0] + 0.5) < 1e-6);
  assert.deepEqual(spread(10, [1, 1, 1]), [4, 3, 3]); assert.equal(npyFloat32([1, 2, 3]).length % 4, 0);
});

const runBase = () => ({ runId: "run-test", lane: "B-human", stage: "svc", condition: "condition-test", benchmarkId: "synthetic-benchmark", packManifestSha256: "a".repeat(64),
  passageId: "P01", inputs: [{ role: "retimed-speech", sha256: "b".repeat(64), bytes: 10 }], outputs: [{ role: "neural-output", sha256: "c".repeat(64), bytes: 20 }],
  config: { n_steps: 32, cfg: 3 }, model: { sourceRevision: "d".repeat(40), checkpointSha256: "e".repeat(64), vocoderSha256: null, licenseRecordId: "license-test", weightsRecordId: "weights-test" },
  seed: { supported: false, value: null }, host: { platform: "win32", arch: "x64", runtime: "python 3.12", gpu: "synthetic GPU", gpuMemoryMiB: 8188 },
  attempts: [{ attempt: 1, status: "failed", startedAt: "2026-10-16T12:00:00.000Z", wallMs: 5, peakMemory: { hostRssMiB: 100, gpuAllocatedMiB: 7000, gpuReservedMiB: null, source: "torch-cuda-max-allocated" }, errorCode: "out-of-memory" },
    { attempt: 2, status: "succeeded", startedAt: "2026-10-16T12:01:00.000Z", wallMs: 9, peakMemory: { hostRssMiB: 100, gpuAllocatedMiB: 6000, gpuReservedMiB: 6500, source: "torch-cuda-max-allocated" }, errorCode: null }] });

test("run records keep every retry, immutable hashes and an honest seed limitation", () => {
  const a = buildRunRecord(runBase()), b = buildRunRecord(runBase());
  assert.equal(a.sha256, b.sha256); assert.equal(a.record.retries, 1); assert.equal(a.record.outcome, "succeeded");
  assert.match(a.record.seedNote, /not exposed/); assert.equal(a.record.configSha256, sha256(canonicalJson({ cfg: 3, n_steps: 32 })));
  assert.equal(a.record.attempts[0].errorCode, "out-of-memory");
  const rejects = (mutate, code) => { const r = runBase(); mutate(r); assert.throws(() => buildRunRecord(r), e => e instanceof RunRecordError && (!code || e.code === code)); };
  rejects(r => { r.attempts.reverse(); }, "attempts");
  rejects(r => { r.attempts[1].status = "failed"; r.attempts[1].errorCode = "crash"; }, "outputs-without-success");
  rejects(r => { r.attempts[0].errorCode = "Traceback at C:\\private\\x"; }, "attempts");
  rejects(r => { r.model = null; }, "schema");
  rejects(r => { r.seed = { supported: false, value: 1 }; }, "seed");
  rejects(r => { r.seed = { supported: true, value: 1 }; }, "seed");
  rejects(r => { r.stage = "retime"; }, "model");
  rejects(r => { r.lane = "A"; }, "lane");
  rejects(r => { r.outputs.push(clone(r.outputs[0])); }, "duplicate-file");
  rejects(r => { r.host.gpu = "x".repeat(200); }, "host");
});

test("listening labels are opaque, random and separate from the identity key", () => {
  const clips = ["A", "B-human", "human-reference"].map((lane, i) => ({ reviewCopySha256: String(i).repeat(64), runRecordSha256: "f".repeat(64), lane, passageId: "P01", condition: "condition-test", playbackSpeed: 1 }));
  let n = 0; const random = size => Uint8Array.from({ length: size }, (_, i) => (n * 7 + i * 13) & 255, n++);
  const { labels, key } = buildListeningKey(clips, random), l = JSON.parse(labels), k = JSON.parse(key);
  assert.equal(l.clips.length, 3); assert.ok(l.clips.every(c => /^clip-[a-z2-9]{8}$/.test(c.label) && Object.keys(c).length === 2));
  assert.ok(!/B-human|human-reference|"lane"|P01|run/.test(labels.toString()));
  assert.equal(k.labelsSha256, sha256(labels)); assert.equal(new Set(k.entries.map(e => e.label)).size, 3);
  let calls = 0; const repeating = size => { calls++; return calls < 3 ? new Uint8Array(size) : Uint8Array.from({ length: size }, () => calls); };
  assert.equal(new Set(JSON.parse(buildListeningKey(clips.slice(0, 2), repeating).labels).clips.map(c => c.label)).size, 2);
  assert.throws(() => buildListeningKey([clips[0], clips[0]], random), RunRecordError);
});

async function scratch(action) {
  const root = await mkdtemp(join(tmpdir(), "chant-retime-synthetic-"));
  try { return await action(root); }
  finally { if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) throw Error("Synthetic cleanup target escaped temp root"); await rm(root, { recursive: true, force: true }); }
}

test("CLI keeps inputs and output private, writes exclusively with a run record, and returns sanitized failures", async () => scratch(async root => {
  const { env, cleanup } = await isolatedEnv();
  try {
    const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity), record = recordFor(target, audio);
    const packDir = join(root, "pack");
    await mkdir(join(packDir, "P01"), { recursive: true });
    for (const [path, data] of Object.entries(target.pack.artifacts)) await writeFile(join(packDir, path), data);
    const alignmentPath = join(root, "alignment.json"), audioPath = join(root, "speech.wav"), alignmentBytes = canonicalJson(record);
    await writeFile(alignmentPath, alignmentBytes); await writeFile(audioPath, audio.bytes);
    const call = async (overrides = {}) => {
      const args = { "--pack": packDir, "--pack-manifest-sha256": target.pack.manifestSha256, "--alignment": alignmentPath, "--alignment-sha256": sha256(alignmentBytes),
        "--audio": audioPath, "--out": join(root, "out"), ...overrides };
      try { const r = await run(process.execPath, [script, ...Object.entries(args).flat()], { cwd: repository, env, windowsHide: true, timeout: 60000, maxBuffer: 8192 }); return { code: 0, ...r }; }
      catch (error) { return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }; }
    };
    const clean = r => assert.ok(!r.stderr.includes(root) && !r.stdout.includes(root) && !r.stderr.includes("P01:u0"), "no private path or identity in output");
    const wrongHash = await call({ "--alignment-sha256": "0".repeat(64) }); assert.equal(wrongHash.code, 1); clean(wrongHash);
    const repoOut = await call({ "--out": join(repository, ".local-logs", "retime-escape") }); assert.equal(repoOut.code, 1); clean(repoOut);
    const repoIn = await call({ "--audio": join(repository, "package.json") }); assert.equal(repoIn.code, 1); clean(repoIn);
    // Any other Git working tree (such as the shared checkout a worktree came from) is refused too.
    const otherRepo = join(root, "other-checkout"); await mkdir(join(otherRepo, ".git"), { recursive: true }); await writeFile(join(otherRepo, "speech.wav"), audio.bytes);
    const otherIn = await call({ "--audio": join(otherRepo, "speech.wav") }); assert.equal(otherIn.code, 1); assert.match(otherIn.stderr, /input-repository/); clean(otherIn);
    const otherOut = await call({ "--out": join(otherRepo, "out") }); assert.equal(otherOut.code, 1); assert.match(otherOut.stderr, /destination-repository/); clean(otherOut);
    await assert.rejects(lstat(join(otherRepo, "out")), { code: "ENOENT" });
    await assert.rejects(lstat(join(root, "out")), { code: "ENOENT" });
    for (const ratio of ["0.1", "1.5", "x"]) { const bad = await call({ "--min-consonant-ratio": ratio }); assert.equal(bad.code, 1); assert.match(bad.stderr, /arguments/); clean(bad); }
    for (const phones of ["a", "h,h", "h,l"]) { const bad = await call({ "--voiced-phones": phones }); assert.equal(bad.code, 1); assert.match(bad.stderr, /arguments/); clean(bad); }
    await assert.rejects(lstat(join(root, "out")), { code: "ENOENT" });
    const floor = await call({ "--min-consonant-ratio": "0.25", "--voiced-phones": "h", "--out": join(root, "out-floor") }); assert.equal(floor.code, 0, floor.stderr); clean(floor);
    const floorManifest = JSON.parse(await readFile(join(root, "out-floor", "manifest.json"), "utf8"));
    assert.ok(JSON.stringify(floorManifest).includes('"minConsonantRatio":0.25'), "a lowered consonant floor is recorded in the manifest");
    assert.ok(JSON.stringify(floorManifest).includes('"voicedPhones":["h"]'), "voiced phones are recorded in the manifest");
    const ok = await call(); assert.equal(ok.code, 0, ok.stderr); clean(ok);
    assert.ok(!JSON.stringify(JSON.parse(await readFile(join(root, "out", "manifest.json"), "utf8"))).includes('"minConsonantRatio":0.25'));
    const manifest = JSON.parse(await readFile(join(root, "out", "manifest.json"), "utf8"));
    assert.equal(manifest.binding.alignmentFileSha256, sha256(alignmentBytes));
    assert.equal(manifest.code.fileHashes["trope/human-retime.mjs"], sha256(await readFile(join(repository, "trope/human-retime.mjs"))));
    for (const [path, a] of Object.entries(manifest.artifacts)) assert.equal(sha256(await readFile(join(root, "out", path))), a.sha256);
    const runRecord = JSON.parse(await readFile(join(root, "out", "run-record.json"), "utf8"));
    assert.equal(runRecord.stage, "retime"); assert.equal(runRecord.model, null); assert.equal(runRecord.attempts[0].peakMemory.source, "node-maxrss");
    assert.ok(runRecord.inputs.some(i => i.role === "original-speech" && i.sha256 === sha256(audio.bytes)));
    assert.equal(sha256(await readFile(audioPath)), sha256(audio.bytes), "original audio untouched");
    const again = await call(); assert.equal(again.code, 1); clean(again);
  } finally { await cleanup(); }
}));

test("review regressions: a phrase ending in an absent consonant still releases, and word review is bound to its own passage", () => {
  const target = packFor("בָ־לָ֑הּ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity, { pauseAfter: new Set() });
  const record = recordFor(target, audio);
  const s = record.syllables.find(x => x.coda.some(c => c.phone === "h"));
  assert.ok(s, "fixture has a final h");
  const h = s.coda.find(c => c.phone === "h"), gone = h.reviewed;
  s.vowel.reviewed.end = gone.end; h.reviewed = { absent: true };
  const map = json(build(record, target, audio), "retime-map.json");
  assert.ok(map.releases.length >= 1);
  const proposal = recordFor(target, synthetic(target.identity, { proposals: true }), { proposals: true });
  proposal.annotation.reviewState = "proposed"; proposal.annotation.reviewRecordId = null;
  for (const x of proposal.syllables) for (const c of [...x.onset, x.vowel, ...x.coda]) { c.proposed = c.reviewed; c.reviewed = null; }
  for (const e of proposal.events) { e.proposed = e.reviewed; e.reviewed = null; }
  assert.throws(() => applyWordListeningReview(proposal, { words: [{ id: "only-word" }] }, ["only-word"], "review-x"), e => e.code === "word-review-target");
  const other = packFor("בָ־לָ֑הּ דָֽ׃", "Genesis 1:2").identity;
  assert.throws(() => applyWordListeningReview(proposal, other, other.words.map(w => w.id), "review-x"), e => e.code === "word-review-target");
  assert.throws(() => applyWordListeningReview(proposal, target.identity, {}, "review-x"), e => e.code === "word-review");
});

test("the verse's last word releases into a bounded tail beyond the timeline, and slices still cover everything", () => {
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity, { pauseAfter: new Set() });
  const plain = json(build(recordFor(target, audio), target, audio, { tailMs: 0 }), "retime-map.json");
  const result = build(recordFor(target, audio), target, audio), map = json(result, "retime-map.json");
  assert.equal(plain.tailSamples, 0); assert.equal(plain.totalSamples, plain.timelineSamples);
  // This target already ends with a rest, so the release fits inside it; the tail is only a fallback.
  assert.ok(map.tailSamples >= 0 && map.tailSamples <= Math.round(0.24 * 24000), "bounded tail");
  assert.equal(map.timelineSamples, Math.round(target.plan.seconds * 24000)); assert.equal(map.totalSamples, map.timelineSamples + map.tailSamples);
  const last = target.identity.syllables.at(-1).id;
  assert.ok(map.releases.some(r => r.syllableId === last), "verse-final word released");
  assert.equal(map.slices.at(-1).dstEnd, map.totalSamples);
  const speech = parseWav(new Uint8Array(result.artifacts["retimed-speech.wav"])).channelData[0];
  assert.equal(speech.length, map.totalSamples); assert.ok(Math.abs(speech.at(-1)) < 1e-3);
  assert.equal(json(result, "f0-voicing.json").full.frames, Math.ceil(map.totalSamples / 480));
});

test("a verse without a final rest releases into a real tail, and short vowels keep a two-frame middle", async () => {
  const { steadySplit } = await import("../trope/human-retime.mjs");
  const target = packFor("בָ־גָ֑", "Genesis 1:1"), audio = synthetic(target.identity, { pauseAfter: new Set() });
  const result = build(recordFor(target, audio), target, audio), map = json(result, "retime-map.json");
  assert.ok(map.tailSamples > 0 && map.tailSamples <= Math.round(0.2 * 24000), "tail within tailMs");
  assert.equal(map.totalSamples, map.timelineSamples + map.tailSamples); assert.equal(map.slices.at(-1).dstEnd, map.totalSamples);
  const speech = parseWav(new Uint8Array(result.artifacts["retimed-speech.wav"])).channelData[0];
  assert.equal(speech.length, map.totalSamples);
  assert.equal(json(result, "f0-voicing.json").full.frames, Math.ceil(map.totalSamples / 480));
  const o = { steadyHeadMs: 25, steadyTailMs: 35 };
  assert.deepEqual(steadySplit(960, 24000, o), { head: 0, tail: 0 });
  const mid = steadySplit(1440, 24000, o); assert.ok(1440 - mid.head - mid.tail >= 960);
  assert.deepEqual(steadySplit(4800, 24000, o), { head: 600, tail: 840 });
});

test("a lengthened vowel keeps its first 25 ms and last 35 ms at natural speed and stretches only its steady middle", async () => {
  const { stretchSteady } = await import("../trope/human-retime.mjs");
  const rate = 24000, vowel = Float64Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 200 * i / rate) * (i < 600 ? i / 600 : 1));
  const out = stretchSteady(vowel, 24000, rate, { steadyHeadMs: 25, steadyTailMs: 35 });
  assert.equal(out.length, 24000);
  for (let i = 0; i < 600; i++) assert.equal(out[i], vowel[i], "head copied exactly");
  for (let i = 1; i <= 840; i++) assert.equal(out.at(-i), vowel.at(-i), "tail copied exactly");
  const short = stretchSteady(vowel, 2400, rate, { steadyHeadMs: 25, steadyTailMs: 35 });
  assert.equal(short.length, 2400);
  const tiny = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i)); assert.equal(stretchSteady(tiny, 400, rate, { steadyHeadMs: 25, steadyTailMs: 35 }).length, 400);
  const target = packFor("בָ־גָ֑ דָֽ׃", "Genesis 1:1"), audio = synthetic(target.identity);
  assert.throws(() => build(recordFor(target, audio), target, audio, { steadyTailMs: 100 }), e => e.code === "options");
});
