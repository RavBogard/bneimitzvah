import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { contextMode, membership, role, roleGrant, tenant } from "./tenant-schema";
import type { CongregationSettings } from "../settings/validation";

/**
 * The congregation's settings, append-only; head = max version. Readers take the head over the
 * legacy tenant.customs keys. An admin saves from the web (channel "web", with an actor receipt);
 * the owner's onboarding script writes only the empty first version of a new congregation, before
 * it has any member (channel "operator", no actor).
 */
export const tenantSettings = pgTable("tenant_settings", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  version: integer("version").notNull(), baseVersion: integer("base_version").notNull(), previousVersion: integer("previous_version"),
  body: jsonb("body").$type<CongregationSettings>().notNull(),
  actorUserId: text("actor_user_id"), actorMembershipId: uuid("actor_membership_id"), roleGrantId: uuid("role_grant_id"),
  role: role("role"), mode: contextMode("mode"), channel: text("channel").notNull(),
  mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("tenant_settings_stream_key").on(t.tenantId, t.version),
  unique("tenant_settings_receipt_key").on(t.tenantId, t.actorUserId, t.mutationId),
  foreignKey({ name: "tenant_settings_previous_fk", columns: [t.tenantId, t.previousVersion], foreignColumns: [t.tenantId, t.version] }),
  foreignKey({ name: "tenant_settings_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "tenant_settings_grant_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "tenant_settings_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("tenant_settings_versions", sql`${t.version} > 0 and ${t.baseVersion} >= 0 and ${t.version}::bigint = ${t.baseVersion}::bigint + 1 and ((${t.baseVersion}=0 and ${t.previousVersion} is null) or (${t.baseVersion}>0 and ${t.previousVersion} is not null and ${t.previousVersion}=${t.baseVersion}))`),
  check("tenant_settings_body", sql`public.portal_tenant_settings_valid(${t.body})`),
  check("tenant_settings_channel", sql`${t.channel} in ('web','operator')`),
  // The admin grant in admin mode (in this product the admin grant is the rabbi/clergy, study spec S21),
  // or the owner's empty first version, which has no actor at all.
  check("tenant_settings_actor", sql`(${t.channel}='web' and ${t.actorUserId} is not null and ${t.actorMembershipId} is not null and ${t.roleGrantId} is not null and ${t.role}='admin' and ${t.mode}='admin')
    or (${t.channel}='operator' and ${t.version}=1 and ${t.body}='{}'::jsonb and ${t.actorUserId} is null and ${t.actorMembershipId} is null and ${t.roleGrantId} is null and ${t.role} is null and ${t.mode} is null)`),
  check("tenant_settings_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
  check("tenant_settings_instant", sql`isfinite(${t.createdAt})`),
]);
