import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreVerse } from "../trope/melody.mjs";
import { scoreToSoulx, soulxSummary, syllableToken, wordToken, synthF0, rhythmFactor, BREATHS, ZH_ONSETS } from "../trope/soulx.mjs";

const table = JSON.parse(readFileSync(new URL("../trope/cells/haftarah.json", import.meta.url), "utf8"));
const verse = JSON.parse(readFileSync(new URL("./fixtures/trope/i-samuel-20-18.units.json", import.meta.url), "utf8"));
const phoneSet = new Set(JSON.parse(readFileSync(new URL("./fixtures/trope/soulx-phone-set.json", import.meta.url), "utf8")).tokens);
const score = scoreVerse(verse, { table });
const LEAD = 0.25;   // scoreToSoulx's default leading rest

const fields = seg => ({
  phoneme: seg.phoneme.split(" "), duration: seg.duration.split(" ").map(Number),
  pitch: seg.note_pitch.split(" ").map(Number), type: seg.note_type.split(" ").map(Number),
  text: seg.text.split(" "), f0: seg.f0.split(" "),
});
const one = opts => { const segs = scoreToSoulx(score, opts); assert.equal(segs.length, 1); return { seg: segs[0], ...fields(segs[0]) }; };
// The emitted notes that carry pitch, in order: one per score event.
const pitched = f => f.type.map((t, k) => k).filter(k => f.type[k] !== 1);

test("one token per note, and one pitched note per score event", () => {
  const f = one();
  const n = f.phoneme.length;
  for (const k of ["duration", "pitch", "type", "text"]) assert.equal(f[k].length, n, `${k} length`);
  const idx = pitched(f);
  assert.equal(idx.length, score.events.length);
  idx.forEach((k, e) => assert.equal(f.pitch[k], score.events[e].midi, `note ${e}`));
  for (let k = 0; k < n; k++) assert.equal(f.phoneme[k] === "<SP>", f.type[k] === 1, `rest ${k} is <SP> with type 1`);
  assert.equal(soulxSummary([f.seg]).notes, score.events.length);
});

test("slur notes are note_type 3 and repeat their syllable's token; syllable starts are 2", () => {
  const f = one();
  const idx = pitched(f);
  idx.forEach((k, e) => {
    assert.equal(f.type[k], score.events[e].slur ? 3 : 2, `event ${e}`);
    if (score.events[e].slur) assert.equal(f.phoneme[k], f.phoneme[idx[e - 1]]);
  });
  assert.ok(f.type.filter(t => t === 3).length >= 9, "the verse's four melismas are there");   // CHO-desh, KAD-ta, KED, LO
});

test("durations sum to the score's seconds plus the leading breath, and time spans them", () => {
  const f = one();
  const sum = f.duration.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - (score.seconds + LEAD)) < 0.002, `${sum} vs ${score.seconds + LEAD}`);
  assert.deepEqual(f.seg.time, [0, Math.round((score.seconds + LEAD) * 1000)]);
  assert.ok(f.duration.every(d => d > 0));
});

test("every token is in SoulX's phone set, as ARPAbet words with stress on the tonic", () => {
  for (const chet of ["en", "zh"]) {
    for (const tok of one({ chet }).phoneme) {
      if (tok.startsWith("en_")) for (const ph of tok.slice(3).split("-")) assert.ok(phoneSet.has(`en_${ph}`), `${tok}: en_${ph}`);
      else assert.ok(phoneSet.has(tok), tok);
    }
  }
  const f = one();
  assert.equal(f.phoneme[pitched(f)[0]], "en_V-AY0");   // va(y): vowel + yod is the ARPAbet diphthong
  assert.ok(f.phoneme.includes("en_T-AA1-N"));        // ye-ho-na-TAN: tonic vowel carries 1
  assert.ok(f.phoneme.includes("en_D-EH0-SH"));
});

test("f0 is a non-empty string of zeros, one per 20 ms frame", () => {
  const f = one();
  assert.ok(f.f0.length > 0 && f.f0.every(x => x === "0.0"));
  assert.equal(f.f0.length, Math.ceil((f.seg.time[1] - f.seg.time[0]) / 20));
});

test('chet: "zh" changes only the tokens of ח / כ rafe / צ syllables', () => {
  const en = one({ chet: "en" }), zh = one({ chet: "zh" });
  assert.equal(zh.phoneme.length, en.phoneme.length);
  assert.deepEqual(zh.duration, en.duration);
  assert.deepEqual(zh.pitch, en.pitch);
  assert.deepEqual(zh.type, en.type);
  const idx = pitched(en);
  let changed = 0;
  en.phoneme.forEach((tok, k) => {
    if (tok === zh.phoneme[k]) return;
    changed++;
    const e = score.events[idx.indexOf(k)];
    assert.ok(e, `rest ${k} changed`);
    const ph = score.units[e.unit].syllables[e.syllable].ph;
    assert.ok(ph.some(p => ZH_ONSETS.includes(p)), `${tok} -> ${zh.phoneme[k]} has no ח/צ`);
    assert.match(zh.phoneme[k], /^zh_[hz]/);
  });
  assert.equal(changed, 5);                           // CHO x4 (melisma) and the final cha; ma-CHAR has no pinyin syllable
  assert.ok(zh.phoneme.includes("en_HH-AA1-R"));
});

