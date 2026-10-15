// SoulX-Singer emitter: a score JSON (trope/melody.mjs scoreVerse) -> SoulX target metadata for one
// verse (renderer ladder step 2, design spec §6). Pure, dependency-free ESM; the Python side is
// trope/soulx_runner.py, driven by scripts/trope-render.mjs.
//
// The metadata format (voice-feasibility.md §3.1): a list of segments, each with `index`, `language`,
// `time` [start_ms, end_ms] inside the verse's WAV, and five space-separated parallel strings, one entry
// per note: `duration` (s), `phoneme` (`<SP>` for a rest, `en_P1-P2-P3` for one sung syllable, or one
// `zh_` pinyin syllable), `note_pitch` (MIDI, 0 for a rest), `note_type` (1 rest, 2 a note that starts a
// syllable, 3 a slur continuation carrying the same token), plus `text` (display only) and `f0`.
//
// The performance options (phrasing, rhythm, stress, tokens, f0) are the voice-quality A/B of 2026-10-15
// (docs/superpowers/research/2026-10-15-trope-engine/legato-ab.md). Each default reproduces the first
// emitter; SOULX_STYLES.v2 is the set that has won so far (legato phrasing only).

import { pronunciationProfile } from "./text.mjs";

// SoulX's own preprocessor cuts metadata at 60 s of notes (preprocess/tools/midi_parser.py
// MAX_SEGMENT_DUR_SUM_SEC). On the 6 GB card a 5 s prompt + 14 s verse peaked at 2.9 GB and attention
// grows with the square of the frame count, so we stay at half the model's limit.
export const MAX_SEGMENT_SECONDS = 30;

const FRAMES_PER_SECOND = 50;   // 24 kHz / hop 480: one f0 value per 20 ms mel frame

// ARPAbet has diphthongs, Hebrew spells them vowel + yod. CMUdict writes "bye" as AY, not AA-Y, so the
// in-distribution token is the diphthong (voice-feasibility.md §5, the yod row). u + yod stays UW-Y.
const DIPHTHONG = { a: "AY", e: "EY", o: "OY" };

// Mandarin syllables for the two sounds ARPAbet lacks (voice-feasibility.md §5): pinyin h is a velar
// fricative [x], a real ח / כ rafe; pinyin z is an unaspirated [ts], a real צ. A zh_ token is a whole
// syllable, so only Hebrew syllables of the shape onset + vowel (+ n | j) have one; any other syllable
// (char, chet with a coda, tsi) keeps its English token. Keys are the syllable's phonemes after the
// onset; the tones are the ones phone_set.json carries for that syllable (tone is ignored in score mode,
// the note pitch rules). Pinyin hei/zei stand in for "he/tse" because pinyin he is [xɤ], not [xe].
const ZH_SYLLABLES = {
  x: { a: "ha1", aj: "hai1", an: "han1", e: "hei1", ej: "hei1", en: "hen2", o: "huo1", u: "hu1", un: "hun1" },
  ts: { a: "za1", aj: "zai1", an: "zan1", e: "zei2", ej: "zei2", en: "zen3", o: "zuo2", u: "zu1", un: "zun1" },
};
export const ZH_ONSETS = Object.keys(ZH_SYLLABLES);

// Disjunctive rank (emperors, kings, dukes, counts) for choosing where a long verse may be split:
// the deepest phrase break first, so a cut falls where a reader would breathe anyway.
const SPLIT_RANK = {
  silluq: 4, etnachta: 4,
  segol: 3, shalshelet: 3, "zakef-katan": 3, "zakef-gadol": 3, tipcha: 3,
  revia: 2, zarka: 2, pashta: 2, yetiv: 2, tevir: 2,
  pazer: 1, geresh: 1, gershayim: 1, "telisha-gedola": 1, "karnei-farah": 1, "munach-legarmeh": 1,
};

const STRESS_DIGIT = { tonic: "1", secondary: "2" };

// Hataf vowels (U+05B1-U+05B3) are sung as their own short syllable; like a vocal sheva they are reduced.
const HATAF = /[ֱ-ֳ]/;
const isReduced = syl => Boolean(syl && (syl.sheva === "na" || HATAF.test(String(syl.he || ""))));

