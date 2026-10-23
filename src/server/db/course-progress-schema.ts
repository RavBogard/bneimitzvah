import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membership, tenant } from "./tenant-schema";

/**
 * Learn to lein, slice 3: a member's own course progress, one `learn-progress/v1` document per member.
 * Only the owner reads it: the table carries one forced `owner_only` policy keyed on a transaction-local
 * owner setting that only src/server/course-progress/access.ts sets, on the saved layer's model (0036).
 * Staff, Daniel, MCP, cron, the roster Sheet and notifications never set it and see no rows. No audit rows.
 */
export const courseProgressTable = pgTable("course_progress", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(),
  progress: jsonb("progress").notNull(), version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "course_progress_key", columns: [t.tenantId, t.membershipId] }),
  foreignKey({ name: "course_progress_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  // The app validates the whole document with the browser's own parser first; the database holds its outline and its size.
  // coalesce: a missing key makes the comparison NULL, which a CHECK would pass.
  check("course_progress_document", sql`jsonb_typeof(${t.progress}) = 'object' and coalesce(${t.progress}->>'schema' = 'learn-progress/v1' and jsonb_typeof(${t.progress}->'lessons') = 'object' and jsonb_typeof(${t.progress}->'cards') = 'object', false) and octet_length(${t.progress}::text) <= 98304`),
  check("course_progress_version", sql`${t.version} > 0`),
  check("course_progress_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt})`),
]);
