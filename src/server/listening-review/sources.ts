import "server-only";
import { createHash } from "node:crypto";
import type { ListeningSource } from "../../lib/listening-review/sample";
import { parseReferenceShortResolution, REFERENCE_SHORT_RESOLUTION_SCHEMA, type ReferenceShortResolution } from "../../lib/reference-audio/short-resolution";
import { ReferenceUnavailable, resolveReference, type ReferenceCatalog } from "../reference-audio/catalog";
import { REFERENCE_ARCHIVE_PREFIX } from "../../lib/reference-audio/source";
import { findShortSource, readShortSourceEntry, type ShortSourceManifest } from "../reference-audio/short-source-manifest";
import type { StudyVerse } from "../study/types";

/**
 * One reference source as the listening review needs it. A provider resolves a verse to the same wire
 * shape the student reading player consumes (so the review plays exactly what a student would get), and
 * names the pinned identity of the audio it serves. `pin()` is null while the source is not configured;
 * its items are then listed as unavailable and never counted. A second source (Cantor Finkel's
 * recordings) supplies its own provider with id "finkel"; nothing else here changes.
 */
export type ListeningSourceProvider = Readonly<{
  id: ListeningSource;
  pin(): string | null;
  resolve(verse: StudyVerse, kind: "torah" | "haftarah", signal: AbortSignal): Promise<ReferenceShortResolution | null>;
  /** Optional, cheap: which of these verses would resolve to a clip now (no text needed). Without it every
   * item of a configured source counts as available. */
  playable?(verses: readonly Readonly<{ ref: string; kind: "torah" | "haftarah" }>[], signal: AbortSignal): Promise<ReadonlySet<string>>;
}>;

const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** PocketTorah short clips, through the same catalog/manifest loaders and the same resolution as students. */
export function createPocketTorahListeningSource(input: {
  catalogSha256?: string; manifestSha256?: string;
  /** The loaders' own configuration check, so an item is never offered where playback would fail. */
  configured?(): boolean;
  loadCatalog(signal?: AbortSignal): Promise<ReferenceCatalog>; loadManifest(signal?: AbortSignal): Promise<ShortSourceManifest>;
}): ListeningSourceProvider {
  const pin = digest(input.catalogSha256) && digest(input.manifestSha256)
    ? createHash("sha256").update(`pocket-torah/short-v1:${input.catalogSha256}:${input.manifestSha256}`).digest("hex") : null;
  return Object.freeze({
    id: "pocket-torah" as const, pin: () => { try { return input.configured === undefined || input.configured() ? pin : null; } catch { return null; } },
    async resolve(verse: StudyVerse, _kind: "torah" | "haftarah", signal: AbortSignal) {
      if (!pin || (input.configured && !input.configured())) throw new ReferenceUnavailable();
      const live = () => { if (signal.aborted) throw new ReferenceUnavailable(); };
      try {
        live(); const catalog = await input.loadCatalog(signal); live();
        const manifest = await input.loadManifest(signal); live();
        const resolved = resolveReference(catalog, verse), entry = findShortSource(manifest, resolved);
        const result = parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse: resolved.verse, source: entry ? readShortSourceEntry(entry).source : null });
        if (!result) throw new ReferenceUnavailable();
        return result.source ? result : null;
      } catch { throw new ReferenceUnavailable(); }
    },
    async playable(verses: readonly Readonly<{ ref: string; kind: "torah" | "haftarah" }>[], signal: AbortSignal) {
      if (!pin || (input.configured && !input.configured())) return new Set<string>();
      const catalog = await input.loadCatalog(signal); if (signal.aborted) throw new ReferenceUnavailable();
      const manifest = await input.loadManifest(signal); if (signal.aborted) throw new ReferenceUnavailable();
      const found = new Set<string>();
      for (const { ref } of verses) {
        const matches = catalog.assets.flatMap(asset => asset.verses.filter(verse => verse.ref === ref).map(verse => ({ asset, verse })));
        if (matches.length !== 1 || matches[0].verse.playback.status !== "ready") continue;
        const { asset, verse } = matches[0];
        const resolution = { verse, source: { schema: "reference-source/v1" as const, asset: asset.id, url: REFERENCE_ARCHIVE_PREFIX + asset.archiveFile, sha256: asset.sha256, bytes: asset.bytes } };
        try { if (findShortSource(manifest, resolution)) found.add(ref); } catch { /* Not playable. */ }
      }
      return found;
    },
  });
}
