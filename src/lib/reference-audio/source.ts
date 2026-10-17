import { parseReferenceVerse, type ReferenceVerse } from "./contract";

export const REFERENCE_SOURCE_SCHEMA = "reference-source/v1" as const;
export const REFERENCE_SOURCE_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024 });
export const REFERENCE_ARCHIVE_PREFIX = "https://archive.org/download/PockettorahAudioFiles/";
export type ReferenceSource = Readonly<{ schema: typeof REFERENCE_SOURCE_SCHEMA; asset: string; url: string; sha256: string; bytes: number }>;
export type ReferenceResolution = Readonly<{ verse: ReferenceVerse; source: ReferenceSource | null }>;

/** Closed data properties only, never invoke input getters. */
export function referenceRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  if (Reflect.ownKeys(value).length !== keys.length) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value")) return null;
    result[key] = field.value;
  }
  return result;
}
export function referenceArchiveFile(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}\.mp3$/.test(value); }
export function parseReferenceSource(value: unknown): ReferenceSource | null {
  try {
    const row = referenceRecord(value, ["schema", "asset", "url", "sha256", "bytes"]);
    if (!row || row.schema !== REFERENCE_SOURCE_SCHEMA || typeof row.asset !== "string" || !/^ra_[a-f0-9]{32}$/.test(row.asset)
      || typeof row.url !== "string" || !row.url.startsWith(REFERENCE_ARCHIVE_PREFIX) || !referenceArchiveFile(row.url.slice(REFERENCE_ARCHIVE_PREFIX.length))
      || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256) || typeof row.bytes !== "number" || !Number.isSafeInteger(row.bytes)
      || row.bytes < 1 || row.bytes > REFERENCE_SOURCE_LIMITS.bytes) return null;
    return Object.freeze({ schema: REFERENCE_SOURCE_SCHEMA, asset: row.asset, url: row.url, sha256: row.sha256, bytes: row.bytes });
  } catch { return null; }
}
export function parseReferenceResolution(value: unknown): ReferenceResolution | null {
  try {
    const row = referenceRecord(value, ["verse", "source"]); if (!row) return null;
    const verse = parseReferenceVerse(row.verse); if (!verse) return null;
    const source = row.source === null ? null : parseReferenceSource(row.source);
    if (row.source !== null && !source || source && (verse.playback.status !== "ready" || source.asset !== verse.playback.asset)) return null;
    return Object.freeze({ verse, source });
  } catch { return null; }
}
