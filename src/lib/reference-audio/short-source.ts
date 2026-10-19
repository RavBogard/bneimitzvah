import { referenceRecord } from "./source";

/** Public derived-media metadata only. Parsing does not authorize serving bytes. */
export const SHORT_SOURCE_SCHEMA = "reference-short-source/v1" as const;
export const SHORT_SOURCE_LIMITS = Object.freeze({ bytes: 1024 * 1024, seconds: 75, parentSeconds: 14400 });
export const SHORT_SOURCE_PREFIX = "/reference-audio/short-v1/";
export const SHORT_SOURCE_RECIPE = "pockettorah-mp3-64k-gapless/v2" as const;
export const SHORT_SOURCE_ATTRIBUTION = Object.freeze({
  version: "pockettorah-short-attribution/v2", title: "PocketTorah Audio Files", creator: "not-a-box media lab",
  license: "CC-BY-SA-3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  changes: "Excerpted and re-encoded as a 64 kbps MP3; encoder gapless endpoint and checksum metadata normalized.",
});
const rates = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
export type ShortReferenceSource = Readonly<{
  schema: typeof SHORT_SOURCE_SCHEMA; id: string; parent: Readonly<{ asset: string; sha256: string; bytes: number }>;
  sha256: string; bytes: number; path: string; codec: "mp3"; bitrate: 64000; sampleRate: number; channels: 1 | 2;
  presentationFrames: number; origin: Readonly<{ firstFrame: number; parentRate: number }>;
  attributionVersion: typeof SHORT_SOURCE_ATTRIBUTION.version;
}>;

export function parseShortReferenceSource(value: unknown): ShortReferenceSource | null {
  try {
    const row = referenceRecord(value, ["schema", "id", "parent", "sha256", "bytes", "path", "codec", "bitrate", "sampleRate", "channels", "presentationFrames", "origin", "attributionVersion"]);
    if (!row) return null;
    const parent = referenceRecord(row.parent, ["asset", "sha256", "bytes"]), origin = referenceRecord(row.origin, ["firstFrame", "parentRate"]);
    if (!parent || !origin || row.schema !== SHORT_SOURCE_SCHEMA || !sha(row.sha256) || row.id !== `rs_${row.sha256}`
      || row.path !== `${SHORT_SOURCE_PREFIX}${row.sha256}.mp3` || row.codec !== "mp3" || row.bitrate !== 64000
      || !integer(row.bytes) || row.bytes < 1 || row.bytes > SHORT_SOURCE_LIMITS.bytes
      || !integer(row.sampleRate) || !rates.has(row.sampleRate) || (row.channels !== 1 && row.channels !== 2)
      || !integer(row.presentationFrames) || row.presentationFrames < 1 || row.presentationFrames > row.sampleRate * SHORT_SOURCE_LIMITS.seconds
      || typeof parent.asset !== "string" || !/^ra_[a-f0-9]{32}$/.test(parent.asset) || !sha(parent.sha256)
      || !integer(parent.bytes) || parent.bytes < 1 || parent.bytes > 32 * 1024 * 1024
      || !integer(origin.firstFrame) || origin.firstFrame < 0 || origin.parentRate !== row.sampleRate
      || origin.firstFrame + row.presentationFrames > row.sampleRate * SHORT_SOURCE_LIMITS.parentSeconds
      || row.attributionVersion !== SHORT_SOURCE_ATTRIBUTION.version) return null;
    return Object.freeze({ schema: SHORT_SOURCE_SCHEMA, id: row.id as string,
      parent: Object.freeze({ asset: parent.asset, sha256: parent.sha256, bytes: parent.bytes }),
      sha256: row.sha256, bytes: row.bytes, path: row.path as string, codec: "mp3", bitrate: 64000,
      sampleRate: row.sampleRate, channels: row.channels, presentationFrames: row.presentationFrames,
      origin: Object.freeze({ firstFrame: origin.firstFrame, parentRate: row.sampleRate }), attributionVersion: SHORT_SOURCE_ATTRIBUTION.version });
  } catch { return null; }
}

/** Original-source seconds -> enclosing native presentation frames: floor start,
 * ceil exclusive end. Each boundary expands by less than one sample.
 * No decoder-padding offset, device-rate assumption, or permissive clamping.
 * A resampled buffer needs a separately validated mapping; it is not this grid.
 */
export function shortSourceRange(value: unknown, original: Readonly<{ start: number; end: number }>): Readonly<{ firstFrame: number; endFrame: number; sampleRate: number }> | null {
  try {
    const source = parseShortReferenceSource(value), range = referenceRecord(original, ["start", "end"]);
    if (!source || !range || typeof range.start !== "number" || typeof range.end !== "number" || !Number.isFinite(range.start) || !Number.isFinite(range.end)
      || range.start >= range.end || range.start < source.origin.firstFrame / source.sampleRate
      || range.end > (source.origin.firstFrame + source.presentationFrames) / source.sampleRate) return null;
    // Exact exported endpoints retain their integer identity through IEEE-754
    // division/multiplication. This is equality, never an epsilon/clamp.
    const firstFrame = range.start === source.origin.firstFrame / source.sampleRate ? 0 : Math.floor(range.start * source.sampleRate) - source.origin.firstFrame;
    const endFrame = range.end === (source.origin.firstFrame + source.presentationFrames) / source.sampleRate ? source.presentationFrames : Math.ceil(range.end * source.sampleRate) - source.origin.firstFrame;
    if (firstFrame < 0 || endFrame > source.presentationFrames || endFrame <= firstFrame) return null;
    return Object.freeze({ firstFrame, endFrame, sampleRate: source.sampleRate });
  } catch { return null; }
}

export function shortSourceOriginalSeconds(value: unknown, localFrame: number): number | null {
  const source = parseShortReferenceSource(value);
  if (!source || !integer(localFrame) || localFrame < 0 || localFrame > source.presentationFrames) return null;
  return (source.origin.firstFrame + localFrame) / source.sampleRate;
}
