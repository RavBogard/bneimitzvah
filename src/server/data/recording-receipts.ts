import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { RecordingActor } from "./recordings";
import * as s from "../db/index";
const h = s.recordingReceipt, slot = s.recordingReceiptSlot, ledger = s.studentRecording;
export type ReceiptRow = typeof h.$inferSelect;
export type SlotRow = typeof slot.$inferSelect;
export type Binding = Pick<ReceiptRow, "actorUserId" | "authSessionId" | "membershipId" | "membershipAuthorityRevision" | "roleGrantId" | "roleGrantRevision" | "mode" | "relationshipId" | "relationshipRevision" | "contextId" | "contextAuthorityRevision" | "contextStudentRevision" | "studentRevision" | "sessionExpiresAt" | "contextExpiresAt">;
const scope = (actor: RecordingActor) => and(eq(h.tenantId, actor.tenantId), eq(h.studentId, actor.studentId));
export async function mutex<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, fresh: () => unknown) {
  await tx.insert(s.recordingAdmission).values({ tenantId }).onConflictDoNothing(); fresh();
  const rows = await tx.select().from(s.recordingAdmission).where(eq(s.recordingAdmission.tenantId, tenantId)).for("update"); fresh();
  if (rows.length !== 1) throw new Error("Receipt admission unavailable");
}
export async function clock<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>) { const [row] = await tx.select({ instant: sql<string>`instant` }).from(sql`(SELECT clock_timestamp()::text AS instant) receipt_clock`); return row.instant; }
export async function request<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, requestId: string) { const [row] = await tx.select().from(h).where(and(scope(actor), eq(h.requestId, requestId))); return row ?? null; }
export async function lock<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, studentId?: string) { const [row] = await tx.select().from(h).where(and(eq(h.tenantId, tenantId), eq(h.id, id), studentId ? eq(h.studentId, studentId) : undefined)).for("update"); return row ?? null; }
export async function hint<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string) { const [row] = await tx.select().from(h).where(and(eq(h.tenantId, tenantId), eq(h.id, id))); return row ?? null; }
export async function slots<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: ReceiptRow) { return tx.select().from(slot).where(and(eq(slot.tenantId, row.tenantId), eq(slot.receiptId, row.id))).orderBy(asc(slot.slotIndex)).for("update"); }
export async function collision<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, id: string, assetId: string) { const rows = await tx.select({ id: ledger.id }).from(ledger).where(or(eq(ledger.id, id), eq(ledger.assetId, assetId))).limit(1); return rows.length !== 0; }
/** Immutable reservation lookup under admission; no head lock or adoption. */
export async function reserved<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, assetId: string) {
  const rows = await tx.select({ id: h.id }).from(h).where(and(eq(h.tenantId, tenantId), or(eq(h.originalRecordingId, id), eq(h.assetId, assetId)))).limit(1);
  return rows.length !== 0;
}
// A collision is a refusal, never adoption. At most ONE present ledger row is
// locked, preserving the maintenance one-logical-head ordering even if corrupt
// external provenance collides with two distinct immutable ledger identities.
export async function existingLedger<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: ReceiptRow) { const rows = await tx.select({ id: ledger.id }).from(ledger).where(and(eq(ledger.tenantId, row.tenantId), or(eq(ledger.id, row.originalRecordingId), eq(ledger.assetId, row.assetId)))).limit(1).for("update"); return rows.length !== 0; }
export function identities() { return { id: randomUUID(), originalRecordingId: randomUUID(), assetId: randomUUID() }; }
export async function insert<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, values: typeof h.$inferInsert) { const [row] = await tx.insert(h).values(values).returning(); return row; }
export async function insertSlots<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: ReceiptRow) {
  return tx.insert(slot).values(Array.from({ length: row.slotCount }, (_, slotIndex) => ({ tenantId: row.tenantId, receiptId: row.id, slotIndex,
    objectKey: `recordings/v1/${row.assetId}/chunk-${String(slotIndex).padStart(2, "0")}`, expectedBytes: Math.min(1048576, row.declaredBytes - slotIndex * 1048576), state: "reserved" as const, revision: 1n }))).returning();
}
export async function prepare<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: SlotRow, bodySha256: string, permitEtag: string) { const [changed] = await tx.update(slot).set({ state: "prepared", revision: row.revision + 1n, bodySha256, permitEtag }).where(and(eq(slot.tenantId, row.tenantId), eq(slot.receiptId, row.receiptId), eq(slot.slotIndex, row.slotIndex), eq(slot.revision, row.revision), eq(slot.state, "reserved"))).returning(); return changed ?? null; }
export async function open<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: SlotRow) { const [changed] = await tx.update(slot).set({ state: "opened", revision: row.revision + 1n, everUploadOpened: true, openOperationId: randomUUID(), openedAt: sql`clock_timestamp()` }).where(and(eq(slot.tenantId, row.tenantId), eq(slot.receiptId, row.receiptId), eq(slot.slotIndex, row.slotIndex), eq(slot.revision, row.revision), eq(slot.state, "prepared"), eq(slot.everUploadOpened, false))).returning(); return changed ?? null; }
export async function retire<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: ReceiptRow, due: boolean) {
  const [changed] = await tx.update(h).set({ state: "retiring", revision: row.revision + 1n, retiringAt: sql`greatest(clock_timestamp(),${h.admittedAt})`, ...(due && !row.retentionLatchedAt ? { retentionLatchedAt: sql`greatest(clock_timestamp(),${h.admittedAt})` } : {}) }).where(and(eq(h.tenantId, row.tenantId), eq(h.id, row.id), eq(h.revision, row.revision), eq(h.state, "receiving"))).returning();
  return changed ?? null;
}
export async function retireSlots<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: ReceiptRow) { return tx.update(slot).set({ state: "retiring", revision: sql`${slot.revision}+1` }).where(and(eq(slot.tenantId, row.tenantId), eq(slot.receiptId, row.id), or(eq(slot.state, "reserved"), eq(slot.state, "prepared"), eq(slot.state, "opened")))).returning(); }
export async function terminal<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: ReceiptRow) {
  const [changed] = await tx.update(h).set({ state: "terminal", revision: row.revision + 1n, terminalAt: sql`greatest(clock_timestamp(),${h.retiringAt})`, terminalReason: "never-opened", logicalTakeReleased: true }).where(and(eq(h.tenantId, row.tenantId), eq(h.id, row.id), eq(h.revision, row.revision), eq(h.state, "retiring"))).returning(); return changed ?? null;
}
export async function closeSlots<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: ReceiptRow) { return tx.update(slot).set({ state: "never-opened", revision: sql`${slot.revision}+1`, audioLiabilityReleased: true }).where(and(eq(slot.tenantId, row.tenantId), eq(slot.receiptId, row.id), eq(slot.state, "retiring"), eq(slot.everUploadOpened, false))).returning(); }

