import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { membership, role, roleGrant, student, tenant } from "./tenant-schema";

/**
 * Release 1.1 email notifications (Daniel, 2026-10-21): tutor draft notices, weekly digests and
 * opt-in practice reminders. A row here records one member's own choice for one kind; no row means
 * the kind's default (tutor notices and parents' digests on, adult self-digests and reminders off).
 */
export const notificationPreference = pgTable("notification_preference", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(),
  kind: text("kind").$type<"tutor-draft" | "weekly-digest" | "practice-reminder">().notNull(), enabled: boolean("enabled").notNull(),
  // Sunday 0 to Saturday 6, the practice reminder's day; null for every other kind.
  weekday: integer("weekday"), revision: integer("revision").default(1).notNull(),
  updatedVia: text("updated_via").$type<"web" | "unsubscribe">().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "notification_preference_key", columns: [t.tenantId, t.membershipId, t.kind] }),
  foreignKey({ name: "notification_preference_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  check("notification_preference_kind", sql`${t.kind} in ('tutor-draft','weekly-digest','practice-reminder')`),
  check("notification_preference_weekday", sql`(${t.kind} = 'practice-reminder' and (${t.weekday} is null or ${t.weekday} between 0 and 6)) or (${t.kind} <> 'practice-reminder' and ${t.weekday} is null)`),
  check("notification_preference_revision", sql`${t.revision} > 0`),
  check("notification_preference_via", sql`${t.updatedVia} in ('web','unsubscribe')`),
  check("notification_preference_instant", sql`isfinite(${t.updatedAt})`),
]);

/**
 * The send ledger: at most one row per (member, kind, period), claimed before the provider is
 * called, so a retried cron or a second runner never sends twice. No address or message text is
 * stored; the recipient's address is read from their account when the row is sent.
 */
export const notificationDelivery = pgTable("notification_delivery", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(), role: role("role").notNull(),
  kind: text("kind").$type<"tutor-draft" | "weekly-digest" | "practice-reminder">().notNull(),
  // tutor-draft: "<student id>:<YYYY-MM-DD>" (one per tutor, student and Central-time day); otherwise the scheduled date.
  periodKey: text("period_key").notNull(), studentId: uuid("student_id"),
  status: text("status").$type<"pending" | "sending" | "sent" | "failed" | "unknown" | "skipped">().notNull(),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }), finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => [
  unique("notification_delivery_tenant_id_key").on(t.tenantId, t.id),
  unique("notification_delivery_period_key").on(t.tenantId, t.membershipId, t.kind, t.periodKey),
  foreignKey({ name: "notification_delivery_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "notification_delivery_grant_fk", columns: [t.tenantId, t.roleGrantId, t.membershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "notification_delivery_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "notification_delivery_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  check("notification_delivery_kind", sql`(${t.kind} = 'tutor-draft' and ${t.role} = 'tutor' and ${t.studentId} is not null and ${t.periodKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    or (${t.kind} = 'weekly-digest' and ${t.role} in ('parent','student') and ${t.studentId} is null and ${t.periodKey} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    or (${t.kind} = 'practice-reminder' and ${t.role} = 'student' and ${t.studentId} is null and ${t.periodKey} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`),
  check("notification_delivery_status", sql`${t.status} in ('pending','sending','sent','failed','unknown','skipped')`),
  check("notification_delivery_attempts", sql`${t.attempts} between 0 and 10`),
  check("notification_delivery_instants", sql`isfinite(${t.createdAt}) and (${t.attemptedAt} is null or isfinite(${t.attemptedAt})) and (${t.finishedAt} is null or isfinite(${t.finishedAt}))`),
]);
