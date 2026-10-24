import "server-only";
import { and, asc, between, eq, lt, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { publicPageViewPaths } from "../../lib/site/page-views";

/**
 * The public page-view counter (release 1.5, "path and day only"): congregation, UTC day, allow-listed path, count.
 * Both functions run inside withTenantTransaction, so row security binds them to the transaction's congregation as well as
 * the explicit tenant filter.
 */
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ALLOWED: ReadonlySet<string> = new Set(publicPageViewPaths());
const MAX_VIEWS = 2147483647;

/** Adds one view of `path` on `day`, atomically. A path outside the allow-list or a malformed day writes nothing. */
export async function countPublicPageView<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, day: string, path: string): Promise<void> {
  if (!DAY.test(day) || !ALLOWED.has(path)) throw new Error("Not a public page");
  const t = s.publicPageViewDay;
  // A count at the integer ceiling stays there instead of failing the insert.
  await tx.insert(t).values({ tenantId, day, path, views: 1 })
    .onConflictDoUpdate({ target: [t.tenantId, t.day, t.path], set: { views: sql`${t.views} + 1` }, setWhere: lt(t.views, MAX_VIEWS) });
}

export type PageViewRow = Readonly<{ day: string; path: string; views: number }>;
/** Counts per path per day for `start`..`end` inclusive, day then path; at most `limit` rows, plus whether more exist. */
export async function readPublicPageViews<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, start: string, end: string, limit: number): Promise<{ rows: PageViewRow[]; truncated: boolean }> {
  const t = s.publicPageViewDay;
  const rows = await tx.select({ day: t.day, path: t.path, views: t.views }).from(t)
    .where(and(eq(t.tenantId, tenantId), between(t.day, start, end))).orderBy(asc(t.day), asc(t.path)).limit(limit + 1);
  return { rows: rows.slice(0, limit).map(row => Object.freeze({ day: String(row.day), path: row.path, views: row.views })), truncated: rows.length > limit };
}