// Exact primary-data aggregates under the common application-writer mutex.
// This is not a restriction on arbitrary privileged SQL INSERTs.
export async function aggregates<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, instant: string, fresh: () => unknown) {
  const student = sql`${h.studentId}=${actor.studentId}`, user = sql`${h.actorUserId}=${actor.userId}`, hour = sql`${h.admittedAt}>${instant}::timestamptz-interval '1 hour' AND ${h.admittedAt}<=${instant}::timestamptz`, day = sql`${h.admittedAt}>${instant}::timestamptz-interval '24 hours' AND ${h.admittedAt}<=${instant}::timestamptz`;
  const [r] = await tx.select({
    studentActive: sql<string>`count(*) FILTER(WHERE ${student} AND ${h.state}='receiving')::text`, actorActive: sql<string>`count(*) FILTER(WHERE ${user} AND ${h.state}='receiving')::text`, tenantActive: sql<string>`count(*) FILTER(WHERE ${h.state}='receiving')::text`,
    studentHour: sql<string>`count(*) FILTER(WHERE ${student} AND ${hour})::text`, actorHour: sql<string>`count(*) FILTER(WHERE ${user} AND ${hour})::text`, tenantHour: sql<string>`count(*) FILTER(WHERE ${hour})::text`,
    studentDay: sql<string>`count(*) FILTER(WHERE ${student} AND ${day})::text`, actorDay: sql<string>`count(*) FILTER(WHERE ${user} AND ${day})::text`, tenantDay: sql<string>`count(*) FILTER(WHERE ${day})::text`,
    studentTakes: sql<string>`count(*) FILTER(WHERE ${student} AND NOT ${h.logicalTakeReleased})::text`, tenantTakes: sql<string>`count(*) FILTER(WHERE NOT ${h.logicalTakeReleased})::text`,
  }).from(h).where(eq(h.tenantId, actor.tenantId)); fresh();
  const [b] = await tx.select({
    studentBytes: sql<string>`coalesce(sum(${slot.expectedBytes}) FILTER(WHERE ${student} AND NOT ${slot.audioLiabilityReleased}),0)::text`,
    tenantBytes: sql<string>`coalesce(sum(${slot.expectedBytes}) FILTER(WHERE NOT ${slot.audioLiabilityReleased}),0)::text`,
    // Immutable slot identities retain a separate 64-byte marker allowance even
    // after terminal audio/logical release. This is not part of the audio cap.
    studentMarkerBytes: sql<string>`(count(*) FILTER(WHERE ${student}) * 64)::text`, tenantMarkerBytes: sql<string>`(count(*) * 64)::text`,
  }).from(slot).innerJoin(h, and(eq(h.tenantId, slot.tenantId), eq(h.id, slot.receiptId))).where(eq(slot.tenantId, actor.tenantId)); fresh();
  const [l] = await tx.select({ studentBytes: sql<string>`coalesce(sum(${ledger.byteLength}) FILTER(WHERE ${ledger.studentId}=${actor.studentId}),0)::text`, tenantBytes: sql<string>`coalesce(sum(${ledger.byteLength}),0)::text`, studentTakes: sql<string>`count(*) FILTER(WHERE ${ledger.studentId}=${actor.studentId})::text`, tenantTakes: sql<string>`count(*)::text` }).from(ledger).where(eq(ledger.tenantId, actor.tenantId)); fresh();
  const [ids] = await tx.select({
    studentIds: sql<string>`(SELECT count(DISTINCT id)::text FROM (SELECT original_recording_id AS id FROM recording_receipt WHERE tenant_id=${actor.tenantId} AND student_id=${actor.studentId} UNION SELECT id FROM student_recording WHERE tenant_id=${actor.tenantId} AND student_id=${actor.studentId}) identities)`,
    tenantIds: sql<string>`(SELECT count(DISTINCT id)::text FROM (SELECT original_recording_id AS id FROM recording_receipt WHERE tenant_id=${actor.tenantId} UNION SELECT id FROM student_recording WHERE tenant_id=${actor.tenantId}) identities)`,
  }).from(sql`(SELECT 1) receipt_counts`); fresh();
  return { studentActive: BigInt(r.studentActive), actorActive: BigInt(r.actorActive), tenantActive: BigInt(r.tenantActive), studentHour: BigInt(r.studentHour), actorHour: BigInt(r.actorHour), tenantHour: BigInt(r.tenantHour), studentDay: BigInt(r.studentDay), actorDay: BigInt(r.actorDay), tenantDay: BigInt(r.tenantDay), studentBytes: BigInt(b.studentBytes)+BigInt(l.studentBytes), tenantBytes: BigInt(b.tenantBytes)+BigInt(l.tenantBytes), studentMarkerBytes: BigInt(b.studentMarkerBytes), tenantMarkerBytes: BigInt(b.tenantMarkerBytes), studentTakes: BigInt(r.studentTakes)+BigInt(l.studentTakes), tenantTakes: BigInt(r.tenantTakes)+BigInt(l.tenantTakes), studentIds: BigInt(ids.studentIds), tenantIds: BigInt(ids.tenantIds) };
}
