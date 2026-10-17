// Private, reviewed alignment of one human spoken recording to one benchmark target passage
// (schema chant-human-alignment/v1). Pure validation and binding: no filesystem, model or network.
//
// The record binds the exact target pack (manifest, identity map and B speech plan hashes), the
// exact original audio bytes and format, the adult speaker's consent record and scope, and per
// syllable the source spans of every onset consonant, the vowel nucleus and every coda consonant,
// plus pauses and breaths. Every span keeps an optional machine/tool proposal separately from the
// human-reviewed boundary; only reviewed boundaries are ever processed. Units are integer sample
// indices of the original recording, half-open [start, end).
import { sha256 } from "./benchmark-pack.mjs";

export const ALIGNMENT_SCHEMA = "chant-human-alignment/v1";
export const ALIGNMENT_LIMITS = Object.freeze({ bytes: 1048576, syllables: 2048, events: 512, phonesPerSide: 6, minConsonantMs: 5, minVowelMs: 15 });
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/, HASH = /^[a-f0-9]{64}$/;
const SYLLABLE_ID = /^[a-f0-9]{64}:[A-Za-z][A-Za-z0-9_-]{0,47}:u\d{1,4}:s\d{1,4}$/;
const PHONE = /^[a-zʔʁʃχ]{1,3}$/u;
const SCOPES = ["privateEvaluationPlayback", "localProcessing", "voiceConversion", "cloudProcessing", "training", "distribution"];
const ENCODINGS = new Set(["pcm16", "pcm24", "pcm32", "float32"]);
// Only sounds commonly unrealised in careful Israeli reading may be reviewed as absent; any other
// missing consonant is a recording or target problem, not something to retime around.
export const ABSENT_ALLOWED = Object.freeze(["ʔ", "h"]);
export const REVIEW_GRANULARITIES = Object.freeze(["phone", "word-listening"]);

export class AlignmentError extends Error {
  constructor(code) { super(`Human alignment rejected (${code}); private details withheld`); this.name = "AlignmentError"; this.code = code; }
}
const fail = code => { throw new AlignmentError(code); };
function object(value, keys, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("schema");
  const present = Object.keys(value);
  if (keys.some(key => !Object.hasOwn(value, key)) || present.some(key => !keys.includes(key) && !optional.includes(key))) fail("schema");
}
const id = (value, code = "identifier") => { if (typeof value !== "string" || !ID.test(value) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) fail(code); };
const nullableId = value => { if (value !== null) id(value); };
const hash = value => { if (typeof value !== "string" || !HASH.test(value)) fail("hash"); };
const integer = (value, min, max, code = "schema") => { if (!Number.isSafeInteger(value) || value < min || value > max) fail(code); };

function interval(value, frames) {
  object(value, ["start", "end"]);
  integer(value.start, 0, frames, "interval-bounds"); integer(value.end, 0, frames, "interval-bounds");
  if (value.end <= value.start) fail("interval-order");
  return value;
}
function span(value, frames, { vowel = false } = {}) {
  object(value, ["phone", "proposed", "reviewed"]);
  if (typeof value.phone !== "string" || !PHONE.test(value.phone)) fail("phone");
  if (value.proposed !== null) {
    if (!vowel && value.proposed?.absent === true) object(value.proposed, ["absent"]); else interval(value.proposed, frames);
  }
  if (value.reviewed !== null) {
    // A reviewed consonant may be explicitly absent (an elided glottal stop, say); a vowel never is.
    if (!vowel && value.reviewed?.absent === true) { object(value.reviewed, ["absent"]); if (!ABSENT_ALLOWED.includes(value.phone)) fail("absent-phone"); }
    else interval(value.reviewed, frames);
  }
}

