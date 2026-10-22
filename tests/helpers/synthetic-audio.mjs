// Deterministic synthetic test signals for the boundary tests: a quiet pseudo-random floor plus harmonic
// segments. Generated in memory; no audio is read or written.
import { ANALYSIS } from "../../scripts/reference-boundaries.mjs";

export const RATE = ANALYSIS.rate;
/** Deterministic quiet floor plus segments: {from, to, f0, harmonics: [amplitude per harmonic]}, 5 ms ramps. */
export function synth(seconds, segments, seed = 7) {
  const x = new Float32Array(Math.round(seconds * RATE));
  let s = seed >>> 0;
  for (let i = 0; i < x.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = (s / 2 ** 32 - 0.5) * 2e-4; }
  for (const g of segments) {
    const a = Math.round(g.from * RATE), b = Math.round(g.to * RATE), ramp = Math.round(0.005 * RATE);
    for (let i = a; i < b && i < x.length; i++) {
      const t = i / RATE, env = Math.min(1, (i - a) / ramp, (b - 1 - i) / ramp);
      let v = 0;
      g.harmonics.forEach((amp, k) => { v += amp * Math.sin(2 * Math.PI * g.f0 * (k + 1) * t); });
      x[i] += env * v;
    }
  }
  return x;
}
export const burst = (from, to, amp = 0.2) => ({ from, to, f0: 220, harmonics: [amp, amp / 2, amp / 3, amp / 4] });