// The vowel's CMU stress digit. "lexical": 1 on the tonic, 2 on a secondary stress, 0 elsewhere (what
// CMUdict writes for an English word). "full": every full Hebrew vowel keeps its quality (1 on the tonic,
// 2 elsewhere); only a vocal sheva or hataf takes 0, the digit an English-trained model reduces towards
// schwa. "flat": 1 on every full vowel, 0 on sheva / hataf.
export const STRESS_MODES = ["lexical", "full", "flat"];
function stressDigit(stress, mode, reduced) {
  if (mode === "lexical") return STRESS_DIGIT[stress] || "0";
  if (reduced && stress !== "tonic") return "0";
  if (mode === "flat") return "1";
  return stress === "tonic" ? "1" : "2";
}

// One syllable's ARPAbet phones (no en_ prefix).
function syllablePhones(ph, { digit, profile }) {
  const prof = pronunciationProfile(profile);
  const phones = ph || [];
  const out = [];
  let vowel = false;
  for (let i = 0; i < phones.length; i++) {
    const sym = prof.symbols[phones[i]];
    if (!sym) throw new Error(`trope/soulx: no symbol "${phones[i]}" in profile ${prof.name}`);
    if (sym.type === "vowel") {
      vowel = true;
      if (phones[i + 1] === "j" && DIPHTHONG[phones[i]]) { out.push(DIPHTHONG[phones[i]] + digit); i++; continue; }
      out.push(sym.arpabet + digit);
      continue;
    }
    // "" (glottal stop, silent letters) is no phone; "T S" (tsadi) is two phones in one note, as in en_B-EH1-S-T.
    out.push(...String(sym.arpabet || "").split(/\s+/).filter(Boolean));
  }
  // A note with no vowel is outside anything CMUdict emits; give it a schwa so it is sung at all.
  if (!vowel) out.push("AH" + digit);
  return out;
}

// One sung syllable -> one SoulX token. ph is the score's phoneme list (pronunciation-profile symbols);
// the vowel's stress digit follows stressMode (stressDigit; reduced = vocal sheva or hataf).
export function syllableToken(ph, { stress = null, profile, chet = "en", stressMode = "lexical", reduced = false } = {}) {
  const phones = ph || [];
  if (chet === "zh" && ZH_SYLLABLES[phones[0]]) {
    const zh = ZH_SYLLABLES[phones[0]][phones.slice(1).join("")];
    if (zh) return `zh_${zh}`;
  }
  return `en_${syllablePhones(phones, { digit: stressDigit(stress, stressMode, reduced), profile }).join("-")}`;
}

// A whole word (a maqaf chain) as one en_ token, the way SoulX's own data spells English: g2p_en writes one
// token per word, and a word sung over several notes repeats it with note_type 3 (example/audio/en_target.json:
// en_B-Y-UW1-T-AH0-F-AH0-L on two notes). zh_ syllables cannot sit inside an en_ word, so chet is ignored.
export function wordToken(syllables, { profile, stressMode = "lexical" } = {}) {
  return `en_${syllables.flatMap(s => syllablePhones(s.ph, { digit: stressDigit(s.stress, stressMode, isReduced(s)), profile })).join("-")}`;
}

export const PHRASING_MODES = ["words", "phrases"];
export const RHYTHM_MODES = ["grid", "speech"];
export const TOKEN_MODES = ["syllable", "word"];
export const F0_MODES = ["zeros", "synth"];

// phrasing "phrases": the breath (s) after a unit, by its disjunctive rank; no rest anywhere else. Chant is
// legato: words inside a phrase run on, and SoulX's own MIDI path merges any gap under 0.2 s into the
// previous note (preprocess/tools/midi_parser.py SILENCE_THRESHOLD_SEC), so shorter rests are off its map.
export const BREATHS = { 4: 0.35, 3: 0.2 };
const RUN_BEFORE_BREATH_MS = 3000;

// rhythm "speech": deterministic duration factors on the score's grid, so a tonic syllable is long, a vocal
// sheva / hataf short, a melisma not machine-even, and a phrase slows into its cadence.
// A held note (the cell's long final, over HELD_MS) is already long: it gets no tonic stretch and a
// smaller cadence one.
export function rhythmFactor({ stress = null, reduced = false, closed = false, nNotes = 1, ni = 0, lastOfUnit = false, penultOfUnit = false, rank = 0, held = false } = {}) {
  let f;
  if (held) f = 1;
  else if (nNotes === 1) {
    if (stress === "tonic") f = 1.3;
    else if (reduced) f = 0.6;
    else if (stress === "secondary") f = 1.05;
    else f = closed ? 0.95 : 0.85;
  } else if (ni === 0) f = stress === "tonic" ? 1.15 : 1;   // the syllable's arrival
  else if (ni === nNotes - 1) f = 1.05;                       // the melisma's goal note
  else f = ni % 2 ? 0.9 : 1;                                  // inner notes: long-short, not a grid
  if (lastOfUnit) f *= rank >= 4 ? (held ? 1.2 : 1.25) : rank >= 3 ? (held ? 1.05 : 1.15) : 1;
  else if (penultOfUnit && rank >= 4) f *= 1.1;               // the ritard into the cadence
  return f;
}
const MIN_NOTE_MS = 120;
const HELD_MS = 500;

