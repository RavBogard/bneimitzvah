// Speech-to-singing plan (voice-quality.md path 1): a score plus its SoulX note timeline -> what a Hebrew
// TTS should say, phrase by phrase, and when each syllable's vowel must start, so that the spoken phrase can
// be re-timed to the chant and re-sung by SoulX-Singer-SVC with the score's own f0.
//   phrases: runs of syllables between rests (the emitter's breaths: etnachta, sof pasuk, a long tipcha run).
//   syllables: Phonikud IPA phones (onset, vowel, coda), whether it is stressed, t = the vowel onset time
//   (the note onset: a singer puts the consonant before the beat) and the time the syllable's notes last.
//   notes: the sung timeline, for the f0 curve (scoreF0) and the pitch check.
// Pure, dependency-free ESM. The Python side is trope/speech2sing.py (TTS, durations, f0 mask) and
// trope/soulx_svc_runner.py (SVC); scripts/trope-speech2sing.mjs drives them.

import { pronunciationProfile } from "./text.mjs";

// Our pronunciation-profile IPA -> the characters Phonikud-TTS was trained on (its phoneme_id_map). Phonikud
// writes ascii g, not U+0261; everything else in israeli-v1 (χ ʁ ʃ ʔ ts) is already Phonikud's.
const PHONIKUD_FIX = { "ɡ": "g" };
export const STRESS_MARK = "ˈ";

// One profile phoneme -> Phonikud characters ("" for a silent symbol).
export function phonikudSymbol(ph, profile) {
  const prof = pronunciationProfile(profile);
  const sym = prof.symbols[ph];
  if (!sym) throw new Error(`trope/speech2sing: no symbol "${ph}" in profile ${prof.name}`);
  return [...String(sym.ipa || "")].map(c => PHONIKUD_FIX[c] ?? c).join("");
}

const isVowel = (ph, prof) => (prof.symbols[ph] || {}).type === "vowel";

// Which syllable of a word carries the spoken stress. The tonic if the word has the unit's accent; else
// a secondary accent or meteg; else dictionary stress (mil'el for a closed segol after a full vowel, the
// way verseToSyllableString marks it; otherwise the last syllable). A TTS stresses every word.
export function wordStressIndex(syls) {
  let k = syls.findIndex(s => s.stress === "tonic");
  if (k >= 0) return k;
  k = syls.findIndex(s => s.stress === "secondary");
  if (k >= 0) return k;
  const n = syls.length;
  if (n < 2) return 0;
  const last = syls[n - 1], pen = syls[n - 2];
  if (last.vowel === "SEGOL" && last.closed && pen.vowel && pen.vowel !== "SHEVA" && !/^HATAF/.test(pen.vowel)) return n - 2;
  return n - 1;
}

// One score syllable -> { onset: [chars], vowel: [chars], coda: [chars] } in Phonikud characters. A
// geminate coda (the dagesh forte's doubled consonant) is dropped: modern Hebrew speech, which the TTS
// learned, does not double (Phonikud itself writes jipakˈed, vajomˈeʁ).
export function syllablePhones(syl, profile) {
  const prof = pronunciationProfile(profile);
  let ph = syl.ph || [];
  if (syl.gem && ph.length > 1 && ph[ph.length - 1] === syl.gem) ph = ph.slice(0, -1);
  const out = { onset: [], vowel: [], coda: [] };
  let seen = false;
  for (const p of ph) {
    const chars = phonikudSymbol(p, prof);
    if (!chars) continue;
    if (isVowel(p, prof)) { out.vowel.push(chars); seen = true; }
    else (seen ? out.coda : out.onset).push(chars);
  }
  if (!out.vowel.length) out.vowel.push("e");   // a vowelless note (never in israeli-v1) is sung on e
  return out;
}

// The emitter's segments -> one flat note list in seconds: { t, dur, midi, rest, type }.
export function segmentNotes(segments) {
  const notes = [];
  let t = 0;
  for (const seg of segments) {
    const durs = seg.duration.split(" ").map(Number);
    const pitches = seg.note_pitch.split(" ").map(Number);
    const types = seg.note_type.split(" ").map(Number);
    durs.forEach((d, i) => {
      notes.push({ t: Math.round(t * 1000) / 1000, dur: d, midi: pitches[i], type: types[i], rest: types[i] === 1 });
      t += d;
    });
  }
  return notes;
}

