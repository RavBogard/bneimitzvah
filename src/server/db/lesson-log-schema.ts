import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { membership, student, tenant } from "./tenant-schema";

export const lessonLog = pgTable("lesson_log", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(), entryId: uuid("entry_id").notNull(),
  creatorMembershipId: uuid("creator_membership_id").notNull(), creatorUserId: text("creator_user_id").notNull(),
  lessonDate: date("lesson_date").notNull(), summary: text("summary").notNull(),
  // Release 1.9 N12 (0045): the optional "Before next time" line. The note's own readers, nothing more; a tombstone clears it.
  beforeNext: text("before_next"), version: integer("version").notNull(), deleted: boolean("deleted").default(false).notNull(),
}, t => [
  primaryKey({ name: "lesson_log_key", columns: [t.tenantId, t.studentId, t.entryId] }),
  foreignKey({ name: "lesson_log_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "lesson_log_creator_fk", columns: [t.tenantId, t.creatorMembershipId, t.creatorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  check("lesson_log_version_positive", sql`${t.version} > 0`),
  check("lesson_log_date", sql`${t.lessonDate} between date '0001-01-01' and date '9999-12-31'`),
  check("lesson_log_before_next", sql`(${t.deleted} and ${t.beforeNext} is null) or (not ${t.deleted} and (${t.beforeNext} is null or (length(trim(${t.beforeNext})) > 0 and octet_length(${t.beforeNext}) <= 1024)))`),
  check("lesson_log_summary", sql`(${t.deleted} and ${t.summary} = '') or (not ${t.deleted} and length(trim(${t.summary})) > 0 and octet_length(${t.summary}) <= 4096)`),
]);
