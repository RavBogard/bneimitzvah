// Offline private target preparation only. No filesystem, renderer or release path.
import { createHash } from "node:crypto";
import { verseUnits } from "./text.mjs";
import { scoreVerse, SPECIAL_MELODIES } from "./melody.mjs";
import { scoreToSoulx, SOULX_STYLES, syllableToken } from "./soulx.mjs";
import { buildPlan, segmentNotes } from "./speech2sing.mjs";
import { applyMeasuredTiming, emitterBreaths, MEASURED_LIMITS, MeasuredTimingError } from "./measured-timing.mjs";

export const BENCHMARK_LIMITS = Object.freeze({ inputBytes: 262144, textBytes: 8192, passages: 12,
  words: 512, syllables: 2048, notes: 8192, seconds: 180, segmentSeconds: 30,
  outputBytes: 16777216, assetBytes: 4194304 });
export const BENCHMARK_TABLES = Object.freeze({ torah: "torah", haftarah: "haftarah", "haftarah-moroccan": "haftarah" });
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const TORAH = new Set(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
const BOOKS = [...TORAH, "Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Ruth", "Song of Songs", "Ecclesiastes", "Lamentations", "Esther", "Daniel", "Ezra", "Nehemiah", "I Chronicles", "II Chronicles"];
const REF = new RegExp(`^(${BOOKS.join("|")}) [1-9]\\d{0,2}:[1-9]\\d{0,2}$`);
const byteLength = value => Buffer.byteLength(value, "utf8");
const fail = code => { throw new BenchmarkPackError(code); };
export class BenchmarkPackError extends Error {
  constructor(code) { super(`Benchmark target pack rejected (${code}); private details withheld`); this.name = "BenchmarkPackError"; this.code = code; }
}
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function canonicalJson(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail("schema");
}
function text(value, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max || !value.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail("schema");
}
function id(value) { if (typeof value !== "string" || !ID.test(value) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) fail("identifier"); }
function hash(value) { if (typeof value !== "string" || !HASH.test(value)) fail("hash"); }
function validateInput(input) {
  object(input, ["schema", "benchmarkId", "source", "pronunciation", "performance", "passages"]);
  if (input.schema !== "chant-benchmark-input/v1") fail("schema"); id(input.benchmarkId);
  object(input.source, ["edition", "sourceRecordId", "rightsRecordId", "approvalRecordId"]);
  text(input.source.edition); for (const key of ["sourceRecordId", "rightsRecordId", "approvalRecordId"]) id(input.source[key]);
  object(input.pronunciation, ["profile", "confirmationRecordId", "divineNames"]);
  if (input.pronunciation.profile !== "israeli-v1" || input.pronunciation.divineNames !== "ceremony-adonai-elohim") fail("profile");
  id(input.pronunciation.confirmationRecordId);
  object(input.performance, ["key", "tempo", "table", "style"]);
  const p = input.performance;
  if (typeof p.key !== "string" || !/^[A-G](?:#|b)?[2-5]$/.test(p.key) || !Number.isFinite(p.tempo) || p.tempo < 40 || p.tempo > 180
    || !Object.hasOwn(BENCHMARK_TABLES, p.table) || !Object.hasOwn(SOULX_STYLES, p.style)) fail("performance");
  if (!Array.isArray(input.passages) || !input.passages.length || input.passages.length > BENCHMARK_LIMITS.passages) fail("bounds");
  const ids = new Set();
  for (const passage of input.passages) {
    // Optional measured timing: same notes and text, syllable durations from a private human take.
    const timed = Object.hasOwn(passage, "timing");
    object(passage, timed ? ["id", "ref", "he", "textSha256", "flags", "timing"] : ["id", "ref", "he", "textSha256", "flags"]); id(passage.id);
    if (timed) {
      object(passage.timing, ["source", "recordId", "syllableMs"]);
      if (passage.timing.source !== "measured" || !Array.isArray(passage.timing.syllableMs) || !passage.timing.syllableMs.length
        || passage.timing.syllableMs.length > BENCHMARK_LIMITS.syllables) fail("timing");
      id(passage.timing.recordId);
      if (passage.timing.syllableMs.some(ms => !Number.isSafeInteger(ms) || ms < MEASURED_LIMITS.syllableMinMs || ms > MEASURED_LIMITS.syllableMaxMs)) fail("timing-bounds");
    }
    if (ids.has(passage.id.toLowerCase())) fail("identifier"); ids.add(passage.id.toLowerCase());
    const book = typeof passage.ref === "string" && REF.exec(passage.ref)?.[1];
    if (!book || (TORAH.has(book) ? "torah" : "haftarah") !== BENCHMARK_TABLES[p.table]) fail("reference-table");
    if (typeof passage.he !== "string" || !passage.he.isWellFormed() || !/[א-ת]/u.test(passage.he)
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(passage.he)) fail("text");
    if (byteLength(passage.he) > BENCHMARK_LIMITS.textBytes || (passage.he.match(/[א-ת]+[\u0591-\u05c7א-ת]*/gu) || []).length > BENCHMARK_LIMITS.words) fail("bounds");
    hash(passage.textSha256); if (sha256(passage.he) !== passage.textSha256) fail("text-hash");
    object(passage.flags, ["final", "endOfAliyah", "endOfBook", "special"]);
    const f = passage.flags;
    if ([f.final, f.endOfAliyah, f.endOfBook].some(value => typeof value !== "boolean") || f.special !== null && !SPECIAL_MELODIES.includes(f.special)) fail("flags");
    if (BENCHMARK_TABLES[p.table] === "torah" ? f.final : f.endOfAliyah || f.endOfBook || f.special !== null) fail("flags-table");
    if (f.endOfBook && !f.endOfAliyah) fail("flags-book");
  }
  if (byteLength(canonicalJson(input)) > BENCHMARK_LIMITS.inputBytes) fail("bounds");
}
function assetsFor(input, assets) {
  object(assets, ["tableJson", "pronunciationJson", "code", "inputFileSha256"]);
  for (const source of [assets.tableJson, assets.pronunciationJson]) if (typeof source !== "string" || byteLength(source) > BENCHMARK_LIMITS.assetBytes) fail("assets");
  object(assets.code, ["revision", "files"]);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(assets.code.revision)) fail("code");
  const files = assets.code.files;
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.keys(files).length || Object.keys(files).length > 100) fail("code");
  let codeBytes = 0;
  const codeHashes = {};
  for (const [path, source] of Object.entries(files)) {
    if (!/^(?:trope|scripts)\/[A-Za-z0-9_./-]+$/.test(path) || path.includes("..") || path.includes("//") || typeof source !== "string") fail("code");
    codeBytes += byteLength(source); if (codeBytes > BENCHMARK_LIMITS.assetBytes) fail("bounds"); codeHashes[path] = sha256(source);
  }
  if (assets.inputFileSha256 !== null) hash(assets.inputFileSha256);
  let table, profiles;
  try { table = JSON.parse(assets.tableJson); profiles = JSON.parse(assets.pronunciationJson); } catch { fail("assets"); }
  const profile = profiles?.profiles?.[input.pronunciation.profile];
  if (table?.type !== BENCHMARK_TABLES[input.performance.table] || !Array.isArray(table.cells) || !table.cells.length || table.cells.length > 512) fail("assets");
  if (profile?.name !== input.pronunciation.profile || profile.rules?.divineName?.adonai?.normalize("NFD") !== "אֲדֹנָי".normalize("NFD")
    || profile.rules?.divineName?.elohim?.normalize("NFD") !== "אֱלֹהִים".normalize("NFD")) fail("profile");
  return { table, profile, codeHashes };
}

