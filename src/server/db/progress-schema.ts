import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { assignment, student, tenant } from "./tenant-schema";

type HeadName = "verse_self_check" | "verse_assessment";
const headColumns = () => ({
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  studentId: uuid("student_id").notNull(), assignmentId: uuid("assignment_id").notNull(), verseRef: text("verse_ref").notNull(),
  state: text("state").notNull(), version: integer("version").notNull(),
});
type HeadColumns = Readonly<{ tenantId: AnyPgColumn; studentId: AnyPgColumn; assignmentId: AnyPgColumn; verseRef: AnyPgColumn; state: AnyPgColumn; version: AnyPgColumn }>;
const headConstraints = (name: HeadName, t: HeadColumns) => [
  unique(`${name}_head_key`).on(t.tenantId, t.studentId, t.assignmentId, t.verseRef),
  foreignKey({ name: `${name}_student_fk`, columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: `${name}_assignment_fk`, columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
  check(`${name}_version_positive`, sql`${t.version} > 0`),
  check(`${name}_ref`, sql`${t.verseRef} ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'`),
  check(`${name}_state`, name === "verse_self_check" ? sql`${t.state} in ('unmarked','working','got-it')` : sql`${t.state} in ('not-started','working','solid')`),
];

/**
 * The student's own Still working / Got it marks. 1.9 N23 (0052, decision 7): each mark records whether it was made in the
 * student's own view or in child practice with a parent (source_mode, as practice_event already does), and the server's own
 * instant of the change (marked_at, stamped by 0052's trigger, never a value the caller chose). Both are null on marks made before
 * 0052. Only src/server/practice-visibility/ reads them for anyone but the student, through 0052's views.
 */
export const verseSelfCheck = pgTable("verse_self_check", {
  ...headColumns(),
  sourceMode: text("source_mode").$type<"student" | "child-practice">(),
  markedAt: timestamp("marked_at", { withTimezone: true, precision: 3 }),
}, t => [
  ...headConstraints("verse_self_check", t),
  check("verse_self_check_source_mode", sql`${t.sourceMode} is null or ${t.sourceMode} in ('student','child-practice')`),
  check("verse_self_check_marked", sql`(${t.sourceMode} is null) = (${t.markedAt} is null) and (${t.markedAt} is null or isfinite(${t.markedAt}))`),
]);
export const verseAssessment = pgTable("verse_assessment", headColumns(), t => headConstraints("verse_assessment", t));
