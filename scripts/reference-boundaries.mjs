// Word-boundary analysis and refinement for the PocketTorah reference index. Pure: no I/O, no
// dependencies. Every time is derived from the audio itself (MISSION: never invent word timings);
// every move is bounded by RULES and reported in the log a caller writes privately.
//
// Ported from the voice branch's machine-alignment rules (voice/human-alignment:trope/propose_alignment.py,
// lines 109-185, explained in docs/planning/2026-10-16-voice/HUMAN-ALIGNMENT-RETURN.md there):
//  - a boundary is the CTC onset minus 20 ms;
//  - a pause: the next word starts where the loudness rises out of the floor;
//  - a vowel-to-vowel join across words is cut at the largest change in timbre;
//  - before b, d, g, m or n a voiced closure (low hum) belongs to the next word.
// Here they act on word starts only, inside a fixed window around each CTC onset, never crossing a
// neighbour. Word ends are new: where the sound fades into the floor for long enough before the next
// onset, the word ends at the fade-out plus its measured decay; otherwise at the next onset.

/** Analysis grid. Times are seconds; frame i is centred on i * hop / rate. */
export const ANALYSIS = Object.freeze({ rate: 16000, hop: 80, energyWindow: 160, spectrumWindow: 400, fftSize: 512, mels: 40, floorPercentile: 10 });
/** Levels in dB above the recording's floor (its 10th-percentile frame level), as in verse_index.py/align_all.py. */
export const LEVELS = Object.freeze({ loudDb: 12, quietDb: 8, decayDb: 3, peakPercentile: 80 });
export const RULES = Object.freeze({
  backS: 0.120, forwardS: 0.060,          // the only window a start may move in, around its CTC onset
  onsetOffsetS: -0.020,                   // Daniel 2026-10-16: onset was a touch late; -20 ms by ear
  pauseQuietS: 0.050,                     // a rise counts after at least this much quiet
  riseSearchBackS: 0.250, riseSearchForwardS: 0.300, riseLoudWithinS: 0.060,
  joinOpenS: 0.010,                       // align_all's syllable end is one CTC frame past the span; +10 ms = the port's +30 ms
  joinCloseS: 0, joinMinS: 0.030,        // the port's span end + 20 ms is align_all's syllable end
  murmurDb: 7, murmurCapS: 0.120, murmurMinMoveS: 0.020, murmurMinVowelS: 0.040, murmurMinFrames: 8,
  endQuietS: 0.120, decayCapS: 0.150,
  minGapS: 0.030,                         // smallest start-to-start step and smallest word drill
  ctcFrameS: 0.020,                       // one wav2vec2 frame; align_all's syllable end is one frame past the span
});
const CLOSURE_ONSETS = new Set(["b", "d", "g", "ɡ", "m", "n"]);

// ---- spectra ----------------------------------------------------------------------------------------
function fftPlan(n) {
  const levels = Math.log2(n);
  if (!Number.isInteger(levels)) throw new Error("fft size");
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0, x = i; b < levels; b++, x >>= 1) r = (r << 1) | (x & 1); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
  const re = new Float64Array(n), im = new Float64Array(n);
  /** Power (|X|^2) of bins 0..n/2 of a real frame already windowed into `input` (length <= n, zero padded). */
  return function power(input, out) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < input.length; i++) re[rev[i]] = input[i];
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const a = start + k, b = a + half, wr = cos[k * step], wi = sin[k * step];
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
    return out;
  };
}
const hann = n => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
function melBank(rate, size, bands) {
  const mel = f => 2595 * Math.log10(1 + f / 700), hz = m => 700 * (10 ** (m / 2595) - 1);
  const top = mel(rate / 2), edges = Array.from({ length: bands + 2 }, (_, i) => hz(top * i / (bands + 1)));
  const bin = f => f * size / rate;
  return Array.from({ length: bands }, (_, b) => {
    const lo = bin(edges[b]), mid = bin(edges[b + 1]), hi = bin(edges[b + 2]), w = [];
    for (let k = Math.max(0, Math.floor(lo)); k <= Math.min(size / 2, Math.ceil(hi)); k++) {
      const g = k <= mid ? (k - lo) / (mid - lo || 1) : (hi - k) / (hi - mid || 1);
      if (g > 0) w.push([k, g]);
    }
    return w;
  });
}

