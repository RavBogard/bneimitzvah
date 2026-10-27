import { PortalRequestError } from "../api";
import { parseCalendar, type CalendarRow } from "../../../lib/readings/calendar";
import { getJson } from "./api";
import { publicCalendarPath } from "./urls";

/**
 * The public calendar, fetched once per page load and shared by Find a reading, the Readings index and the home's chips. A failed
 * fetch is forgotten, so "Try again" asks again; a good one is kept until the page is left.
 */
let kept: Promise<CalendarRow[]> | null = null;
export function fetchCalendar(signal: AbortSignal): Promise<CalendarRow[]> {
  if (kept) return kept;
  const work = getJson(publicCalendarPath(), 64 * 1024, signal).then(body => {
    const rows = parseCalendar(body);
    if (!rows.length) throw new PortalRequestError(503);
    return rows;
  });
  kept = work;
  work.catch(() => { if (kept === work) kept = null; });
  return work;
}
