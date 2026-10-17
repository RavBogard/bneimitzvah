// Deterministic, dependency-free audio primitives for the private human-source benchmark lane:
// a strict WAV reader, a Kaiser-windowed-sinc polyphase resampler, WSOLA time-scale modification
// and a NumPy .npy writer. Pure functions over Float64Array; no filesystem, network or Python.
//
// WSOLA (waveform-similarity overlap-add, Verhelst & Roelands 1993) changes duration without
// resampling pitch. It is the reviewed retiming method for vowel nuclei, not a claim that large
// stretches are artifact-free: a 60 ms vowel held for a 1 s melisma repeats short grains and can
// sound buzzy or phasey. Callers record every ratio so that damage can be traced to this stage.

export class AudioDspError extends Error {
  constructor(code) { super(`Audio processing rejected (${code}); private details withheld`); this.name = "AudioDspError"; this.code = code; }
}
const fail = code => { throw new AudioDspError(code); };

export const WAV_LIMITS = Object.freeze({ bytes: 128 * 1024 * 1024, seconds: 600, channels: 8, minRate: 8000, maxRate: 192000 });
const ENCODINGS = Object.freeze({ "1:16": "pcm16", "1:24": "pcm24", "1:32": "pcm32", "3:32": "float32" });

/** Parse a RIFF/WAVE buffer strictly: one fmt and one data chunk, no truncation, no clamping. */
export function parseWav(buffer) {
  if (!(buffer instanceof Uint8Array) || buffer.length < 44 || buffer.length > WAV_LIMITS.bytes) fail("wav-bounds");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tag = at => String.fromCharCode(buffer[at], buffer[at + 1], buffer[at + 2], buffer[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") fail("wav-header");
  if (view.getUint32(4, true) + 8 !== buffer.length) fail("wav-length");
  let fmt = null, data = null;
  for (let p = 12; p < buffer.length;) {
    if (p + 8 > buffer.length) fail("wav-chunk");
    const id = tag(p), size = view.getUint32(p + 4, true), body = p + 8;
    if (body + size > buffer.length) fail("wav-chunk");
    if (id === "fmt ") {
      if (fmt || size < 16) fail("wav-format");
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true), sampleRate = view.getUint32(body + 4, true);
      const byteRate = view.getUint32(body + 8, true), blockAlign = view.getUint16(body + 12, true), bits = view.getUint16(body + 14, true);
      if (format === 0xfffe) {
        // WAVE_FORMAT_EXTENSIBLE: the full KSDATAFORMAT GUID tail and valid bits must match the container.
        const tail = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
        if (size < 40 || view.getUint16(body + 16, true) < 22 || view.getUint16(body + 18, true) !== bits || tail.some((b, i) => buffer[body + 26 + i] !== b)) fail("wav-format");
        format = view.getUint16(body + 24, true);
      }
      const encoding = ENCODINGS[`${format}:${bits}`];
      if (!encoding || channels < 1 || channels > WAV_LIMITS.channels || sampleRate < WAV_LIMITS.minRate || sampleRate > WAV_LIMITS.maxRate
        || blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign) fail("wav-format");
      fmt = { encoding, channels, sampleRate, blockAlign, bits };
    } else if (id === "data") {
      if (data) fail("wav-chunk");
      data = { offset: body, size };
    }
    p = body + size + (size & 1);
    if (p > buffer.length + 1) fail("wav-chunk");
  }
  if (!fmt || !data || data.size === 0 || data.size % fmt.blockAlign) fail("wav-data");
  const frames = data.size / fmt.blockAlign;
  if (frames / fmt.sampleRate > WAV_LIMITS.seconds) fail("wav-bounds");
  const channelData = Array.from({ length: fmt.channels }, () => new Float64Array(frames));
  const bytes = fmt.bits / 8;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = data.offset + i * fmt.blockAlign + c * bytes;
      let v;
      if (fmt.encoding === "float32") { v = view.getFloat32(o, true); if (!Number.isFinite(v)) fail("wav-sample"); }
      else if (fmt.encoding === "pcm16") v = view.getInt16(o, true) / 32768;
      else if (fmt.encoding === "pcm32") v = view.getInt32(o, true) / 2147483648;
      else { const u = buffer[o] | buffer[o + 1] << 8 | buffer[o + 2] << 16; v = (u & 0x800000 ? u - 0x1000000 : u) / 8388608; }
      channelData[c][i] = v;
    }
  }
  return { encoding: fmt.encoding, sampleRate: fmt.sampleRate, channels: fmt.channels, frames, channelData };
}

