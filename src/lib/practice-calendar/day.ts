export const PRACTICE_REPLAY_DAYS = 90;
export const PRACTICE_DATE_BATCH = 31;

const chicago = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", calendar: "gregory", numberingSystem: "latn",
  year: "numeric", month: "2-digit", day: "2-digit", era: "short",
});

export function chicagoDate(instant: number) {
  const parts = Object.fromEntries(chicago.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  if (parts.era !== "AD" || !Number.isInteger(year) || year < 1 || !Number.isInteger(month) || !Number.isInteger(day)) throw new Error("Practice time unavailable");
  return { year, month, day, date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

export function practiceDateOrdinal(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number), date = new Date(0);
  if (year < 1) return null;
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() / 86_400_000 : null;
}
