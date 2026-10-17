import "server-only";
// Deliberate reuse of the reviewed Chicago/calendar-year arithmetic, including
// the valid year-9999 ceremony's year-10000 anniversary. No practice quotas or
// 90-day policy are imported into recording retention.
import { chicagoDate, retention, serverInstant } from "../practice-calendar/policy";
export const recordingInstant = serverInstant;
export const recordingDate = (instant: Date) => chicagoDate(instant.getTime()).date;
export const recordingDue = (ceremonyDate: string, instant: number) => retention(ceremonyDate, instant).expired;
