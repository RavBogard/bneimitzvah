// Modelled syllable timing for verses nobody has chanted. Fitted from measured takes (trope/measured-timing.mjs
// inputs): a syllable's length depends on where it sits relative to its word's accent, which accent that is,
// and how many notes it carries. Pure and dependency-free. A fitted model holds only numbers derived from
// private recordings, so it is kept with them, outside the repo.
//
// log(ms) = global + gamma * log(notes) + delta * consonants + e(pos) + e(pos, role) + e(pos, accent[, phrase end])
// The consonant term gives a heavy syllable (nis-, -tar-) room for its consonants (Daniel, 2026-10-16: "too cramped").
// Each effect is the median residual of its group after the coarser levels, shrunk toward zero by n / (n + k).

import { MEASURED_LIMITS } from "./measured-timing.mjs";

export const TIMING_MODEL_SCHEMA = "chant-timing-model/v1";
export const TIMING_MODEL_DEFAULTS = Object.freeze({ gamma: 0.75, delta: 0.2, shrink: 6 });

export class TimingModelError extends Error {
  constructor(code) { super(`Timing model rejected (${code})`); this.name = "TimingModelError"; this.code = code; }
}
const fail = code => { throw new TimingModelError(code); };

/** One row per score syllable, in score order: notes, consonants, and the keys of the three effect levels. */
export function syllableTimingFeatures(score, units) {
  if (!Array.isArray(score?.events) || !Array.isArray(units?.units)) fail("input");
  const rows = [];
  for (const e of score.events) {
    const last = rows.at(-1);
    if (last && last.unit === e.unit && last.syllable === e.syllable) { last.notes++; last.beats.push(e.dur); }
    else rows.push({ unit: e.unit, syllable: e.syllable, notes: 1, beats: [e.dur] });
  }
  return rows.map((r, k) => {
    const u = units.units[r.unit], s = u?.syllables?.[r.syllable];
    if (!s) fail("syllable");
    const accent = u.accents?.[0] ?? { name: "none", role: "none" };
    const accentAt = u.syllables.findIndex(x => x.accent);
    const pos = s.accent ? "accent" : accentAt >= 0 && r.syllable > accentAt ? "post" : s.sheva === "na" ? "sheva" : "pre";
    const wordLast = r.syllable === u.syllables.length - 1;
    const end = k === rows.length - 1 ? "|versefinal" : u.trope && u.trope.pos === u.trope.of - 1 && wordLast ? "|phrasefinal" : "";
    const consonants = (s.ph ?? []).filter(ph => !/^[aeiou]$/.test(ph)).length;
    return { notes: r.notes, noteBeats: r.beats, consonants, keys: [`pos:${pos}`, `pos:${pos}|role:${accent.role}`, `pos:${pos}|acc:${accent.name}${end}`] };
  });
}

const median = values => {
  const s = [...values].sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
};

/** Fit from examples [{ features: syllableTimingFeatures(...), syllableMs: [...], verse: id }]. */
export function fitTimingModel(examples, options = {}) {
  const { gamma, delta, shrink } = { ...TIMING_MODEL_DEFAULTS, ...options };
  if (!(gamma >= 0 && gamma <= 1) || !(delta >= 0 && delta <= 1) || !(shrink >= 0) || !Array.isArray(examples) || !examples.length) fail("options");
  const rows = [];
  for (const ex of examples) {
    if (!Array.isArray(ex.features) || !Array.isArray(ex.syllableMs) || ex.features.length !== ex.syllableMs.length) fail("example");
    ex.features.forEach((f, k) => {
      const ms = ex.syllableMs[k];
      if (!(ms > 0)) fail("example");
      if (!Number.isInteger(f.consonants) || f.consonants < 0) fail("example");
      rows.push({ keys: f.keys, residual: Math.log(ms) - gamma * Math.log(f.notes) - delta * f.consonants });
    });
  }
  const global = median(rows.map(r => r.residual)), effects = {};
  for (let level = 0; level < 3; level++) {
    const groups = new Map();
    for (const r of rows) {
      const before = r.keys.slice(0, level).reduce((sum, key) => sum + (effects[key] ?? 0), 0);
      const key = r.keys[level];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r.residual - global - before);
    }
    for (const [key, values] of [...groups].sort((a, b) => a[0] < b[0] ? -1 : 1)) effects[key] = Number((values.length / (values.length + shrink) * median(values)).toFixed(6)) + 0;
  }
  return { schema: TIMING_MODEL_SCHEMA, gamma, delta, shrink, global: Number(global.toFixed(6)), effects,
    trainedOn: { verses: examples.map(ex => ex.verse ?? null), syllables: rows.length } };
}

/** Integer syllable lengths in ms for one verse, inside the measured-timing bounds. Unseen keys contribute 0.
 * The floor keeps every note at least noteMinMs after applyMeasuredTiming splits the syllable in proportion to
 * its notes' score lengths (largest remainder, so each part is at least its floor). */
export function predictSyllableMs(model, features, { tempoScale = 1 } = {}) {
  if (model?.schema !== TIMING_MODEL_SCHEMA || typeof model.effects !== "object" || !Number.isFinite(model.global) || !Number.isFinite(model.gamma)
    || !(tempoScale > 0)) fail("model");
  return features.map(f => {
    const log = model.global + model.gamma * Math.log(f.notes) + (model.delta ?? 0) * f.consonants + f.keys.reduce((sum, key) => sum + (model.effects[key] ?? 0), 0);
    const beats = Array.isArray(f.noteBeats) && f.noteBeats.length === f.notes && f.noteBeats.every(b => b > 0) ? f.noteBeats : fail("features");
    const total = beats.reduce((a, b) => a + b, 0);
    const floor = Math.max(MEASURED_LIMITS.syllableMinMs, Math.ceil((MEASURED_LIMITS.noteMinMs + 1) * total / Math.min(...beats)));
    return Math.min(MEASURED_LIMITS.syllableMaxMs, Math.max(floor, Math.round(Math.exp(log) * tempoScale)));
  });
}
