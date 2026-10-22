import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { AccessRequest } from "../access/types";
import { createStudyService, type StudySelection } from "../study/service";
import { planStudyPage } from "../study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "../study/types";
import { ReferenceUnavailable, resolveReference, unavailableReference, type ReferenceCatalog } from "./catalog";
import { findShortSource, readShortSourceEntry, type ShortSourceManifest } from "./short-source-manifest";
import { parseReferenceShortResolution, REFERENCE_SHORT_RESOLUTION_SCHEMA, type ReferenceShortResolution } from "../../lib/reference-audio/short-resolution";

export const SHORT_REFERENCE_PAGE_LIMITS = Object.freeze({ verses: 100, bytes: 1024 * 1024 });

/** Assigned-reading composition only. All public work remains inside the
 * incumbent study service's two live authorization passes. No exploration IDs. */
export function createShortReferenceAudioService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  loadText: (request: StudyRequest) => Promise<StudyPage>;
  loadCatalog: (signal?: AbortSignal) => Promise<ReferenceCatalog>;
  loadManifest: (signal?: AbortSignal) => Promise<ShortSourceManifest>;
  studentRelease?: boolean;
}) {
  const released = input.studentRelease === true;
  // Presentation hint and reference masking share the same release rule. The
  // caller supplies an already authorized effective mode, including practice.
  const listeningEnabled = (mode: StudySelection["mode"]) => released || mode === "admin";
  const execute = async (request: AccessRequest & { signal?: AbortSignal }, selection: StudySelection, pageMode: boolean, asset?: string) => {
    if (asset !== undefined && (typeof asset !== "string" || !/^ra_[a-f0-9]{32}$/.test(asset))) throw new ReferenceUnavailable();
    const study = createStudyService<Q, StudyPage & { references: readonly ReferenceShortResolution[] }>({ access: input.access, practice: input.practice,
      load: async supplied => {
        const plan = planStudyPage(supplied, TANAKH_VERSE_COUNTS), page = structuredClone(await input.loadText(supplied));
        if (page.offset !== plan.offset || page.nextOffset !== plan.nextOffset || page.totalVerses !== plan.totalVerses
          || page.verses.length !== plan.refs.length || !page.verses.length || page.verses.length > SHORT_REFERENCE_PAGE_LIMITS.verses
          || page.verses.some((verse, i) => verse.ref !== plan.refs[i])) throw new ReferenceUnavailable();
        const live = () => { if (supplied.signal?.aborted) throw new StudyUnavailable("upstream"); };
        live();
        try {
          const catalog = await input.loadCatalog(supplied.signal); live();
          const manifest = await input.loadManifest(supplied.signal); live();
          const references = (pageMode ? page.verses : page.verses.slice(0, 1)).map(target => {
            const resolved = resolveReference(catalog, target, asset, supplied.verses), entry = findShortSource(manifest, resolved);
            const result = parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse: resolved.verse,
              source: entry ? readShortSourceEntry(entry).source : null });
            if (!result) throw new ReferenceUnavailable(); return result;
          });
          if (new TextEncoder().encode(JSON.stringify(references)).byteLength > SHORT_REFERENCE_PAGE_LIMITS.bytes) throw new ReferenceUnavailable();
          live(); return { ...page, references: Object.freeze(references) };
        } catch { throw new ReferenceUnavailable(); }
      } });
    const result = await study.read(request, selection);
    if (!result.ok) return result;
    const references = listeningEnabled(result.mode) ? result.page.references : Object.freeze(result.page.references.map(reference => {
      const hidden = parseReferenceShortResolution({ schema: REFERENCE_SHORT_RESOLUTION_SCHEMA, verse: unavailableReference(reference.verse.ref).verse, source: null });
      if (!hidden) throw new ReferenceUnavailable(); return hidden;
    }));
    const authority = { ok: true as const, studentId: result.studentId, studentRevision: result.studentRevision, mode: result.mode,
      context: result.context, assignment: result.assignment };
    const response = Object.freeze({ ...authority, page: Object.freeze({ offset: result.page.offset, nextOffset: result.page.nextOffset,
      totalVerses: result.page.totalVerses, references }) });
    if (new TextEncoder().encode(JSON.stringify(response)).byteLength > SHORT_REFERENCE_PAGE_LIMITS.bytes) throw new ReferenceUnavailable();
    return response;
  };
  return Object.freeze({
    listeningEnabled,
    read: async (request: AccessRequest & { signal?: AbortSignal }, selection: StudySelection & { asset?: string }) => {
      const result = await execute(request, selection, false, selection.asset); if (!result.ok) return result;
      return Object.freeze({ ok: true as const, studentId: result.studentId, studentRevision: result.studentRevision, mode: result.mode,
        context: result.context, assignment: result.assignment, reference: result.page.references[0] });
    },
    readPage: (request: AccessRequest & { signal?: AbortSignal }, selection: StudySelection) => execute(request, selection, true),
  });
}
