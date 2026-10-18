import "server-only";
import { createHash } from "node:crypto";
import { SHORT_SOURCE_LIMITS } from "../../lib/reference-audio/short-source";
import { SHORT_SOURCE_FFMPEG_TAGS } from "../../lib/reference-audio/short-source-tags";
import { referenceRecord } from "../../lib/reference-audio/source";
import { ReferenceUnavailable } from "./catalog";

export type ShortGaplessProfile = Readonly<{ sampleRate: number; channels: 1 | 2 }>;
export type ShortGaplessInspection = Readonly<{
  sampleRate: number; channels: 1 | 2; mpegVersion: 1 | 2 | 2.5; samplesPerFrame: 576 | 1152;
  frameCount: number; delay: number; padding: number; presentationFrames: number;
  checksum: "strict" | "ffmpeg-fixed190"; tagCRC: number; strictTagCRC: number; musicCRC: number;
  bytes: number; sha256: string; audioSHA256: string;
}>;
export type ShortGaplessAudit = Readonly<{
  changed: boolean; physicalFrames: number; surplusFrames: number;
  original: ShortGaplessInspection; normalized: ShortGaplessInspection;
  changedOffsets: readonly number[];
}>;
const need: (v: unknown) => asserts v = v => { if (!v) throw new ReferenceUnavailable(); };
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const u32 = (b: Uint8Array, p: number) => b[p] * 0x1000000 + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const u16 = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const rates = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
function snapshot(value: unknown, empty = false): Uint8Array {
  need(value instanceof Uint8Array);
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  const size = Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(value) as number;
  const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(value) as ArrayBuffer;
  const offset = Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(value) as number;
  need(buffer instanceof ArrayBuffer && size >= (empty ? 0 : 1) && size <= SHORT_SOURCE_LIMITS.bytes);
  return new Uint8Array(new Uint8Array(buffer, offset, size));
}
function profile(value: unknown): ShortGaplessProfile {
  const p = referenceRecord(value, ["sampleRate", "channels"]);
  need(p && typeof p.sampleRate === "number" && rates.has(p.sampleRate) && (p.channels === 1 || p.channels === 2));
  return { sampleRate: p.sampleRate, channels: p.channels };
}
function count(value: unknown, rate: number): number {
  need(typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= rate * SHORT_SOURCE_LIMITS.seconds); return value;
}
function ascii(b: Uint8Array, p: number, end: number): string {
  need(p >= 0 && p <= end && end <= b.length); let s = "";
  for (; p < end; p++) { need(b[p] <= 127); s += String.fromCharCode(b[p]); } return s;
}
function zeros(b: Uint8Array, p: number, end: number) { need(p <= end && end <= b.length); for (; p < end; p++) need(b[p] === 0); }

