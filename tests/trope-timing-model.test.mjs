import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syllableTimingFeatures, fitTimingModel, predictSyllableMs, TIMING_MODEL_SCHEMA } from "../trope/timing-model.mjs";
import { verseUnits } from "../trope/text.mjs";
import { scoreVerse } from "../trope/melody.mjs";
import { MEASURED_LIMITS } from "../trope/measured-timing.mjs";

const table = JSON.parse(readFileSync(new URL("../trope/cells/torah.json", import.meta.url), "utf8"));
const verses = JSON.parse(readFileSync(new URL("./fixtures/trope/calibration-torah.json", import.meta.url), "utf8")).verses;
const featuresFor = row => {
  const units = verseUnits(row.he, { ref: row.ref, final: false });
  return syllableTimingFeatures(scoreVerse(units, { table, key: "D3", tempo: 96, elision: false }), units);
};
// Invented "measured" lengths from a known rule: accented syllables 500 ms, sheva 150, others 250, scaled by sqrt(notes).
const rule = f => Math.round((f.keys[0] === "pos:accent" ? 500 : f.keys[0] === "pos:sheva" ? 150 : 250) * Math.sqrt(f.notes));

test("features name each syllable's place against its word's accent, the accent, and the verse end", () => {
  const f = featuresFor(verses.find(v => v.ref === "Genesis 1:1"));
  assert.equal(f.length, 18);
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
  if (accented.length && sheva.length) assert.ok(Math.min(...accented) > Math.max(...sheva) * 2, "accented syllables are held, shevas are short");
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
  assert.throws(() => predictSyllableMs({ schema: "x" }, features), /model/);
  assert.throws(() => predictSyllableMs(fitTimingModel([{ features, syllableMs: features.map(rule) }]), features, { tempoScale: 0 }), /model/);
  assert.throws(() => syllableTimingFeatures({}, {}), /input/);
});
