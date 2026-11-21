import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { membership, student, tenant } from "./tenant-schema";

export type StudentLearningKind = "learn" | "service" | "verses";

export const studentLearning = pgTable("student_learning", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id),
  studentId: uuid("student_id").notNull(),
  kind: text("kind").$type<StudentLearningKind>().notNull(),
  document: jsonb("document").notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "student_learning_key", columns: [t.tenantId, t.studentId, t.kind] }),
  foreignKey({ name: "student_learning_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  check("student_learning_document", sql`jsonb_typeof(${t.document}) = 'object' and coalesce(
    jsonb_typeof(${t.document}->'cards') = 'object' and case ${t.kind}
      when 'learn' then ${t.document}->>'schema' = 'learn-progress/v1' and jsonb_typeof(${t.document}->'lessons') = 'object'
      when 'service' then ${t.document}->>'schema' = 'service-course-progress/v1' and jsonb_typeof(${t.document}->'lessons') = 'object'
      when 'verses' then ${t.document}->>'schema' = 'learn-verses/v1'
      else false end, false) and octet_length(${t.document}::text) <= case when ${t.kind} = 'verses' then 49152 else 98304 end`),
  check("student_learning_version", sql`${t.version} > 0`),
  check("student_learning_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt})`),
]);

/** A linked account at rollout remains the physical home of its student's established history. */
export const studentLearningLegacy = pgTable("student_learning_legacy", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id),
  studentId: uuid("student_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  userId: text("user_id").notNull(),
}, t => [
  primaryKey({ name: "student_learning_legacy_key", columns: [t.tenantId, t.studentId] }),
  unique("student_learning_legacy_member_key").on(t.tenantId, t.membershipId),
  foreignKey({ name: "student_learning_legacy_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "student_learning_legacy_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
]);
