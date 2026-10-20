import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { assignment, contextMode, guardian, membership, role, roleGrant, student, studentIdentity, tenant } from "./tenant-schema";
import type { HonorsContext, HonorsForm } from "../../lib/honors/types";
export const honorsVersion = pgTable("honors_version", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  assignmentId: uuid("assignment_id"), version: integer("version").notNull(), baseVersion: integer("base_version").notNull(), previousVersion: integer("previous_version"),
  form: jsonb("form").$type<HonorsForm>().notNull(), reviewedContext: jsonb("reviewed_context").$type<HonorsContext>().notNull(), contextHash: text("context_hash").notNull(),
  actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(),
  guardianId: uuid("guardian_id"), studentIdentityId: uuid("student_identity_id"), role: role("role").notNull(), mode: contextMode("mode").notNull(), mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("honors_version_stream_key").on(t.tenantId, t.studentId, t.version),
  unique("honors_version_receipt_key").on(t.tenantId, t.studentId, t.mutationId),
  foreignKey({ name: "honors_version_previous_fk", columns: [t.tenantId, t.studentId, t.previousVersion], foreignColumns: [t.tenantId, t.studentId, t.version] }),
  foreignKey({ name: "honors_version_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "honors_version_assignment_fk", columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
  foreignKey({ name: "honors_version_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "honors_version_grant_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "honors_version_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "honors_version_guardian_fk", columns: [t.tenantId, t.guardianId, t.studentId, t.roleGrantId], foreignColumns: [guardian.tenantId, guardian.id, guardian.studentId, guardian.parentGrantId] }),
  foreignKey({ name: "honors_version_student_identity_fk", columns: [t.tenantId, t.studentIdentityId, t.studentId, t.roleGrantId], foreignColumns: [studentIdentity.tenantId, studentIdentity.id, studentIdentity.studentId, studentIdentity.roleGrantId] }),
  check("honors_version_versions", sql`${t.version} > 0 and ${t.baseVersion} >= 0 and ${t.version}::bigint = ${t.baseVersion}::bigint + 1 and ((${t.baseVersion}=0 and ${t.previousVersion} is null) or (${t.baseVersion}>0 and ${t.previousVersion}=${t.baseVersion} and ${t.previousVersion} is not null))`),
  check("honors_version_author", sql`${t.mode}::text=${t.role}::text and ((${t.mode}='parent' and ${t.guardianId} is not null and ${t.studentIdentityId} is null) or (${t.mode}='admin' and ${t.guardianId} is null and ${t.studentIdentityId} is null) or (${t.mode}='student' and ${t.guardianId} is null and ${t.studentIdentityId} is not null))`),
  check("honors_version_hashes", sql`${t.contextHash} ~ '^[a-f0-9]{64}$' and ${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
  check("honors_version_form", sql`public.portal_honors_form_valid(${t.form})`),
  check("honors_version_context", sql`public.portal_honors_context_valid(${t.reviewedContext}, ${t.tenantId}, ${t.studentId}, ${t.assignmentId})`),
  check("honors_version_mappings", sql`public.portal_honors_mappings_valid(${t.form}, ${t.reviewedContext})`),
  check("honors_version_instant", sql`isfinite(${t.createdAt})`),
]);
