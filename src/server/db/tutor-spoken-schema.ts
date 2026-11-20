import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { assignment, membership, student, tenant } from "./tenant-schema";

export const tutorSpoken = pgTable("tutor_spoken", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(), startVerse: text("start_verse").notNull(), endVerse: text("end_verse").notNull(), verseDigest: text("verse_digest").notNull(),
  creatorMembershipId: uuid("creator_membership_id").notNull(), blobPath: text("blob_path"), mediaType: text("media_type").notNull(), byteLength: integer("byte_length").notNull(),
  revision: integer("revision").notNull().default(1), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique("tutor_spoken_tenant_key").on(t.tenantId, t.id), unique("tutor_spoken_aliyah_key").on(t.tenantId, t.assignmentId, t.startVerse),
  foreignKey({ name: "tutor_spoken_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "tutor_spoken_assignment_fk", columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
  foreignKey({ name: "tutor_spoken_creator_fk", columns: [t.tenantId, t.creatorMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  check("tutor_spoken_shape", sql`${t.revision} > 0 and ${t.byteLength} between 16 and 3145728 and ${t.verseDigest} ~ '^[a-f0-9]{64}$' and ${t.mediaType} in ('audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav') and (${t.blobPath} is null or ${t.blobPath} ~ '^tutor-spoken/[a-f0-9-]{36}$')`),
]);
/** A failed provider deletion remains retryable without exposing its obsolete blob. */
export const tutorSpokenCleanup = pgTable("tutor_spoken_cleanup", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(), blobPath: text("blob_path").primaryKey(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [foreignKey({ name: "tutor_spoken_cleanup_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  check("tutor_spoken_cleanup_path", sql`${t.blobPath} ~ '^tutor-spoken/[a-f0-9-]{36}$'`)]);
