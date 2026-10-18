import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { guardian, membership, role, roleGrant, student, tenant } from "./tenant-schema";
import { honorsVersion } from "./honors-schema";
import { serviceCatalog } from "./service-learning-schema";
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);
const epoch = () => bigint("epoch", { mode: "bigint" }).notNull().default(sql`0`);
export const honoreeReadingEpoch = pgTable("honoree_reading_epoch", {
  tenantId: tenantId(), studentId: uuid("student_id").notNull(), epoch: epoch(),
}, t => [unique("honoree_reading_epoch_key").on(t.tenantId, t.studentId),
  foreignKey({ name: "honoree_reading_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  check("honoree_reading_epoch_positive", sql`${t.epoch} >= 0`)]);
export const honoreeGroupEpoch = pgTable("honoree_group_epoch", {
  tenantId: tenantId(), studentId: uuid("student_id").notNull(), startVerse: text("start_verse").notNull(), epoch: epoch(),
}, t => [unique("honoree_group_epoch_key").on(t.tenantId, t.studentId, t.startVerse),
  foreignKey({ name: "honoree_group_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  check("honoree_group_epoch_positive", sql`${t.epoch} >= 0`), check("honoree_group_start", sql`length(${t.startVerse}) between 1 and 80 and ${t.startVerse} ~ '^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$'`)]);
export const honoreeMaterialRelease = pgTable("honoree_material_release", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), catalogId: uuid("catalog_id").notNull(), catalogIdentity: text("catalog_identity").notNull(),
  slot: text("slot").$type<"morning" | "havdalah">().notNull(), beforeId: text("before_id").notNull(), afterId: text("after_id").notNull(),
  materialVersion: text("material_version").notNull(), projectionDigest: text("projection_digest").notNull(),
  approvalBasis: text("approval_basis").notNull(), notices: jsonb("notices").$type<readonly string[]>().notNull(),
  state: text("state").$type<"active" | "withdrawn">().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("honoree_material_tenant_key").on(t.tenantId, t.id), uniqueIndex("honoree_material_active_slot").on(t.tenantId, t.slot).where(sql`${t.state}='active'`),
  foreignKey({ name: "honoree_material_catalog_fk", columns: [t.tenantId, t.catalogId, t.catalogIdentity], foreignColumns: [serviceCatalog.tenantId, serviceCatalog.id, serviceCatalog.identity] }),
  check("honoree_material_shape", sql`${t.state} in ('active','withdrawn') and ${t.slot} in ('morning','havdalah') and ${t.projectionDigest} ~ '^[a-f0-9]{64}$' and ${t.catalogIdentity} ~ '^[a-f0-9]{64}$' and length(${t.materialVersion}) between 1 and 128 and octet_length(${t.approvalBasis}) between 1 and 4096 and isfinite(${t.createdAt})`),
  check("honoree_material_units", sql`${t.beforeId}='torah.blessing-before-the-torah-reading@'||case when ${t.slot}='morning' then 'bm-shacharit' else 'bm-maariv' end and ${t.afterId}='torah.blessing-following-the-torah-reading@'||case when ${t.slot}='morning' then 'bm-shacharit' else 'bm-maariv' end`),
  check("honoree_material_notices", sql`public.portal_honoree_notices_valid(${t.notices})`)]);
const attribution = () => ({ actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(), guardianId: uuid("guardian_id"), role: role("role").$type<"parent" | "admin">().notNull() });
export const honoreeLink = pgTable("honoree_link", {
  id: text("id").primaryKey(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), startVerse: text("start_verse").notNull(),
  readingEpoch: bigint("reading_epoch", { mode: "bigint" }).notNull(), groupEpoch: bigint("group_epoch", { mode: "bigint" }).notNull(), honorsVersion: integer("honors_version").notNull(), contextHash: text("context_hash").notNull(),
  materialReleaseId: uuid("material_release_id").notNull(), ...attribution(), tokenHash: text("token_hash").notNull(), keyId: text("key_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [unique("honoree_link_tenant_key").on(t.tenantId, t.id), unique("honoree_link_student_key").on(t.tenantId, t.studentId, t.id), uniqueIndex("honoree_link_one_current").on(t.tenantId, t.studentId, t.startVerse).where(sql`${t.revokedAt} is null`),
  foreignKey({ name: "honoree_link_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "honoree_link_group_fk", columns: [t.tenantId, t.studentId, t.startVerse], foreignColumns: [honoreeGroupEpoch.tenantId, honoreeGroupEpoch.studentId, honoreeGroupEpoch.startVerse] }),
  foreignKey({ name: "honoree_link_reading_fk", columns: [t.tenantId, t.studentId], foreignColumns: [honoreeReadingEpoch.tenantId, honoreeReadingEpoch.studentId] }),
  foreignKey({ name: "honoree_link_honors_fk", columns: [t.tenantId, t.studentId, t.honorsVersion], foreignColumns: [honorsVersion.tenantId, honorsVersion.studentId, honorsVersion.version] }),
  foreignKey({ name: "honoree_link_material_fk", columns: [t.tenantId, t.materialReleaseId], foreignColumns: [honoreeMaterialRelease.tenantId, honoreeMaterialRelease.id] }),
  foreignKey({ name: "honoree_link_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "honoree_link_grant_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "honoree_link_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "honoree_link_guardian_fk", columns: [t.tenantId, t.guardianId, t.studentId, t.roleGrantId], foreignColumns: [guardian.tenantId, guardian.id, guardian.studentId, guardian.parentGrantId] }),
  check("honoree_link_shape", sql`${t.id} ~ '^[A-Za-z0-9_-]{22}$' and ${t.contextHash} ~ '^[a-f0-9]{64}$' and ${t.tokenHash} ~ '^[a-f0-9]{64}$' and ${t.keyId}='k1' and ${t.readingEpoch}>=0 and ${t.groupEpoch}>=0 and ${t.honorsVersion}>0 and ((${t.role}='parent' and ${t.guardianId} is not null) or (${t.role}='admin' and ${t.guardianId} is null))`),
  check("honoree_link_instants", sql`isfinite(${t.issuedAt}) and isfinite(${t.expiresAt}) and ${t.expiresAt}>${t.issuedAt} and ${t.expiresAt}<=${t.issuedAt}+interval '2160 hours' and (${t.revokedAt} is null or isfinite(${t.revokedAt}) and ${t.revokedAt}>=${t.issuedAt})`)]);
export const honoreeOperation = pgTable("honoree_operation", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(),
  operation: text("operation").$type<"issue" | "revoke" | "reissue">().notNull(), linkId: text("link_id").notNull(), ...attribution(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("honoree_operation_uuid").on(t.tenantId, t.studentId, t.mutationId),
  foreignKey({ name: "honoree_operation_link_fk", columns: [t.tenantId, t.studentId, t.linkId], foreignColumns: [honoreeLink.tenantId, honoreeLink.studentId, honoreeLink.id] }),
  foreignKey({ name: "honoree_operation_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "honoree_operation_grant_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "honoree_operation_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "honoree_operation_guardian_fk", columns: [t.tenantId, t.guardianId, t.studentId, t.roleGrantId], foreignColumns: [guardian.tenantId, guardian.id, guardian.studentId, guardian.parentGrantId] }),
  check("honoree_operation_shape", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$' and ${t.operation} in ('issue','revoke','reissue') and ((${t.role}='parent' and ${t.guardianId} is not null) or (${t.role}='admin' and ${t.guardianId} is null)) and isfinite(${t.createdAt})`)]);
