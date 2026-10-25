import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membership, tenant } from "./tenant-schema";

/**
 * 1.9 N19: a student's own verse review cards, one `learn-verses/v1` document per member, on the course-progress model
 * (0037) with its own owner setting. Only the owner reads it: the table carries one forced `owner_only` policy keyed on a
 * transaction-local owner setting that only src/server/verse-review/access.ts sets. Staff, parents, Daniel, MCP, cron, the
 * roster Sheet and notifications never set it and see no rows. No audit rows.
 */
export const verseReviewTable = pgTable("verse_review", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(),
  review: jsonb("review").notNull(), version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "verse_review_key", columns: [t.tenantId, t.membershipId] }),
  foreignKey({ name: "verse_review_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  // The app validates the whole document with the browser's own parser first; the database holds its outline and its size.
  // coalesce: a missing key makes the comparison NULL, which a CHECK would pass.
  check("verse_review_document", sql`jsonb_typeof(${t.review}) = 'object' and coalesce(${t.review}->>'schema' = 'learn-verses/v1' and jsonb_typeof(${t.review}->'cards') = 'object', false) and octet_length(${t.review}::text) <= 49152`),
  check("verse_review_version", sql`${t.version} > 0`),
  check("verse_review_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt})`),
]);
