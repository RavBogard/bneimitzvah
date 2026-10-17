import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { assignment, student, tenant } from "./tenant-schema";

function progressHead(name: "verse_self_check" | "verse_assessment") {
  return pgTable(name, {
    id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
    studentId: uuid("student_id").notNull(), assignmentId: uuid("assignment_id").notNull(), verseRef: text("verse_ref").notNull(),
    state: text("state").notNull(), version: integer("version").notNull(),
  }, t => [
    unique(`${name}_head_key`).on(t.tenantId, t.studentId, t.assignmentId, t.verseRef),
    foreignKey({ name: `${name}_student_fk`, columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
    foreignKey({ name: `${name}_assignment_fk`, columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
    check(`${name}_version_positive`, sql`${t.version} > 0`),
    check(`${name}_ref`, sql`${t.verseRef} ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'`),
    check(`${name}_state`, name === "verse_self_check" ? sql`${t.state} in ('unmarked','working','got-it')` : sql`${t.state} in ('not-started','working','solid')`),
  ]);
}
export const verseSelfCheck = progressHead("verse_self_check");
export const verseAssessment = progressHead("verse_assessment");