// The score's notes and rests in milliseconds. rhythm "grid": on a single rounded clock, so the durations
// add up to exactly round(seconds * 1000): each note boundary is rounded once, and a duration is the
// difference. rhythm "speech": each note scaled by rhythmFactor and rounded on its own.
function noteList(score, { profile, chet, lead, wordGap, phrasing, rhythm, stress: stressMode, tokens }) {
  const msAt = beats => Math.round(beats * 60000 / score.tempo);
  const items = [];
  const rest = (ms, unit) => { if (ms > 0) items.push({ token: "<SP>", pitch: 0, type: 1, ms, unit, text: "<SP>" }); };
  rest(Math.round(lead * 1000), 0);

  const units = score.units || [];
  const rankOf = u => SPLIT_RANK[units[u]?.cell?.trope] || 0;
  const wordTok = new Map();
  const events = score.events || [];
  let clock = 0;   // beats
  let ni = 0;      // index of this note inside its syllable
  let sung = 0;    // ms sung since the last rest
  events.forEach((e, k) => {
    const scoreGap = msAt(e.t) - msAt(clock);
    rest(scoreGap, events[k - 1] ? events[k - 1].unit : 0);   // a gap in the score is a rest (the breath after sof pasuk)
    if (scoreGap > 0) sung = 0;
    const syl = units[e.unit].syllables[e.syllable];
    const reduced = isReduced(syl);
    const prev = events[k - 1], next = events[k + 1];
    ni = prev && prev.unit === e.unit && prev.syllable === e.syllable ? ni + 1 : 0;
    const wordStart = !prev || prev.unit !== e.unit;
    const lastOfUnit = !next || next.unit !== e.unit;
    let token;
    if (tokens === "word") {
      if (!wordTok.has(e.unit)) wordTok.set(e.unit, wordToken(units[e.unit].syllables, { profile, stressMode }));
      token = wordTok.get(e.unit);
    } else token = syllableToken(syl.ph, { stress: syl.stress, profile, chet, stressMode, reduced });
    let ms = msAt(e.t + e.dur) - msAt(e.t);
    if (rhythm === "speech") {
      const penultOfUnit = !lastOfUnit && (!events[k + 2] || events[k + 2].unit !== e.unit);
      const closed = !/[aeiou]$/.test((syl.ph || []).join(""));
      const nNotes = Math.max(1, (syl.notes || []).length);
      ms = Math.max(MIN_NOTE_MS, Math.round(ms * rhythmFactor({ stress: syl.stress, reduced, closed, nNotes, ni, lastOfUnit, penultOfUnit, rank: rankOf(e.unit), held: ms > HELD_MS })));
    }
    const touching = next && msAt(next.t) === msAt(e.t + e.dur);
    let gap = 0, breath = 0;
    if (phrasing === "words") {
      // A short silence carved from the end of each word's last note keeps words apart without
      // changing the verse's length (the experiment's 0.12 s gaps kept words separate in the f0 track).
      gap = lastOfUnit && touching ? Math.min(Math.round(wordGap * 1000), Math.round(ms * 0.3)) : 0;
    } else if (lastOfUnit && touching) {
      // added time: a phrase break is a pause. A lesser break (rank 3) breathes only after a long run.
      const r = rankOf(e.unit);
      if (r >= 4 || (r === 3 && sung + ms >= RUN_BEFORE_BREATH_MS)) breath = Math.round((BREATHS[r] || 0) * 1000);
    }
    const type = tokens === "word" ? (wordStart ? 2 : 3) : e.slur ? 3 : 2;
    items.push({ token, pitch: Math.round(e.midi), type, ms: ms - gap, unit: e.unit, text: String(syl.he || "").replace(/\s+/g, "") || token, ph: syl.ph });
    rest(gap + breath, e.unit);
    sung = gap + breath > 0 ? 0 : sung + ms;
    clock = e.t + e.dur;
  });
  rest(msAt(score.beats ?? clock) - msAt(clock), events.at(-1) ? events.at(-1).unit : 0);
  return items;
}

// ARPAbet phones that are voiceless: a synthetic f0 is unvoiced (0) over them, as RMVPE would track them.
const VOICELESS = new Set(["P", "T", "K", "F", "S", "SH", "HH", "CH", "TH"]);
const midiHz = m => 440 * 2 ** ((m - 69) / 12);