/** Check A and B against the same executed timeline, including rests and splits. */
export function benchmarkIdentityMap({ passageId, targetHash, units, score, segments, plan, profile, style }) {
  const prefix = `${targetHash}:${passageId}`;
  const wordId = (u, w) => `${prefix}:u${u}:w${w}`;
  const syllableId = (u, s) => `${prefix}:u${u}:s${s}`;
  const executed = segmentNotes(segments);
  if (executed.length !== plan.notes.length || executed.length > BENCHMARK_LIMITS.notes || score.events.length > BENCHMARK_LIMITS.notes) fail("parity-count");
  const words = [], syllables = [], noteRows = [];
  let wordIndex = 0;
  units.units.forEach((unit, ui) => {
    unit.words.forEach((he, wi) => words.push({ id: wordId(ui, wi), unit: ui, word: wi, index: wordIndex++, he }));
    unit.syllables.forEach((syllable, si) => {
      if (!Number.isInteger(syllable.word) || !unit.words[syllable.word]) fail("parity-word");
      syllables.push({ id: syllableId(ui, si), unit: ui, syllable: si, wordId: wordId(ui, syllable.word), he: syllable.he,
        phonemes: syllable.ph, engineStress: syllable.stress ?? null, noteIds: [] });
    });
  });
  const bySyllable = new Map(syllables.map(s => [`${s.unit}:${s.syllable}`, s]));
  let ordinal = 0, flat = 0, clockMs = 0;
  const splitRows = segments.map((segment, segmentIndex) => {
    const duration = segment.duration.split(" ").map(Number), pitches = segment.note_pitch.split(" ").map(Number);
    const types = segment.note_type.split(" ").map(Number), phones = segment.phoneme.split(" "), labels = segment.text.split(" ");
    if ([pitches, types, phones, labels].some(list => list.length !== duration.length) || segment.time[0] !== clockMs) fail("parity-count");
    const firstNote = flat;
    duration.forEach((seconds, segmentNote) => {
      const ms = Math.round(seconds * 1000), midi = pitches[segmentNote], type = types[segmentNote];
      const a = executed[flat], b = plan.notes[flat];
      if (!Number.isInteger(ms) || ms <= 0 || Math.abs(seconds * 1000 - ms) > 1e-7 || ![1, 2, 3].includes(type) || !Number.isInteger(midi)
        || !a || !b || Math.round(a.t * 1000) !== clockMs || Math.round(a.dur * 1000) !== ms || a.midi !== midi || a.type !== type
        || Math.round(b.t * 1000) !== clockMs || Math.round(b.dur * 1000) !== ms || b.midi !== midi || b.rest !== (type === 1) || b.slur !== (type === 3)) fail("parity-timing");
      const rest = type === 1;
      let identity = null, noteId = `${prefix}:r${flat}`;
      if (rest) { if (midi !== 0 || phones[segmentNote] !== "<SP>") fail("parity-rest"); }
      else {
        const event = score.events[ordinal], syl = event && units.units[event.unit]?.syllables[event.syllable];
        if (!event || !syl || event.midi !== midi || Boolean(event.slur) !== (type === 3)) fail("parity-score");
        const token = syllableToken(syl.ph, { stress: syl.stress, profile, stressMode: style.stress, reduced: syl.sheva === "na" || /[ֱ-ֳ]/u.test(syl.he) });
        if (phones[segmentNote] !== token || labels[segmentNote] !== syl.he.replace(/\s+/g, "")) fail("parity-syllable");
        identity = bySyllable.get(`${event.unit}:${event.syllable}`); if (!identity) fail("parity-syllable");
        noteId = `${prefix}:n${ordinal}`; identity.noteIds.push(noteId); ordinal++;
      }
      noteRows.push({ id: noteId, syllableId: identity?.id ?? null, wordId: identity?.wordId ?? null, rest,
        segment: segmentIndex, segmentNote, bNote: flat, startMs: clockMs, durationMs: ms, midi, slur: type === 3,
        ...(rest ? {} : { scoreEvent: ordinal - 1, scoreBeat: score.events[ordinal - 1].t, scoreDurationBeats: score.events[ordinal - 1].dur }) });
      flat++; clockMs += ms;
    });
    if (segment.time[1] !== clockMs || segment.time[1] - segment.time[0] > BENCHMARK_LIMITS.segmentSeconds * 1000) fail("segment-bounds");
    return { index: segmentIndex, startMs: segment.time[0], endMs: segment.time[1], firstNote, noteCount: flat - firstNote };
  });
  if (flat !== executed.length || ordinal !== score.events.length || Math.round(plan.seconds * 1000) !== clockMs || clockMs > BENCHMARK_LIMITS.seconds * 1000) fail("parity-count");
  const bSyllables = plan.phrases.flatMap(phrase => phrase.syllables);
  if (bSyllables.length !== syllables.length) fail("parity-syllable");
  for (const [i, b] of bSyllables.entries()) {
    const s = syllables[i], notes = noteRows.filter(note => note.syllableId === s.id);
    if (b.unit !== s.unit || b.syllable !== s.syllable || b.he !== s.he || notes.length !== b.notes || !notes.length
      || Math.round(b.t * 1000) !== notes[0].startMs || Math.round(b.dur * 1000) !== notes.reduce((sum, note) => sum + note.durationMs, 0)) fail("parity-syllable");
    s.bSpokenStress = b.stressed;
    s.bPhones = { onset: b.onset, vowel: b.vowel, coda: b.coda };
  }
  return { schema: "chant-benchmark-identity/v1", targetHash, passageId, words, syllables, notes: noteRows, segments: splitRows,
    parity: { noteCount: ordinal, midi: true, order: true, slur: true, syllableAttachment: true, executedTiming: true },
    stressNote: "B spoken stress may use the existing word-stress heuristic; it is recorded separately from engine stress.",
    f0Parity: "not-claimed" };
}

