import { PortalRequestError } from "../api";
import { getJson } from "../public-reading/api";
import { isSaturday } from "../../../lib/readings/public-shabbat";
import { parsePortions, type WeekPortions } from "../../../lib/print/portions";

/** A Shabbat's calendar aliyot, from the signed-out allowlist (same transport as the reading: no cookie, no referrer). */
export const publicAliyotPath = (date: string) => `/api/public/aliyot?${new URLSearchParams([["date", date]]).toString()}`;
export async function fetchPublicAliyot(date: string, signal: AbortSignal): Promise<WeekPortions> {
  if (!isSaturday(date)) throw new PortalRequestError(400);
  const portions = parsePortions(await getJson(publicAliyotPath(date), 32 * 1024, signal), date);
  if (!portions) throw new PortalRequestError(503);
  return portions;
}
