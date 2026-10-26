import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { invite, role, roleGrant, student, tenant } from "./tenant-schema";

/**
 * A student held for a tutor invitation (Daniel, 2026-10-26: choose the students now, and the tutor has them as soon as the
 * invitation is accepted). One row per invitation and student, written by an admin (rabbis are admins) when the tutor is invited,
 * and copied onto the new invitation when "Send again" or "Copy link" rotates it. Accepting the invitation creates each held
 * student's tutor_student link through the portal's own tutor write (writeTutorAssignment), skipping a student who is disabled,
 * ceremony-done or already linked. A hold grants nothing by itself: only an accepted tutor invitation turns it into access.
 *
 * Forced row security (migration 0053), as on tutor_student: tenant_isolation, SELECT and INSERT only, no UPDATE or DELETE.
 * A row on a revoked, expired or accepted invitation simply never applies again.
 */
export const tutorInviteHold = pgTable("tutor_invite_hold", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  inviteId: uuid("invite_id").notNull(), studentId: uuid("student_id").notNull(),
  heldByGrantId: uuid("held_by_grant_id").notNull(), heldByRole: role("held_by_role").default("admin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("tutor_invite_hold_tenant_id_key").on(t.tenantId, t.id),
  unique("tutor_invite_hold_invite_student_key").on(t.tenantId, t.inviteId, t.studentId),
  foreignKey({ name: "tutor_invite_hold_invite_fk", columns: [t.tenantId, t.inviteId], foreignColumns: [invite.tenantId, invite.id] }),
  foreignKey({ name: "tutor_invite_hold_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "tutor_invite_hold_held_by_fk", columns: [t.tenantId, t.heldByGrantId, t.heldByRole], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("tutor_invite_hold_by_admin", sql`${t.heldByRole} = 'admin'`),
  check("tutor_invite_hold_instant", sql`isfinite(${t.createdAt})`),
]);
