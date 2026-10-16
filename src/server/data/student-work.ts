import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import type { PracticeActor } from "../practice/types";
import type { Stream, WorkSelection, WorkWrite } from "../student-work/validation";
import * as s from "../db/index";

export type WorkActor = StudentActor | PracticeActor;
const table = (stream: Stream) => stream === "draft" ? s.translationDraft : s.tutorNote;
export type WorkRow = typeof s.translationDraft.$inferSelect & { displayName: string };
export async function studentRevision<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: WorkActor) {
  const [row] = await tx.select({ revision: s.student.revision }).from(s.student).where(and(eq(s.student.tenantId, actor.tenantId), eq(s.student.id, actor.studentId)));
  if (!row) throw new Error("Work authority unavailable");
  return row.revision;
}
const displayName = (value: string) => value.includes("@") ? "Portal member"
  : Array.from(value.toWellFormed().replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim()).slice(0, 120).join("") || "Portal member";
export function view(row: WorkRow) {
  return { id: row.id, verseRef: row.verseRef, version: row.version, text: row.text,
    assignmentId: row.assignmentId, assignmentRevision: row.assignmentRevision,
    author: { membershipId: row.actorMembershipId, displayName: displayName(row.displayName), mode: row.mode, assisted: row.mode === "child-practice" }, createdAt: row.createdAt.toISOString() };
}
export async function history<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: WorkActor, stream: Stream, verseRef: string, before: number | undefined, limit: number) {
  const t = table(stream);
  const rows = await tx.select({ row: t, displayName: s.user.name }).from(t)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, t.tenantId), eq(s.membership.id, t.actorMembershipId), eq(s.membership.userId, t.actorUserId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId), eq(t.verseRef, verseRef), before === undefined ? undefined : lt(t.version, before)))
    .orderBy(desc(t.version)).limit(limit);
  return rows.map(row => ({ ...(row.row as typeof s.translationDraft.$inferSelect), displayName: row.displayName }));
}
export async function receipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: WorkActor, stream: Stream, mutationId: string) {
  const t = table(stream);
  const [found] = await tx.select({ row: t, displayName: s.user.name }).from(t)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, t.tenantId), eq(s.membership.id, t.actorMembershipId), eq(s.membership.userId, t.actorUserId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId), eq(t.actorUserId, actor.userId), eq(t.mutationId, mutationId))).limit(1);
  return found ? { ...(found.row as typeof s.translationDraft.$inferSelect), displayName: found.displayName } : null;
}
export async function append<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: WorkActor, stream: Stream, selection: WorkSelection, write: WorkWrite, digest: string) {
  const t = table(stream);
  const child = actor.mode === "child-practice";
  const [row] = await tx.insert(t).values({ tenantId: actor.tenantId, studentId: actor.studentId, verseRef: write.verseRef,
    assignmentId: selection.assignmentId, assignmentRevision: selection.assignmentRevision, version: write.expectedVersion + 1, baseVersion: write.expectedVersion,
    text: write.text, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    role: child ? "parent" : actor.mode, mode: actor.mode, guardianId: child ? actor.relationshipId : null,
    contextId: "context" in actor ? actor.context?.id ?? null : null, studentIdentityId: actor.mode === "student" ? actor.relationshipId : null,
    mutationId: write.mutationId, requestDigest: digest }).onConflictDoNothing().returning();
  if (row) await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId,
    mode: actor.mode, actingStudentId: actor.studentId, roleGrantId: actor.roleGrantId, guardianId: child ? actor.relationshipId : null,
    action: stream === "draft" ? "draft.append" : "note.append", targetType: stream === "draft" ? "translation_draft" : "tutor_note", targetId: row.id, requestId: randomUUID() });
  return row ? receipt(tx, actor, stream, write.mutationId) : null;
}
