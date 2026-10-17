import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syllableTimingFeatures, fitTimingModel, predictSyllableMs, TIMING_MODEL_SCHEMA } from "../trope/timing-model.mjs";
import { verseUnits } from "../trope/text.mjs";
import { scoreVerse } from "../trope/melody.mjs";
import { MEASURED_LIMITS, applyMeasuredTiming } from "../trope/measured-timing.mjs";

const table = JSON.parse(readFileSync(new URL("../trope/cells/torah.json", import.meta.url), "utf8"));
const verses = JSON.parse(readFileSync(new URL("./fixtures/trope/calibration-torah.json", import.meta.url), "utf8")).verses;
const scoreFor = row => { const units = verseUnits(row.he, { ref: row.ref, final: false }); return { units, score: scoreVerse(units, { table, key: "D3", tempo: 96, elision: false }) }; };
const featuresFor = row => { const { units, score } = scoreFor(row); return syllableTimingFeatures(score, units); };
// Invented "measured" lengths from a known rule: accented syllables 500 ms, sheva 150, others 250, scaled by
// notes^0.75 and by 1.2 per consonant (the model's default gamma and delta).
const rule = f => Math.round((f.keys[0] === "pos:accent" ? 500 : f.keys[0] === "pos:sheva" ? 150 : 250) * f.notes ** 0.75 * Math.exp(0.2 * f.consonants));

test("features name each syllable's place against its word's accent, the accent, and the verse end", () => {
  const f = featuresFor(verses.find(v => v.ref === "Genesis 1:1"));
  assert.equal(f.length, 18);
  assert.deepEqual(f.slice(0, 3).map(x => x.consonants), [1, 1, 2], "בְּ רֵא שִׁית");
  assert.ok(f.every(x => x.notes >= 1 && x.keys.length === 3 && /^pos:(accent|post|pre|sheva)$/.test(x.keys[0])));
  assert.equal(f[0].keys[0], "pos:sheva", "בְּ of בְּרֵאשִׁית has a vocal sheva");
  assert.equal(f[2].keys[2], "pos:accent|acc:tipcha", "שִׁית carries the tipcha");
  assert.match(f.at(-1).keys[2], /\|versefinal$/);
});

test("a fitted model recovers a known rule on verses it has not seen and is plain, reproducible data", () => {
  const rows = verses.slice(0, 12).map(row => { const features = featuresFor(row); return { verse: row.ref, features, syllableMs: features.map(rule) }; });
  const held = rows.pop(), model = fitTimingModel(rows);
  assert.equal(model.schema, TIMING_MODEL_SCHEMA); assert.equal(model.trainedOn.verses.length, rows.length);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model); assert.deepEqual(fitTimingModel(rows), model, "deterministic");
  const predicted = predictSyllableMs(model, held.features);
  const err = predicted.map((ms, k) => Math.abs(Math.log(ms / held.syllableMs[k])));
  assert.ok(err.reduce((a, b) => a + b, 0) / err.length < 0.15, "held-out syllables within about 15%");
  const accented = held.features.map((f, k) => [f, predicted[k]]).filter(([f]) => f.keys[0] === "pos:accent" && f.notes === 1).map(([, ms]) => ms);
  const sheva = held.features.map((f, k) => [f, predicted[k]]).filter(([f]) => f.keys[0] === "pos:sheva" && f.notes === 1).map(([, ms]) => ms);
  assert.ok(accented.length && sheva.length, "the held-out verse has both kinds of single-note syllable");
  assert.ok(Math.min(...accented) > Math.max(...sheva) * 1.5, "accented syllables are held, shevas are short");
  const one = { notes: 1, noteBeats: [0.5], keys: ["pos:pre", "pos:pre|role:conjunctive", "pos:pre|acc:munach"] };
  const [light, heavy] = predictSyllableMs(model, [{ ...one, consonants: 1 }, { ...one, consonants: 3 }]);
  assert.ok(heavy > light * 1.4, "a syllable with more consonants gets more time");
});

test("predictions always build a measured-timing score, even for unequal notes at extreme speed", () => {
  const model = fitTimingModel(verses.slice(0, 6).map(row => { const features = featuresFor(row); return { features, syllableMs: features.map(rule) }; }));
  let built = 0;
  for (const row of verses) {
    const { units, score } = scoreFor(row), features = syllableTimingFeatures(score, units);
    for (const tempoScale of [1, 0.1, 0.01]) { applyMeasuredTiming(score, predictSyllableMs(model, features, { tempoScale }), { source: "modelled" }); built++; }
  }
  assert.equal(built, verses.length * 3);
  const unseen = { notes: 1, noteBeats: [0.5], consonants: 1, keys: ["pos:x", "pos:x|role:y", "pos:x|acc:z"] };
  const known = { ...unseen, keys: ["pos:accent", "pos:x|role:y", "pos:x|acc:z"] };
  assert.equal(predictSyllableMs(model, [unseen])[0], Math.round(Math.exp(model.global + model.delta)), "unseen keys add nothing");
  assert.notEqual(predictSyllableMs(model, [known])[0], predictSyllableMs(model, [unseen])[0]);
});

test("predictions stay inside the measured-timing bounds and tempoScale stretches them", () => {
  const features = featuresFor(verses[0]), model = fitTimingModel([{ features, syllableMs: features.map(rule) }]);
  const base = predictSyllableMs(model, features), slow = predictSyllableMs(model, features, { tempoScale: 1.5 });
  assert.ok(base.every((ms, k) => Number.isSafeInteger(ms) && ms >= MEASURED_LIMITS.syllableMinMs && ms <= MEASURED_LIMITS.syllableMaxMs && ms >= features[k].notes * MEASURED_LIMITS.noteMinMs));
  assert.ok(slow.every((ms, k) => ms >= base[k]) && slow.some((ms, k) => ms > base[k] * 1.4));
  const extreme = { ...model, global: 20 };
  assert.ok(predictSyllableMs(extreme, features).every(ms => ms === MEASURED_LIMITS.syllableMaxMs));
});

test("malformed models, examples and options are refused", () => {
  const features = featuresFor(verses[0]);
  assert.throws(() => fitTimingModel([]), /options/);
  assert.throws(() => fitTimingModel([{ features, syllableMs: [100] }]), /example/);
  assert.throws(() => fitTimingModel([{ features, syllableMs: features.map(() => 0) }]), /example/);
  assert.throws(() => fitTimingModel([{ features, syllableMs: features.map(rule) }], { gamma: 2 }), /options/);
  assert.throws(() => fitTimingModel([{ features, syllableMs: features.map(rule) }], { delta: -1 }), /options/);
  assert.throws(() => fitTimingModel([{ features: features.map(f => ({ ...f, consonants: 1.5 })), syllableMs: features.map(rule) }]), /example/);
  assert.throws(() => predictSyllableMs({ schema: "x" }, features), /model/);
  assert.throws(() => predictSyllableMs(fitTimingModel([{ features, syllableMs: features.map(rule) }]), features, { tempoScale: 0 }), /model/);
  assert.throws(() => syllableTimingFeatures({}, {}), /input/);
  assert.throws(() => predictSyllableMs({ ...fitTimingModel([{ features, syllableMs: features.map(rule) }]), gamma: undefined }, features), /model/);
});
