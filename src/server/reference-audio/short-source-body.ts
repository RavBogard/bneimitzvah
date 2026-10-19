import "server-only";
import { createHash } from "node:crypto";
import { SHORT_SOURCE_LIMITS, type ShortReferenceSource } from "../../lib/reference-audio/short-source";
import { ReferenceUnavailable } from "./catalog";
import { verifyShortSourceGapless } from "./short-source-gapless";
import { readShortSourceEntry, type ShortSourceEntry } from "./short-source-manifest";

declare const verifiedBodyBrand: unique symbol;
export type VerifiedShortSourceBody = Readonly<{ [verifiedBodyBrand]: true }>;
type Verified = Readonly<{ source: ShortReferenceSource; bytes: Uint8Array }>;
const bodies = new WeakMap<object, Verified>();
const refuse = (): never => { throw new ReferenceUnavailable(); };
const need = (value: unknown): void => { if (!value) refuse(); };
function snapshot(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) return refuse();
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  const size = Number(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(value));
  need(size > 0 && size <= SHORT_SOURCE_LIMITS.bytes);
  const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(value) as ArrayBuffer;
  const offset = Number(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(value));
  return new Uint8Array(new Uint8Array(buffer, offset, size));
}

/** Full owned snapshot + SHA/size precede structural validation and branding.
 * The shared strict structural/tag+audio CRC/geometry gate has no legacy flag.
 * This does not establish Huffman decodability,
 * audible quality or acoustic word timing. The pinned build must decode too. */
export function verifyShortSourceBody(entry: ShortSourceEntry, value: Uint8Array): VerifiedShortSourceBody {
  try {
    const { source } = readShortSourceEntry(entry), bytes = snapshot(value);
    need(bytes.length === source.bytes && createHash("sha256").update(bytes).digest("hex") === source.sha256);
    verifyShortSourceGapless(bytes, { sampleRate: source.sampleRate, channels: source.channels, presentationFrames: source.presentationFrames });
    const receipt = Object.freeze({}) as VerifiedShortSourceBody; bodies.set(receipt, Object.freeze({ source, bytes })); return receipt;
  } catch { return refuse(); }
}

/** Each consumer gets a fresh copy; neither input mutation nor a previous
 * consumer can rewrite the privately verified byte snapshot. */
export function readVerifiedShortSourceBody(receipt: VerifiedShortSourceBody): Readonly<{ source: ShortReferenceSource; bytes: Uint8Array }> {
  const body = receipt && bodies.get(receipt); if (!body) return refuse();
  return Object.freeze({ source: body.source, bytes: new Uint8Array(body.bytes) });
}
