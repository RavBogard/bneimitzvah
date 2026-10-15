import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreVerse } from "../trope/melody.mjs";
import { scoreToSoulx, soulxSummary, syllableToken, ZH_ONSETS } from "../trope/soulx.mjs";

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
