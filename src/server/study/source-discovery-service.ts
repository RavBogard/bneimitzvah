import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { AccessRequest } from "../access/types";
import type { RelatedSourceCatalog } from "./sources/metadata";
import { discoverRelatedPage, sourcePageSelection, type SourcePageSelection } from "./sources/discovery";
import { createStudyService, type StudySelection } from "./service";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "./types";

export function createStudySourceDiscoveryService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  loadText: (request: StudyRequest) => Promise<StudyPage>;
  related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
}) {
  return Object.freeze({ async read(request: AccessRequest & { signal?: AbortSignal }, selection: StudySelection, supplied: SourcePageSelection) {
    let paging: SourcePageSelection;
    try { paging = sourcePageSelection(supplied); } catch { throw new StudyUnavailable("invalid-request"); }
    type Outcome = ReturnType<typeof discoverRelatedPage> | Readonly<{ status: "unavailable" }>;
    const study = createStudyService<Q, StudyPage & { sourceOutcome: Outcome }>({ access: input.access, practice: input.practice,
      load: async publicRequest => {
        const targetRef = publicRequest.verses[publicRequest.offset];
        const page = await input.loadText(publicRequest), target = page.verses[0];
        if (!target || target.ref !== targetRef || publicRequest.signal?.aborted) throw new StudyUnavailable("upstream");
        let sourceOutcome: Outcome;
        try { sourceOutcome = discoverRelatedPage(await input.related(targetRef, publicRequest.signal ?? new AbortController().signal), targetRef, paging); }
        catch { sourceOutcome = Object.freeze({ status: "unavailable" }); }
        // Enum-only staged outcomes must pass the original final authorization.
        return { ...page, sourceOutcome };
      } });
    const result = await study.read(request, selection);
    if (!result.ok) return result;
    const outcome = result.page.sourceOutcome;
    if (outcome.status === "unavailable") throw new StudyUnavailable("upstream");
    if (outcome.status === "invalid-page") throw new StudyUnavailable("invalid-request");
    if (outcome.status === "catalog-changed") return Object.freeze({ ok: false as const, code: "source-catalog-changed" as const });
    return Object.freeze({ ok: true as const, studentId: result.studentId, studentRevision: result.studentRevision, mode: result.mode,
      context: result.context, assignment: result.assignment, sources: outcome.page });
  } });
}
