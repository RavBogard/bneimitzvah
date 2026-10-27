import { addDays, shabbatOnOrAfter } from "./public-shabbat";

/**
 * The public calendar (Readings for everyone, Area B): one row per Shabbat, with the week resolver's name for it. `kind` comes
 * from the Hebcal classification: a regular parashah, a holiday that falls on Shabbat, or anything else (a week with no single
 * morning reading, or one the resolver could not answer).
 */
export type CalendarRow = Readonly<{ date: string; name: string | null; kind: "regular" | "holiday" | "other" }>;
/** Fifteen months: this Shabbat plus 65 weeks, 66 rows. */
export const CALENDAR_WEEKS = 65;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The Saturdays from the one on or after `today`, then `weeks` more, in date order. */
export function nextShabbatot(today: string, weeks: number = CALENDAR_WEEKS): string[] {
  const first = shabbatOnOrAfter(today);
  return Array.from({ length: weeks + 1 }, (_, i) => addDays(first, i * 7));
}
/** The rows of a /api/public/calendar body, or an empty list when the body is not one. */
export function parseCalendar(value: unknown): CalendarRow[] {
  const rows = value && typeof value === "object" ? (value as { rows?: unknown }).rows : undefined;
  if (!Array.isArray(rows) || rows.length > 200) return [];
  const out: CalendarRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return [];
    const { date, name, kind } = row as Record<string, unknown>;
    if (typeof date !== "string" || !DATE.test(date) || !(name === null || typeof name === "string" && name.length <= 120)
      || kind !== "regular" && kind !== "holiday" && kind !== "other") return [];
    out.push(Object.freeze({ date, name, kind }));
  }
  return out;
}
