import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { student, tenant } from "./tenant-schema";

const instant = (name: string) => timestamp(name, { withTimezone: true });
// Provider-disabled persistence only. These rows grant no upload capability.
export const recordingAdmission = pgTable("recording_admission", {
  tenantId: text("tenant_id").primaryKey().references(() => tenant.id),
});
export const recordingReceipt = pgTable("recording_receipt", {
  id: uuid("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  requestId: uuid("request_id").notNull(), originalRecordingId: uuid("original_recording_id").notNull(), assetId: uuid("asset_id").notNull(), storeGeneration: text("store_generation").notNull(),
  actorUserId: text("actor_user_id").notNull(), authSessionId: text("auth_session_id").notNull(), membershipId: uuid("membership_id").notNull(),
  membershipAuthorityRevision: integer("membership_authority_revision").notNull(), roleGrantId: uuid("role_grant_id").notNull(), roleGrantRevision: integer("role_grant_revision").notNull(),
  mode: text("mode").$type<"student" | "child-practice">().notNull(), relationshipId: uuid("relationship_id").notNull(), relationshipRevision: integer("relationship_revision"),
  contextId: uuid("context_id"), contextAuthorityRevision: integer("context_authority_revision"), contextStudentRevision: integer("context_student_revision"), studentRevision: integer("student_revision").notNull(),
  sessionExpiresAt: instant("session_expires_at").notNull(), contextExpiresAt: instant("context_expires_at"),
  declaredBytes: integer("declared_bytes").notNull(), slotCount: integer("slot_count").notNull(), admittedAt: instant("admitted_at").default(sql`clock_timestamp()`).notNull(),
  state: text("state").$type<"receiving" | "retiring" | "terminal">().notNull(), revision: bigint("revision", { mode: "bigint" }).notNull(),
  retiringAt: instant("retiring_at"), terminalAt: instant("terminal_at"), terminalReason: text("terminal_reason"),
  retentionCeremonyDate: date("retention_ceremony_date").notNull(), retentionLatchedAt: instant("retention_latched_at"), logicalTakeReleased: boolean("logical_take_released").default(false).notNull(),
}, t => [
  unique("recording_receipt_tenant_id_key").on(t.tenantId, t.id), unique("recording_receipt_request_key").on(t.tenantId, t.studentId, t.requestId),
  unique("recording_receipt_original_key").on(t.originalRecordingId), unique("recording_receipt_asset_key").on(t.assetId),
  foreignKey({ name: "recording_receipt_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  index("recording_receipt_student_idx").on(t.tenantId, t.studentId, t.admittedAt), index("recording_receipt_actor_idx").on(t.tenantId, t.actorUserId, t.admittedAt),
  check("recording_receipt_text", sql.raw("length(store_generation) BETWEEN 1 AND 64 AND store_generation !~ '[[:cntrl:]]' AND length(actor_user_id) BETWEEN 1 AND 256 AND actor_user_id !~ '[[:cntrl:]]' AND length(auth_session_id) BETWEEN 1 AND 256 AND auth_session_id !~ '[[:cntrl:]]'")),
  check("recording_receipt_declaration", sql.raw("declared_bytes BETWEEN 46 AND 28800044 AND declared_bytes % 2 = 0 AND slot_count BETWEEN 1 AND 28 AND slot_count = (declared_bytes + 1048575) / 1048576")),
  check("recording_receipt_revisions", sql.raw("revision > 0 AND membership_authority_revision > 0 AND role_grant_revision > 0 AND student_revision > 0 AND (relationship_revision IS NULL OR relationship_revision > 0) AND (context_authority_revision IS NULL OR context_authority_revision > 0) AND (context_student_revision IS NULL OR context_student_revision > 0)")),
  check("recording_receipt_binding", sql.raw("(mode = 'student' AND relationship_revision IS NULL AND context_id IS NULL AND context_authority_revision IS NULL AND context_student_revision IS NULL AND context_expires_at IS NULL) OR (mode = 'child-practice' AND relationship_revision IS NOT NULL AND context_id IS NOT NULL AND context_authority_revision IS NOT NULL AND context_student_revision IS NOT NULL AND context_student_revision = student_revision AND context_expires_at IS NOT NULL)")),
  check("recording_receipt_instants", sql.raw("isfinite(admitted_at) AND isfinite(session_expires_at) AND session_expires_at > admitted_at AND (context_expires_at IS NULL OR (isfinite(context_expires_at) AND context_expires_at > admitted_at AND context_expires_at <= session_expires_at)) AND (retiring_at IS NULL OR (isfinite(retiring_at) AND retiring_at >= admitted_at)) AND (terminal_at IS NULL OR (isfinite(terminal_at) AND retiring_at IS NOT NULL AND terminal_at >= retiring_at)) AND (retention_latched_at IS NULL OR (isfinite(retention_latched_at) AND retention_latched_at >= admitted_at)) AND isfinite(retention_ceremony_date)")),
  check("recording_receipt_lifecycle", sql.raw("(state = 'receiving' AND retiring_at IS NULL AND terminal_at IS NULL AND terminal_reason IS NULL AND retention_latched_at IS NULL AND NOT logical_take_released) OR (state = 'retiring' AND retiring_at IS NOT NULL AND terminal_at IS NULL AND terminal_reason IS NULL AND NOT logical_take_released) OR (state = 'terminal' AND retiring_at IS NOT NULL AND terminal_at IS NOT NULL AND terminal_reason IS NOT NULL AND terminal_reason = 'never-opened' AND logical_take_released)")),
]);
export const recordingReceiptSlot = pgTable("recording_receipt_slot", {
  tenantId: text("tenant_id").notNull(), receiptId: uuid("receipt_id").notNull(), slotIndex: integer("slot_index").notNull(), objectKey: text("object_key").notNull(), expectedBytes: integer("expected_bytes").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(), state: text("state").$type<"reserved" | "prepared" | "opened" | "retiring" | "never-opened">().notNull(),
  everUploadOpened: boolean("ever_upload_opened").default(false).notNull(), audioLiabilityReleased: boolean("audio_liability_released").default(false).notNull(),
  bodySha256: text("body_sha256"), permitEtag: text("permit_etag"), openOperationId: uuid("open_operation_id"), openedAt: instant("opened_at"),
}, t => [
  primaryKey({ name: "recording_receipt_slot_pk", columns: [t.tenantId, t.receiptId, t.slotIndex] }), unique("recording_receipt_slot_object_key").on(t.objectKey), unique("recording_receipt_slot_operation_key").on(t.openOperationId),
  foreignKey({ name: "recording_receipt_slot_head_fk", columns: [t.tenantId, t.receiptId], foreignColumns: [recordingReceipt.tenantId, recordingReceipt.id] }),
  check("recording_receipt_slot_length", sql.raw("slot_index BETWEEN 0 AND 27 AND expected_bytes BETWEEN 2 AND 1048576 AND expected_bytes % 2 = 0 AND revision > 0")),
  check("recording_receipt_slot_preparation", sql.raw(`(body_sha256 IS NULL AND permit_etag IS NULL) OR (body_sha256 IS NOT NULL AND body_sha256 ~ '^[a-f0-9]{64}$' AND permit_etag IS NOT NULL AND length(permit_etag) BETWEEN 3 AND 256 AND permit_etag ~ '^"[!-!#-~]+"$')`)),
  check("recording_receipt_slot_opening", sql.raw("(NOT ever_upload_opened AND open_operation_id IS NULL AND opened_at IS NULL) OR (ever_upload_opened AND body_sha256 IS NOT NULL AND permit_etag IS NOT NULL AND open_operation_id IS NOT NULL AND opened_at IS NOT NULL AND isfinite(opened_at))")),
  check("recording_receipt_slot_lifecycle", sql.raw("(state = 'reserved' AND body_sha256 IS NULL AND NOT ever_upload_opened AND NOT audio_liability_released) OR (state = 'prepared' AND body_sha256 IS NOT NULL AND NOT ever_upload_opened AND NOT audio_liability_released) OR (state = 'opened' AND ever_upload_opened AND NOT audio_liability_released) OR (state = 'retiring' AND NOT audio_liability_released) OR (state = 'never-opened' AND NOT ever_upload_opened AND audio_liability_released)")),
]);
