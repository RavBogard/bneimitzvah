// Measured syllable timing for a benchmark target: the same notes, text and melisma attachment as the
// engine's score, but each syllable lasts as long as a human chanter actually held it (measured from a
// private recording, e.g. inter-onset intervals of aligned vowel nuclei). Pure and dependency-free.
//
// The score is rewritten at tempo 60, so one beat is one second and the emitter's millisecond rounding
// reproduces the measured durations exactly. Inside a syllable, notes keep the score's own proportions.
// This changes timing only; pitches, note order, slurs and syllables are untouched, and the result is a
// benchmark condition, not a change to the engine's default rhythm.

export const MEASURED_LIMITS = Object.freeze({ syllableMinMs: 40, syllableMaxMs: 4000, noteMinMs: 20 });

export class MeasuredTimingError extends Error {
  constructor(code) { super(`Measured timing rejected (${code}); private details withheld`); this.name = "MeasuredTimingError"; this.code = code; }
}
const fail = code => { throw new MeasuredTimingError(code); };

/** Integer split of total in proportion to weights (largest remainder, ties to the earlier item). */
function split(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0), raw = weights.map(w => w / sum * total), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

/** Syllables in score order: [{ unit, syllable, events: [event index...] }]. */
export function scoreSyllables(score) {
  const rows = [];
  score.events.forEach((e, i) => {
    const last = rows.at(-1);
    if (last && last.unit === e.unit && last.syllable === e.syllable) last.events.push(i);
    else rows.push({ unit: e.unit, syllable: e.syllable, events: [i] });
  });
  const keys = new Set(rows.map(r => `${r.unit}:${r.syllable}`));
  if (keys.size !== rows.length) fail("syllable-order");
  return rows;
}

/** A new score whose syllables last syllableMs[k] milliseconds each, back to back from beat 0. */
export function applyMeasuredTiming(score, syllableMs) {
  const rows = scoreSyllables(score);
  if (!Array.isArray(syllableMs) || syllableMs.length !== rows.length) fail("syllable-count");
  if (syllableMs.some(ms => !Number.isSafeInteger(ms) || ms < MEASURED_LIMITS.syllableMinMs || ms > MEASURED_LIMITS.syllableMaxMs)) fail("syllable-bounds");
  const out = structuredClone(score);
  let clockMs = 0;
  rows.forEach((row, k) => {
    const parts = split(syllableMs[k], row.events.map(i => score.events[i].dur));
    if (parts.some(ms => ms < MEASURED_LIMITS.noteMinMs)) fail("note-bounds");
    row.events.forEach((i, j) => {
      out.events[i].t = clockMs / 1000; out.events[i].dur = parts[j] / 1000; clockMs += parts[j];
      const notes = out.units[row.unit].syllables[row.syllable].notes;
      if (notes?.[j]) notes[j].dur = parts[j] / 1000;
    });
  });
  out.tempo = 60; out.beats = clockMs / 1000; out.seconds = clockMs / 1000;
  out.timing = { source: "measured", syllables: rows.length };
  return out;
}
