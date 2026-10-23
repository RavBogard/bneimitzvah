import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { membership, role, roleGrant, tenant } from "./tenant-schema";

/**
 * Release 1.4 accounts (accounts plan section 1b). A person asks for an account (`account_request`, the pending
 * queue only); an approver turns it into the Member role (`tenant_member`, never a portal_role grant); admins
 * designate tutors who may also approve (`account_approver`). None of these ever grants a workspace mode.
 */
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
// A person's own words, shown to staff: no control characters, line or paragraph separators, or bidirectional
// overrides and isolates (which could make one name read as another). The app refuses the same set first.
export const ACCOUNT_TEXT_CONTROLS = String.raw`[\x01-\x1f\x7f-\x9f\x2028\x2029\x202a-\x202e\x2066-\x2069]`;
const clean = (column: unknown) => sql`${column} !~ ${sql.raw(`'${ACCOUNT_TEXT_CONTROLS}'`)}`;

export const accountRequest = pgTable("account_request", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), userId: text("user_id").notNull().references(() => user.id),
  displayName: text("display_name").notNull(), purpose: text("purpose"), createdAt: createdAt(),
  notifyStatus: text("notify_status").$type<"pending" | "sent" | "failed" | "skipped">().default("pending").notNull(),
  notifyAttemptedAt: timestamp("notify_attempted_at", { withTimezone: true }),
}, t => [
  unique("account_request_tenant_id_key").on(t.tenantId, t.id),
  unique("account_request_user_key").on(t.tenantId, t.userId),
  check("account_request_name", sql`${t.displayName} = btrim(${t.displayName}) and char_length(${t.displayName}) between 1 and 80 and ${clean(t.displayName)}`),
  check("account_request_purpose", sql`${t.purpose} is null or (${t.purpose} = btrim(${t.purpose}) and char_length(${t.purpose}) between 1 and 500 and ${clean(t.purpose)})`),
  check("account_request_notify_shape", sql`(${t.notifyStatus} in ('pending','skipped') and ${t.notifyAttemptedAt} is null) or (${t.notifyStatus} in ('sent','failed') and ${t.notifyAttemptedAt} is not null)`),
  check("account_request_instants", sql`isfinite(${t.createdAt}) and (${t.notifyAttemptedAt} is null or isfinite(${t.notifyAttemptedAt}))`),
]);

export const tenantMember = pgTable("tenant_member", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(), approvedByMembershipId: uuid("approved_by_membership_id").notNull(), createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), revokedByMembershipId: uuid("revoked_by_membership_id"),
  welcomeStatus: text("welcome_status").$type<"pending" | "sent" | "failed" | "skipped">().default("pending").notNull(),
  welcomeAttemptedAt: timestamp("welcome_attempted_at", { withTimezone: true }),
}, t => [
  unique("tenant_member_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "tenant_member_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "tenant_member_approver_fk", columns: [t.tenantId, t.approvedByMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  foreignKey({ name: "tenant_member_revoker_fk", columns: [t.tenantId, t.revokedByMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  uniqueIndex("tenant_member_active_key").on(t.tenantId, t.membershipId).where(sql`${t.revokedAt} is null`),
  check("tenant_member_name", sql`${t.displayName} = btrim(${t.displayName}) and char_length(${t.displayName}) between 1 and 80 and ${clean(t.displayName)}`),
  check("tenant_member_revoked_pair", sql`(${t.revokedAt} is null) = (${t.revokedByMembershipId} is null)`),
  check("tenant_member_welcome_shape", sql`(${t.welcomeStatus} in ('pending','skipped') and ${t.welcomeAttemptedAt} is null) or (${t.welcomeStatus} in ('sent','failed') and ${t.welcomeAttemptedAt} is not null)`),
  check("tenant_member_instants", sql`isfinite(${t.createdAt}) and (${t.revokedAt} is null or isfinite(${t.revokedAt})) and (${t.welcomeAttemptedAt} is null or isfinite(${t.welcomeAttemptedAt}))`),
]);

export const accountApprover = pgTable("account_approver", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), membershipId: uuid("membership_id").notNull(), tutorGrantId: uuid("tutor_grant_id").notNull(),
  role: role("role").default("tutor").notNull(), designatedByMembershipId: uuid("designated_by_membership_id").notNull(), createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), revokedByMembershipId: uuid("revoked_by_membership_id"),
}, t => [
  unique("account_approver_tenant_id_key").on(t.tenantId, t.id),
  // The designation is bound to one tutor grant of this very membership; it dies with that grant.
  foreignKey({ name: "account_approver_grant_fk", columns: [t.tenantId, t.tutorGrantId, t.membershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "account_approver_role_fk", columns: [t.tenantId, t.tutorGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "account_approver_designator_fk", columns: [t.tenantId, t.designatedByMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  foreignKey({ name: "account_approver_revoker_fk", columns: [t.tenantId, t.revokedByMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  uniqueIndex("account_approver_active_key").on(t.tenantId, t.membershipId).where(sql`${t.revokedAt} is null`),
  check("account_approver_role", sql`${t.role} = 'tutor'`),
  check("account_approver_revoked_pair", sql`(${t.revokedAt} is null) = (${t.revokedByMembershipId} is null)`),
  check("account_approver_instants", sql`isfinite(${t.createdAt}) and (${t.revokedAt} is null or isfinite(${t.revokedAt}))`),
]);
