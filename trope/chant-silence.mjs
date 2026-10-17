// Silent runs inside a measured chant syllable. A measured syllable runs from one vowel onset to the
// next, so a pause the singer took after a word is counted in that word, and the emitter's own breath
// at a phrase end then counts it a second time. These helpers find the longest silent run in each
// syllable and take it out of the measured length, keeping a little for a closure.

export const CHANT_SILENCE_DEFAULTS = Object.freeze({ frameMs: 10, thresholdDb: -30, minRunMs: 100, keepMs: 80, minCutMs: 100, minSyllableMs: 20 });

const fail = code => { throw new Error(`chant silence: ${code}`); };

function settings(options) {
  const o = { ...CHANT_SILENCE_DEFAULTS, ...options };
  for (const k of Object.keys(CHANT_SILENCE_DEFAULTS)) if (!Number.isFinite(o[k])) fail("options");
  if (o.frameMs <= 0 || o.thresholdDb >= 0 || o.minRunMs < 0 || o.keepMs < 0 || o.minCutMs < 0 || o.minSyllableMs < 0 || o.keepMs > o.minRunMs) fail("options");
  return o;
}

/**
 * For each syllable, the longest run of frames below thresholdDb between its vowel onset and the next
 * syllable's, in ms; runs of minRunMs or more become a cut of the run minus keepMs. The last syllable
 * has no next onset and is never cut. Times are in seconds into `samples`. Frames start at the vowel onset and
 * stop one frame short of the next onset (as the run that produced the approved v9 record did), so a silence
 * must last about 110 ms to count as 100.
 */
export function chantSilenceCuts(samples, rate, vowelOnsets, options = {}) {
  const o = settings(options);
  if (!(samples instanceof Float32Array || samples instanceof Float64Array) || !(rate > 0) || !Array.isArray(vowelOnsets)) fail("input");
  const hop = Math.floor(o.frameMs / 1000 * rate);
  if (hop < 1) fail("options");
  return vowelOnsets.map((onset, k) => {
    if (!Number.isFinite(onset) || onset < 0 || Math.floor(onset * rate) > samples.length) fail("onset");
    if (k + 1 >= vowelOnsets.length) return 0;
    const a = Math.floor(onset * rate), b = Math.floor(vowelOnsets[k + 1] * rate);
    if (b < a || b > samples.length) fail("onset");
    let best = 0, run = 0;
    for (let i = a; i < b - hop; i += hop) {
      let sum = 0;
      for (let j = i; j < i + hop; j++) sum += samples[j] * samples[j];
      run = 20 * Math.log10(Math.sqrt(sum / hop) + 1e-9) < o.thresholdDb ? run + 1 : 0;
      if (run > best) best = run;
    }
    const ms = best * o.frameMs;
    return ms >= o.minRunMs ? ms - o.keepMs : 0;
  });
}

/** Measured syllable lengths with each cut of minCutMs or more removed; no syllable may fall under minSyllableMs. */
export function removeChantSilence(syllableMs, cuts, options = {}) {
  const o = settings(options);
  if (!Array.isArray(syllableMs) || !Array.isArray(cuts) || cuts.length !== syllableMs.length) fail("count");
  let removedMs = 0;
  const out = syllableMs.map((ms, k) => {
    const cut = cuts[k] >= o.minCutMs ? cuts[k] : 0;
    if (!Number.isFinite(ms) || !Number.isFinite(cuts[k]) || cuts[k] < 0 || ms - cut < o.minSyllableMs) fail("syllable");
    removedMs += cut;
    return ms - cut;
  });
  return { syllableMs: out, removedMs };
}