// score (scoreVerse) + segments (scoreToSoulx of that score) -> the plan. The segments' pitched notes are
// the score's events in order (one per event); a rest between two syllables ends a phrase. units is the
// verseUnits object the score came from: the score drops each syllable's word index, vowel and closedness,
// which word boundaries and dictionary stress need (without it each unit is one word).
export function buildPlan(score, segments, { profile, units = null } = {}) {
  const prof = pronunciationProfile(profile);
  const notes = segmentNotes(segments);
  const events = score.events || [];
  const pitched = notes.filter(n => !n.rest);
  if (pitched.length !== events.length) throw new Error(`trope/speech2sing: ${pitched.length} sung notes for ${events.length} score events`);

  // Spoken stress per (unit, syllable).
  const stressed = new Set();
  const sylOf = (ui, si) => (units && units.units[ui] && units.units[ui].syllables[si]) || score.units[ui].syllables[si];
  (score.units || []).forEach((u, ui) => {
    const words = [];
    u.syllables.forEach((_, si) => {
      const s = sylOf(ui, si);
      const w = s.word ?? 0;
      (words[w] = words[w] || []).push({ ...s, si });
    });
    words.filter(Boolean).forEach(ws => stressed.add(`${ui}:${ws[wordStressIndex(ws)].si}`));
  });

  const phrases = [];
  let cur = null, k = 0, restSince = true;
  for (const n of notes) {
    if (n.rest) { restSince = true; continue; }
    const e = events[k++];
    const key = `${e.unit}:${e.syllable}`;
    const last = cur && cur.syllables[cur.syllables.length - 1];
    if (last && last.key === key) { last.dur = Math.round((last.dur + n.dur) * 1000) / 1000; last.notes++; restSince = false; continue; }
    if (!cur || restSince) { cur = { syllables: [] }; phrases.push(cur); }
    restSince = false;
    const syl = sylOf(e.unit, e.syllable);
    const prevSyl = cur.syllables[cur.syllables.length - 1];
    const wordStart = !prevSyl || prevSyl.unit !== e.unit || (syl.word ?? 0) !== (sylOf(prevSyl.unit, prevSyl.syllable).word ?? 0);
    cur.syllables.push({
      key, unit: e.unit, syllable: e.syllable, he: syl.he, wordStart,
      stressed: stressed.has(key), ...syllablePhones(syl, prof),
      t: n.t, dur: n.dur, notes: 1,
    });
  }
  phrases.forEach(p => {
    p.start = p.syllables[0].t;
    const z = p.syllables[p.syllables.length - 1];
    p.end = Math.round((z.t + z.dur) * 1000) / 1000;
    p.text = phraseText(p);
    p.syllables.forEach(s => delete s.key);
  });
  const total = notes.length ? notes[notes.length - 1].t + notes[notes.length - 1].dur : 0;
  return {
    ref: score.ref || null, key: score.key || null, tempo: score.tempo || null,
    seconds: Math.round(total * 1000) / 1000,
    phrases,
    notes: notes.map(({ t, dur, midi, rest, type }) => ({ t, dur, midi, rest, slur: type === 3 })),
  };
}

// The phrase as Phonikud IPA: words separated by spaces, the stress mark before the stressed vowel.
export function phraseText(phrase) {
  return phrase.syllables.map((s, i) => (i && s.wordStart ? " " : "") + s.onset.join("") + (s.stressed ? STRESS_MARK : "") + s.vowel.join("") + s.coda.join("")).join("");
}

const midiHz = m => 440 * 2 ** ((m - 69) / 12);

