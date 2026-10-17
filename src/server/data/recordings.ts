import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import type { PracticeActor } from "../practice/types";
import type { VerifiedRecordingDescriptor } from "../recordings/validation";
import * as s from "../db/index";

export type RecordingActor = StudentActor | PracticeActor;
export type RecordingRow = typeof s.studentRecording.$inferSelect;
const t = s.studentRecording;
const scope = (actor: RecordingActor) => and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId));
export const staff = (actor: RecordingActor) => actor.mode === "tutor" || actor.mode === "admin";
function visible(actor: RecordingActor, due: boolean) {
  if (due) return sql`false`;
  return staff(actor) ? eq(t.state, "submitted") : or(eq(t.state, "private"), eq(t.state, "submitted"));
}
export async function cursor<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, id: string, due: boolean) {
  const [row] = await tx.select().from(t).where(and(scope(actor), eq(t.id, id), visible(actor, due))).for("share");
  return row ?? null;
}
export async function page<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, due: boolean, after?: RecordingRow) {
  const time = staff(actor) ? t.submittedAt : t.createdAt, previous = after && (staff(actor) ? after.submittedAt! : after.createdAt);
  return tx.select().from(t).where(and(scope(actor), visible(actor, due), after && previous ? or(lt(time, previous), and(eq(time, previous), lt(t.id, after.id))) : undefined))
    .orderBy(desc(time), desc(t.id)).limit(51).for("share");
}
export async function lock<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, id: string) {
  const [row] = await tx.select().from(t).where(and(scope(actor), eq(t.id, id))).for("update"); return row ?? null;
}
export async function asset<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, assetId: string) {
  const [row] = await tx.select().from(t).where(and(scope(actor), eq(t.assetId, assetId))).for("update"); return row ?? null;
}
export async function insert<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, descriptor: VerifiedRecordingDescriptor, createdAt: Date) {
  return insertWithId(tx, actor, randomUUID(), descriptor, createdAt);
}
/** Internal trusted composition only; an ID supplies no authority. */
export async function insertWithId<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, id: string, descriptor: VerifiedRecordingDescriptor, createdAt: Date) {
  const [row] = await tx.insert(t).values({ id, tenantId: actor.tenantId, studentId: actor.studentId, assetId: descriptor.assetId,
    contentSha256: descriptor.contentSha256, ...descriptor.media, state: "private", revision: 1, createdAt }).onConflictDoNothing().returning();
  return row ?? null;
}
export async function transition<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, row: RecordingRow, state: "submitted" | "deleting", instant: Date) {
  const [changed] = await tx.update(t).set({ state, revision: row.revision + 1, ...(state === "submitted" ? { submittedAt: instant } : { deletionRequestedAt: instant }) })
    .where(and(scope(actor), eq(t.id, row.id), eq(t.revision, row.revision), eq(t.state, row.state))).returning();
  return changed ?? null;
}
export async function audit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: RecordingActor, action: "create" | "submit" | "delete-request", id: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: actor.mode, actingStudentId: actor.studentId, guardianId: actor.mode === "child-practice" ? actor.relationshipId : null,
    action: `recording.${action}`, targetType: "student_recording", targetId: id, requestId: randomUUID() });
}
