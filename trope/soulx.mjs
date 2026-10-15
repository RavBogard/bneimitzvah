// SoulX-Singer emitter: a score JSON (trope/melody.mjs scoreVerse) -> SoulX target metadata for one
// verse (renderer ladder step 2, design spec §6). Pure, dependency-free ESM; the Python side is
// trope/soulx_runner.py, driven by scripts/trope-render.mjs.
//
// The metadata format (voice-feasibility.md §3.1): a list of segments, each with `index`, `language`,
// `time` [start_ms, end_ms] inside the verse's WAV, and five space-separated parallel strings, one entry
// per note: `duration` (s), `phoneme` (`<SP>` for a rest, `en_P1-P2-P3` for one sung syllable, or one
// `zh_` pinyin syllable), `note_pitch` (MIDI, 0 for a rest), `note_type` (1 rest, 2 a note that starts a
// syllable, 3 a slur continuation carrying the same token), plus `text` (display only) and `f0`.

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

// One sung syllable -> one SoulX token. ph is the score's phoneme list (pronunciation-profile symbols);
// the vowel carries CMU stress digit 1 on the tonic syllable, 0 elsewhere.
export function syllableToken(ph, { stress = null, profile, chet = "en" } = {}) {
  const prof = pronunciationProfile(profile);
  const phones = ph || [];
  if (chet === "zh" && ZH_SYLLABLES[phones[0]]) {
    const zh = ZH_SYLLABLES[phones[0]][phones.slice(1).join("")];
    if (zh) return `zh_${zh}`;
  }
  const digit = STRESS_DIGIT[stress] || "0";
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
  return `en_${out.join("-")}`;
}

// The score's notes and rests, in milliseconds on a single rounded clock so the durations add up to
// exactly round(seconds * 1000): each note boundary is rounded once, and a duration is the difference.
function noteList(score, { profile, chet, lead, wordGap }) {
  const msAt = beats => Math.round(beats * 60000 / score.tempo);
  const items = [];
  const rest = (ms, unit) => { if (ms > 0) items.push({ token: "<SP>", pitch: 0, type: 1, ms, unit, text: "<SP>" }); };
  rest(Math.round(lead * 1000), 0);

  const events = score.events || [];
  let clock = 0;   // beats
  events.forEach((e, k) => {
    rest(msAt(e.t) - msAt(clock), events[k - 1] ? events[k - 1].unit : 0);   // a gap in the score is a rest (the breath after sof pasuk)
    const syl = score.units[e.unit].syllables[e.syllable];
    const token = syllableToken(syl.ph, { stress: syl.stress, profile, chet });
    let ms = msAt(e.t + e.dur) - msAt(e.t);
    // A short silence carved from the end of each word's last note keeps words apart without
    // changing the verse's length (the experiment's 0.12 s gaps kept words separate in the f0 track).
    const next = events[k + 1];
    const wordEnd = next && next.unit !== e.unit && msAt(next.t) === msAt(e.t + e.dur);
    const gap = wordEnd ? Math.min(Math.round(wordGap * 1000), Math.round(ms * 0.3)) : 0;
    items.push({ token, pitch: Math.round(e.midi), type: e.slur ? 3 : 2, ms: ms - gap, unit: e.unit, text: String(syl.he || "").replace(/\s+/g, "") || token, ph: syl.ph });
    rest(gap, e.unit);
    clock = e.t + e.dur;
  });
  rest(msAt(score.beats ?? clock) - msAt(clock), events.at(-1) ? events.at(-1).unit : 0);
  return items;
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

// score -> SoulX target metadata (an array of segments; more than one only when the verse was split).
// Options: profile (pronunciation profile name or object), chet "en" (HH / T-S) or "zh" (Mandarin
// syllables for ח, כ rafe and צ), lead (s of leading rest, a breath before the first note), wordGap (s
// carved from the end of each word), maxSegmentSeconds.
export function scoreToSoulx(score, { profile, chet = "en", lead = 0.25, wordGap = 0.1, maxSegmentSeconds = MAX_SEGMENT_SECONDS } = {}) {
  if (!["en", "zh"].includes(chet)) throw new Error(`trope/soulx: chet must be "en" or "zh", got ${chet}`);
  if (!score || !score.tempo || !Array.isArray(score.events)) throw new Error("trope/soulx: not a score (scoreVerse output)");
  const items = noteList(score, { profile, chet, lead, wordGap });
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
      // Ignored in score mode but must not be empty: the Space's parser truncates the target to the f0
      // length, so an empty string renders nothing (§3.2 call 1). One zero per mel frame, rounded up.
      f0: Array(Math.ceil(ms / 1000 * FRAMES_PER_SECOND)).fill("0.0").join(" "),
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
