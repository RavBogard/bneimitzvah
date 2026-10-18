import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { AccessRequest } from "../access/types";
import type { StudyWordAids } from "../../lib/hebrew/word-aids";
import { createStudyService, type StudySelection } from "./service";
import { createStudyWordAids } from "./word-aids";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "./types";

/** Analyze only assigned text, before the existing second authority pass. */
export function createStudyWordAidsService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>;
  practice: ReturnType<typeof createPracticeService<Q>>;
  loadText: (request: StudyRequest) => Promise<StudyPage>;
}) {
  const study = createStudyService<Q, StudyPage & { wordAids: StudyWordAids }>({
    access: input.access, practice: input.practice,
    load: async request => {
      const page = await input.loadText(request), target = page.verses[0];
      if (!target || target.ref !== request.verses[request.offset]) throw new StudyUnavailable("upstream");
      if (request.signal?.aborted) throw new StudyUnavailable("upstream");
      const wordAids = createStudyWordAids(target);
      if (!wordAids || request.signal?.aborted) throw new StudyUnavailable("upstream");
      return { ...page, wordAids };
    },
  });
  return Object.freeze({ async read(request: AccessRequest & { signal?: AbortSignal }, selection: StudySelection) {
    const result = await study.read(request, selection);
    if (!result.ok) return result;
    return Object.freeze({ ok: true as const, studentId: result.studentId, studentRevision: result.studentRevision,
      mode: result.mode, context: result.context, assignment: result.assignment, wordAids: result.page.wordAids });
  } });
}
