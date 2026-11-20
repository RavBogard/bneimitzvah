import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { membership, student, tenant } from "./tenant-schema";

/** One private, optional profile field. Student/guardian edits do not grant writes on the student table. */
export const privatePronouns = pgTable("private_pronouns", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  membershipId: uuid("membership_id"), studentId: uuid("student_id"), pronouns: text("pronouns").notNull(), revision: integer("revision").notNull().default(1),
}, t => [
  unique("private_pronouns_member_key").on(t.tenantId, t.membershipId), unique("private_pronouns_student_key").on(t.tenantId, t.studentId),
  foreignKey({ name: "private_pronouns_member_fk", columns: [t.tenantId, t.membershipId], foreignColumns: [membership.tenantId, membership.id] }),
  foreignKey({ name: "private_pronouns_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  check("private_pronouns_subject", sql`(${t.membershipId} is null) <> (${t.studentId} is null)`),
  check("private_pronouns_shape", sql`char_length(${t.pronouns}) <= 80 and ${t.revision} > 0`),
]);
