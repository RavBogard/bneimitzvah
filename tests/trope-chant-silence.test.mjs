import test from "node:test";
import assert from "node:assert/strict";
import { chantSilenceCuts, removeChantSilence, CHANT_SILENCE_DEFAULTS } from "../trope/chant-silence.mjs";

const rate = 48000;
// Tone (about -9 dBFS) everywhere except the given silent spans, in seconds.
function take(seconds, silent) {
  const x = new Float64Array(Math.round(seconds * rate));
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / rate);
  for (const [a, b] of silent) x.fill(0, Math.round(a * rate), Math.round(b * rate));
  return x;
}

test("the longest silent run in each syllable becomes a cut that keeps 80 ms for a closure", () => {
  // Vowel onsets at 0, 1, 2, 3 s. A 300 ms pause in the first syllable, 150 ms in the second, 50 ms in the third.
  const x = take(4, [[0.5, 0.8], [1.5, 1.65], [2.5, 2.55]]);
  const cuts = chantSilenceCuts(x, rate, [0, 1, 2, 3]);
  assert.deepEqual(cuts, [220, 70, 0, 0], "300 ms keeps 80; 150 ms keeps 80; 50 ms is no pause; the last syllable is never cut");
  // Two shorter pauses in one syllable count as their longest run, not their sum.
  assert.deepEqual(chantSilenceCuts(take(2, [[0.2, 0.35], [0.5, 0.65]]), rate, [0, 1]), [70, 0]);
});

test("only cuts of 100 ms or more are removed, the total is reported and no syllable is emptied", () => {
  assert.equal(CHANT_SILENCE_DEFAULTS.minCutMs, 100);
  const { syllableMs, removedMs } = removeChantSilence([900, 600, 400, 500], [220, 70, 0, 0]);
  assert.deepEqual(syllableMs, [680, 600, 400, 500]); assert.equal(removedMs, 220);
  assert.throws(() => removeChantSilence([100], [95], { minCutMs: 0 }), /syllable/);
  assert.throws(() => removeChantSilence([100, 200], [0]), /count/);
  assert.throws(() => removeChantSilence([100], [-5]), /syllable/);
});

test("malformed inputs and options are refused", () => {
  const x = take(1, []);
  assert.throws(() => chantSilenceCuts([0, 0], rate, [0]), /input/);
  assert.throws(() => chantSilenceCuts(x, rate, [0.5, 0.2]), /onset/);
  assert.throws(() => chantSilenceCuts(x, rate, [0, 2]), /onset/);
  assert.throws(() => chantSilenceCuts(x, rate, [0, Number.NaN]), /onset/);
  assert.throws(() => chantSilenceCuts(x, rate, [0], { thresholdDb: 3 }), /options/);
  assert.throws(() => chantSilenceCuts(x, rate, [0], { keepMs: "80" }), /options/);
  assert.deepEqual(chantSilenceCuts(x, rate, [0, 0.5]), [0, 0], "a take with no pause has nothing to cut");
});
