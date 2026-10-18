import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { AccessRequest } from "../access/types";
import { WORD_DETAILS_LIMITS, type StudyWordDetails } from "../../lib/hebrew/word-details";
import type { StepSourceLoader } from "./lexical/source-loader";
import { createSelectedWordDetails } from "./lexical/word-details";
import { createStudyService, type StudySelection } from "./service";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "./types";

export function createStudyWordDetailsService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  loadText: (request: StudyRequest) => Promise<StudyPage>; source: StepSourceLoader;
}) {
  return Object.freeze({ async read(request: AccessRequest & { signal?: AbortSignal }, selection: StudySelection, suppliedIndex: number) {
    const wordIndex = suppliedIndex;
    if (!Number.isSafeInteger(wordIndex) || wordIndex < 0 || wordIndex >= WORD_DETAILS_LIMITS.words) throw new StudyUnavailable("invalid-request");
    // Request-local closure, never a mutable selected word shared across reads.
    const study = createStudyService<Q, StudyPage & { wordDetails: StudyWordDetails }>({ access: input.access, practice: input.practice,
      load: async publicRequest => {
        const page = await input.loadText(publicRequest), target = page.verses[0];
        if (!target || target.ref !== publicRequest.verses[publicRequest.offset] || publicRequest.signal?.aborted) throw new StudyUnavailable("upstream");
        const wordDetails = await createSelectedWordDetails(target, wordIndex, input.source, publicRequest.signal);
        if (!wordDetails || publicRequest.signal?.aborted) throw new StudyUnavailable("upstream");
        return { ...page, wordDetails };
      } });
    const result = await study.read(request, selection);
    if (!result.ok) return result;
    return Object.freeze({ ok: true as const, studentId: result.studentId, studentRevision: result.studentRevision, mode: result.mode,
      context: result.context, assignment: result.assignment, wordDetails: result.page.wordDetails });
  } });
}