/** Explicit channel policy: "none" requires mono; "average" or "channel-N" otherwise. */
export function downmix(wav, policy) {
  if (policy === "none") { if (wav.channels !== 1) fail("downmix"); return Float64Array.from(wav.channelData[0]); }
  if (policy === "average") {
    if (wav.channels < 2) fail("downmix");
    const out = new Float64Array(wav.frames);
    for (const channel of wav.channelData) for (let i = 0; i < out.length; i++) out[i] += channel[i];
    for (let i = 0; i < out.length; i++) out[i] /= wav.channels;
    return out;
  }
  const match = /^channel-([0-7])$/.exec(String(policy));
  if (!match || wav.channels < 2 || Number(match[1]) >= wav.channels) fail("downmix");
  return Float64Array.from(wav.channelData[Number(match[1])]);
}

const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
function besselI0(x) { let sum = 1, term = 1; for (let k = 1; k < 64; k++) { term *= (x / (2 * k)) ** 2; sum += term; if (term < 1e-17 * sum) break; } return sum; }
export const RESAMPLER = Object.freeze({ method: "kaiser-windowed-sinc-polyphase", zeroCrossings: 32, beta: 8.6, cutoff: 0.95 });

/** Output sample index for a source sample index: the single boundary mapping used everywhere. */
export const mapSample = (index, fromRate, toRate) => fromRate === toRate ? index : Math.round(index * toRate / fromRate);

/**
 * Band-limited rate conversion. Output length is mapSample(input.length). Equal rates copy exactly.
 * Downsampling low-passes at cutoff x the output Nyquist; the impulse response is normalised per phase.
 */
export function resample(input, fromRate, toRate) {
  if (!(input instanceof Float64Array) || ![fromRate, toRate].every(r => Number.isInteger(r) && r >= WAV_LIMITS.minRate && r <= WAV_LIMITS.maxRate)) fail("resample");
  const length = mapSample(input.length, fromRate, toRate);
  if (fromRate === toRate) return Float64Array.from(input);
  const g = gcd(fromRate, toRate), up = toRate / g, down = fromRate / g;   // output n sits at source position n * down / up
  const fc = RESAMPLER.cutoff * Math.min(1, toRate / fromRate);            // cycles per source sample x 2
  const half = Math.ceil(RESAMPLER.zeroCrossings / fc), taps = 2 * half + 1, i0 = besselI0(RESAMPLER.beta);
  const table = new Float64Array(up * taps);
  for (let phase = 0; phase < up; phase++) {
    const frac = phase / up;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = k - half - frac, r = x / (half + 1);
      const window = Math.abs(r) >= 1 ? 0 : besselI0(RESAMPLER.beta * Math.sqrt(1 - r * r)) / i0;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x);
      table[phase * taps + k] = fc * sinc * window; sum += table[phase * taps + k];
    }
    for (let k = 0; k < taps; k++) table[phase * taps + k] /= sum;
  }
  const out = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    const position = n * down, base = Math.floor(position / up), phase = position - base * up, row = phase * taps;
    let acc = 0;
    for (let k = 0; k < taps; k++) { const j = base - half + k; if (j >= 0 && j < input.length) acc += input[j] * table[row + k]; }
    out[n] = acc;
  }
  return out;
}

export const WSOLA = Object.freeze({ method: "wsola-hann", frameMs: 20, toleranceMs: 5, correlationStride: 2, minSourceSamples: 16 });