test("syllableToken: tsadi and the zh shapes", () => {
  assert.equal(syllableToken(["ts", "a"], {}), "en_T-S-AA0");
  assert.equal(syllableToken(["ts", "a"], { chet: "zh" }), "zh_za1");
  assert.equal(syllableToken(["ts", "i"], { chet: "zh" }), "en_T-S-IY0");   // pinyin zi is not [tsi]
  assert.equal(syllableToken(["x", "a", "j"], { chet: "zh", stress: "tonic" }), "zh_hai1");
  assert.equal(syllableToken(["l", "e", "x"], { chet: "zh" }), "en_L-EH0-HH");   // coda ח: no pinyin syllable
  assert.equal(syllableToken(["a"], { stress: "tonic" }), "en_AA1");
  assert.equal(syllableToken(["q", "a"], {}), "en_AA0");   // glottal stop is no phone
  assert.throws(() => syllableToken(["?"], {}), /no symbol/);
  for (const tok of ["zh_za1", "zh_hai1"]) assert.ok(phoneSet.has(tok));
});

test("a verse over the segment limit splits at unit boundaries into contiguous segments", () => {
  const whole = one();
  const segs = scoreToSoulx(score, { maxSegmentSeconds: 6 });
  assert.ok(segs.length > 1);
  let t = 0;
  for (const s of segs) {
    assert.equal(s.time[0], t); t = s.time[1];
    assert.ok(s.time[1] - s.time[0] <= 6000, `${s.time}`);
    const f = fields(s);
    assert.equal(f.f0.length, Math.ceil((s.time[1] - s.time[0]) / 20));
    assert.notEqual(f.type[0], 3, "a segment never starts mid-melisma");
  }
  assert.equal(t, whole.seg.time[1]);
  assert.deepEqual(segs.flatMap(s => s.phoneme.split(" ")), whole.phoneme);
  assert.equal(soulxSummary(segs).notes, score.events.length);
  // the first cut is the etnachta (CHO-desh), the verse's main break, when it fits
  const two = scoreToSoulx(score, { maxSegmentSeconds: 10 });
  assert.equal(two.length, 2);
  assert.equal(fields(two[0]).phoneme.filter(x => x !== "<SP>").at(-1), "en_D-EH0-SH");
});

test("bad options are refused", () => {
  assert.throws(() => scoreToSoulx(score, { chet: "ar" }), /chet/);
  assert.throws(() => scoreToSoulx({ units: [] }), /not a score/);
});

// ---- performance options (voice A/B, 2026-10-15) ----

test('phrasing "phrases": legato inside phrases, rests only at the score\'s gaps and at deep breaks', () => {
  const f = one({ phrasing: "phrases" });
  const idx = pitched(f);
  assert.equal(idx.length, score.events.length);
  const rests = f.type.map((t, k) => k).filter(k => f.type[k] === 1).slice(1);   // after the leading breath
  // every rest follows the last note of a unit whose disjunctive is etnachta / silluq or a long-run zakef/tipcha
  for (const k of rests) {
    const e = score.events[idx.filter(j => j < k).length - 1];
    assert.ok(["etnachta", "silluq", "tipcha", "zakef-gadol", "zakef-katan"].includes(score.units[e.unit].cell.trope), `rest ${k} after ${score.units[e.unit].cell.trope}`);
    assert.ok(f.duration[k] >= 0.2, `rest ${k} is ${f.duration[k]} s: SoulX merges shorter gaps`);
  }
  assert.ok(rests.length >= 2 && rests.length <= 4, `${rests.length} rests`);
  // the note before a no-breath word boundary keeps its whole length (nothing is carved)
  const grid = one();
  assert.ok(f.duration.reduce((a, b) => a + b, 0) > grid.duration.reduce((a, b) => a + b, 0));
  assert.ok(BREATHS[4] > BREATHS[3]);
});

test('rhythm "speech": tonic long, sheva short, deterministic; pitches and tokens unchanged', () => {
  const grid = one({ phrasing: "phrases" }), sp = one({ phrasing: "phrases", rhythm: "speech" });
  assert.deepEqual(sp.phoneme, grid.phoneme);
  assert.deepEqual(sp.pitch, grid.pitch);
  assert.deepEqual(sp.type, grid.type);
  assert.deepEqual(one({ phrasing: "phrases", rhythm: "speech" }).duration, sp.duration);
  const at = tok => sp.duration[sp.phoneme.indexOf(tok)];
  assert.ok(at("en_HH-AA1-R") > at("en_M-AA0"), "ma-CHAR: the tonic is longer");
  assert.ok(at("en_Y-EH0") < at("en_HH-OW0"), "ye-ho: the vocal sheva is shorter");
  assert.ok(sp.duration.every(d => d >= 0.12 || d === 0));
  assert.ok(rhythmFactor({ lastOfUnit: true, rank: 4 }) > rhythmFactor({ lastOfUnit: true, rank: 3 }));
  assert.equal(rhythmFactor({ held: true, stress: "tonic" }), 1);
});

