import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import type { PracticeActor } from "../practice/types";
import type { LessonLogCreate, LessonLogCursor, LessonLogEntry } from "../../lib/lesson-log/types";
import * as s from "../db/index";

export type LessonLogActor = StudentActor | PracticeActor;
export type LessonLogRow = typeof s.lessonLog.$inferSelect;
const t = s.lessonLog;
const scope = (actor: LessonLogActor) => and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId));
const key = (actor: LessonLogActor, entryId: string) => and(scope(actor), eq(t.entryId, entryId));
export function canChange(actor: LessonLogActor, row: LessonLogRow) {
  return actor.mode === "admin" || actor.mode === "tutor" && actor.membershipId === row.creatorMembershipId && actor.userId === row.creatorUserId;
}
/** A lesson note's author is a tutor or the rabbi; with no usable name the learner is told "your tutor" (Readings for everyone E1, F24), never "Portal member". */
export function safeDisplayName(value: string) {
  return !value.isWellFormed() || !value.trim() || value.includes("@") || Array.from(value).length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(value) ? "your tutor" : value.trim();
}
export function view(actor: LessonLogActor, row: LessonLogRow, name: string): LessonLogEntry {
  if (row.deleted) throw new Error("Lesson unavailable");
  const editable = canChange(actor, row);
  return { entryId: row.entryId, lessonDate: row.lessonDate, summary: row.summary, beforeNext: row.beforeNext ?? null, version: row.version, displayName: safeDisplayName(name), canEdit: editable, canDelete: editable };
}
export async function page<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: LessonLogActor, before: LessonLogCursor | undefined) {
  return tx.select({ row: t, name: s.user.name }).from(t).innerJoin(s.user, eq(s.user.id, t.creatorUserId))
    .where(and(scope(actor), eq(t.deleted, false), before ? or(lt(t.lessonDate, before.lessonDate), and(eq(t.lessonDate, before.lessonDate), lt(t.entryId, before.entryId))) : undefined))
    .orderBy(desc(t.lessonDate), desc(t.entryId)).limit(51);
}
export async function lock<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: LessonLogActor, entryId: string) {
  const [row] = await tx.select().from(t).where(key(actor, entryId)).for("update"); return row ?? null;
}
export async function insert<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: LessonLogActor, write: LessonLogCreate) {
  const [row] = await tx.insert(t).values({ entryId: write.entryId, lessonDate: write.lessonDate, summary: write.summary, beforeNext: write.beforeNext ?? null, tenantId: actor.tenantId, studentId: actor.studentId, creatorMembershipId: actor.membershipId, creatorUserId: actor.userId, version: 1, deleted: false }).onConflictDoNothing().returning();
  return row ?? null;
}
export async function change<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: LessonLogActor, row: LessonLogRow, values: { summary: string; beforeNext: string | null; lessonDate?: string; deleted?: boolean }) {
  const [changed] = await tx.update(t).set({ ...values, version: row.version + 1 }).where(and(key(actor, row.entryId), eq(t.version, row.version), eq(t.deleted, false))).returning();
  return changed ?? null;
}
export async function creatorName<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: LessonLogRow) {
  const [found] = await tx.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, row.creatorUserId));
  if (!found) throw new Error("Lesson unavailable"); return found.name;
}
export async function audit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: LessonLogActor, action: "create" | "edit" | "delete", entryId: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: actor.mode, actingStudentId: actor.studentId, guardianId: null, action: `lesson-log.${action}`, targetType: "lesson_log", targetId: entryId, requestId: randomUUID() });
}