/** Time-scale x to exactly targetLength samples without changing pitch. Ratio 1 is an exact copy. */
export function wsola(x, targetLength, rate, { frameMs = WSOLA.frameMs, toleranceMs = WSOLA.toleranceMs } = {}) {
  if (!(x instanceof Float64Array) || !Number.isInteger(targetLength) || targetLength < 1 || !Number.isInteger(rate)) fail("wsola");
  if (targetLength === x.length) return Float64Array.from(x);
  if (x.length < WSOLA.minSourceSamples) fail("wsola-short");
  let frame = Math.round(frameMs / 1000 * rate);
  frame = Math.max(WSOLA.minSourceSamples, Math.min(frame, x.length, targetLength) & ~1);
  const hop = frame / 2, tolerance = Math.min(Math.round(toleranceMs / 1000 * rate), hop);
  const analysisHop = hop * x.length / targetLength, last = x.length - frame;
  const window = Float64Array.from({ length: frame }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / frame));
  const out = new Float64Array(targetLength + frame), norm = new Float64Array(targetLength + frame);
  const place = (outAt, srcAt, first, final) => {
    for (let i = 0; i < frame; i++) {
      // The first frame's rising half and the final frame's falling half are flat, so the piece
      // starts and ends on exact source samples instead of fading to zero.
      const w = first && i < hop || final && i >= hop ? 1 : window[i];
      out[outAt + i] += w * x[srcAt + i]; norm[outAt + i] += w;
    }
  };
  let previous = 0, outAt = 0;
  place(0, 0, true, targetLength <= frame);
  for (let k = 1; (outAt = k * hop) + frame <= targetLength; k++) {
    const nominal = Math.round(k * analysisHop), natural = Math.min(previous + hop, last);
    let best = Math.max(0, Math.min(nominal, last)), bestScore = -Infinity;
    for (let candidate = Math.max(0, nominal - tolerance); candidate <= Math.min(last, nominal + tolerance); candidate++) {
      let score = 0;
      for (let i = 0; i < frame; i += WSOLA.correlationStride) score += x[candidate + i] * x[natural + i];
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    place(outAt, best, false, false); previous = best;
  }
  if (targetLength > frame) place(targetLength - frame, last, false, true);
  const y = new Float64Array(targetLength);
  for (let i = 0; i < targetLength; i++) y[i] = norm[i] > 1e-9 ? out[i] / norm[i] : 0;
  return y;
}

/** Raised-cosine fade over n samples at the start ("in") or end ("out") of buffer[from, to). */
export function fade(buffer, from, to, n, direction) {
  const length = Math.min(n, to - from);
  for (let i = 0; i < length; i++) {
    const g = 0.5 - 0.5 * Math.cos(Math.PI * (i + 0.5) / length);
    buffer[direction === "in" ? from + i : to - 1 - i] *= g;
  }
}

/** One-dimensional little-endian float32 .npy (format 1.0), as SoulX-SVC's runner loads with np.load. */
export function npyFloat32(values) {
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${values.length},), }`;
  header += " ".repeat((64 - (10 + header.length + 1) % 64) % 64) + "\n";
  const out = new Uint8Array(10 + header.length + values.length * 4), view = new DataView(out.buffer);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]); view.setUint16(8, header.length, true);
  for (let i = 0; i < header.length; i++) out[10 + i] = header.charCodeAt(i);
  values.forEach((v, i) => view.setFloat32(10 + header.length + i * 4, v, true));
  return out;
}

/** Mono float32 WAV bytes. Samples are written as given; nothing is normalised or clipped. */
export function floatWav(samples, rate) {
  const size = samples.length * 4, out = new Uint8Array(44 + size), view = new DataView(out.buffer);
  const ascii = (at, s) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + size, true); ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 32, true); ascii(36, "data"); view.setUint32(40, size, true);
  for (let i = 0; i < samples.length; i++) view.setFloat32(44 + i * 4, samples[i], true);
  return out;
}
