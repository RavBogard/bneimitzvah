import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { student, tenant } from "./tenant-schema";

export const studentRecording = pgTable("student_recording", {
  id: uuid("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  assetId: uuid("asset_id").notNull(), contentSha256: text("content_sha256").notNull(), mediaType: text("media_type").notNull(),
  byteLength: integer("byte_length").notNull(), durationMs: integer("duration_ms").notNull(), state: text("state").notNull(), revision: integer("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), submittedAt: timestamp("submitted_at", { withTimezone: true }), deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
}, t => [
  unique("student_recording_asset_key").on(t.assetId),
  foreignKey({ name: "student_recording_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  index("student_recording_creation_idx").on(t.tenantId, t.studentId, t.createdAt, t.id),
  index("student_recording_submission_idx").on(t.tenantId, t.studentId, t.submittedAt, t.id),
  check("student_recording_hash", sql`${t.contentSha256} ~ '^[a-f0-9]{64}$'`),
  check("student_recording_media", sql`${t.mediaType} in ('audio/webm;codecs=opus','audio/mp4;codecs=mp4a.40.2') and ${t.byteLength} between 1 and 33554432 and ${t.durationMs} between 1 and 600000`),
  check("student_recording_instants", sql`isfinite(${t.createdAt}) and (${t.submittedAt} is null or (isfinite(${t.submittedAt}) and ${t.submittedAt} >= ${t.createdAt})) and (${t.deletionRequestedAt} is null or (isfinite(${t.deletionRequestedAt}) and ${t.deletionRequestedAt} >= coalesce(${t.submittedAt}, ${t.createdAt})))`),
  check("student_recording_lifecycle", sql`(${t.state} = 'private' and ${t.revision} = 1 and ${t.submittedAt} is null and ${t.deletionRequestedAt} is null) or (${t.state} = 'submitted' and ${t.revision} = 2 and ${t.submittedAt} is not null and ${t.deletionRequestedAt} is null) or (${t.state} = 'deleting' and ${t.deletionRequestedAt} is not null and ((${t.revision} = 2 and ${t.submittedAt} is null) or (${t.revision} = 3 and ${t.submittedAt} is not null)))`),
]);
