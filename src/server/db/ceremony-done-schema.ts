import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { role, roleGrant, student, tenant } from "./tenant-schema";

/**
 * Release 1.9 N21, "Ceremony done" (Daniel, decision 13; PLAN "Decided here 5": ceremony done narrows access, never widens it).
 * One row each time an admin (rabbis are admins) marks a student's ceremony done: who set it (an admin role grant, held to the
 * admin role by the typed foreign key) and when (the server's now()). Reversing it fills reversed_at and reversed_by on the same
 * row; a reversed row stays as history and is never live again. At most one live (unreversed) row per student.
 *
 * Forced row security (migration 0049): a RESTRICTIVE tenant_isolation; any tenant reader may see the state (every staff list
 * filters on it); INSERT and UPDATE only with `app.ceremony_done_actor` naming a live admin grant of an enabled membership, which
 * only src/server/students/ceremony-done.ts sets. The INSERT also requires that no live tutor_student row is left for the student,
 * so the tutor rows must end in the same transaction first; a trigger on tutor_student refuses a new row while the state is live.
 */
export const studentCeremonyDone = pgTable("student_ceremony_done", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  setByGrantId: uuid("set_by_grant_id").notNull(), setByRole: role("set_by_role").default("admin").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  reversedByGrantId: uuid("reversed_by_grant_id"), reversedByRole: role("reversed_by_role"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
}, t => [
  unique("student_ceremony_done_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "student_ceremony_done_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "student_ceremony_done_set_by_fk", columns: [t.tenantId, t.setByGrantId, t.setByRole], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "student_ceremony_done_reversed_by_fk", columns: [t.tenantId, t.reversedByGrantId, t.reversedByRole], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  uniqueIndex("student_ceremony_done_live_key").on(t.tenantId, t.studentId).where(sql`${t.reversedAt} is null`),
  check("student_ceremony_done_set_by_admin", sql`${t.setByRole} = 'admin'`),
  check("student_ceremony_done_reversal_whole", sql`(${t.reversedAt} is null and ${t.reversedByGrantId} is null and ${t.reversedByRole} is null)
    or (${t.reversedAt} is not null and ${t.reversedByGrantId} is not null and ${t.reversedByRole} = 'admin' and ${t.reversedAt} >= ${t.setAt})`),
  check("student_ceremony_done_instants", sql`isfinite(${t.setAt}) and (${t.reversedAt} is null or isfinite(${t.reversedAt}))`),
]);
