/* Canonical local capture only. No network, storage, URLs or microphone output. */
class CanonicalRecordingCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.active = sampleRate === 24000; this.frames = 0; this.sequence = 0; this.used = 0; this.pcm = new DataView(new ArrayBuffer(8192));
    this.port.onmessage = event => {
      if (!this.active) return;
      if (!event.data || Object.keys(event.data).length !== 2 || event.data.v !== 1 || event.data.type !== "stop") { this.fail("invalid-capture"); return; }
      this.active = false; this.flush(); this.pcm = null;
      this.port.postMessage({ v: 1, type: "done", chunks: this.sequence, frames: this.frames });
    };
    this.port.postMessage(this.active ? { v: 1, type: "ready", sampleRate } : { v: 1, type: "error", error: "unsupported" });
  }
  fail(error) { if (!this.active) return; this.active = false; this.pcm = null; this.used = 0; this.port.postMessage({ v: 1, type: "error", error }); }
  flush() {
    if (!this.used) return;
    const frames = this.used, buffer = frames === 4096 ? this.pcm.buffer : this.pcm.buffer.slice(0, frames * 2);
    this.port.postMessage({ v: 1, type: "pcm", sequence: this.sequence++, frames, buffer }, [buffer]); this.used = 0;
    this.pcm = this.active ? new DataView(new ArrayBuffer(8192)) : null;
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!this.active) return false;
    const channels = inputs[0]; if (!channels?.length) return true;
    const length = channels[0].length;
    if (channels.length > 32 || channels.some(channel => channel.length !== length)) { this.fail("invalid-capture"); return false; }
    for (let index = 0; index < length; index++) {
      if (this.frames >= 14400000 || 44 + (this.frames + 1) * 2 > 33554432) { this.fail("limit-reached"); return false; }
      let value = 0; for (const channel of channels) { if (!Number.isFinite(channel[index])) { this.fail("invalid-capture"); return false; } value += channel[index]; }
      value = Math.max(-1, Math.min(1, value / channels.length));
      this.pcm.setInt16(this.used++ * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); this.frames++;
      if (this.used === 4096) this.flush();
    }
    return true;
  }
}
registerProcessor("canonical-recording-capture", CanonicalRecordingCapture);
