import { NAMED_READINGS, namedReading } from "../readings/named-readings";

/**
 * Which parashah a reading is, for the portion summary (1.9 N7): the portal's slug for it, from a slug or the usual name ("Vayera",
 * "Lech Lecha", the calendar's spelling of a combined portion). Only a parashah has a summary; a special Shabbat, a festival or a fast
 * has none, so the answer is null and nothing is asked. The same words the server's `parashahOf` accepts (client-safe, no server code).
 */
const squash = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function parashahSlug(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const wanted = squash(value), found = namedReading(value) ?? (wanted ? NAMED_READINGS.find(reading => squash(reading.name) === wanted || squash(reading.slug) === wanted) ?? null : null);
  return found && found.group === "parashah" ? found.slug : null;
}
/** The one public read, the same signed in or out. */
export const portionSummaryPath = (slug: string) => `/api/public/portion-summary?${new URLSearchParams([["reading", slug]]).toString()}`;
