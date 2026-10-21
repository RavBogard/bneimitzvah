import "server-only";
import type { GuideChecker } from "./service";
import type { GuideBody, GuideSource } from "./validation";
import type { RelatedSourceCatalog, RelatedSourceMetadata } from "../study/sources/metadata";
import { projectRelatedCatalog } from "../study/sources/discovery";
import { sourceNumericCitation } from "../study/sources/content-extents";

/** "Read" in the app needs a narrow numeric citation the content reader can open; anything else links out. */
export function readableInApp(source: Pick<RelatedSourceMetadata, "ref" | "indexTitle">): boolean {
  try { sourceNumericCitation(source); return true; } catch { return false; }
}

/**
 * Never invent a citation: every source id in a guide must be one Sefaria lists as related to that
 * very verse, and the stored metadata is Sefaria's, not the caller's. Every note's verse must be in
 * the reading. One unknown id, one verse outside, or Sefaria being unreachable refuses the whole save.
 */
export function createGuideChecker(input: { related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>; timeoutMs?: number; concurrency?: number }): GuideChecker {
  const timeoutMs = input.timeoutMs ?? 20_000, concurrency = input.concurrency ?? 4;
  return async ({ verses, body }) => {
    const problems: string[] = [];
    body.themes.forEach((theme, i) => theme.notes.forEach((note, j) => {
      if (!verses.has(note.verseRef)) problems.push(`themes[${i}].notes[${j}]: ${note.verseRef} is not in this reading`);
    }));
    if (problems.length) return { ok: false, problems };
    const wanted = [...new Set(body.themes.flatMap(t => t.notes.filter(n => n.sources.length).map(n => n.verseRef)))];
    const catalogs = new Map<string, ReadonlyMap<string, RelatedSourceMetadata>>();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let next = 0;
      const worker = async () => {
        while (next < wanted.length && !controller.signal.aborted) {
          const verse = wanted[next++];
          const entries = projectRelatedCatalog(await input.related(verse, controller.signal), verse).entries;
          catalogs.set(verse, new Map(entries.map(entry => [entry.id, entry])));
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, () => worker().catch(error => { controller.abort(); throw error; })));
      // A timed-out run is incomplete: never let a missing catalog read as an invented citation.
      if (controller.signal.aborted || wanted.some(verse => !catalogs.has(verse))) throw new Error("Related sources incomplete");
    } catch {
      return { ok: false, problems: ["Sefaria's related sources could not be checked just now; nothing was saved. Try again."] };
    } finally { clearTimeout(timer); controller.abort(); }
    const resolved: GuideBody = {
      ...(body.overview !== undefined ? { overview: body.overview } : {}),
      themes: body.themes.map((theme, i) => ({ ...theme, notes: theme.notes.map((note, j) => ({ ...note, sources: note.sources.flatMap((source, k): GuideSource[] => {
        const entry = catalogs.get(note.verseRef)?.get(source.id);
        if (!entry) { problems.push(`themes[${i}].notes[${j}].sources[${k}]: ${source.id} is not a Sefaria source for ${note.verseRef}`); return []; }
        return [{ id: entry.id, ref: entry.ref, indexTitle: entry.indexTitle, category: entry.category, labels: { en: entry.labels.en, he: entry.labels.he }, readable: readableInApp(entry) }];
      }) })) })),
    };
    return problems.length ? { ok: false, problems } : { ok: true, body: resolved };
  };
}
