import { parseCeremonyDate } from "./ranges";

/**
 * Calendar arithmetic for the public, signed-out reading. A visitor browses by
 * Shabbat: every public request names one Saturday inside a bounded window, so
 * the set of distinct public URLs (and so of uncached server work) stays finite.
 * Pure date arithmetic on UTC midnights; no time zone enters the date itself.
 */
export const PUBLIC_SHABBAT_WINDOW = Object.freeze({ pastDays: 2 * 366, futureDays: 3 * 366 });
/** CRC is in St. Louis: "this week" turns over on the congregation's own calendar day. */
export const PUBLIC_TIME_ZONE = "America/Chicago";
const DAY = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

export function isSaturday(date: string): boolean {
  try { parseCeremonyDate(date); } catch { return false; }
  return new Date(utc(date)).getUTCDay() === 6;
}
export function addDays(date: string, days: number): string {
  parseCeremonyDate(date);
  if (!Number.isSafeInteger(days)) throw new Error("Invalid day offset");
  return parseCeremonyDate(iso(utc(date) + days * DAY));
}
/** The Saturday on or after a calendar date. */
export function shabbatOnOrAfter(date: string): string {
  parseCeremonyDate(date);
  const day = new Date(utc(date)).getUTCDay();
  return addDays(date, (6 - day + 7) % 7);
}
/** Today's date where the congregation is. */
export function congregationToday(now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PUBLIC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(row => row.type === type)?.value ?? "";
  return parseCeremonyDate(`${part("year")}-${part("month")}-${part("day")}`);
}
/** This week's Shabbat: today if it is Saturday, otherwise the coming Saturday. */
export const thisShabbat = (now: number = Date.now()) => shabbatOnOrAfter(congregationToday(now));
/** A Saturday inside the public window around today, or null. */
export function publicShabbat(value: unknown, now: number = Date.now()): string | null {
  if (typeof value !== "string" || !isSaturday(value)) return null;
  const today = utc(congregationToday(now)), time = utc(value);
  if (time < today - PUBLIC_SHABBAT_WINDOW.pastDays * DAY || time > today + PUBLIC_SHABBAT_WINDOW.futureDays * DAY) return null;
  return value;
}