function timedScore(score, syllableMs) {
  try { return applyMeasuredTiming(score, syllableMs); }
  catch (error) { if (error instanceof MeasuredTimingError) fail(`timing-${error.code}`); throw error; }
}

/** Trusted assets are exact local file bytes supplied by the CLI, never private input. */
export function buildBenchmarkPack(input, assets) {
  try {
    validateInput(input);
    const { table, profile, codeHashes } = assetsFor(input, assets);
    const canonicalInputSha256 = sha256(canonicalJson(input)), tableSha256 = sha256(assets.tableJson), profileFileSha256 = sha256(assets.pronunciationJson);
    const profileSha256 = sha256(canonicalJson(profile)), artifacts = {}, passages = [];
    const style = { ...SOULX_STYLES[input.performance.style], chet: "en", lead: 0.25, wordGap: 0.1, maxSegmentSeconds: BENCHMARK_LIMITS.segmentSeconds };
    let outputBytes = 0;
    const add = (path, value) => { const data = canonicalJson(value); outputBytes += byteLength(data); if (outputBytes > BENCHMARK_LIMITS.outputBytes) fail("output-bounds"); artifacts[path] = data; };
    for (const passage of input.passages) {
      if (passage.flags.special && !table.cells.some(cell => cell.context?.special === passage.flags.special)) fail("special-unavailable");
      const targetHash = sha256(canonicalJson({ passage, performance: input.performance, pronunciation: input.pronunciation, source: input.source,
        codeHashes, tableSha256, profileSha256 }));
      // Finality always comes from the supplied flags, never the array position.
      const units = { ...verseUnits(passage.he, { ref: passage.ref, final: passage.flags.final, pronunciation: profile }), ...passage.flags };
      const syllables = units.units.flatMap(unit => unit.syllables);
      if (!units.units.length || units.warnings.length || units.units.reduce((n, unit) => n + unit.words.length, 0) > BENCHMARK_LIMITS.words
        || syllables.length > BENCHMARK_LIMITS.syllables || syllables.some(s => !s.ph.some(p => profile.symbols[p]?.type === "vowel"))) fail("units");
      const engineScore = scoreVerse(units, { table, key: input.performance.key, tempo: input.performance.tempo, elision: false });
      if (engineScore.events.length > BENCHMARK_LIMITS.notes || engineScore.seconds > BENCHMARK_LIMITS.seconds || engineScore.units.some(unit => unit.cell.fallback)) fail("score");
      let score = engineScore, breathMs = null;
      if (passage.timing) {
        // Measured inter-onset times already hold the chanter's breaths, so each syllable the emitter
        // follows with a breath rest is shortened by that rest, and the score is timed once more.
        const draft = timedScore(engineScore, passage.timing.syllableMs);
        const breaths = emitterBreaths(draft, scoreToSoulx(draft, { ...style, profile }));
        // Never take more than half a syllable: the chanter may not have breathed where the emitter does.
        const removed = passage.timing.syllableMs.map((ms, k) => Math.min(breaths.get(k) ?? 0, Math.floor(ms / 2)));
        breathMs = removed.reduce((a, b) => a + b, 0);
        score = timedScore(engineScore, passage.timing.syllableMs.map((ms, k) => ms - removed[k]));
        if (score.seconds > BENCHMARK_LIMITS.seconds) fail("score");
      }
      const segments = scoreToSoulx(score, { ...style, profile });
      const plan = buildPlan(score, segments, { profile, units });
      const identities = benchmarkIdentityMap({ passageId: passage.id, targetHash, units, score, segments, plan, profile, style });
      const directory = passage.id;
      for (const [name, data] of [["units", units], ["score", score], ["a-soulx-target", segments], ["b-speech-plan", plan], ["identity-map", identities]]) add(`${directory}/${name}.json`, data);
      passages.push({ id: passage.id, ref: passage.ref, textSha256: passage.textSha256, flags: passage.flags, targetHash, directory,
        timing: passage.timing ? { source: "measured", recordId: passage.timing.recordId, syllables: passage.timing.syllableMs.length, emitterBreathMsRemoved: breathMs,
          review: "measured values are assertions from a private take; not reviewed here" } : "engine",
        seconds: plan.seconds, segments: segments.length, notes: score.events.length, syllables: syllables.length, targetReview: "pending" });
    }
    const manifest = { schema: "chant-benchmark-pack/v1", benchmarkId: input.benchmarkId, releaseStatus: "private-unreleased", targetReview: "pending",
      provenance: { suppliedRecords: input.source, pronunciationRecord: input.pronunciation.confirmationRecordId,
        verification: "recorded-only; record identifiers do not establish approval or rights" },
      input: { canonicalSha256: canonicalInputSha256, fileSha256: assets.inputFileSha256 }, pronunciation: { ...input.pronunciation, profileSha256, profileFileSha256 },
      performance: { ...input.performance, tableSha256, elision: false, emitter: style }, code: { revision: assets.code.revision,
        revisionMeaning: "repository HEAD only; fileHashes identify the working sources actually used, including uncommitted changes", fileHashes: codeHashes }, passages,
      lanes: { A: { adapter: "SoulX-SVS", conditioning: "score", f0: "zero placeholder in target metadata; ignored by score conditioning" },
        B: { adapter: "speech-to-SVC proposed", conditioning: "same executed note timeline; source audio and F0 not prepared", f0: "not-emitted; later scoreF0 and voicing review required" } },
      f0Parity: "not-claimed", jobs: "not-created; no model, prompt, audio or runner paths",
      artifacts: Object.fromEntries(Object.entries(artifacts).map(([path, data]) => [path, { sha256: sha256(data), bytes: byteLength(data) }])) };
    add("manifest.json", manifest);
    return Object.freeze({ manifest, manifestSha256: sha256(artifacts["manifest.json"]), artifacts: Object.freeze(artifacts) });
  } catch (error) { if (error instanceof BenchmarkPackError) throw error; fail("engine"); }
}
