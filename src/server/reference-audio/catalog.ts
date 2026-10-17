import "server-only";
import { createHash } from "node:crypto";
import { parseReferenceVerse, REFERENCE_AUDIO_SCHEMA, type ReferenceVerse, type AvailableReferenceVerse } from "../../lib/reference-audio/contract";
import { parseReferenceSource, referenceArchiveFile, referenceRecord, REFERENCE_ARCHIVE_PREFIX, type ReferenceResolution, type ReferenceSource } from "../../lib/reference-audio/source";
import { projectStudyVerse } from "../../lib/hebrew/study-tokens";
import type { StudyVerse } from "../study/types";

export const REFERENCE_CATALOG_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, assets: 600, cuts: 10000 });
export type ReferenceCatalogAsset = Readonly<{ id: string; archiveFile: string; sha256: string; bytes: number; verses: readonly AvailableReferenceVerse[] }>;
export type ReferenceCatalog = Readonly<{ schema: "reference-catalog/v1"; source: "PockettorahAudioFiles"; assets: readonly ReferenceCatalogAsset[] }>;
export class ReferenceUnavailable extends Error { constructor() { super("Reference unavailable"); this.name = "ReferenceUnavailable"; } }
function array(value: unknown, max: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) return null; result.push(d.value); }
  return result;
}
export function parseReferenceCatalog(value: unknown): ReferenceCatalog | null {
  try {
    const row = referenceRecord(value, ["schema", "source", "assets"]);
    if (!row || row.schema !== "reference-catalog/v1" || row.source !== "PockettorahAudioFiles") return null;
    const assets = array(row.assets, REFERENCE_CATALOG_LIMITS.assets); if (!assets?.length) return null;
    const result: ReferenceCatalogAsset[] = [], ids = new Set<string>(), files = new Set<string>(); let cuts = 0;
    for (const value of assets) {
      const a = referenceRecord(value, ["id", "archiveFile", "sha256", "bytes", "verses"]);
      if (!a || !referenceArchiveFile(a.archiveFile)) return null;
      const source = parseReferenceSource({ schema: "reference-source/v1", asset: a.id, url: REFERENCE_ARCHIVE_PREFIX + a.archiveFile, sha256: a.sha256, bytes: a.bytes });
      if (!source || ids.has(source.asset) || files.has(a.archiveFile.toLowerCase())) return null;
      ids.add(source.asset); files.add(a.archiveFile.toLowerCase());
      const verses = array(a.verses, REFERENCE_CATALOG_LIMITS.cuts - cuts); if (!verses?.length) return null;
      const parsed: AvailableReferenceVerse[] = [], refs = new Set<string>();
      for (const raw of verses) { const v = parseReferenceVerse(raw); if (!v || v.playback.status === "unavailable" || v.playback.asset !== source.asset || refs.has(v.ref)) return null; refs.add(v.ref); parsed.push(v as AvailableReferenceVerse); cuts++; }
      result.push(Object.freeze({ id: source.asset, archiveFile: a.archiveFile, sha256: source.sha256, bytes: source.bytes, verses: Object.freeze(parsed) }));
    }
    const catalog = Object.freeze({ schema: "reference-catalog/v1" as const, source: "PockettorahAudioFiles" as const, assets: Object.freeze(result) });
    if (Buffer.byteLength(JSON.stringify(catalog)) > REFERENCE_CATALOG_LIMITS.bytes) return null;
    return catalog;
  } catch { return null; }
}
export function unavailableReference(ref: string): ReferenceResolution {
  return Object.freeze({ verse: Object.freeze({ schema: REFERENCE_AUDIO_SCHEMA, ref,
    playback: Object.freeze({ status: "unavailable" as const, reason: "asset-not-approved" as const }),
    words: Object.freeze({ status: "unavailable" as const, reason: "no-playback" as const }) }), source: null });
}
/** Never pick the first recording for a duplicated reference. */
export function resolveReference(catalog: ReferenceCatalog, study: StudyVerse, asset?: string): ReferenceResolution {
  const matches = catalog.assets.flatMap(a => a.verses.filter(v => v.ref === study.ref && (!asset || a.id === asset)).map(verse => ({ a, verse })));
  if (matches.length !== 1) return unavailableReference(study.ref);
  const { a, verse } = matches[0]; let bound = verse;
  if (verse.words.status === "ready") {
    const projection = projectStudyVerse(study.ref, study.hebrew);
    if (projection.status !== "ready") bound = Object.freeze({ ...verse, words: Object.freeze({ status: "unavailable" as const, reason: "portal-text-unavailable" as const }) });
    else if (createHash("sha256").update(projection.projection.readingText.normalize("NFC")).digest("hex") !== verse.words.readingTextSha256
      || projection.projection.words.length !== verse.words.starts.length) bound = Object.freeze({ ...verse,
        playback: Object.freeze({ status: "needs-review" as const, review: "text-mismatch" as const, asset: verse.playback.asset, clip: verse.playback.clip }),
        words: Object.freeze({ status: "unavailable" as const, reason: "text-mismatch" as const }) });
  }
  const source: ReferenceSource | null = bound.playback.status === "ready" ? Object.freeze({ schema: "reference-source/v1", asset: a.id,
    url: REFERENCE_ARCHIVE_PREFIX + a.archiveFile, sha256: a.sha256, bytes: a.bytes }) : null;
  return Object.freeze({ verse: bound, source });
}