export function percentile(values, p) {
  const sorted = Float64Array.from(values).sort();
  if (!sorted.length) return NaN;
  const at = (sorted.length - 1) * p / 100, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * Frame features of one mono recording at ANALYSIS.rate: level (dB), the recording floor, onset flux
 * (half-wave rectified log-mel rise, for attacks) and timbre flux (change of the level-normalised
 * log-mel shape, for vowel joins; smoothed over 25 ms as in the port).
 */
export function analyzeSignal(samples, rate = ANALYSIS.rate) {
  if (!(samples instanceof Float32Array) || rate !== ANALYSIS.rate || samples.length < ANALYSIS.spectrumWindow) throw new Error("signal");
  const { hop, energyWindow, spectrumWindow, fftSize, mels } = ANALYSIS;
  const n = samples.length, frames = Math.floor((n - 1) / hop) + 1;
  const db = new Float32Array(frames), onsetFlux = new Float32Array(frames), timbreRaw = new Float32Array(frames);
  const window = hann(spectrumWindow), bank = melBank(rate, fftSize, mels), power = fftPlan(fftSize);
  const frame = new Float64Array(spectrumWindow), spectrum = new Float64Array(fftSize / 2 + 1);
  let prev = null, prevShape = null;
  const logmel = new Float64Array(mels), shape = new Float64Array(mels);
  for (let i = 0; i < frames; i++) {
    const centre = i * hop;
    let sum = 0, count = 0;
    for (let s = Math.max(0, centre - energyWindow / 2); s < Math.min(n, centre + energyWindow / 2); s++) { sum += samples[s] * samples[s]; count++; }
    db[i] = 20 * Math.log10(Math.sqrt(sum / Math.max(1, count)) + 1e-9);
    const first = centre - spectrumWindow / 2;
    for (let k = 0; k < spectrumWindow; k++) { const s = first + k; frame[k] = s >= 0 && s < n ? samples[s] * window[k] : 0; }
    power(frame, spectrum);
    let mean = 0;
    for (let b = 0; b < mels; b++) { let e = 0; for (const [k, g] of bank[b]) e += spectrum[k] * g; logmel[b] = Math.log(Math.max(e, 1e-10)); mean += logmel[b]; }
    mean /= mels;
    for (let b = 0; b < mels; b++) shape[b] = logmel[b] - mean;
    if (prev) {
      let rise = 0, change = 0;
      for (let b = 0; b < mels; b++) { rise += Math.max(0, logmel[b] - prev[b]); change += (shape[b] - prevShape[b]) ** 2; }
      onsetFlux[i] = rise; timbreRaw[i] = Math.sqrt(change);
    } else { prev = new Float64Array(mels); prevShape = new Float64Array(mels); }
    prev.set(logmel); prevShape.set(shape);
  }
  const timbreFlux = new Float32Array(frames);
  // Smoothed over 25 ms (5 frames): the port smoothed 3 frames on its 10 ms grid, which also merges the
  // two peaks a timbre step makes as it enters and leaves the 25 ms analysis window.
  for (let i = 0; i < frames; i++) { let sum = 0; for (let k = -2; k <= 2; k++) sum += timbreRaw[Math.min(frames - 1, Math.max(0, i + k))]; timbreFlux[i] = sum / 5; }
  const floor = percentile(db, ANALYSIS.floorPercentile);
  return Object.freeze({ rate, hopS: hop / rate, frames, seconds: n / rate, db, floor, onsetFlux, timbreFlux, samples });
}

const frameAt = (f, t) => Math.min(f.frames - 1, Math.max(0, Math.round(t / f.hopS)));
const timeOf = (f, i) => i * f.hopS;
const quiet = (f, i) => f.db[i] < f.floor + LEVELS.quietDb;
const loud = (f, i) => f.db[i] > f.floor + LEVELS.loudDb;
function quietBetween(f, a, b) { for (let i = frameAt(f, a); i < frameAt(f, b); i++) if (!quiet(f, i)) return false; return true; }

/**
 * Acoustic events of a recording, computed once: onset-flux peaks (a local maximum over +-25 ms with
 * sound within +-15 ms, at or above the 80th percentile of non-quiet onset flux) and rises out of the
 * floor (the first non-quiet frame after at least 50 ms of quiet, loud within 60 ms). Sorted times.
 */
export function acousticEvents(f) {
  const voiced = [];
  for (let i = 0; i < f.frames; i++) if (!quiet(f, i)) voiced.push(f.onsetFlux[i]);
  const threshold = voiced.length ? percentile(voiced, LEVELS.peakPercentile) : Infinity, reach = 5;
  const peaks = [], rises = [];
  // An attack reaches the 25 ms spectrum before the 10 ms level frame, so a peak needs sound within +-15 ms, not at its own frame.
  const soundNear = i => { for (let k = Math.max(0, i - 3); k <= Math.min(f.frames - 1, i + 3); k++) if (!quiet(f, k)) return true; return false; };
  for (let i = 1; i < f.frames; i++) {
    const v = f.onsetFlux[i];
    if (v >= threshold && soundNear(i)) {
      let top = true;
      for (let k = Math.max(0, i - reach); k <= Math.min(f.frames - 1, i + reach) && top; k++) if (f.onsetFlux[k] > v || (f.onsetFlux[k] === v && k < i)) top = false;
      if (top) peaks.push(timeOf(f, i));
    }
  }
  const need = Math.round(RULES.pauseQuietS / f.hopS), within = Math.round(RULES.riseLoudWithinS / f.hopS);
  let run = 0;
  for (let i = 0; i < f.frames; i++) {
    if (quiet(f, i)) { run++; continue; }
    if (run >= need) { for (let k = i; k <= Math.min(f.frames - 1, i + within); k++) if (loud(f, k)) { rises.push(timeOf(f, i)); break; } }
    run = 0;
  }
  return Object.freeze({ peaks: Float64Array.from(peaks), rises: Float64Array.from(rises) });
}

/** The event in sorted `times` nearest t within [t - back, t + forward], or null. */
export function nearestEvent(times, t, back, forward) {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  let best = null;
  for (const k of [lo - 1, lo]) {
    if (k < 0 || k >= times.length) continue;
    const d = times[k] - t;
    if (d < -back - 1e-9 || d > forward + 1e-9) continue;
    if (best === null || Math.abs(d) < Math.abs(best - t)) best = times[k];
  }
  return best;
}

// ---- the ported rules ----------------------------------------------------------------------------
function vowelJoin(f, lo, hi) {
  // propose_alignment.py vowel_join: argmax of smoothed timbre flux strictly after lo, before hi.
  const f0 = Math.floor(lo / f.hopS) + 1, f1 = Math.min(f.frames, Math.max(f0 + 1, Math.floor(hi / f.hopS)));
  if (f1 <= f0) return null;
  let best = f0;
  for (let i = f0; i < f1; i++) if (f.timbreFlux[i] > f.timbreFlux[best]) best = i;
  return timeOf(f, best);
}
const bandPlan = fftPlan(2048), bandOut = new Float64Array(1025);
function bandRatio(f, t) {
  // propose_alignment.py band_ratio: one 10 ms Hann frame from t, |X| summed 80-400 Hz over 400-2500 Hz.
  const width = Math.round(0.01 * f.rate), first = Math.round(t * f.rate);
  if (first < 0 || first + width > f.samples.length) return [0, -120];
  const w = hann(width), frame = new Float64Array(width);
  let energy = 0;
  for (let k = 0; k < width; k++) { const x = f.samples[first + k]; energy += x * x; frame[k] = x * w[k]; }
  bandPlan(frame, bandOut);
  let low = 0, mid = 0;
  for (let k = 0; k <= 1024; k++) { const hz = k * f.rate / 2048, mag = Math.sqrt(bandOut[k]); if (hz > 80 && hz < 400) low += mag; else if (hz > 400 && hz < 2500) mid += mag; }
  return [low / (mid + 1e-9), 20 * Math.log10(Math.sqrt(energy / width) + 1e-9)];
}
function voicedClosure(f, v0, v1) {
  // propose_alignment.py murmur pass over the vowel [v0, v1) before a b/d/g/m/n onset.
  const times = [];
  for (let k = 0; k < Math.floor((v1 - v0) / 0.01 + 1e-9); k++) times.push(v0 + k * 0.01);
  if (times.length < RULES.murmurMinFrames) return null;
  const stats = times.map(t => bandRatio(f, t));
  const head = stats.slice(0, Math.max(3, Math.floor(stats.length * 0.6))).map(s => s[1]).sort((a, b) => a - b);
  const median = head[head.length >> 1];
  const raw = stats.map(([ratio, level]) => ratio > 0.6 && level < median - RULES.murmurDb);
  const hum = raw.map((r, k) => r || (k > 0 && k < raw.length - 1 && raw[k - 1] && raw[k + 1]));
  let cut = hum.length;
  while (cut > 0 && hum[cut - 1]) cut--;
  const moved = Math.max(cut < times.length ? times[cut] : v1, v1 - RULES.murmurCapS);
  return v1 - moved >= RULES.murmurMinMoveS && moved - v0 >= RULES.murmurMinVowelS ? moved : null;
}

const r3 = t => Math.round(t * 1000) / 1000;
const msOf = s => Math.round(s * 1000);

/**
 * Refine one verse. words[j]: {ctc, startsWithVowel, firstPhone, endsWithVowel, firstSyllableVowel,
 * firstSyllableEnd, lastSyllableVowel, lastSyllableEnd} (times in recording seconds; phone facts from the aligner's own
 * phone sequence). clip: the verse's existing {start, end}, which is never changed.
 * Returns {ok: true, starts, ends, log} or {ok: false, reason}. Starts stay inside
 * [ctc - backS, ctc + forwardS] and the clip, strictly increase by at least minGapS, and each end is
 * after its start and at most the next start (the clip end for the last word).
 */
export function refineVerse({ clip, words }, f, events = acousticEvents(f)) {
  if (!clip || !Array.isArray(words) || !words.length) return { ok: false, reason: "input" };
  const ctc = words.map(w => w.ctc);
  if (ctc.some((t, j) => !Number.isFinite(t) || t < clip.start - 1e-6 || t >= clip.end || (j > 0 && !(t > ctc[j - 1])))) return { ok: false, reason: "ctc-order" };
  const starts = [], log = [];
  for (let j = 0; j < words.length; j++) {
    const w = words[j], c = w.ctc, prev = j > 0 ? words[j - 1] : null, entry = { word: j, ctc: r3(c), rule: "onset-20ms", refused: [] };
    const windowLo = c - RULES.backS, windowHi = c + RULES.forwardS, inWindow = t => t >= windowLo - 1e-9 && t <= windowHi + 1e-9;
    let target = c + RULES.onsetOffsetS;
    const rise = nearestEvent(events.rises, c, RULES.riseSearchBackS, RULES.riseSearchForwardS);
    if (rise !== null) {
      // A rise before the previous word's last phone has ended (its CTC span) is that word's sound; a rise
      // after this word's first vowel is inside the word; a later rise counts only when the CTC onset itself
      // sits in the quiet before it (CTC marked the first consonant early, inside the pause).
      const t = rise + RULES.onsetOffsetS;
      const why = prev && rise < prev.lastSyllableEnd - RULES.ctcFrameS ? "previous-word"
        : rise > w.firstSyllableVowel + RULES.ctcFrameS ? "inside-word"
        : rise > c && !quietBetween(f, c, rise) ? "sound-at-onset" : null;
      if (inWindow(t) && !why) { target = t; entry.rule = "pause-rise"; }
      else entry.refused.push({ rule: "pause-rise", wantedMs: msOf(t - c), ...(why ? { why } : {}) });
    }
    if (entry.rule === "onset-20ms" && prev && prev.endsWithVowel && w.startsWithVowel) {
      const lo = Math.max(prev.lastSyllableEnd + RULES.joinOpenS, windowLo);
      const hi = Math.min(w.firstSyllableEnd + RULES.joinCloseS, windowHi, (words[j + 1]?.ctc ?? clip.end) - RULES.minGapS);
      const cut = hi - lo >= RULES.joinMinS ? vowelJoin(f, lo, hi) : null;
      // A join is a cut inside continuous sound; a timbre maximum in the quiet is noise (a pause the rise rule missed).
      const silent = cut !== null && quiet(f, frameAt(f, cut));
      if (cut !== null && inWindow(cut) && !silent) { target = cut; entry.rule = "vowel-join"; }
      else if (cut !== null) entry.refused.push({ rule: "vowel-join", wantedMs: msOf(cut - c), ...(silent ? { why: "quiet" } : {}) });
    }
    if (entry.rule === "onset-20ms" && prev && prev.endsWithVowel && CLOSURE_ONSETS.has(w.firstPhone)) {
      const moved = voicedClosure(f, Math.max(prev.lastSyllableVowel, starts[j - 1] ?? -Infinity), target);
      if (moved !== null && inWindow(moved)) { target = moved; entry.rule = "voiced-closure"; }
      else if (moved !== null) entry.refused.push({ rule: "voiced-closure", wantedMs: msOf(moved - c) });
    }
    // Neighbours and the existing clip edges bound every start; a clamp is a logged, bounded move.
    const lower = Math.max(windowLo, j > 0 ? starts[j - 1] + RULES.minGapS : -Infinity, clip.start);
    const upper = Math.min(windowHi, j + 1 < words.length ? words[j + 1].ctc - RULES.minGapS : Infinity, clip.end - RULES.minGapS);
    if (lower > upper + 1e-9) return { ok: false, reason: "no-room" };
    const placed = Math.min(upper, Math.max(lower, target));
    if (Math.abs(placed - target) > 1e-9) entry.clampedMs = msOf(placed - target);
    starts.push(placed);
    entry.start = r3(placed); entry.moveMs = msOf(placed - c);
    log.push(entry);
  }
  const ends = starts.map((s, j) => {
    const next = j + 1 < starts.length ? starts[j + 1] : clip.end, entry = log[j];
    entry.endRule = "next-onset";
    const from = frameAt(f, s), to = frameAt(f, next);
    let lastLoud = -1;
    for (let i = to - 1; i >= from; i--) if (loud(f, i)) { lastLoud = i; break; }
    const tail = Math.round(RULES.endQuietS / f.hopS);
    let quietTail = lastLoud >= 0 && to - tail > lastLoud;
    for (let i = Math.max(from, to - tail); quietTail && i < to; i++) if (!quiet(f, i)) quietTail = false;
    if (!quietTail) return next;
    const fadeOut = timeOf(f, lastLoud + 1);
    let decayEnd = Math.min(fadeOut + RULES.decayCapS, next);
    for (let i = lastLoud + 1; i < to; i++) {
      if (timeOf(f, i) > fadeOut + RULES.decayCapS) break;
      if (f.db[i] <= f.floor + LEVELS.decayDb) { decayEnd = timeOf(f, i); break; }
    }
    const end = Math.min(next, Math.max(decayEnd, fadeOut));
    if (end - s < RULES.minGapS) return next;
    entry.endRule = "fade-decay"; entry.decayMs = msOf(end - fadeOut);
    return end;
  });
  // Round to the index's 1 ms grid; rounding is monotone, so order and end <= next start survive.
  const rs = starts.map(r3), re = ends.map(r3);
  for (let j = 0; j < rs.length; j++) {
    log[j].end = re[j];
    if (!(re[j] > rs[j]) || (j + 1 < rs.length && (re[j] > rs[j + 1] || !(rs[j + 1] > rs[j]))) || rs[j] < r3(clip.start) || re[j] > r3(clip.end)) return { ok: false, reason: "rounding" };
  }
  return { ok: true, starts: rs, ends: re, log };
}
