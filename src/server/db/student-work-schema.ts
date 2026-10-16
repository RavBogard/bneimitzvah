import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { assignment, contextMode, guardian, membership, role, roleGrant, student, studentIdentity, tenant } from "./tenant-schema";

function workTable(name: "translation_draft" | "tutor_note") {
  return pgTable(name, {
    id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
    studentId: uuid("student_id").notNull(), verseRef: text("verse_ref").notNull(), version: integer("version").notNull(),
    assignmentId: uuid("assignment_id").notNull(), assignmentRevision: integer("assignment_revision").notNull(),
    text: text("text").notNull(), actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(),
    roleGrantId: uuid("role_grant_id").notNull(), role: role("role").notNull(), mode: contextMode("mode").notNull(),
    guardianId: uuid("guardian_id"), contextId: uuid("context_id"), studentIdentityId: uuid("student_identity_id"),
    mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(), baseVersion: integer("base_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }, t => [
    unique(`${name}_stream_key`).on(t.tenantId, t.studentId, t.verseRef, t.version),
    unique(`${name}_receipt_key`).on(t.tenantId, t.studentId, t.actorUserId, t.mutationId),
    foreignKey({ name: `${name}_student_fk`, columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
    foreignKey({ name: `${name}_assignment_fk`, columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
    foreignKey({ name: `${name}_actor_fk`, columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
    foreignKey({ name: `${name}_grant_fk`, columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
    foreignKey({ name: `${name}_role_fk`, columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
    foreignKey({ name: `${name}_guardian_fk`, columns: [t.tenantId, t.guardianId, t.studentId, t.roleGrantId], foreignColumns: [guardian.tenantId, guardian.id, guardian.studentId, guardian.parentGrantId] }),
    foreignKey({ name: `${name}_identity_fk`, columns: [t.tenantId, t.studentIdentityId, t.studentId, t.roleGrantId], foreignColumns: [studentIdentity.tenantId, studentIdentity.id, studentIdentity.studentId, studentIdentity.roleGrantId] }),
    check(`${name}_versions`, sql`${t.version} > 0 and ${t.baseVersion} >= 0 and ${t.version} = ${t.baseVersion} + 1 and ${t.assignmentRevision} > 0`),
    check(`${name}_text_bound`, sql`octet_length(${t.text}) <= 4096 and translate(${t.text}, chr(9) || chr(10), '') !~ '[[:cntrl:]]'`),
    check(`${name}_digest`, sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
    check(`${name}_ref`, sql`${t.verseRef} ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'`),
    check(`${name}_mode`, name === "translation_draft"
      ? sql`(${t.mode} = 'student' and ${t.role} = 'student' and ${t.studentIdentityId} is not null and ${t.guardianId} is null and ${t.contextId} is null) or (${t.mode} = 'child-practice' and ${t.role} = 'parent' and ${t.guardianId} is not null and ${t.contextId} is not null and ${t.studentIdentityId} is null)`
      : sql`${t.mode}::text = ${t.role}::text and ${t.mode} in ('admin','tutor') and ${t.guardianId} is null and ${t.contextId} is null and ${t.studentIdentityId} is null and length(trim(${t.text})) > 0`),
  ]);
}
export const translationDraft = workTable("translation_draft");
export const tutorNote = workTable("tutor_note");
