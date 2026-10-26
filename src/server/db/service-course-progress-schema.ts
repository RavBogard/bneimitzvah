import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membership, tenant } from "./tenant-schema";

/**
 * Release 2.0 SC4: a member's own progress in the service course (Learn the service), one `service-course-progress/v1`
 * document per member, a copy of Learn to lein's progress table (0037) with its own owner setting (A4 6.2, migration A).
 * Only the owner reads it: one forced `owner_only` policy keyed on its own transaction-local owner setting, which only
 * src/server/service-course/progress-access.ts sets. Staff, Daniel, MCP, cron, the roster Sheet and notifications never
 * set it and see no rows. No audit rows.
 */
export const serviceCourseProgressTable = pgTable("service_course_progress", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(),
  progress: jsonb("progress").notNull(), version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "service_course_progress_key", columns: [t.tenantId, t.membershipId] }),
  foreignKey({ name: "service_course_progress_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  // The app validates the whole document with the browser's own parser first; the database holds its outline and its size.
  // coalesce: a missing key makes the comparison NULL, which a CHECK would pass.
  check("service_course_progress_document", sql`jsonb_typeof(${t.progress}) = 'object' and coalesce(${t.progress}->>'schema' = 'service-course-progress/v1' and jsonb_typeof(${t.progress}->'lessons') = 'object' and jsonb_typeof(${t.progress}->'cards') = 'object', false) and octet_length(${t.progress}::text) <= 98304`),
  check("service_course_progress_version", sql`${t.version} > 0`),
  check("service_course_progress_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt})`),
]);
