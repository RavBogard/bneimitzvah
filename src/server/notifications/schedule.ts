import { chicagoDate } from "../practice-calendar/policy";

/** The three kinds, each with its own admin switch, member choice and unsubscribe link. */
export const KINDS = ["tutor-draft", "weekly-digest", "practice-reminder"] as const;
export type NotificationKind = (typeof KINDS)[number];
export const KIND_CODE: Record<NotificationKind, "t" | "d" | "r"> = { "tutor-draft": "t", "weekly-digest": "d", "practice-reminder": "r" };
export const KIND_OF_CODE: Record<string, NotificationKind> = { t: "tutor-draft", d: "weekly-digest", r: "practice-reminder" };
/** Sunday, when a congregation has not chosen a digest day. */
export const DEFAULT_DIGEST_WEEKDAY = 0;
/** A digest or reminder the morning run could not reach is still sent up to this many days late, never later. */
export const CATCH_UP_DAYS = 2;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function utc(date: string) {
  const match = DATE.exec(date); if (!match) throw new Error("Notification date unavailable");
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (value.toISOString().slice(0, 10) !== date) throw new Error("Notification date unavailable");
  return value;
}
/** A Central-time calendar day (the portal's practice day) and its weekday, Sunday 0. */
export function chicagoDay(now: number) {
  const { date } = chicagoDate(now);
  return { date, weekday: utc(date).getUTCDay() };
}
export function addDays(date: string, days: number) {
  const value = utc(date); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function weekdayOf(date: string) { return utc(date).getUTCDay(); }
/** The latest day on `weekday` within the last CATCH_UP_DAYS days (today included), or null. */
export function dueOccurrence(today: string, weekday: number) {
  for (let back = 0; back <= CATCH_UP_DAYS; back++) { const day = addDays(today, -back); if (weekdayOf(day) === weekday) return day; }
  return null;
}
export const validWeekday = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