test('stress "full" / "flat": 0 only on vocal sheva and hataf, full vowels keep 1 or 2', () => {
  const full = one({ stress: "full" }).phoneme, flat = one({ stress: "flat" }).phoneme;
  const digits = toks => toks.filter(t => t.startsWith("en_")).flatMap(t => t.slice(3).split("-")).filter(p => /\d$/.test(p));
  const zeros = toks => toks.filter(t => /0(-|$)/.test(t));
  assert.deepEqual([...new Set(zeros(full))].sort(), ["en_V-EH0", "en_Y-EH0"]);   // ye-ho-na-tan, ve-nif-kad-ta: sheva na
  assert.deepEqual([...new Set(zeros(flat))].sort(), ["en_V-EH0", "en_Y-EH0"]);
  assert.ok(full.includes("en_T-AA1-N") && full.includes("en_N-AA2") && full.includes("en_D-EH2-SH"));
  assert.ok(digits(flat).every(p => /[01]$/.test(p)));
  assert.equal(syllableToken(["x", "a"], { stressMode: "full", reduced: true }), "en_HH-AA0");
  assert.equal(syllableToken(["x", "a"], { stressMode: "full", reduced: true, stress: "tonic" }), "en_HH-AA1");
});

test('tokens "word": one token per unit, repeated as note_type 3 on the rest of its notes, all in the phone set', () => {
  const f = one({ tokens: "word" });
  const idx = pitched(f);
  assert.equal(idx.length, score.events.length);
  idx.forEach((k, e) => {
    const first = e === 0 || score.events[e - 1].unit !== score.events[e].unit;
    assert.equal(f.type[k], first ? 2 : 3, `event ${e}`);
    if (!first) assert.equal(f.phoneme[k], f.phoneme[idx[e - 1]]);
  });
  assert.equal(new Set(f.phoneme.filter(t => t !== "<SP>")).size, score.units.length);
  assert.ok(f.phoneme.includes("en_HH-OW1-D-EH0-SH"));
  for (const tok of f.phoneme) if (tok.startsWith("en_")) for (const ph of tok.slice(3).split("-")) assert.ok(phoneSet.has(`en_${ph}`), ph);
  assert.equal(wordToken(score.units[2].syllables), "en_M-AA0-HH-AA1-R");
});

test('f0 "synth": one value per frame, 0 in rests and voiceless edges, the note pitch mid-note, glides between', () => {
  const f = one({ phrasing: "phrases", f0: "synth" });
  assert.equal(f.f0.length, Math.ceil((f.seg.time[1] - f.seg.time[0]) / 20));
  const hz = f.f0.map(Number);
  const midi = h => 69 + 12 * Math.log2(h / 440);
  let t = 0, glided = 0;
  f.duration.forEach((d, k) => {
    const a = Math.round(t * 50), b = Math.round((t + d) * 50); t += d;
    const mid = hz[Math.floor((a + b) / 2)];
    if (f.type[k] === 1) { for (let i = a + 1; i < b - 1; i++) assert.equal(hz[i], 0, `rest ${k} frame ${i}`); return; }
    assert.ok(mid > 0, `note ${k} voiced mid-note`);
    assert.ok(Math.abs(midi(mid) - f.pitch[k]) <= 0.3, `note ${k}: ${midi(mid)} vs ${f.pitch[k]}`);
    const j = hz[a];
    if (k > 0 && f.type[k - 1] !== 1 && f.pitch[k - 1] !== f.pitch[k] && j > 0) {
      const m = midi(j);
      if (m > Math.min(f.pitch[k - 1], f.pitch[k]) + 0.1 && m < Math.max(f.pitch[k - 1], f.pitch[k]) - 0.1) glided++;
    }
  });
  assert.ok(glided >= 5, `${glided} joins glide`);
  // a voiceless onset (en_K-IY1, en_SH-AA0) starts unvoiced
  const k = f.phoneme.indexOf("en_SH-AA0");
  const a = Math.round(f.duration.slice(0, k).reduce((x, y) => x + y, 0) * 50);
  assert.equal(hz[a], 0);
  assert.deepEqual(synthF0([{ token: "<SP>", pitch: 0, type: 1, ms: 100 }]), ["0.0", "0.0", "0.0", "0.0", "0.0"]);
});

test("bad performance options are refused", () => {
  assert.throws(() => scoreToSoulx(score, { phrasing: "breathless" }), /phrasing/);
  assert.throws(() => scoreToSoulx(score, { stress: "loud" }), /stress/);
  assert.throws(() => scoreToSoulx(score, { f0: "real" }), /f0/);
});
