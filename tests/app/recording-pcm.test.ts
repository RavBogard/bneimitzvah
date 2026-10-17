import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { CANONICAL_RECORDING_PCM as limits, verifyCanonicalRecordingWav as verify } from "../../src/server/recordings/media-wav";

const failure = { ok: false, error: "invalid-recording-media" };
const signal = () => new AbortController().signal;
function header(frames: number) {
  const bytes = new Uint8Array(44), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
    bytes.set(new TextEncoder().encode(text), offset);
  for (const [offset, value] of [[4, 36 + frames * 2], [16, 16], [24, 24000], [28, 48000], [40, frames * 2]]) view.setUint32(offset, value, true);
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
  return bytes;
}
function source(parts: Uint8Array[]) {
  let position = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) { if (position < parts.length) controller.enqueue(parts[position++]); else controller.close(); } });
}

test.each([1, 25, 24000])("canonical silent %i-frame bytes give actual duration and exact full-file hash", async frames => {
  const bytes = Buffer.concat([header(frames), new Uint8Array(frames * 2)]), stream = source([bytes]);
  const result = await verify(stream, { signal: signal() });
  expect(result).toEqual({ ok: true, value: { mediaType: "audio/wav", byteLength: bytes.length, frameCount: frames,
    durationMs: Math.ceil(frames / 24), contentSha256: createHash("sha256").update(bytes).digest("hex") } });
  expect(Object.isFrozen(result)).toBe(true); if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  expect(stream.locked).toBe(false);
});

test("maximum ten-minute PCM streams from one reused chunk without retaining its body", async () => {
  const frames = 14_400_000, first = header(frames), zeros = new Uint8Array(65536), digest = createHash("sha256").update(first);
  let remaining = frames * 2, initial = true;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (initial) { initial = false; controller.enqueue(first); return; }
    if (!remaining) { controller.close(); return; }
    const chunk = zeros.subarray(0, Math.min(remaining, zeros.length)); remaining -= chunk.length;
    digest.update(chunk); controller.enqueue(chunk);
  } });
  expect(await verify(stream, { signal: signal() })).toEqual({ ok: true, value: { mediaType: "audio/wav", byteLength: 28_800_044,
    frameCount: frames, durationMs: 600_000, contentSha256: digest.digest("hex") } });
  expect(stream.locked).toBe(false);
});

test("one-byte chunks and empty chunks preserve exact sample bytes and framing", async () => {
  const bytes = Buffer.concat([header(3), Buffer.from([255, 127, 0, 128, 1, 0])]);
  const parts = [...bytes].flatMap(byte => [new Uint8Array(), Uint8Array.of(byte)]);
  const result = await verify(source(parts), { signal: signal() });
  expect(result.ok && result.value.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
});

test("declared and actual framing reject truncation, zero, odd sizes and extra chunks", async () => {
  const valid = Buffer.concat([header(2), new Uint8Array(4)]), odd = header(2);
  new DataView(odd.buffer).setUint32(40, 3, true); new DataView(odd.buffer).setUint32(4, 39, true);
  for (const bytes of [new Uint8Array(), valid.subarray(0, 43), valid.subarray(0, 47), Buffer.concat([valid, Buffer.from([0])]),
    header(0), odd, Buffer.concat([header(2), Buffer.from("JUNK"), new Uint8Array(4)])]) {
    const stream = source([bytes]); expect(await verify(stream, { signal: signal() })).toEqual(failure); expect(stream.locked).toBe(false);
  }
});

test.each([14_400_001, 16_777_216])("rejects over-limit declared frames %i before requesting a body", async frames => {
  let reads = 0, canceled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(header(frames)); }, cancel() { canceled = true; } }, { highWaterMark: 0 });
  expect(await verify(stream, { signal: signal() })).toEqual(failure); expect(reads).toBe(1); expect(canceled).toBe(true); expect(stream.locked).toBe(false);
});

test("abort cancels a pending read and releases the reader without waiting for stalled cancellation", async () => {
  const abort = new AbortController(); let canceled = 0;
  const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); }, cancel() { canceled++; return new Promise<void>(() => {}); } });
  const pending = verify(stream, { signal: abort.signal }); abort.abort();
  expect(await pending).toEqual(failure); expect(canceled).toBe(1); expect(stream.locked).toBe(false);
});

test("idle watchdog returns a sanitized failure and consumes cancellation rejection", async () => {
  const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); }, cancel() { return Promise.reject(new Error("synthetic source cancellation")); } });
  expect(await verify(stream, { signal: signal(), idleTimeoutMs: 5 })).toEqual(failure); expect(stream.locked).toBe(false);
});

test("synchronous empty stream cannot starve the watchdog or leave its reader locked", async () => {
  let pulls = 0, canceled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array()); }, cancel() { canceled = true; } }, { highWaterMark: 0 });
  expect(await verify(stream, { signal: signal() })).toEqual(failure);
  expect(pulls).toBe(limits.maxConsecutiveEmptyChunks); expect(canceled).toBe(true); expect(stream.locked).toBe(false);
});

test("source errors and wrong chunk types never expose provider errors", async () => {
  const thrown = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("synthetic private provider detail")); } });
  expect(await verify(thrown, { signal: signal() })).toEqual(failure); expect(thrown.locked).toBe(false);
  const wrong = source(["not bytes" as unknown as Uint8Array]); expect(await verify(wrong, { signal: signal() })).toEqual(failure); expect(wrong.locked).toBe(false);
});

test("only shortening integer timeouts are accepted and accessors are never invoked", async () => {
  const getter = vi.fn(() => 1);
  for (const options of [{ signal: signal(), idleTimeoutMs: 5001 }, { signal: signal(), totalTimeoutMs: 30001 },
    { signal: signal(), totalTimeoutMs: 0 }, { signal: signal(), idleTimeoutMs: null }, { signal: signal(), maxByteLength: 1 },
    Object.defineProperty({ signal: signal() }, "idleTimeoutMs", { get: getter })]) {
    const stream = source([header(1), Uint8Array.of(0, 0)]);
    expect(await verify(stream, options as Parameters<typeof verify>[1])).toEqual(failure); expect(stream.locked).toBe(false);
  }
  expect(getter).not.toHaveBeenCalled(); expect(Object.isFrozen(limits)).toBe(true);
});
