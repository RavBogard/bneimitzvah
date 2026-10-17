import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { verifyCanonicalRecordingWav } from "../../src/server/recordings/media-wav";

const failure = { ok: false, error: "invalid-recording-media" };
// Independent fixed-format producer: the canonical 44-byte header, not the
// verifier's parsing/constants, and invented signed samples only.
function header(dataBytes: number) {
  const value = Buffer.from("524946460000000057415645666d74201000000001000100c05d000080bb0000020010006461746100000000", "hex");
  value.writeUInt32LE((36 + dataBytes) >>> 0, 4); value.writeUInt32LE(dataBytes, 40); return value;
}
function example() {
  const body = Buffer.alloc(10); [-32768, -1, 0, 32767, 1024].forEach((sample, index) => body.writeInt16LE(sample, index * 2));
  return Buffer.concat([header(body.length), body]);
}
function chunks(values: Uint8Array[], cancel?: () => void | PromiseLike<void>) {
  let index = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) { if (index < values.length) controller.enqueue(values[index++]); else controller.close(); }, cancel });
}
const verify = (stream: ReadableStream<Uint8Array>, overrides: { signal?: AbortSignal; idleTimeoutMs?: number; totalTimeoutMs?: number } = {}) => verifyCanonicalRecordingWav(stream, { signal: new AbortController().signal, ...overrides });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("independent exact digest excludes surrounding backing-buffer bytes across arbitrary header and PCM boundaries", async () => {
  const bytes = example(), expected = { ok: true, value: { mediaType: "audio/wav", byteLength: 54, frameCount: 5, durationMs: 1, contentSha256: createHash("sha256").update(bytes).digest("hex") } };
  for (let split = 1; split < bytes.length; split++) {
    const surround = Buffer.concat([Buffer.from([17, 18, 19]), bytes, Buffer.from([20, 21])]);
    const view = new Uint8Array(surround.buffer, surround.byteOffset + 3, bytes.length), stream = chunks([view.subarray(0, split), view.subarray(split)]);
    const result = await verify(stream); expect(result).toEqual(expected); expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true); expect(stream.locked).toBe(false);
  }
});

for (const [name, offset, value, width] of [
  ["RIFF id", 0, 0, 4], ["RIFF size", 4, 47, 4], ["WAVE id", 8, 0, 4], ["fmt id", 12, 0, 4],
  ["fmt size", 16, 18, 4], ["PCM encoding", 20, 3, 2], ["channel count", 22, 2, 2], ["sample rate", 24, 48000, 4],
  ["byte rate", 28, 96000, 4], ["block alignment", 32, 4, 2], ["sample bits", 34, 8, 2], ["data id", 36, 0, 4],
  ["data size", 40, 12, 4],
] as const) test(`independent canonical header rejects spoofed ${name}`, async () => {
  const bytes = example(); if (width === 2) bytes.writeUInt16LE(value, offset); else bytes.writeUInt32LE(value, offset);
  let canceled = false; const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); }, pull() { return new Promise<void>(() => {}); }, cancel() { canceled = true; } });
  expect(await verify(stream)).toEqual(failure); expect(canceled).toBe(true); expect(stream.locked).toBe(false);
});

test("independent framing rejects early EOF, trailing bytes, odd/empty data and declared frame overflow without reading a giant body", async () => {
  const valid = example();
  for (const bytes of [valid.subarray(0, 43), valid.subarray(0, -1), Buffer.concat([valid, Buffer.from([0, 0])]), header(0), header(3), header(28_800_002), header(0xffff_fffe)]) {
    const stream = chunks([bytes]); expect(await verify(stream)).toEqual(failure); expect(stream.locked).toBe(false);
  }
  const minimum = Buffer.concat([header(2), Buffer.from([0, 0])]), stream = chunks([minimum]);
  expect(await verify(stream)).toEqual({ ok: true, value: { mediaType: "audio/wav", byteLength: 46, frameCount: 1, durationMs: 1, contentSha256: createHash("sha256").update(minimum).digest("hex") } });
});

test("independent exact frame counts round duration upwards and accept legal silence", async () => {
  for (const [frames, milliseconds] of [[25, 2], [24000, 1000], [24001, 1001]] as const) {
    const bytes = Buffer.concat([header(frames * 2), Buffer.alloc(frames * 2)]);
    expect(await verify(chunks([bytes]))).toEqual({ ok: true, value: { mediaType: "audio/wav", byteLength: 44 + frames * 2, frameCount: frames, durationMs: milliseconds, contentSha256: createHash("sha256").update(bytes).digest("hex") } });
  }
});

