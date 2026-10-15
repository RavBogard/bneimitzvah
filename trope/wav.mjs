// Minimal RIFF/WAVE reader and concatenator (PCM 16-bit or float32, multichannel folded to mono), so the
// cloud backend can build the full-reading file without Python. Dependency-free.
export function readWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === "fmt ") {
      let tag = buf.readUInt16LE(body);
      if (tag === 0xfffe) tag = buf.readUInt16LE(body + 24);   // WAVE_FORMAT_EXTENSIBLE: subformat tag
      fmt = { tag, channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") data = buf.subarray(body, Math.min(body + size, buf.length));
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV has no fmt or data chunk");
  if (!((fmt.tag === 1 && fmt.bits === 16) || (fmt.tag === 3 && fmt.bits === 32))) throw new Error(`unsupported WAV format tag ${fmt.tag}, ${fmt.bits} bits`);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      s += fmt.tag === 3 ? data.readFloatLE(o) : data.readInt16LE(o) / 32768;
    }
    samples[i] = s / fmt.channels;
  }
  return { rate: fmt.rate, float: fmt.tag === 3, samples };
}

export function writeWav({ rate, float, samples }) {
  const bytes = float ? 4 : 2, size = samples.length * bytes;
  const b = Buffer.alloc(44 + size);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + size, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(float ? 3 : 1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * bytes, 28); b.writeUInt16LE(bytes, 32); b.writeUInt16LE(bytes * 8, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(size, 40);
  for (let i = 0; i < samples.length; i++) {
    if (float) b.writeFloatLE(samples[i], 44 + i * 4);
    else b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), 44 + i * 2);
  }
  return b;
}

// Verses in order with `gap` seconds of silence between (none after the last), like soulx_runner's concat.
export function concatWavs(buffers, gap = 0.6) {
  const wavs = buffers.map(readWav);
  if (!wavs.length) throw new Error("nothing to concatenate");
  const rate = wavs[0].rate;
  for (const w of wavs) if (w.rate !== rate) throw new Error(`sample rate ${w.rate} != ${rate}`);
  const pad = Math.round(rate * gap);
  const total = wavs.reduce((n, w) => n + w.samples.length, 0) + pad * (wavs.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  wavs.forEach((w, k) => { out.set(w.samples, at); at += w.samples.length + (k < wavs.length - 1 ? pad : 0); });
  return { wav: writeWav({ rate, float: wavs[0].float, samples: out }), seconds: total / rate };
}