// f0 "synth": a sung f0 contour at 50 frames/s for SoulX's melody control (which reads f0 and ignores
// note_pitch): each note's pitch; a raised-cosine glide (portamento) of glideMs centred on every join of
// two touching notes of different pitch; vibrato (vibratoHz, +/- vibratoCents) easing in after 200 ms on
// notes of 400 ms or more; 0 in rests, over a voiceless onset of a syllable's first note and over a
// voiceless coda at the end of its last note. items: the segment's notes ({ token, pitch, type, ms }).
export function synthF0(items, { glideMs = 80, vibratoHz = 5.5, vibratoCents = 25, voicelessMs = 50 } = {}) {
  const fps = FRAMES_PER_SECOND;
  const total = items.reduce((s, x) => s + x.ms, 0);
  const n = Math.ceil(total / 1000 * fps);
  const at = f => f / fps * 1000;   // frame -> ms
  let t = 0;
  const spans = items.map(x => { const a = t; t += x.ms; return { ...x, a, b: t }; });
  const noteAt = new Array(n).fill(-1);
  spans.forEach((x, i) => {
    for (let f = Math.floor(x.a / 1000 * fps); f < Math.min(n, Math.ceil(x.b / 1000 * fps)); f++) if (at(f) >= x.a && at(f) < x.b) noteAt[f] = i;
  });
  const cents = new Array(n).fill(null);   // MIDI cents; null = unvoiced
  for (let f = 0; f < n; f++) {
    const i = noteAt[f];
    if (i < 0 || spans[i].type === 1) continue;
    const x = spans[i];
    let c = x.pitch * 100;
    // glide: inside glideMs/2 of a join with a touching pitched neighbour, blend towards it
    const p = spans[i - 1], q = spans[i + 1], half = glideMs / 2;
    if (p && p.type !== 1 && p.pitch !== x.pitch && at(f) - x.a < half) {
      const u = 0.5 + (at(f) - x.a) / glideMs;            // 0.5 at the join .. 1 at +half
      const w = (1 - Math.cos(Math.PI * u)) / 2;
      c = (1 - w) * p.pitch * 100 + w * x.pitch * 100;
    } else if (q && q.type !== 1 && q.pitch !== x.pitch && x.b - at(f) <= half) {
      const u = 0.5 - (x.b - at(f)) / glideMs;            // 0 at -half .. 0.5 at the join
      const w = (1 - Math.cos(Math.PI * u)) / 2;
      c = (1 - w) * x.pitch * 100 + w * q.pitch * 100;
    }
    const tin = at(f) - x.a;
    if (x.ms >= 400 && tin > 200) c += vibratoCents * Math.min(1, (tin - 200) / 250) * Math.sin(2 * Math.PI * vibratoHz * at(f) / 1000);
    cents[f] = c;
  }
  const vf = Math.round(voicelessMs / 1000 * fps);
  spans.forEach((x, i) => {
    if (x.type === 1 || !x.token.startsWith("en_")) return;
    const ph = x.token.slice(3).split("-");
    const frames = noteAt.map((j, f) => j === i ? f : -1).filter(f => f >= 0);
    if (!frames.length) return;
    const nxt = spans[i + 1];
    if (x.type === 2 && VOICELESS.has(ph[0])) frames.slice(0, vf).forEach(f => { cents[f] = null; });
    if ((!nxt || nxt.type !== 3) && VOICELESS.has(ph.at(-1))) frames.slice(-vf).forEach(f => { cents[f] = null; });
  });
  return cents.map(c => c === null ? "0.0" : midiHz(c / 100).toFixed(1));
}

// Split [from, to) of items into segments of at most maxMs, at the deepest phrase break nearest the
// middle; a break is a change of unit, ranked by the trope of the unit that ends there. A break that
// leaves both halves under the limit beats a deeper one that does not, so a verse is cut as few times
// as it can be (an etnachta near the end of a 39 s verse would otherwise force a third segment).
function splitItems(items, from, to, maxMs, units) {
  const dur = (a, b) => items.slice(a, b).reduce((s, x) => s + x.ms, 0);
  const total = dur(from, to);
  if (total <= maxMs) return [[from, to]];
  let best = null;
  for (let i = from + 1; i < to; i++) {
    if (items[i].unit === items[i - 1].unit) continue;
    const trope = units[items[i - 1].unit]?.cell?.trope;
    const rank = SPLIT_RANK[trope] || 0;
    const left = dur(from, i);
    const fits = left <= maxMs && total - left <= maxMs ? 1 : 0;
    const off = Math.abs(left - total / 2);
    const better = !best || fits > best.fits || (fits === best.fits && (rank > best.rank || (rank === best.rank && off < best.off)));
    if (better) best = { i, rank, off, fits };
  }
  if (!best) return [[from, to]];   // one word longer than the limit: nothing sensible to cut
  return [...splitItems(items, from, best.i, maxMs, units), ...splitItems(items, best.i, to, maxMs, units)];
}

