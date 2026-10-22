import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { AccessRequest } from "../access/types";
import { createStudyService, type StudySelection } from "../study/service";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "../study/types";
import { ReferenceUnavailable, resolveReference, unavailableReference, type ReferenceCatalog } from "./catalog";
import type { ReferenceResolution } from "../../lib/reference-audio/source";

export function createReferenceAudioService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  loadText: (request: StudyRequest) => Promise<StudyPage>;
  loadCatalog: (signal?: AbortSignal) => Promise<ReferenceCatalog>;
  studentRelease?: boolean;
}) {
  const released = input.studentRelease === true;
  return Object.freeze({ async read(request: AccessRequest & { signal?: AbortSignal }, selection: StudySelection & { asset?: string }) {
    const asset = selection.asset;
    if (asset !== undefined && (typeof asset !== "string" || !/^ra_[a-f0-9]{32}$/.test(asset))) throw new ReferenceUnavailable();
    // A distinct composition retains the original service's two authorization passes,
    // including its snapshot and real-time final session/context checks.
    const study = createStudyService<Q, StudyPage & { reference: ReferenceResolution }>({ access: input.access, practice: input.practice,
      load: async supplied => {
        const page = await input.loadText(supplied), target = page.verses[0];
        if (!target || target.ref !== supplied.verses[supplied.offset]) throw new ReferenceUnavailable();
        if (supplied.signal?.aborted) throw new StudyUnavailable("upstream");
        try { const catalog = await input.loadCatalog(supplied.signal); return { ...page, reference: resolveReference(catalog, target, asset, supplied.verses) }; }
        catch { throw new ReferenceUnavailable(); }
      } });
    const result = await study.read(request, selection);
    if (!result.ok) return result;
    return Object.freeze({ ok: true as const, studentId: result.studentId, studentRevision: result.studentRevision, mode: result.mode,
      context: result.context, assignment: result.assignment,
      reference: released || result.mode === "admin" ? result.page.reference : unavailableReference(result.page.verses[0].ref) });
  } });
}
