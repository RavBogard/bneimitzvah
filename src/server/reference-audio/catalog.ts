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
type Match = Readonly<{ a: ReferenceCatalogAsset; verse: AvailableReferenceVerse }>;
/**
 * Some references are recorded more than once: Isaiah 54:1-55:5 is in PocketTorah's Noach,
 * Re'eh and Ki Teitzei haftarah recordings. Never pick by catalog order. The choice is fixed:
 * 1. a ready cut before a held one;
 * 2. the recording that best matches the reading being studied, measured as the verses it shares
 *    with the reading over the verses of both together, so studying Re'eh's haftarah
 *    (54:11-55:5) plays Re'eh's own recording, not Noach's longer one that also holds it.
 *    Without a reading, the verse alone is the reading, which prefers the shortest recording;
 * 3. the archive file name, then the asset id, in code-point order.
 * This chooses only among the catalog's own cuts; whether anything is heard stays with each
 * cut's status, the published short sources and the services' release gate.
 */
function preferredCut(matches: readonly Match[], reading: readonly string[]): Match {
  const wanted = new Set(reading);
  const fit = (a: ReferenceCatalogAsset) => { let shared = 0; for (const v of a.verses) if (wanted.has(v.ref)) shared++; return { shared, union: a.verses.length + wanted.size - shared }; };
  const order = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  return matches.map(m => ({ m, ready: m.verse.playback.status === "ready" ? 1 : 0, fit: fit(m.a) }))
    .sort((x, y) => (y.ready - x.ready) || (y.fit.shared * x.fit.union - x.fit.shared * y.fit.union)
      || order(x.m.a.archiveFile, y.m.a.archiveFile) || order(x.m.a.id, y.m.a.id))[0].m;
}
/** `reading` is the whole reading being studied, in order, when the caller knows it. */
export function resolveReference(catalog: ReferenceCatalog, study: StudyVerse, asset?: string, reading?: readonly string[]): ReferenceResolution {
  const matches = catalog.assets.flatMap(a => a.verses.filter(v => v.ref === study.ref && (!asset || a.id === asset)).map(verse => ({ a, verse })));
  if (!matches.length) return unavailableReference(study.ref);
  let projection: ReturnType<typeof projectStudyVerse> | undefined;
  // The current text binds each cut's timings before any choice, so a cut the text check holds never outranks a ready one.
  const bind = (verse: AvailableReferenceVerse): AvailableReferenceVerse => {
    if (verse.words.status !== "ready") return verse;
    projection ??= projectStudyVerse(study.ref, study.hebrew);
    if (projection.status !== "ready") return Object.freeze({ ...verse, words: Object.freeze({ status: "unavailable" as const, reason: "portal-text-unavailable" as const }) });
    if (createHash("sha256").update(projection.projection.readingText.normalize("NFC")).digest("hex") !== verse.words.readingTextSha256
      || projection.projection.words.length !== verse.words.starts.length) return Object.freeze({ ...verse,
        playback: Object.freeze({ status: "needs-review" as const, review: "text-mismatch" as const, asset: verse.playback.asset, clip: verse.playback.clip }),
        words: Object.freeze({ status: "unavailable" as const, reason: "text-mismatch" as const }) });
    return verse;
  };
  const bound = matches.map(({ a, verse }) => ({ a, verse: bind(verse) }));
  const { a, verse } = bound.length === 1 ? bound[0] : preferredCut(bound, reading?.length ? reading : [study.ref]);
  const source: ReferenceSource | null = verse.playback.status === "ready" ? Object.freeze({ schema: "reference-source/v1", asset: a.id,
    url: REFERENCE_ARCHIVE_PREFIX + a.archiveFile, sha256: a.sha256, bytes: a.bytes }) : null;
  return Object.freeze({ verse, source });
}
