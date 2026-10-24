import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { CourseTextInvalid, courseTextAnswer, parsePublicCourseFeed, type PublicCourseFeed } from "./public-feed";
import { PUBLIC_COURSE_TEXT, type CourseTextPins } from "./pin";
import type { ServiceText } from "../../lib/service-course/text";

/**
 * The congregation's active public build of one volume, read inside its tenant transaction (forced row security), checked
 * against the code pin byte for byte and parsed. The stored pins must equal the code pin exactly and the bytes must hash to
 * it, so a row the operator path never should have written still shows nothing. Parsed builds are kept per instance by
 * identity: a stored build never changes (the table is immutable), so the parse runs once per instance, not per request.
 */
export class CourseTextUnavailable extends Error {
  constructor(readonly code: "not-found" | "unavailable") { super("Course text unavailable"); this.name = "CourseTextUnavailable"; }
}
const parsed = new Map<string, PublicCourseFeed>();
const samePins = (stored: unknown, pin: CourseTextPins) => {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const keys = Object.keys(pin) as (keyof CourseTextPins)[];
  return Object.keys(stored).length === keys.length && keys.every(key => (stored as Record<string, unknown>)[key] === pin[key]);
};

/** `pin` is the code pin; tests pass a synthetic one. */
export async function readCourseText<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, pin: CourseTextPins = PUBLIC_COURSE_TEXT): Promise<PublicCourseFeed> {
  const volume = pin.volume;
  const [life] = await tx.select({ catalogId: s.courseTextLifecycle.catalogId }).from(s.courseTextLifecycle)
    .where(and(eq(s.courseTextLifecycle.tenantId, tenantId), eq(s.courseTextLifecycle.volume, volume), eq(s.courseTextLifecycle.state, "active")));
  if (!life) throw new CourseTextUnavailable("unavailable");
  const [row] = await tx.select().from(s.courseTextCatalog)
    .where(and(eq(s.courseTextCatalog.tenantId, tenantId), eq(s.courseTextCatalog.id, life.catalogId), eq(s.courseTextCatalog.volume, volume)));
  if (!row || !samePins(row.pins, pin)) throw new CourseTextUnavailable("unavailable");
  const kept = parsed.get(row.identity);
  if (kept) return kept;
  try {
    const bytes = new Uint8Array(row.feedBytes);
    if (createHash("sha256").update(bytes).digest("hex") !== pin.feedSha256) throw new CourseTextInvalid();
    const feed = parsePublicCourseFeed(bytes, row.pins);
    if (feed.identity !== row.identity) throw new CourseTextInvalid();
    if (parsed.size > 4) parsed.clear();
    parsed.set(row.identity, feed);
    return feed;
  } catch { throw new CourseTextUnavailable("unavailable"); }
}

/** One unit's answer, or not-found for a unit the build does not carry (the route already refused any unit the course does not name). */
export function serviceTextOf(feed: PublicCourseFeed, unit: string): ServiceText {
  const answer = courseTextAnswer(feed, unit);
  if (!answer) throw new CourseTextUnavailable("not-found");
  return answer;
}
