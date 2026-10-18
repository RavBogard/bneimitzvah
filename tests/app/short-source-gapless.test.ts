import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { SHORT_SOURCE_FFMPEG_TAGS } from "../../src/lib/reference-audio/short-source-tags";
import { inspectShortSourceGapless, verifyShortSourceGapless, normalizeShortSourceGapless, shortSourceGaplessCRC16 } from "../../src/server/reference-audio/short-source-gapless";

// Independent table checksum for synthetic structural fixtures, not an MP3
// encoder/native/profile compatibility proof. No corpus/audio/codec execution.
const table = Array.from({ length: 256 }, (_, n) => { let x = n; for (let i = 0; i < 8; i++) x = x & 1 ? (x >>> 1) ^ 0xa001 : x >>> 1; return x; });
function crc(b: Uint8Array) { let x = 0; for (const n of b) x = (x >>> 8) ^ table[(x ^ n) & 255]; return x; }
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const set32 = (b: Buffer, p: number, n: number) => b.writeUInt32BE(n >>> 0, p);
function fixture(rate = 44100, channels: 1 | 2 = 2) {
  const t = SHORT_SOURCE_FFMPEG_TAGS, fields = [["TIT2", t.title], ["TPE1", t.artist], ["TCOP", t.copyright], ["TXXX", `comment\0${t.comment}`], ["TENC", t.encoded_by], ["TXXX", `source\0${t.source}`], ["TSSE", "Lavf63.1.101"]];
  const tags = fields.map(([id, text]) => { const b = Buffer.alloc(12 + text.length); b.write(id); set32(b, 4, text.length + 2); b.write(text, 11); return b; });
  const size = tags.reduce((n, b) => n + b.length, 10), start = size + 10;
  const version = rate >= 32000 ? 3 : rate >= 16000 ? 2 : 0, samples = version === 3 ? 1152 : 576;
  const ri = [44100, 48000, 32000].findIndex(n => n / (version === 3 ? 1 : version === 2 ? 2 : 4) === rate);
  const length = Math.floor((version === 3 ? 144 : 72) * 64000 / rate), count = 40, padding = 800, N = samples * count - 576 - padding;
  const b = Buffer.alloc(start + (count + 1) * length); b.write("ID3"); b[3] = 3;
  b[6] = (size >>> 21) & 127; b[7] = (size >>> 14) & 127; b[8] = (size >>> 7) & 127; b[9] = size & 127;
  let p = 10; for (const tag of tags) { b.set(tag, p); p += tag.length; }
  const header = 0xffe00000 | (version << 19) | (1 << 17) | (1 << 16) | ((version === 3 ? 5 : 8) << 12) | (ri << 10) | (channels === 1 ? 3 << 6 : 0);
  for (let i = 0; i <= count; i++) set32(b, start + i * length, header);
  const side = version === 3 ? channels === 1 ? 17 : 32 : channels === 1 ? 9 : 17, info = start + 4 + side, enc = info + 120, crcAt = enc + 34, end = start + length;
  b.write("Info", info); set32(b, info + 4, 15); set32(b, info + 8, count); set32(b, info + 12, b.length - start);
  for (let i = 0; i < 100; i++) b[info + 16 + i] = i * 2;
  b.write("Lavc63.1.", enc); b[enc + 21] = 576 >>> 4; b[enc + 22] = (padding >>> 8); b[enc + 23] = padding & 255;
  set32(b, enc + 28, b.length - start);
  const music = () => b.writeUInt16BE(crc(b.subarray(end)), enc + 32);
  const seal = () => b.writeUInt16BE(crc(b.subarray(start, crcAt)), crcAt);
  const legacy = () => { b.writeUInt16BE(0, crcAt); b.writeUInt16BE(crc(b.subarray(start, start + 190)), crcAt); };
  music(); seal(); return { b, rate, channels, samples, count, N, start, info, enc, end, crcAt, length, music, seal, legacy,
    expected: { sampleRate: rate, channels }, verify: { sampleRate: rate, channels, presentationFrames: N } };
}

test("CRC independent known vectors agree, including empty and high-bit input", () => {
  for (const [b, expected] of [[Buffer.alloc(0), 0], [Buffer.from("123456789"), 0xbb3d], [Buffer.from([1]), 0xc0c1]] as const) {
    expect(shortSourceGaplessCRC16(b)).toBe(expected); expect(crc(b)).toBe(expected);
  }
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i); expect(shortSourceGaplessCRC16(bytes)).toBe(crc(bytes));
});

