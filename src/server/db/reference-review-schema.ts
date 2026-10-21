import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { membership, tenant } from "./tenant-schema";
import type { ReviewChecks } from "../reference-review/batch-contract";

export const referenceReviewBatch = pgTable("reference_review_batch", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), id: uuid("id").notNull(),
  manifestSha256: text("manifest_sha256").notNull(), catalogSha256: text("catalog_sha256").notNull(), reviewerUserId: text("reviewer_user_id").notNull(),
  entryCount: integer("entry_count").notNull(), generation: integer("generation").default(1).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "reference_review_batch_key", columns: [t.tenantId, t.id] }),
  unique("reference_review_batch_manifest_key").on(t.tenantId, t.id, t.manifestSha256),
  check("reference_review_batch_hashes", sql`${t.manifestSha256} ~ '^[a-f0-9]{64}$' and ${t.catalogSha256} ~ '^[a-f0-9]{64}$'`),
  check("reference_review_batch_bound", sql`${t.entryCount} between 1 and 8 and ${t.generation} > 0 and ${t.expiresAt} > ${t.createdAt} and ${t.reviewerUserId} ~ '^[A-Za-z0-9_-]{1,128}$'`),
]);
export const referenceReviewDecision = pgTable("reference_review_decision", {
  tenantId: text("tenant_id").notNull(), batchId: uuid("batch_id").notNull(), requestId: uuid("request_id").notNull(),
  assetKey: text("asset_key").notNull(), generation: integer("generation").notNull(), revision: integer("revision").notNull(),
  manifestSha256: text("manifest_sha256").notNull(), catalogSha256: text("catalog_sha256").notNull(), identitySha256: text("identity_sha256").notNull(),
  targetSha256: text("target_sha256").notNull(), textSha256: text("text_sha256").notNull(), playbackSha256: text("playback_sha256").notNull(), playbackBytes: integer("playback_bytes").notNull(),
  requestSha256: text("request_sha256").notNull(), checks: jsonb("checks").$type<ReviewChecks>().notNull(),
  actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  roleGrantId: uuid("role_grant_id").notNull(), authorityRevision: integer("authority_revision").notNull(), roleGrantRevision: integer("role_grant_revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "reference_review_decision_key", columns: [t.tenantId, t.batchId, t.requestId] }),
  unique("reference_review_decision_revision_key").on(t.tenantId, t.batchId, t.generation, t.assetKey, t.revision),
  foreignKey({ name: "reference_review_decision_batch_fk", columns: [t.tenantId, t.batchId, t.manifestSha256], foreignColumns: [referenceReviewBatch.tenantId, referenceReviewBatch.id, referenceReviewBatch.manifestSha256] }),
  foreignKey({ name: "reference_review_decision_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  check("reference_review_decision_bound", sql`${t.generation} > 0 and ${t.revision} > 0 and ${t.playbackBytes} between 1 and 4194304 and ${t.assetKey} ~ '^fj_[a-f0-9]{20}$' and ${t.authorityRevision} > 0 and ${t.roleGrantRevision} > 0`),
  check("reference_review_decision_hashes", sql`${t.manifestSha256} ~ '^[a-f0-9]{64}$' and ${t.catalogSha256} ~ '^[a-f0-9]{64}$' and ${t.identitySha256} ~ '^[a-f0-9]{64}$' and ${t.targetSha256} ~ '^[a-f0-9]{64}$' and ${t.textSha256} ~ '^[a-f0-9]{64}$' and ${t.playbackSha256} ~ '^[a-f0-9]{64}$' and ${t.requestSha256} ~ '^[a-f0-9]{64}$'`),
  check("reference_review_decision_checks", sql`(jsonb_typeof(${t.checks}) = 'object' and ${t.checks} ?& array['privacy','listening','exactText','musicalAccuracy','rights'] and ${t.checks} - array['privacy','listening','exactText','musicalAccuracy','rights'] = '{}'::jsonb and ${t.checks}->>'privacy' in ('pass','hold') and ${t.checks}->>'listening' in ('pass','hold') and ${t.checks}->>'exactText' in ('pass','hold') and ${t.checks}->>'musicalAccuracy' in ('pass','hold') and ${t.checks}->>'rights' in ('pass','hold')) is true`),
]);
