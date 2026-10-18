import { parseReferenceVerse, type ReferenceVerse } from "./contract";
import { referenceRecord } from "./source";
import { parseShortReferenceSource, shortSourceRange, type ShortReferenceSource } from "./short-source";

export const REFERENCE_SHORT_RESOLUTION_SCHEMA = "reference-resolution/short-v1" as const;
export type ReferenceShortResolution = Readonly<{
  schema: typeof REFERENCE_SHORT_RESOLUTION_SCHEMA;
  verse: ReferenceVerse;
  source: ShortReferenceSource | null;
}>;

/** Separate wire metadata, never a legacy URL fallback or a verified-body
 * receipt. The server must additionally bind parent SHA/bytes to its catalog. */
export function parseReferenceShortResolution(value: unknown): ReferenceShortResolution | null {
  try {
    const row = referenceRecord(value, ["schema", "verse", "source"]);
    if (!row || row.schema !== REFERENCE_SHORT_RESOLUTION_SCHEMA) return null;
    const verse = parseReferenceVerse(row.verse); if (!verse) return null;
    const source = row.source === null ? null : parseShortReferenceSource(row.source);
    if (row.source !== null && !source) return null;
    if (source) {
      if (verse.playback.status !== "ready" || source.parent.asset !== verse.playback.asset) return null;
      const first = Math.floor(verse.playback.clip.start * source.sampleRate), last = Math.ceil(verse.playback.clip.end * source.sampleRate);
      if (source.origin.firstFrame !== first || source.presentationFrames !== last - first) return null;
      const range = shortSourceRange(source, verse.playback.clip);
      if (!range || range.firstFrame !== 0 || range.endFrame !== source.presentationFrames) return null;
    }
    return Object.freeze({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse, source });
  } catch { return null; }
}
