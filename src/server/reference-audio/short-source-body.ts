import "server-only";
import { createHash } from "node:crypto";
import { SHORT_SOURCE_LIMITS, type ShortReferenceSource } from "../../lib/reference-audio/short-source";
import { SHORT_SOURCE_FFMPEG_TAGS } from "../../lib/reference-audio/short-source-tags";
import { ReferenceUnavailable } from "./catalog";
import { readShortSourceEntry, type ShortSourceEntry } from "./short-source-manifest";

declare const verifiedBodyBrand: unique symbol;
export type VerifiedShortSourceBody = Readonly<{ [verifiedBodyBrand]: true }>;
type Verified = Readonly<{ source: ShortReferenceSource; bytes: Uint8Array }>;
const bodies = new WeakMap<object, Verified>();
const refuse = (): never => { throw new ReferenceUnavailable(); };
const need = (value: unknown): void => { if (!value) refuse(); };
const u32 = (b: Uint8Array, p: number) => b[p] * 0x1000000 + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
function ascii(b: Uint8Array, start: number, end: number): string {
  need(start >= 0 && end <= b.length && start <= end);
  let text = ""; for (let i = start; i < end; i++) { need(b[i] <= 127); text += String.fromCharCode(b[i]); } return text;
}
function zeros(b: Uint8Array, start: number, end: number) { need(start <= end && end <= b.length); for (let i = start; i < end; i++) need(b[i] === 0); }
function snapshot(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) return refuse();
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  const size = Number(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(value));
  need(size > 0 && size <= SHORT_SOURCE_LIMITS.bytes);
  const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(value) as ArrayBuffer;
  const offset = Number(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(value));
  return new Uint8Array(new Uint8Array(buffer, offset, size));
}

/** Selected FFmpeg ID3v2.3 profile: six fixed ASCII credits, numeric muxer
 * version, no imported metadata/URLs/extra frames, and ten zero pad bytes. */
function id3(b: Uint8Array): number {
  need(b.length >= 10 && ascii(b, 0, 3) === "ID3" && b[3] === 3 && b[4] === 0 && b[5] === 0);
  for (let i = 6; i < 10; i++) need(b[i] < 128);
  const size = b[6] * 0x200000 + b[7] * 0x4000 + b[8] * 0x80 + b[9], end = 10 + size;
  need(size > 0 && size <= 4096 && end < b.length);
  const t = SHORT_SOURCE_FFMPEG_TAGS;
  const fields = [["TIT2", t.title], ["TPE1", t.artist], ["TCOP", t.copyright], ["TXXX", `comment\0${t.comment}`], ["TENC", t.encoded_by], ["TXXX", `source\0${t.source}`]];
  let p = 10;
  for (let i = 0; i < 7; i++) {
    need(p + 10 <= end); const name = ascii(b, p, p + 4), length = u32(b, p + 4);
    need(length >= 2 && length <= 512 && p + 10 + length <= end && b[p + 8] === 0 && b[p + 9] === 0);
    need(b[p + 10] === 0 && b[p + 9 + length] === 0);
    const text = ascii(b, p + 11, p + 9 + length);
    if (i < fields.length) need(name === fields[i][0] && text === fields[i][1]);
    else need(name === "TSSE" && /^Lavf[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(text));
    p += 10 + length;
  }
  need(end - p === 10); zeros(b, p, end); return end;
}

type Header = { length: number; samples: 576 | 1152; side: number };
function header(b: Uint8Array, p: number, source: ShortReferenceSource): Header {
  need(p + 4 <= b.length); const h = u32(b, p), version = (h >>> 19) & 3, mode = (h >>> 6) & 3;
  need((h >>> 21) === 0x7ff && version !== 1 && ((h >>> 17) & 3) === 1 && ((h >>> 16) & 1) === 1);
  const rateIndex = (h >>> 10) & 3, bitIndex = (h >>> 12) & 15;
  need(rateIndex < 3 && bitIndex > 0 && bitIndex < 15);
  const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitIndex];
  need(rate === source.sampleRate && bitrate === 64 && (mode === 3 ? 1 : 2) === source.channels && mode !== 2);
  need(((h >>> 8) & 1) === 0 && (h & 3) === 0); // private bit and emphasis are outside the selected profile.
  const samples = version === 3 ? 1152 : 576, length = Math.floor((version === 3 ? 144 : 72) * 64000 / rate) + ((h >>> 9) & 1);
  need(p + length <= b.length);
  return { length, samples, side: version === 3 ? source.channels === 1 ? 17 : 32 : source.channels === 1 ? 9 : 17 };
}

function mp3(b: Uint8Array, start: number, source: ShortReferenceSource) {
  const first = header(b, start, source), info = start + 4 + first.side, encoder = info + 120, end = start + first.length;
  need(encoder + 36 <= end); zeros(b, start + 4, info);
  // CBR libmp3lame emits Info. VBR Xing/unknown encoders are not this recipe.
  need(ascii(b, info, info + 4) === "Info" && u32(b, info + 4) === 15);
  const count = u32(b, info + 8), size = u32(b, info + 12);
  need(count > 0 && size === b.length - start);
  need(b[info + 16] === 0);
  for (let p = info + 17; p < info + 116; p++) need(b[p] >= b[p - 1]);
  zeros(b, info + 116, encoder);
  need(/^Lavc[0-9]{1,3}\.[0-9]{1,3}(?:\.[0-9]*)?$/.test(ascii(b, encoder, encoder + 9)));
  zeros(b, encoder + 9, encoder + 21);
  const delay = (b[encoder + 21] << 4) | (b[encoder + 22] >>> 4), padding = ((b[encoder + 22] & 15) << 8) | b[encoder + 23];
  need(delay === 576 && count * first.samples - delay - padding === source.presentationFrames);
  zeros(b, encoder + 24, encoder + 28); need(u32(b, encoder + 28) === size);
  // The two stored CRC words are covered by full SHA, not an invented CRC
  // implementation. Offline production also requires actual roundtrip decode.
  zeros(b, encoder + 36, end);
  let p = end, actual = 0;
  while (p < b.length) { const frame = header(b, p, source); need(frame.samples === first.samples); p += frame.length; actual++; }
  need(p === b.length && actual === count);
}

/** Full owned snapshot + SHA/size precede structural validation and branding.
 * This checks the selected container/frame profile, not Huffman decodability,
 * audible quality or acoustic word timing. The pinned build must decode too. */
export function verifyShortSourceBody(entry: ShortSourceEntry, value: Uint8Array): VerifiedShortSourceBody {
  try {
    const { source } = readShortSourceEntry(entry), bytes = snapshot(value);
    need(bytes.length === source.bytes && createHash("sha256").update(bytes).digest("hex") === source.sha256);
    mp3(bytes, id3(bytes), source);
    const receipt = Object.freeze({}) as VerifiedShortSourceBody; bodies.set(receipt, Object.freeze({ source, bytes })); return receipt;
  } catch { return refuse(); }
}

/** Each consumer gets a fresh copy; neither input mutation nor a previous
 * consumer can rewrite the privately verified byte snapshot. */
export function readVerifiedShortSourceBody(receipt: VerifiedShortSourceBody): Readonly<{ source: ShortReferenceSource; bytes: Uint8Array }> {
  const body = receipt && bodies.get(receipt); if (!body) return refuse();
  return Object.freeze({ source: body.source, bytes: new Uint8Array(body.bytes) });
}