test("all selected version/channel actual-prefix offsets strictly verify and normalize copied frames", () => {
  for (const rate of [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]) for (const channels of [1, 2] as const) {
    const f = fixture(rate, channels), before = Buffer.from(f.b), old = verifyShortSourceGapless(f.b, f.verify);
    expect(f.crcAt - f.start).toBe(rate >= 32000 ? channels === 1 ? 175 : 190 : channels === 1 ? 167 : 175);
    const r = normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: f.N - 37 });
    expect(r.audit.original).toEqual(old); expect(r.audit.surplusFrames).toBe(37); expect(r.audit.normalized.padding).toBe(837);
    expect(verifyShortSourceGapless(r.bytes, { ...f.expected, presentationFrames: f.N - 37 }).checksum).toBe("strict");
    expect(r.bytes.subarray(f.end)).toEqual(new Uint8Array(f.b.subarray(f.end))); expect(f.b).toEqual(before);
    expect(r.audit.normalized.audioSHA256).toBe(sha(f.b.subarray(f.end)));
    for (const i of r.audit.changedOffsets) expect([f.enc + 22, f.enc + 23, f.crcAt, f.crcAt + 1]).toContain(i);
    for (let i = 0; i < f.b.length; i++) if (![f.enc + 22, f.enc + 23, f.crcAt, f.crcAt + 1].includes(i)) expect(r.bytes[i]).toBe(f.b[i]);
  }
});

test("known fixed190 relation is producer diagnosis only, both mono offsets and MPEG2 stereo", () => {
  for (const [rate, channels] of [[44100, 1], [32000, 1], [24000, 1], [24000, 2], [8000, 1]] as const) {
    const f = fixture(rate, channels); f.legacy(); const before = Buffer.from(f.b);
    expect(inspectShortSourceGapless(f.b, f.expected).checksum).toBe("ffmpeg-fixed190");
    expect(() => verifyShortSourceGapless(f.b, f.verify)).toThrow();
    const r = normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: f.N });
    expect(r.audit.surplusFrames).toBe(0); expect(r.audit.changed).toBe(true); expect(r.audit.normalized.padding).toBe(800);
    expect(r.audit.normalized.checksum).toBe("strict"); expect(f.b).toEqual(before);
    expect(r.audit.changedOffsets.every(i => i === f.crcAt || i === f.crcAt + 1)).toBe(true);
  }
});

test("one-bit legacy music, padding or tag corruption cannot authorize normalization", () => {
  for (const at of ["music", "padding", "tag"] as const) {
    const f = fixture(24000, 1); f.legacy(); f.b[at === "music" ? f.enc + 32 : at === "padding" ? f.enc + 23 : f.crcAt] ^= 1;
    expect(() => inspectShortSourceGapless(f.b, f.expected)).toThrow();
    expect(() => normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: f.N - 1 })).toThrow();
  }
});

test("exact strict body no-op is independent copy with immutable audit", () => {
  const f = fixture(), r = normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: f.N });
  expect(r.bytes).toEqual(new Uint8Array(f.b)); expect(r.bytes).not.toBe(f.b); expect(r.audit.changed).toBe(false);
  expect(r.audit.original.sha256).toBe(r.audit.normalized.sha256); expect(r.audit.changedOffsets).toEqual([]);
  for (const v of [r, r.audit, r.audit.original, r.audit.normalized, r.audit.changedOffsets]) expect(Object.isFrozen(v)).toBe(true);
  const auditSHA = r.audit.normalized.sha256; r.bytes.fill(0); expect(r.audit.normalized.sha256).toBe(auditSHA); expect(f.b[0]).toBe(73);
});

