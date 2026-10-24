import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import { readPublicPageViews } from "../data/page-views";
import { SCOPES } from "./oauth";
import type { Tool } from "./tools";

// The public page-view counter's one readout (release 1.5, cookieless analytics; Daniel: "path and day only"). Admin only,
// read only, the caller's own congregation only: the transaction is bound to the connection's tenant (row security) and the
// query filters on it too. The table holds nothing about a visitor, so neither does the answer.

const DATE = /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/;
/** At most 92 days per call (a quarter) and 5,000 rows; `truncated` says when a range held more. */
export const PAGE_VIEW_MAX_DAYS = 92, PAGE_VIEW_MAX_ROWS = 5000;
const date = (description: string) => ({ type: "string", pattern: DATE.source, description });
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

/** A real calendar date (2026-02-30 is not), as its UTC midnight in milliseconds, or null. */
function calendarDay(value: string): number | null {
  if (!DATE.test(value)) return null;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at : null;
}

export function createAnalyticsTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  return Object.freeze([{
    name: "get_page_views", roles: ["admin"], scope: SCOPES.read, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: `How often the public pages were opened, per page per day (UTC), for this congregation: /read (this week's reading), /read/<slug> (a named reading, e.g. /read/noach), /read/any ("Any reading"), /learn, /learn/<lesson>, /learn/about, /learn/review and /trope-chart. Counts only: nothing about who visited is kept. start and end are inclusive dates, at most ${PAGE_VIEW_MAX_DAYS} days apart. Days with no views are absent.`,
    inputSchema: closed({ start: date("First day, YYYY-MM-DD (UTC)."), end: date("Last day, YYYY-MM-DD (UTC), on or after start.") }, ["start", "end"]),
    handler: async (input, ctx) => {
      if (ctx.actor.role !== "admin") throw new AccessDenied(403);
      const start = String(input.start), end = String(input.end), from = calendarDay(start), to = calendarDay(end);
      if (from === null || to === null) return { ok: false, code: "invalid", hint: "start and end must be real dates, YYYY-MM-DD." };
      if (to < from) return { ok: false, code: "invalid", hint: "end must be on or after start." };
      if ((to - from) / 86_400_000 + 1 > PAGE_VIEW_MAX_DAYS) return { ok: false, code: "invalid", hint: `Ask for at most ${PAGE_VIEW_MAX_DAYS} days at a time.` };
      return ctx.mcp.withLive(ctx.actor, "read", async (tx, live) => {
        if (live.role !== "admin") throw new AccessDenied(403);
        const { rows, truncated } = await readPublicPageViews(tx, live.tenantId, start, end, PAGE_VIEW_MAX_ROWS);
        const totals = new Map<string, number>();
        for (const row of rows) totals.set(row.path, (totals.get(row.path) ?? 0) + row.views);
        return { ok: true, start, end, rows, truncated,
          totals: [...totals].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views || (a.path < b.path ? -1 : 1)) };
      });
    },
  }] satisfies Tool<Q>[]);
}
