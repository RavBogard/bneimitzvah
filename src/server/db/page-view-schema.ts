import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { tenant } from "./tenant-schema";

/**
 * Release 1.5, cookieless analytics (Daniel: "Vercel Web Analytics only if it is free on the current plan. Otherwise build
 * our own counter (path and day only)"). One row per congregation, UTC day and normalized public path, holding a count and
 * nothing else: no IP, user agent, referrer, cookie, session, user, query string, finer time or per-visit row. Paths come
 * only from the allow-list in src/lib/site/page-views.ts; the CHECKs below are the database's own bound on their shape, so
 * no request can fill the table with arbitrary text. Written by the public beacon route, read by one admin MCP tool.
 */
export const publicPageViewDay = pgTable("public_page_view_day", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), day: date("day").notNull(), path: text("path").notNull(),
  views: integer("views").notNull(),
}, t => [
  primaryKey({ name: "public_page_view_day_key", columns: [t.tenantId, t.day, t.path] }),
  // Lowercase segments of letters, digits and single hyphens under one leading slash: no query, fragment, dot or space.
  check("public_page_view_day_path", sql`char_length(${t.path}) between 2 and 96 and ${t.path} ~ '^(/[a-z0-9]+(-[a-z0-9]+)*)+$'`),
  check("public_page_view_day_views", sql`${t.views} > 0`),
  check("public_page_view_day_day", sql`isfinite(${t.day})`),
]);
