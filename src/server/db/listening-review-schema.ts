import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { contextMode, membership, role, roleGrant, tenant } from "./tenant-schema";

/**
 * Daniel's reference-audio listening review (2026-10-22): one append-only row per verdict an admin gives
 * on a sampled verse. The latest row per reviewer and item is that reviewer's current verdict. Each row
 * names the source and the exact clip it played and the pinned source identity that served it, so a
 * re-cut collection never inherits verdicts given on other audio. Verdicts never change what students
 * can hear: the student release stays a separate, logged configuration decision.
 */
export const listeningReviewVerdict = pgTable("listening_review_verdict", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  sampleVersion: text("sample_version").notNull(), itemId: text("item_id").notNull(), verseRef: text("verse_ref").notNull(),
  source: text("source").notNull(), sourcePin: text("source_pin").notNull(), asset: text("asset").notNull(),
  verdict: text("verdict").notNull(), reasons: text("reasons").array().notNull(), note: text("note"), latencyMs: integer("latency_ms"),
  actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(),
  role: role("role").notNull(), mode: contextMode("mode").notNull(), mutationId: uuid("mutation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("listening_review_receipt_key").on(t.tenantId, t.actorUserId, t.mutationId),
  foreignKey({ name: "listening_review_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "listening_review_grant_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "listening_review_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("listening_review_admin", sql`${t.role} = 'admin' and ${t.mode} = 'admin'`),
  check("listening_review_item", sql`${t.sampleVersion} ~ '^listening-sample/v[1-9][0-9]{0,3}$' and ${t.itemId} ~ '^[a-z]{2}-[a-z0-9-]{1,60}$' and char_length(${t.verseRef}) between 3 and 64 and ${t.verseRef} ~ '^[A-Za-z ]+ [1-9][0-9]*:[1-9][0-9]*$'`),
  check("listening_review_source", sql`${t.source} in ('pocket-torah','finkel') and ${t.sourcePin} ~ '^[a-f0-9]{64}$' and ${t.asset} ~ '^[a-z]{2}_[a-f0-9]{20,64}$'`),
  check("listening_review_verdict_value", sql`${t.verdict} in ('pass','needs-work') and cardinality(${t.reasons}) <= 6
    and ${t.reasons} <@ array['slow-start','verse-cut','highlight-off','word-drill-off','sound','would-teach-wrong']::text[]
    and (${t.verdict} = 'needs-work' or cardinality(${t.reasons}) = 0) and array_position(${t.reasons}, null) is null`),
  check("listening_review_note", sql`${t.note} is null or public.portal_settings_text(${t.note}, 1000, true)`),
  check("listening_review_latency", sql`${t.latencyMs} is null or ${t.latencyMs} between 0 and 60000`),
  check("listening_review_instant", sql`isfinite(${t.createdAt})`),
]);
