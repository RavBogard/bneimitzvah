import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreVerse } from "../trope/melody.mjs";
import { scoreToSoulx, SOULX_STYLES } from "../trope/soulx.mjs";
import { buildPlan, scoreF0, segmentNotes, syllablePhones, phonikudSymbol, wordStressIndex, phraseText, parseS2sArgs, STRESS_MARK } from "../trope/speech2sing.mjs";

const table = JSON.parse(readFileSync(new URL("../trope/cells/haftarah.json", import.meta.url), "utf8"));
import { verseUnits } from "../trope/text.mjs";
// The fixture's MAM text through the live front end (the hand-made fixture units carry no word index or gemination).
const fixture = JSON.parse(readFileSync(new URL("./fixtures/trope/i-samuel-20-18.units.json", import.meta.url), "utf8"));
const units = { ...verseUnits(fixture.he), ref: fixture.ref };
const score = scoreVerse(units, { table, key: "D3" });
const segments = scoreToSoulx(score, { ...SOULX_STYLES.v2 });
const plan = buildPlan(score, segments, { units });

test("Phonikud symbols: profile IPA with ascii g", () => {
  assert.equal(phonikudSymbol("x"), "χ");
  assert.equal(phonikudSymbol("r"), "ʁ");
  assert.equal(phonikudSymbol("sh"), "ʃ");
  assert.equal(phonikudSymbol("g"), "g");
  assert.equal(phonikudSymbol("ts"), "ts");
  assert.throws(() => phonikudSymbol("nope"), /no symbol/);
});

test("syllable phones split onset / vowel / coda and drop a geminate coda", () => {
  assert.deepEqual(syllablePhones({ ph: ["x", "a", "r"] }), { onset: ["χ"], vowel: ["a"], coda: ["ʁ"] });
  assert.deepEqual(syllablePhones({ ph: ["j", "i", "p"], gem: "p" }), { onset: ["j"], vowel: ["i"], coda: [] });
  assert.deepEqual(syllablePhones({ ph: ["d", "e", "sh"] }), { onset: ["d"], vowel: ["e"], coda: ["ʃ"] });
});

test("word stress: tonic, else secondary, else dictionary stress", () => {
  assert.equal(wordStressIndex([{ stress: null }, { stress: "tonic" }, { stress: null }]), 1);
  assert.equal(wordStressIndex([{ stress: "secondary" }, { stress: null }]), 0);
  assert.equal(wordStressIndex([{ vowel: "QAMATS" }, { vowel: "SEGOL", closed: true }]), 0);   // segolate: mil'el
  assert.equal(wordStressIndex([{ vowel: "PATAH" }, { vowel: "QAMATS", closed: true }]), 1);
});

test("the plan covers every score event, in phrases split at the emitter's rests", () => {
  const sungNotes = plan.phrases.flatMap(p => p.syllables).reduce((s, x) => s + x.notes, 0);
  assert.equal(sungNotes, score.events.length);
  const rests = segmentNotes(segments).filter((n, i, a) => n.rest && i > 0 && i < a.length - 1).length;
  assert.equal(plan.phrases.length, rests + 1);
  // I Samuel 20:18: four phrases, the etnachta phrase ends on chodesh
  assert.deepEqual(plan.phrases.map(p => p.text), ["vajˈomeʁ lˈo jehonatˈan", "maχˈaʁ χˈodeʃ", "venifkˈadta kˈi jipakˈed", "moʃavˈeχa"]);
  for (const p of plan.phrases) {
    assert.ok(p.end > p.start);
    p.syllables.forEach((s, i) => {
      if (i) assert.ok(Math.abs(p.syllables[i - 1].t + p.syllables[i - 1].dur - s.t) < 0.002, "syllables touch inside a phrase");
    });
  }
  assert.equal(plan.notes.length, segmentNotes(segments).length);
});

test("one stress mark per word, words separated by spaces", () => {
  for (const p of plan.phrases) {
    for (const w of phraseText(p).split(" ")) assert.equal([...w].filter(c => c === STRESS_MARK).length, 1, w);
  }
});

test("score f0: note pitches, glides at joins, lead-in before a phrase, 0 in rests", () => {
  const notes = [
    { t: 0, dur: 0.5, midi: 0, rest: true },
    { t: 0.5, dur: 0.5, midi: 57, rest: false },
    { t: 1.0, dur: 0.6, midi: 60, rest: false },
    { t: 1.6, dur: 0.4, midi: 0, rest: true },
  ];
  const f0 = scoreF0(notes, { fps: 50, vibratoCents: 0 });
  assert.equal(f0.length, 100);
  assert.equal(f0[0], 0);                          // rest before the lead-in
  assert.equal(f0[20], 220);                       // 0.4 s: 100 ms lead-in at the first note's pitch
  assert.equal(f0[35], 220);                       // middle of A3
  assert.ok(f0[50] > 220 && f0[50] < 261.6);       // the join: half way through the glide
  assert.equal(f0[65], 261.6);                     // C4
  assert.equal(f0[82], 261.6);                     // 40 ms into the 80 ms tail after the phrase's last note
  assert.equal(f0[95], 0);                         // rest
});

test("score f0 of the verse is as long as the plan, voiced on every note", () => {
  const f0 = scoreF0(plan.notes, { seconds: plan.seconds });
  assert.equal(f0.length, Math.ceil(plan.seconds * 50));
  for (const n of plan.notes.filter(n => !n.rest)) assert.ok(f0[Math.floor((n.t + n.dur / 2) * 50)] > 0);
});

test("command line", () => {
  const o = parseS2sArgs(["--ref", "I Samuel 20:18"]);
  assert.equal(o.key, "D3"); assert.equal(o.style, "v2"); assert.equal(o.stage, "all"); assert.equal(o.source, "timed"); assert.equal(o.steps, 32);
  assert.equal(parseS2sArgs(["--ref", "x", "--stage", "tts", "--cpu", "--max-cons", "0.5"]).maxCons, 0.5);
  assert.throws(() => parseS2sArgs([]), /--ref/);
  assert.throws(() => parseS2sArgs(["--ref", "x", "--stage", "nope"]), /--stage/);
  assert.throws(() => parseS2sArgs(["--ref", "x", "--prompt", "a.wav"]), /--prompt-meta/);
  assert.throws(() => parseS2sArgs(["--ref", "x", "--bogus"]), /unknown/);
});