const slug = s => String(s || "verse").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Named option sets for scoreToSoulx. v1 is the first emitter; v2 is the A/B winner (legato-ab.md).
export const SOULX_STYLES = {
  v1: { phrasing: "words", rhythm: "grid", stress: "lexical", tokens: "syllable", f0: "zeros" },
  v2: { phrasing: "phrases", rhythm: "grid", stress: "lexical", tokens: "syllable", f0: "zeros" },
};

// score -> SoulX target metadata (an array of segments; more than one only when the verse was split).
// Options: profile (pronunciation profile name or object), chet "en" (HH / T-S) or "zh" (Mandarin
// syllables for ח, כ rafe and צ), lead (s of leading rest, a breath before the first note), wordGap (s
// carved from the end of each word, phrasing "words" only), maxSegmentSeconds, and the performance
// options, whose defaults reproduce the first emitter (SOULX_STYLES.v1):
//   phrasing "words" (a wordGap rest after every word) | "phrases" (legato; BREATHS at disjunctives only)
//   rhythm   "grid" (the score's durations) | "speech" (rhythmFactor)
//   stress   "lexical" | "full" | "flat" (stressDigit)
//   tokens   "syllable" (one en_ token per syllable) | "word" (one per word, repeated as note_type 3)
//   f0       "zeros" (score control ignores it) | "synth" (synthF0, for SoulX's melody control)
export function scoreToSoulx(score, { profile, chet = "en", lead = 0.25, wordGap = 0.1, maxSegmentSeconds = MAX_SEGMENT_SECONDS,
  phrasing = "words", rhythm = "grid", stress = "lexical", tokens = "syllable", f0 = "zeros" } = {}) {
  if (!["en", "zh"].includes(chet)) throw new Error(`trope/soulx: chet must be "en" or "zh", got ${chet}`);
  for (const [name, v, ok] of [["phrasing", phrasing, PHRASING_MODES], ["rhythm", rhythm, RHYTHM_MODES], ["stress", stress, STRESS_MODES], ["tokens", tokens, TOKEN_MODES], ["f0", f0, F0_MODES]]) {
    if (!ok.includes(v)) throw new Error(`trope/soulx: ${name} must be one of ${ok.join(", ")}, got ${v}`);
  }
  if (!score || !score.tempo || !Array.isArray(score.events)) throw new Error("trope/soulx: not a score (scoreVerse output)");
  const items = noteList(score, { profile, chet, lead, wordGap, phrasing, rhythm, stress, tokens });
  const ranges = splitItems(items, 0, items.length, maxSegmentSeconds * 1000, score.units || []);
  let startMs = 0;
  return ranges.map(([a, b], k) => {
    const seg = items.slice(a, b);
    const ms = seg.reduce((s, x) => s + x.ms, 0);
    const time = [startMs, startMs + ms];
    startMs += ms;
    return {
      index: `${slug(score.ref)}_${k}`,
      language: "English",   // SoulX branches per token on the en_ prefix; zh_ tokens inside are accepted (§3.2 variant C)
      time,
      duration: seg.map(x => (x.ms / 1000).toFixed(3)).join(" "),
      text: seg.map(x => x.text).join(" "),
      phoneme: seg.map(x => x.token).join(" "),
      note_pitch: seg.map(x => x.pitch).join(" "),
      note_type: seg.map(x => x.type).join(" "),
      // zeros: ignored in score mode but must not be empty: the Space's parser truncates the target to the
      // f0 length, so an empty string renders nothing (§3.2 call 1). One value per mel frame, rounded up.
      f0: f0 === "synth" ? synthF0(seg).join(" ") : Array(Math.ceil(ms / 1000 * FRAMES_PER_SECOND)).fill("0.0").join(" "),
    };
  });
}

// What the manifest records about a verse's metadata.
export function soulxSummary(segments) {
  const types = segments.flatMap(s => s.note_type.split(" ").map(Number));
  return {
    segments: segments.length,
    notes: types.filter(t => t !== 1).length,
    seconds: segments.length ? segments.at(-1).time[1] / 1000 : 0,
  };
}
