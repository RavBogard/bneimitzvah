import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { assignment, contextMode, membership, role, roleGrant, student, tenant } from "./tenant-schema";
import type { RelatedSourceMetadata } from "../study/sources/metadata";

export const verseSourceAssignment = pgTable("verse_source_assignment", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(), assignmentRevision: integer("assignment_revision").notNull(), verseRef: text("verse_ref").notNull(),
  version: integer("version").notNull(), baseVersion: integer("base_version").notNull(), previousVersion: integer("previous_version"),
  citations: jsonb("citations").$type<readonly RelatedSourceMetadata[]>().notNull(),
  actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(),
  role: role("role").notNull(), mode: contextMode("mode").notNull(), mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("verse_source_assignment_stream_key").on(t.tenantId, t.studentId, t.assignmentId, t.assignmentRevision, t.verseRef, t.version),
  unique("verse_source_assignment_receipt_key").on(t.tenantId, t.studentId, t.actorUserId, t.mutationId),
  foreignKey({ name: "verse_source_assignment_previous_fk", columns: [t.tenantId, t.studentId, t.assignmentId, t.assignmentRevision, t.verseRef, t.previousVersion], foreignColumns: [t.tenantId, t.studentId, t.assignmentId, t.assignmentRevision, t.verseRef, t.version] }),
  foreignKey({ name: "verse_source_assignment_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "verse_source_assignment_reading_fk", columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
  foreignKey({ name: "verse_source_assignment_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "verse_source_assignment_grant_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "verse_source_assignment_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("verse_source_assignment_versions", sql`${t.version} > 0 and ${t.baseVersion} >= 0 and ${t.version}::bigint = ${t.baseVersion}::bigint + 1 and ${t.assignmentRevision} > 0 and ((${t.baseVersion}=0 and ${t.previousVersion} is null) or (${t.baseVersion}>0 and ${t.previousVersion} is not null and ${t.previousVersion}=${t.baseVersion}))`),
  check("verse_source_assignment_citations", sql`public.portal_source_citations_valid(${t.citations})`),
  check("verse_source_assignment_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
  check("verse_source_assignment_ref", sql`octet_length(${t.verseRef}) <= 100 and ${t.verseRef} ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'`),
  check("verse_source_assignment_staff", sql`${t.mode}::text=${t.role}::text and ${t.mode} in ('admin','tutor')`),
  check("verse_source_assignment_instant", sql`isfinite(${t.createdAt})`),
]);
