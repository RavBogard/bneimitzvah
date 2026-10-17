import "server-only";
import { parseCeremonyDate } from "../../lib/readings/ranges";

export const RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const DAILY_DETAIL_LIMIT = 512;
const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", era: "short" });
export function serverInstant(value: number): number {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) throw new Error("Practice time unavailable");
  return value;
}
export function chicagoDate(value: number) {
  const parts = Object.fromEntries(zone.formatToParts(new Date(serverInstant(value))).map(part => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  if (parts.era !== "AD" || !Number.isInteger(year) || year < 1 || !Number.isInteger(month) || !Number.isInteger(day)) throw new Error("Practice time unavailable");
  return { year, month, day, date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}
const leap = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const ordinalKey = (value: { year: number; month: number; day: number }) => value.year * 10000 + value.month * 100 + value.day;
export function retention(ceremonyDate: string, value: number) {
  parseCeremonyDate(ceremonyDate);
  const [originalYear, month, originalDay] = ceremonyDate.split("-").map(Number), year = originalYear + 1;
  const day = month === 2 && originalDay === 29 && !leap(year) ? 28 : originalDay;
  const today = chicagoDate(value);
  // Numeric parts deliberately allow the valid year-9999 ceremony's year-10000 anniversary.
  return { serverDay: today.date, expired: ordinalKey(today) >= ordinalKey({ year, month, day }), rawAfter: new Date(serverInstant(value) - RAW_RETENTION_MS) };
}
export function dateOrdinal(value: string) {
  parseCeremonyDate(value);
  const [year, month, day] = value.split("-").map(Number), date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / 86_400_000;
}
