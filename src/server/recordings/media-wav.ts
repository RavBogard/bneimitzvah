import "server-only";
import { createHash } from "node:crypto";

/** Canonical capture bytes only. This result proves neither ownership nor access. */
export const CANONICAL_RECORDING_PCM = Object.freeze({
  mediaType: "audio/wav" as const, headerBytes: 44, sampleRate: 24_000, channels: 1, bitsPerSample: 16,
  byteRate: 48_000, blockAlign: 2, maxFrameCount: 14_400_000, maxByteLength: 32 * 1024 * 1024,
  idleTimeoutMs: 5_000, totalTimeoutMs: 30_000, maxConsecutiveEmptyChunks: 64,
});
export type VerifiedCanonicalRecordingPcm = Readonly<{ mediaType: "audio/wav"; byteLength: number; frameCount: number; durationMs: number; contentSha256: string }>;
export type CanonicalRecordingPcmResult = Readonly<{ ok: true; value: VerifiedCanonicalRecordingPcm }> | Readonly<{ ok: false; error: "invalid-recording-media" }>;
export type CanonicalRecordingPcmOptions = Readonly<{ signal: AbortSignal; idleTimeoutMs?: number; totalTimeoutMs?: number }>;
const invalid = Object.freeze({ ok: false, error: "invalid-recording-media" } as const);

function optionsFrom(value: CanonicalRecordingPcmOptions) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw 0;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !["signal", "idleTimeoutMs", "totalTimeoutMs"].includes(key))
    || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) throw 0;
  const signal = descriptors.signal?.value;
  if (!(signal instanceof AbortSignal)) throw 0;
  const idle = descriptors.idleTimeoutMs === undefined ? CANONICAL_RECORDING_PCM.idleTimeoutMs : descriptors.idleTimeoutMs.value;
  const total = descriptors.totalTimeoutMs === undefined ? CANONICAL_RECORDING_PCM.totalTimeoutMs : descriptors.totalTimeoutMs.value;
  if (typeof idle !== "number" || !Number.isInteger(idle) || idle < 1 || idle > CANONICAL_RECORDING_PCM.idleTimeoutMs
    || typeof total !== "number" || !Number.isInteger(total) || total < 1 || total > CANONICAL_RECORDING_PCM.totalTimeoutMs) throw 0;
  return { signal, idle, total };
}
function dataSize(header: Uint8Array) {
  const ascii = (offset: number, expected: string) => Array.from(expected).every((char, index) => header[offset + index] === char.charCodeAt(0));
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength), bytes = view.getUint32(40, true);
  if (!ascii(0, "RIFF") || !ascii(8, "WAVE") || !ascii(12, "fmt ") || !ascii(36, "data")
    || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== 24_000 || view.getUint32(28, true) !== 48_000 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16
    || !bytes || bytes % 2 || bytes / 2 > CANONICAL_RECORDING_PCM.maxFrameCount || bytes + 44 > CANONICAL_RECORDING_PCM.maxByteLength
    || view.getUint32(4, true) !== 36 + bytes) throw 0;
  return bytes;
}

// Each read has its own removable abort listener/timer; a shared pending abort
// promise would retain a handler per chunk until EOF. Cancellation is handled by
// the outer finally and is deliberately never awaited.
function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal, deadline: number) {
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value?: ReadableStreamReadResult<Uint8Array>) => {
      if (settled) return; settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (value) resolve(value); else reject(0);
    };
    const stop = () => finish();
    signal.addEventListener("abort", stop, { once: true });
    const remaining = deadline - performance.now();
    if (signal.aborted || remaining <= 0) { finish(); return; }
    timer = setTimeout(stop, Math.max(1, remaining));
    try { void reader.read().then(value => finish(value), stop); } catch { finish(); }
  });
}

/** Verifies the entire canonical WAV, including EOF; keeps only header + SHA
 * state. No byte upload, persistent asset, registrar, HTTP or provider wiring. */
export async function verifyCanonicalRecordingWav(stream: ReadableStream<Uint8Array>, options: CanonicalRecordingPcmOptions): Promise<CanonicalRecordingPcmResult> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, verified = false;
  try {
    reader = stream.getReader();
    const { signal, idle, total } = optionsFrom(options), started = performance.now(), totalDeadline = started + total;
    let idleDeadline = started + idle, emptyChunks = 0, headerLength = 0, byteLength = 0, expectedLength: number | undefined;
    const header = new Uint8Array(44), hash = createHash("sha256");
    while (true) {
      const chunk = await readChunk(reader, signal, Math.min(totalDeadline, idleDeadline));
      if (signal.aborted || performance.now() >= Math.min(totalDeadline, idleDeadline)) throw 0;
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw 0;
      const bytes = chunk.value.byteLength;
      if (!bytes) { if (++emptyChunks >= CANONICAL_RECORDING_PCM.maxConsecutiveEmptyChunks) throw 0; continue; }
      emptyChunks = 0; byteLength += bytes;
      if (byteLength > CANONICAL_RECORDING_PCM.maxByteLength) throw 0;
      if (headerLength < 44) {
        const copied = Math.min(44 - headerLength, bytes); header.set(chunk.value.subarray(0, copied), headerLength); headerLength += copied;
        if (headerLength === 44) expectedLength = 44 + dataSize(header);
      }
      if (expectedLength !== undefined && byteLength > expectedLength) throw 0;
      hash.update(chunk.value); idleDeadline = performance.now() + idle;
    }
    if (headerLength !== 44 || byteLength !== expectedLength || signal.aborted || performance.now() >= totalDeadline) throw 0;
    const frameCount = (byteLength - 44) / 2, durationMs = Math.ceil(frameCount * 1000 / 24_000);
    const value = Object.freeze({ mediaType: CANONICAL_RECORDING_PCM.mediaType, byteLength, frameCount, durationMs, contentSha256: hash.digest("hex") });
    verified = true; return Object.freeze({ ok: true, value });
  } catch { return invalid; }
  finally {
    if (reader) {
      if (!verified) try { void reader.cancel().catch(() => undefined); } catch { /* Fixed failure only. */ }
      try { reader.releaseLock(); } catch { /* Never reflect source errors. */ }
    }
  }
}