// CRC-16/ARC: reflected polynomial0xA001, seed0, no final XOR. Tag stores BE16.
// FFmpeg9.0.1 crc.c/mp3enc.c and LAME VbrTag.c; no MPEG audio-frame CRC claim.
function crc(b: Uint8Array, first = 0, end = b.length, zeroAt = -1): number {
  let c = 0;
  for (let p = first; p < end; p++) { c ^= zeroAt >= 0 && (p === zeroAt || p === zeroAt + 1) ? 0 : b[p]; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
  return c;
}
export function shortSourceGaplessCRC16(value: Uint8Array): number { return crc(snapshot(value, true)); }

// Same selected seven ID3 fields and ten padding bytes as the incumbent body
// profile. This module deliberately changes no existing consumer/producer.
function id3(b: Uint8Array): number {
  need(b.length >= 10 && ascii(b, 0, 3) === "ID3" && b[3] === 3 && b[4] === 0 && b[5] === 0);
  for (let p = 6; p < 10; p++) need(b[p] < 128);
  const size = b[6] * 0x200000 + b[7] * 0x4000 + b[8] * 0x80 + b[9], end = size + 10;
  need(size > 0 && size <= 4096 && end < b.length);
  const t = SHORT_SOURCE_FFMPEG_TAGS;
  const fields = [["TIT2", t.title], ["TPE1", t.artist], ["TCOP", t.copyright], ["TXXX", `comment\0${t.comment}`], ["TENC", t.encoded_by], ["TXXX", `source\0${t.source}`]];
  let p = 10;
  for (let i = 0; i < 7; i++) {
    need(p + 10 <= end); const name = ascii(b, p, p + 4), n = u32(b, p + 4);
    need(n >= 2 && n <= 512 && p + 10 + n <= end && b[p + 8] === 0 && b[p + 9] === 0 && b[p + 10] === 0 && b[p + 9 + n] === 0);
    const text = ascii(b, p + 11, p + 9 + n);
    if (i < fields.length) need(name === fields[i][0] && text === fields[i][1]);
    else need(name === "TSSE" && /^Lavf[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(text));
    p += 10 + n;
  }
  need(end - p === 10); zeros(b, p, end); return end;
}
function frame(b: Uint8Array, p: number, expected: ShortGaplessProfile) {
  need(p + 4 <= b.length); const h = u32(b, p), v = (h >>> 19) & 3, mode = (h >>> 6) & 3, r = (h >>> 10) & 3;
  need((h >>> 21) === 0x7ff && v !== 1 && ((h >>> 17) & 3) === 1 && ((h >>> 16) & 1) === 1 && r < 3);
  const rate = [44100, 48000, 32000][r] / (v === 3 ? 1 : v === 2 ? 2 : 4);
  need(rate === expected.sampleRate && ((h >>> 12) & 15) === (v === 3 ? 5 : 8));
  need((mode === 3 ? 1 : 2) === expected.channels && mode !== 2 && ((h >>> 8) & 1) === 0 && (h & 3) === 0);
  const length = Math.floor((v === 3 ? 144 : 72) * 64000 / rate) + ((h >>> 9) & 1);
  need(p + length <= b.length);
  return { length, samples: (v === 3 ? 1152 : 576) as 1152 | 576, version: (v === 3 ? 1 : v === 2 ? 2 : 2.5) as 1 | 2 | 2.5,
    side: v === 3 ? expected.channels === 1 ? 17 : 32 : expected.channels === 1 ? 9 : 17 };
}
function inspect(b: Uint8Array, expected: ShortGaplessProfile) {
  const start = id3(b), first = frame(b, start, expected), info = start + 4 + first.side, enc = info + 120, crcAt = enc + 34, end = start + first.length;
  need(enc + 36 <= end); zeros(b, start + 4, info);
  need(ascii(b, info, info + 4) === "Info" && u32(b, info + 4) === 15);
  const frames = u32(b, info + 8), size = u32(b, info + 12);
  need(frames > 0 && size === b.length - start && b[info + 16] === 0);
  for (let p = info + 17; p < info + 116; p++) need(b[p] >= b[p - 1]);
  zeros(b, info + 116, enc); need(/^Lavc[0-9]{1,3}\.[0-9]{1,3}(?:\.[0-9]*)?$/.test(ascii(b, enc, enc + 9)));
  zeros(b, enc + 9, enc + 21); zeros(b, enc + 24, enc + 28); zeros(b, enc + 36, end);
  const delay = (b[enc + 21] << 4) | (b[enc + 22] >>> 4), padding = ((b[enc + 22] & 15) << 8) | b[enc + 23];
  need(delay === 576 && padding <= 3000 && u32(b, enc + 28) === size);
  let p = end, actual = 0; while (p < b.length) { const f = frame(b, p, expected); need(f.samples === first.samples); p += f.length; actual++; }
  need(p === b.length && actual === frames);
  const presentationFrames = count(frames * first.samples - delay - padding, expected.sampleRate);
  const musicCRC = u16(b, enc + 32), tagCRC = u16(b, crcAt), strictTagCRC = crc(b, start, crcAt);
  need(musicCRC === crc(b, end));
  // Explicit producer diagnosis only: upstream9.0.1 wrote190 bytes with the
  // checksum word still zero. Never accept an arbitrary incorrect checksum.
  let checksum: ShortGaplessInspection["checksum"] = "strict";
  if (tagCRC !== strictTagCRC) {
    need(crcAt < start + 190 && start + 190 <= end && tagCRC === crc(b, start, start + 190, crcAt));
    checksum = "ffmpeg-fixed190";
  }
  const view: ShortGaplessInspection = Object.freeze({ ...expected, mpegVersion: first.version, samplesPerFrame: first.samples,
    frameCount: frames, delay, padding, presentationFrames, checksum, tagCRC, strictTagCRC, musicCRC,
    bytes: b.length, sha256: hash(b), audioSHA256: hash(b.subarray(end)) });
  return { view, enc, crcAt, start };
}

/** Producer diagnostics, not a consumer receipt or authority. Known upstream
 * fixed190 mismatch is labelled explicitly, never described as valid CRC. */
export function inspectShortSourceGapless(value: Uint8Array, expected: ShortGaplessProfile): ShortGaplessInspection {
  return inspect(snapshot(value), profile(expected)).view;
}
/** Strict consumer checksum/geometry gate; no flag to accept legacy CRC. */
export function verifyShortSourceGapless(value: Uint8Array, expected: ShortGaplessProfile & Readonly<{ presentationFrames: number }>): ShortGaplessInspection {
  const e = referenceRecord(expected, ["sampleRate", "channels", "presentationFrames"]); need(e);
  const p = profile({ sampleRate: e.sampleRate, channels: e.channels }), n = count(e.presentationFrames, p.sampleRate), v = inspect(snapshot(value), p).view;
  need(v.checksum === "strict" && v.presentationFrames === n); return v;
}
/** Producer-only copied normalization. physicalFrames is independently measured
 * caller evidence, not inferable from MP3; this cannot prove truthful PCM input,
 * decodability, acoustic timing, or fix an absent parent source frame. */
export function normalizeShortSourceGapless(value: Uint8Array, expected: ShortGaplessProfile & Readonly<{ physicalFrames: number }>): Readonly<{ bytes: Uint8Array; audit: ShortGaplessAudit }> {
  const e = referenceRecord(expected, ["sampleRate", "channels", "physicalFrames"]); need(e);
  const p = profile({ sampleRate: e.sampleRate, channels: e.channels }), n = count(e.physicalFrames, p.sampleRate), b = snapshot(value), original = inspect(b, p);
  const surplus = original.view.presentationFrames - n, padding = original.view.frameCount * original.view.samplesPerFrame - original.view.delay - n;
  need(surplus >= 0 && surplus <= original.view.samplesPerFrame && padding >= original.view.padding && padding <= 3000 && padding <= 4095);
  const output = b.slice(); output[original.enc + 22] = (output[original.enc + 22] & 0xf0) | (padding >>> 8); output[original.enc + 23] = padding & 255;
  const tagCRC = crc(output, original.start, original.crcAt); output[original.crcAt] = tagCRC >>> 8; output[original.crcAt + 1] = tagCRC & 255;
  const normalized = inspect(output, p).view; need(normalized.checksum === "strict" && normalized.presentationFrames === n && normalized.delay === original.view.delay && normalized.audioSHA256 === original.view.audioSHA256 && normalized.musicCRC === original.view.musicCRC);
  const allowed = new Set([original.enc + 22, original.enc + 23, original.crcAt, original.crcAt + 1]), changed: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] !== output[i]) { need(allowed.has(i)); changed.push(i); }
  need((output[original.enc + 22] & 0xf0) === (b[original.enc + 22] & 0xf0));
  const audit: ShortGaplessAudit = Object.freeze({ changed: changed.length > 0, physicalFrames: n, surplusFrames: surplus,
    original: original.view, normalized, changedOffsets: Object.freeze(changed) });
  return Object.freeze({ bytes: output, audit });
}