test("missing source, excess over one frame, noninteger physical evidence and padding bounds refuse without mutation", () => {
  const f = fixture(), before = Buffer.from(f.b);
  for (const physicalFrames of [f.N + 1, f.N - f.samples - 1, f.N + 0.5, 0, -1, NaN, Infinity, f.rate * 75 + 1]) {
    expect(() => normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames })).toThrow(); expect(f.b).toEqual(before);
  }
  expect(normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: f.N - f.samples }).audit.surplusFrames).toBe(f.samples);
  f.b[f.enc + 22] = 3000 >>> 8; f.b[f.enc + 23] = 3000 & 255; f.seal();
  const actual = inspectShortSourceGapless(f.b, f.expected).presentationFrames;
  expect(() => normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: actual - 1 })).toThrow();
  f.b[f.enc + 23] = 3001 & 255; f.seal(); expect(() => inspectShortSourceGapless(f.b, f.expected)).toThrow();
});

test("strict checksum catches resealed tag, audio and geometry tampering separately", () => {
  let f = fixture(); f.b[f.crcAt] ^= 1; expect(() => verifyShortSourceGapless(f.b, f.verify)).toThrow();
  f = fixture(); f.b[f.end + 10] ^= 1; f.seal(); expect(() => inspectShortSourceGapless(f.b, f.expected)).toThrow();
  f = fixture(); f.b[f.enc + 32] ^= 1; f.seal(); expect(() => inspectShortSourceGapless(f.b, f.expected)).toThrow();
  f = fixture(); expect(() => verifyShortSourceGapless(f.b, { ...f.verify, presentationFrames: f.N - 1 })).toThrow();
});

test("unknown layout, credits, flags, count, delay and MPEG frame damage refuse even with repaired tagCRC", () => {
  const changes = [(f: ReturnType<typeof fixture>) => { f.b[21] ^= 1; },
    (f: ReturnType<typeof fixture>) => { f.b.write("Xing", f.info); },
    (f: ReturnType<typeof fixture>) => set32(f.b, f.info + 4, 7),
    (f: ReturnType<typeof fixture>) => set32(f.b, f.info + 8, f.count + 1),
    (f: ReturnType<typeof fixture>) => set32(f.b, f.info + 12, f.b.length),
    (f: ReturnType<typeof fixture>) => { f.b[f.info + 20] = 0; },
    (f: ReturnType<typeof fixture>) => { f.b.write("Unknown!!", f.enc); },
    (f: ReturnType<typeof fixture>) => { f.b[f.enc + 21] ^= 1; },
    (f: ReturnType<typeof fixture>) => { f.b[f.enc + 10] = 1; },
    (f: ReturnType<typeof fixture>) => { f.b[f.end + 2] ^= 0x10; f.music(); },
    (f: ReturnType<typeof fixture>) => { f.b[f.start + 3] |= 0x80; }];
  for (const change of changes) { const f = fixture(); change(f); f.seal(); expect(() => normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: f.N })).toThrow(); }
  const f = fixture(); for (const b of [f.b.subarray(0, f.b.length - 1), Buffer.concat([f.b, Buffer.from([0])])]) expect(() => inspectShortSourceGapless(b, f.expected)).toThrow();
});

test("intrinsic bounded snapshot ignores shadow accessors; caller/output changes cannot alter frozen evidence", () => {
  const f = fixture(), getter = vi.fn(() => { throw Error("not read"); });
  Object.defineProperties(f.b, { byteLength: { get: getter }, byteOffset: { get: getter }, buffer: { get: getter }, slice: { get: getter } });
  const r = normalizeShortSourceGapless(f.b, { ...f.expected, physicalFrames: f.N - 1 }); expect(getter).not.toHaveBeenCalled();
  const old = r.audit.original.sha256; f.b.fill(0); expect(r.audit.original.sha256).toBe(old); expect(r.bytes[0]).toBe(73);
  const huge = new Uint8Array(1048577); Object.defineProperty(huge, "byteLength", { value: 1 }); expect(() => inspectShortSourceGapless(huge, f.expected)).toThrow();
});

test("trusted profile and physical inputs are exact closed records, not getter-driven or resampling hints", () => {
  const f = fixture(); for (const expected of [{ sampleRate: 48000, channels: 2 }, { sampleRate: 44100, channels: 1 }, { ...f.expected, extra: true }]) expect(() => inspectShortSourceGapless(f.b, expected as typeof f.expected)).toThrow();
  const getter = vi.fn(() => 44100); expect(() => inspectShortSourceGapless(f.b, { get sampleRate() { return getter(); }, channels: 2 })).toThrow(); expect(getter).not.toHaveBeenCalled();
});