/** Shape, bounds and review-state validation of the record alone. */
export function validateAlignmentRecord(record) {
  object(record, ["schema", "alignmentId", "target", "recording", "annotation", "syllables", "events"]);
  if (record.schema !== ALIGNMENT_SCHEMA) fail("schema");
  id(record.alignmentId);
  const t = record.target;
  object(t, ["benchmarkId", "manifestSha256", "passageId", "targetHash", "identityMapSha256", "speechPlanSha256", "targetReviewRecordId"]);
  id(t.benchmarkId); id(t.passageId); nullableId(t.targetReviewRecordId);
  for (const key of ["manifestSha256", "targetHash", "identityMapSha256", "speechPlanSha256"]) hash(t[key]);
  const r = record.recording;
  object(r, ["sampleId", "role", "speakerId", "takeNumber", "audioSha256", "encoding", "sampleRate", "channels", "frames", "downmix", "consentRecordId", "consentScope"]);
  id(r.sampleId); id(r.speakerId); id(r.consentRecordId); hash(r.audioSha256);
  if (r.role !== "spoken") fail("recording-role");
  integer(r.takeNumber, 1, 99); integer(r.sampleRate, 8000, 192000); integer(r.channels, 1, 8); integer(r.frames, 1, 192000 * 600);
  if (!ENCODINGS.has(r.encoding)) fail("schema");
  if (r.channels === 1 ? r.downmix !== "none" : !(r.downmix === "average" || new RegExp(`^channel-[0-${r.channels - 1}]$`).test(r.downmix))) fail("downmix");
  object(r.consentScope, SCOPES);
  if (SCOPES.some(key => typeof r.consentScope[key] !== "boolean")) fail("schema");
  const a = record.annotation;
  object(a, ["units", "method", "proposalSource", "reviewState", "reviewRecordId"], ["reviewGranularity"]);
  // "phone": a person checked every boundary. "word-listening": a person heard each word's slice and
  // approved it; the phone boundaries inside stay exactly the machine proposal and are labelled so.
  const granularity = a.reviewGranularity ?? "phone";
  if (!REVIEW_GRANULARITIES.includes(granularity)) fail("schema");
  if (granularity === "word-listening" && a.method !== "proposed-then-reviewed") fail("annotation-method");
  if (a.units !== "samples" || !["manual", "proposed-then-reviewed"].includes(a.method) || !["proposed", "reviewed"].includes(a.reviewState)) fail("schema");
  nullableId(a.proposalSource); nullableId(a.reviewRecordId);
  if ((a.method === "manual") !== (a.proposalSource === null)) fail("annotation-method");
  if (a.reviewState === "reviewed" && a.reviewRecordId === null) fail("review-record");
  if (!Array.isArray(record.syllables) || !record.syllables.length || record.syllables.length > ALIGNMENT_LIMITS.syllables) fail("bounds");
  if (!Array.isArray(record.events) || record.events.length > ALIGNMENT_LIMITS.events) fail("bounds");
  const seen = new Set();
  for (const s of record.syllables) {
    object(s, ["syllableId", "onset", "vowel", "coda"]);
    if (typeof s.syllableId !== "string" || !SYLLABLE_ID.test(s.syllableId)) fail("identifier");
    if (seen.has(s.syllableId)) fail("duplicate-syllable"); seen.add(s.syllableId);
    for (const side of [s.onset, s.coda]) {
      if (!Array.isArray(side) || side.length > ALIGNMENT_LIMITS.phonesPerSide) fail("schema");
      side.forEach(c => span(c, r.frames));
    }
    span(s.vowel, r.frames, { vowel: true });
  }
  for (const e of record.events) {
    object(e, ["kind", "proposed", "reviewed"]);
    if (!["pause", "breath"].includes(e.kind)) fail("schema");
    if (e.proposed !== null) interval(e.proposed, r.frames);
    if (e.reviewed !== null) interval(e.reviewed, r.frames);
  }
  const reviewedEverywhere = record.syllables.every(s => [...s.onset, s.vowel, ...s.coda].every(x => x.reviewed !== null)) && record.events.every(e => e.reviewed !== null);
  if (a.reviewState === "reviewed" && !reviewedEverywhere) fail("review-incomplete");
  if (a.method === "manual" && (record.syllables.some(s => [...s.onset, s.vowel, ...s.coda].some(x => x.proposed !== null)) || record.events.some(e => e.proposed !== null))) fail("annotation-method");
  if (granularity === "word-listening" && a.reviewState === "reviewed") {
    const same = x => x.proposed !== null && JSON.stringify(x.proposed) === JSON.stringify(x.reviewed);
    if (!record.syllables.every(s => [...s.onset, s.vowel, ...s.coda].every(same)) || !record.events.every(same)) fail("word-review-moved");
  }
  if (Buffer.byteLength(JSON.stringify(record)) > ALIGNMENT_LIMITS.bytes) fail("bounds");
  return record;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Bind a reviewed record to the exact pack files and audio. `pack` holds the raw bytes the caller
 * read: manifestBytes, identityMapBytes, speechPlanBytes. `audio` is { bytes, wav } where wav is
 * parseWav(bytes). Returns the ordered reviewed items and timing facts used by retiming.
 */
export function bindAlignment(record, { manifestBytes, identityMapBytes, speechPlanBytes }, audio) {
  validateAlignmentRecord(record);
  const { target: t, recording: r } = record;
  if (record.annotation.reviewState !== "reviewed") fail("review-pending");
  if (!r.consentScope.localProcessing) fail("consent-scope");
  let manifest, identity, plan;
  try { manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")); identity = JSON.parse(Buffer.from(identityMapBytes).toString("utf8")); plan = JSON.parse(Buffer.from(speechPlanBytes).toString("utf8")); }
  catch { fail("pack-json"); }
  if (sha256(manifestBytes) !== t.manifestSha256 || manifest?.schema !== "chant-benchmark-pack/v1" || manifest.benchmarkId !== t.benchmarkId
    || manifest.releaseStatus !== "private-unreleased") fail("stale-target");
  const passage = Array.isArray(manifest.passages) && manifest.passages.find(p => p.id === t.passageId);
  if (!passage || passage.targetHash !== t.targetHash) fail("stale-target");
  const artifact = name => manifest.artifacts?.[`${passage.directory}/${name}.json`];
  if (sha256(identityMapBytes) !== t.identityMapSha256 || artifact("identity-map")?.sha256 !== t.identityMapSha256
    || sha256(speechPlanBytes) !== t.speechPlanSha256 || artifact("b-speech-plan")?.sha256 !== t.speechPlanSha256) fail("stale-target");
  if (identity?.schema !== "chant-benchmark-identity/v1" || identity.targetHash !== t.targetHash || identity.passageId !== t.passageId) fail("stale-target");
  if (sha256(audio.bytes) !== r.audioSha256) fail("recording-mismatch");
  const w = audio.wav;
  if (w.sampleRate !== r.sampleRate || w.channels !== r.channels || w.frames !== r.frames || w.encoding !== r.encoding) fail("recording-mismatch");

  // Text-to-note join: exactly the identity map's syllables, in order, with exactly its phones.
  if (record.syllables.length !== identity.syllables.length) fail("syllable-coverage");
  const consonantMin = Math.ceil(ALIGNMENT_LIMITS.minConsonantMs * r.sampleRate / 1000), vowelMin = Math.ceil(ALIGNMENT_LIMITS.minVowelMs * r.sampleRate / 1000);
  const items = [];
  record.syllables.forEach((s, index) => {
    const expected = identity.syllables[index];
    if (s.syllableId !== expected.id) fail("syllable-identity");
    if (!expected.noteIds?.length) fail("note-join");
    const phones = expected.bPhones;
    if (!same(s.onset.map(x => x.phone), phones.onset) || s.vowel.phone !== phones.vowel.join("") || !same(s.coda.map(x => x.phone), phones.coda)) fail("phone-identity");
    for (const [role, list] of [["onset", s.onset], ["vowel", [s.vowel]], ["coda", s.coda]]) {
      list.forEach((x, position) => {
        if (x.reviewed.absent) { items.push({ kind: "phone", role, syllable: index, position, phone: x.phone, absent: true }); return; }
        if (x.reviewed.end - x.reviewed.start < (role === "vowel" ? vowelMin : consonantMin)) fail("span-too-short");
        items.push({ kind: "phone", role, syllable: index, position, phone: x.phone, start: x.reviewed.start, end: x.reviewed.end });
      });
    }
  });
  // Monotonic and contiguous: from the first phone to the last, every sample belongs to exactly one
  // phone or one annotated pause/breath, and events sit only between syllables.
  const present = items.filter(x => !x.absent);
  for (let i = 1; i < present.length; i++) if (present[i].start < present[i - 1].end) fail("interval-overlap");
  const events = record.events.map(e => ({ kind: e.kind, start: e.reviewed.start, end: e.reviewed.end })).sort((a, b) => a.start - b.start);
  const timeline = [...present.map(x => ({ ...x })), ...events].sort((a, b) => a.start - b.start || (a.kind === "phone") - (b.kind === "phone"));
  const first = present[0].start, last = present.at(-1).end;
  for (let i = 0; i < timeline.length; i++) {
    const x = timeline[i];
    if (x.start < first || x.end > last) fail("event-bounds");
    if (i && x.start !== timeline[i - 1].end) fail(x.start < timeline[i - 1].end ? "interval-overlap" : "coverage-gap");
    if (x.kind !== "phone") {
      const before = timeline.slice(0, i).findLast(y => y.kind === "phone"), after = timeline.slice(i + 1).find(y => y.kind === "phone");
      if (!before || !after || after.syllable === before.syllable) fail("event-inside-syllable");
    }
  }
  return { record, manifest, identity, plan, passage, items, events,
    sourceRegion: { start: first, end: last }, reviewDeviation: proposalDeviation(record) };
}

/** Diagnostic only: how far reviewed boundaries moved from any recorded proposal. Not an accuracy claim. */
export function proposalDeviation(record) {
  const rate = record.recording.sampleRate, deltas = [];
  let absentChanges = 0;
  const visit = x => {
    if (!x.proposed || !x.reviewed) return;
    if (Boolean(x.proposed.absent) !== Boolean(x.reviewed.absent)) { absentChanges++; return; }
    if (!x.reviewed.absent) deltas.push(Math.abs(x.proposed.start - x.reviewed.start), Math.abs(x.proposed.end - x.reviewed.end));
  };
  record.syllables.forEach(s => [...s.onset, s.vowel, ...s.coda].forEach(visit)); record.events.forEach(visit);
  const ms = v => Math.round(v * 1e6 / rate) / 1000;
  return { boundariesCompared: deltas.length, absentChanges, meanAbsMs: deltas.length ? ms(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
    maxAbsMs: deltas.length ? ms(Math.max(...deltas)) : null, meaning: "diagnostic difference between recorded proposals and human review; not an alignment-accuracy claim" };
}

/**
 * Turn a machine proposal into a word-listening review: every word of the target must be in
 * approvedWordIds (a person heard its slice and accepted it), and every boundary is copied unchanged
 * from the proposal. Returns a new record; the proposal is not modified.
 */
export function applyWordListeningReview(proposal, identity, approvedWordIds, reviewRecordId) {
  validateAlignmentRecord(proposal);
  if (proposal.annotation.method !== "proposed-then-reviewed" || proposal.annotation.reviewState !== "proposed") fail("annotation-method");
  id(reviewRecordId);
  if (!Array.isArray(approvedWordIds)) fail("word-review");
  // The word list must be the passage this proposal is bound to, syllable for syllable.
  if (!identity || identity.targetHash !== proposal.target.targetHash || identity.passageId !== proposal.target.passageId
    || !Array.isArray(identity.syllables) || !Array.isArray(identity.words) || identity.syllables.length !== proposal.syllables.length
    || identity.syllables.some((s, k) => s.id !== proposal.syllables[k].syllableId)) fail("word-review-target");
  const approved = new Set(approvedWordIds), words = identity.words.map(w => w.id);
  if (approved.size !== approvedWordIds.length || [...approved].some(w => !words.includes(w))) fail("word-review");
  if (identity.syllables.some(s => !approved.has(s.wordId))) fail("word-review-incomplete");
  if (words.some(w => !approved.has(w))) fail("word-review-incomplete");
  const copy = structuredClone(proposal), review = x => { if (x.proposed === null) fail("review-incomplete"); x.reviewed = structuredClone(x.proposed); };
  copy.syllables.forEach(s => [...s.onset, s.vowel, ...s.coda].forEach(review)); copy.events.forEach(review);
  copy.annotation = { ...copy.annotation, reviewState: "reviewed", reviewRecordId, reviewGranularity: "word-listening" };
  return validateAlignmentRecord(copy);
}
