import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { student, tenant } from "./tenant-schema";

/**
 * Release 2.0 SC5 (A4 9, Batch 3 Q12): the per-part "finished" mark. One row per student and assigned part whose lesson the
 * student has finished (reached its Done screen), written only as a side effect of the student's own progress sync, and only for
 * a lesson that is one of the student's own assigned parts. Nothing else: no answers, attempts, scores or times beyond the
 * instant the server recorded it. Insert-only; unmarking does not exist.
 *
 * Readers (forced row security, migration 0048): the student; a parent in child practice acting for that child; the student's
 * assigned tutors with a live tutor_student row; admins (rabbis are admins). Never a parent in parent view (Batch 3b Q18), and no
 * MCP, cron, Sheet or Claude path. The reader is the transaction-local `app.service_part_reader` (a role grant id), and for child
 * practice also `app.service_part_context` (the practice context id); only src/server/service-course/finished.ts sets them.
 */
export const servicePartFinished = pgTable("service_part_finished", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(), lessonId: text("lesson_id").notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "service_part_finished_key", columns: [t.tenantId, t.studentId, t.lessonId] }),
  foreignKey({ name: "service_part_finished_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  // A course lesson id (course.json), never a feed unit id with its family suffix.
  check("service_part_finished_lesson", sql`${t.lessonId} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`),
  check("service_part_finished_instant", sql`isfinite(${t.finishedAt})`),
]);
