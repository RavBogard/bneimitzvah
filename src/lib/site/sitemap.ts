import { NAMED_READINGS } from "../readings/named-readings";
import { INDEXABLE_PATHS } from "./indexing";

/**
 * Public URLs worth indexing, as absolute URLs on the canonical origin: the three public routes and one reading
 * per weekly parashah (the stable `/read?reading=<slug>` shape). Nothing signed-in, no saved or dated address, no ids.
 */
export function sitemapPaths(): string[] {
  return [...INDEXABLE_PATHS, ...NAMED_READINGS.filter(reading => reading.group === "parashah").map(reading => `/read?reading=${encodeURIComponent(reading.slug)}`)];
}
export function sitemapEntries(origin: string | null): { url: string }[] {
  return origin ? sitemapPaths().map(path => ({ url: `${origin}${path}` })) : [];
}