test("independent many-read success removes per-read abort listeners and timers", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const signal = new AbortController(), add = vi.spyOn(signal.signal, "addEventListener"), remove = vi.spyOn(signal.signal, "removeEventListener");
  const stream = chunks([...example()].map(byte => Uint8Array.of(byte)));
  expect(await verify(stream, { signal: signal.signal })).toMatchObject({ ok: true });
  expect(add.mock.calls.length).toBeGreaterThan(40); expect(remove.mock.calls.length).toBe(add.mock.calls.length); expect(vi.getTimerCount()).toBe(0); expect(stream.locked).toBe(false);
});

test("independent pending read abort ignores a hostile reason and releases the reader without awaiting cancellation", async () => {
  let canceled = false, finish!: () => void;
  const cancellation = new Promise<void>(resolve => { finish = resolve; }), signal = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); }, cancel() { canceled = true; return cancellation; } });
  const pending = verify(stream, { signal: signal.signal }); signal.abort(new Error("synthetic-private-driver-detail"));
  let result: unknown; void pending.then(value => { result = value; });
  try { await flush(); expect(result).toEqual(failure); expect(canceled).toBe(true); expect(stream.locked).toBe(false); }
  finally { finish(); await pending; }
});

test("independent idle timeout settles even when the source cancellation promise never settles", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  let canceled = false, finish!: () => void; const cancellation = new Promise<void>(resolve => { finish = resolve; });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(header(2)); }, pull() { return new Promise<void>(() => {}); }, cancel() { canceled = true; return cancellation; } });
  const pending = verify(stream, { idleTimeoutMs: 5, totalTimeoutMs: 20 }); let result: unknown; void pending.then(value => { result = value; });
  try { await vi.advanceTimersByTimeAsync(6); await flush(); expect(result).toEqual(failure); expect(canceled).toBe(true); expect(stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0); }
  finally { finish(); await pending; }
});

test("independent total deadline stops slow nonempty progress that never reaches the idle deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(header(200)); }, pull(controller) { return new Promise<void>(resolve => { setTimeout(() => { if (!canceled) controller.enqueue(Uint8Array.of(0)); resolve(); }, 1); }); }, cancel() { canceled = true; } });
  const pending = verify(stream, { idleTimeoutMs: 20, totalTimeoutMs: 5 });
  await vi.advanceTimersByTimeAsync(6); expect(await pending).toEqual(failure); expect(canceled).toBe(true); expect(stream.locked).toBe(false);
});

test("independent synchronous empty chunks cannot starve the watchdog or spin without a fixed read bound", async () => {
  let pulls = 0, canceled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array()); }, cancel() { canceled = true; return Promise.reject(new Error("synthetic-cancel-detail")); } });
  expect(await verify(stream)).toEqual(failure); expect(pulls).toBeLessThanOrEqual(66); expect(canceled).toBe(true); expect(stream.locked).toBe(false); await flush();
});

test("independent source failures, invalid chunks and pre-abort expose only a fixed result and unlock", async () => {
  const errorStream = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("synthetic-source-detail")); } });
  const invalid = chunks(["synthetic-invalid-chunk" as unknown as Uint8Array]);
  const signal = new AbortController(); signal.abort("synthetic-abort-detail"); let canceled = false;
  const preAborted = chunks([example()], () => { canceled = true; throw new Error("synthetic-cancel-detail"); });
  for (const [stream, options] of [[errorStream, {}], [invalid, {}], [preAborted, { signal: signal.signal }]] as const) {
    const result = await verify(stream, options); expect(result).toEqual(failure); expect(Object.isFrozen(result)).toBe(true); expect(Object.keys(result).sort()).toEqual(["error", "ok"]); expect(stream.locked).toBe(false);
  }
  expect(canceled).toBe(true);
});

test("independent timing options cannot widen the fixed deadline or accept nonpositive/nonfinite inputs", async () => {
  for (const options of [{ idleTimeoutMs: 5001 }, { totalTimeoutMs: 30001 }, { idleTimeoutMs: 0 }, { totalTimeoutMs: -1 }, { idleTimeoutMs: NaN }, { totalTimeoutMs: Infinity }]) {
    const stream = chunks([example()]); expect(await verify(stream, options)).toEqual(failure); expect(stream.locked).toBe(false);
  }
});
