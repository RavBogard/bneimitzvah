import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { createReadingExplorationService } from "../study/exploration";
import { planStudyPage } from "../study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import type { StudyPage } from "../study/types";
import { ReferenceUnavailable, resolveReference, unavailableReference, type ReferenceCatalog } from "./catalog";
import { findShortSource, readShortSourceEntry, type ShortSourceManifest } from "./short-source-manifest";
import { parseReferenceShortResolution, REFERENCE_SHORT_RESOLUTION_SCHEMA, type ReferenceShortResolution } from "../../lib/reference-audio/short-resolution";

type ShortPage = StudyPage & { references: readonly ReferenceShortResolution[] };
/** Same existing exploration purpose and signed scope, never an assignment.
 * Metadata awaits remain within the incumbent page's two captures and fences. */
export function createShortExplorationService<Q extends PgQueryResultHKT>(input: Parameters<typeof createReadingExplorationService<Q>>[0] & {
  loadCatalog(signal?: AbortSignal): Promise<ReferenceCatalog>;
  loadManifest(signal?: AbortSignal): Promise<ShortSourceManifest>;
  studentRelease?: boolean;
}) {
  const released = input.studentRelease === true;
  const exploration = createReadingExplorationService<Q, ShortPage>({ ...input, loadText: async request => {
    const plan = planStudyPage(request, TANAKH_VERSE_COUNTS), page = structuredClone(await input.loadText(request));
    if (page.offset !== plan.offset || page.nextOffset !== plan.nextOffset || page.totalVerses !== plan.totalVerses
      || !page.verses.length || page.verses.length > 100 || page.verses.length !== plan.refs.length
      || page.verses.some((verse, i) => verse.ref !== plan.refs[i])) throw new ReferenceUnavailable();
    const live = () => { if (request.signal?.aborted) throw new ReferenceUnavailable(); };
    try {
      live(); const catalog = await input.loadCatalog(request.signal); live();
      const manifest = await input.loadManifest(request.signal); live();
      const references = page.verses.map(verse => {
        const resolved = resolveReference(catalog, verse), entry = findShortSource(manifest, resolved);
        const parsed = parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse: resolved.verse,
          source: entry ? readShortSourceEntry(entry).source : null });
        if (!parsed) throw new ReferenceUnavailable(); return parsed;
      });
      if (Buffer.byteLength(JSON.stringify(references)) > 1024 * 1024) throw new ReferenceUnavailable();
      live(); return { ...page, references: Object.freeze(references) };
    } catch { throw new ReferenceUnavailable(); }
  } });
  return Object.freeze({ async page(request: Parameters<typeof exploration.page>[0], selection: Parameters<typeof exploration.page>[1]) {
    const result = await exploration.page(request, selection); if (!result.ok) return result;
    const references = released || result.mode === "admin" ? result.page.references : Object.freeze(result.page.references.map(reference => {
      const parsed = parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse: unavailableReference(reference.verse.ref).verse, source: null });
      if (!parsed) throw new ReferenceUnavailable(); return parsed;
    }));
    const projected = Object.freeze({ ok: true as const, studentId: result.studentId, studentRevision: result.studentRevision, mode: result.mode,
      kind: result.kind, expiresAt: result.expiresAt, page: Object.freeze({ offset: result.page.offset, nextOffset: result.page.nextOffset, totalVerses: result.page.totalVerses, references }) });
    if (Buffer.byteLength(JSON.stringify(projected)) > 1024 * 1024) throw new ReferenceUnavailable(); return projected;
  } });
}
