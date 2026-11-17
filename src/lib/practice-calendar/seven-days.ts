/**
 * The one window every "days practiced" surface uses (project review 2026-11-16, "practice dots disagree"): the seven days ending
 * today, oldest first. The student's card, the parent's This week, the tutor's and admin's student page, child practice and the
 * tutor's "Practiced n of last 7 days" all count and draw these same seven days. Dates only (YYYY-MM-DD); no count is shown to a student.
 */
export const SEVEN_DAYS = 7;
const DAY_MS = 86_400_000;
const ordinalOf = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const dayOf = (ordinal: number) => new Date(ordinal * DAY_MS).toISOString().slice(0, 10);

/** The first and last day of the window ending on `today`, inclusive. */
export function sevenDayWindow(today: string): { from: string; through: string } {
  return { from: dayOf(ordinalOf(today) - (SEVEN_DAYS - 1)), through: today };
}

export type SevenDay = Readonly<{ date: string; practiced: boolean; today: boolean; weekday: number }>;
/** The seven days ending on `today`, oldest first, each with whether the student practiced; weekday is 0 for Sunday. */
export function lastSevenDays(today: string, dates: ReadonlySet<string> | readonly string[]): readonly SevenDay[] {
  const end = ordinalOf(today), practiced = dates instanceof Set ? dates as ReadonlySet<string> : new Set(dates as readonly string[]);
  return Array.from({ length: SEVEN_DAYS }, (_, index) => {
    const ordinal = end - (SEVEN_DAYS - 1) + index, date = dayOf(ordinal);
    return Object.freeze({ date, practiced: practiced.has(date), today: ordinal === end, weekday: ((ordinal + 4) % 7 + 7) % 7 });
  });
}
