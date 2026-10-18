import "server-only";
import { parseTahot, parseTbesh } from "./step";
import { STEP_BOOK_GROUPS, STEP_SOURCE_MANIFEST } from "./source-manifest";
import { createStepSourceLoader, type StepSourceDescriptor, type StepSourceLoader } from "./source-loader";

/** No I/O at construction. Runtime composition may own one instance, never an
 * actor-specific cache. Caller chooses only a supported book, not configuration. */
export function createStepSource(): StepSourceLoader {
  const books: Record<string, StepSourceDescriptor> = {};
  for (const [code, group] of Object.entries(STEP_BOOK_GROUPS)) books[code] = STEP_SOURCE_MANIFEST[group];
  return createStepSourceLoader({ books, lexicon: STEP_SOURCE_MANIFEST.lexicon,
    fetch: (url, options) => fetch(url, options), parseBook: parseTahot, parseLexicon: parseTbesh });
}