// The score's f0 at fps frames per second (SoulX-SVC reads 50: 24 kHz, hop 480), in Hz, 0 = unvoiced. Each
// note holds its pitch; a raised-cosine glide of glideMs is centred on every join of two touching pitched
// notes; vibrato (vibratoHz, +/- vibratoCents) eases in after 250 ms on notes of 500 ms or more. Rests are
// 0 except leadMs before a phrase's first note (its onset consonant is spoken before the beat) and tailMs
// after its last note, which take that note's pitch. The Python side zeroes the voiceless consonants.
export function scoreF0(notes, { fps = 50, glideMs = 80, vibratoHz = 5.5, vibratoCents = 20, leadMs = 200, tailMs = 80, seconds } = {}) {
  const total = seconds ?? (notes.length ? notes[notes.length - 1].t + notes[notes.length - 1].dur : 0);
  const n = Math.ceil(total * fps);
  const cents = new Array(n).fill(null);
  const half = glideMs / 2000;
  notes.forEach((x, i) => {
    if (x.rest) return;
    const p = notes[i - 1], q = notes[i + 1];
    const a = x.t, b = x.t + x.dur;
    for (let f = Math.max(0, Math.floor(a * fps)); f < Math.min(n, Math.ceil(b * fps)); f++) {
      const t = f / fps;
      if (t < a || t >= b) continue;
      let c = x.midi * 100;
      if (p && !p.rest && p.midi !== x.midi && t - a < half) {
        const w = (1 - Math.cos(Math.PI * (0.5 + (t - a) / (2 * half)))) / 2;
        c = (1 - w) * p.midi * 100 + w * x.midi * 100;
      } else if (q && !q.rest && q.midi !== x.midi && b - t <= half) {
        const w = (1 - Math.cos(Math.PI * (0.5 - (b - t) / (2 * half)))) / 2;
        c = (1 - w) * x.midi * 100 + w * q.midi * 100;
      }
      const tin = t - a;
      if (x.dur >= 0.5 && tin > 0.25) c += vibratoCents * Math.min(1, (tin - 0.25) / 0.25) * Math.sin(2 * Math.PI * vibratoHz * t);
      cents[f] = c;
    }
    // lead-in before a phrase's first note, tail after its last
    if (!p || p.rest) for (let f = Math.max(0, Math.floor((a - leadMs / 1000) * fps)); f < Math.min(n, Math.floor(a * fps) + 1); f++) if (cents[f] === null && f / fps < a) cents[f] = x.midi * 100;
    if (!q || q.rest) for (let f = Math.max(0, Math.floor(b * fps)); f < Math.min(n, Math.ceil((b + tailMs / 1000) * fps)); f++) if (cents[f] === null) cents[f] = x.midi * 100;
  });
  return cents.map(c => c === null ? 0 : Math.round(midiHz(c / 100) * 10) / 10);
}

// ---- command line (scripts/trope-speech2sing.mjs) ----------------------------------------------------
export const S2S_USAGE = 'usage: node scripts/trope-speech2sing.mjs --ref "Book c:v[-v]" [--key D3] [--tempo 96] [--style v2] [--table path] [--voice michael] [--prompt wav --prompt-meta json] [--out dir] [--stage all|tts|svc] [--source timed|world] [--steps 32] [--cfg 3] [--cpu] [--max-cons 0.6]';
const S2S_VALUE = ["--ref", "--key", "--tempo", "--style", "--table", "--voice", "--prompt", "--prompt-meta", "--out", "--stage", "--source", "--steps", "--cfg", "--max-cons"];
const S2S_BOOL = ["--cpu"];
export const S2S_STAGES = ["all", "tts", "svc"];
export const S2S_SOURCES = ["timed", "world"];
const S2S_STYLES = ["v1", "v2"];

// argv (without node and script) -> options; throws Error with a usage message.
export function parseS2sArgs(argv) {
  const raw = {}, flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (S2S_BOOL.includes(a)) flags.add(a);
    else if (S2S_VALUE.includes(a)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${a} needs a value`);
      raw[a] = argv[++i];
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!raw["--ref"]) throw new Error("give --ref");
  if (raw["--prompt"] && !raw["--prompt-meta"]) throw new Error("--prompt needs --prompt-meta (its f0 conditions the SVC)");
  const pick = (flag, ok, def) => {
    const v = raw[flag] ?? def;
    if (!ok.includes(v)) throw new Error(`${flag} must be one of ${ok.join(", ")}, got "${v}"`);
    return v;
  };
  const num = (flag, def, { int = false, min = 0, max = Infinity } = {}) => {
    if (raw[flag] === undefined) return def;
    const n = Number(raw[flag]);
    if (!Number.isFinite(n) || (int && !Number.isInteger(n)) || n < min || n > max) throw new Error(`${flag} out of range: "${raw[flag]}"`);
    return n;
  };
  return {
    ref: raw["--ref"], key: raw["--key"] || "D3", tempo: num("--tempo", 96, { min: 1 }),
    style: pick("--style", S2S_STYLES, "v2"), table: raw["--table"], voice: raw["--voice"] || "michael",
    prompt: raw["--prompt"], promptMeta: raw["--prompt-meta"], out: raw["--out"],
    stage: pick("--stage", S2S_STAGES, "all"), source: pick("--source", S2S_SOURCES, "timed"),
    steps: num("--steps", 32, { int: true, min: 1 }), cfg: num("--cfg", 3), maxCons: num("--max-cons", 0.6, { min: 0.05, max: 0.95 }),
    cpu: flags.has("--cpu"),
  };
}
