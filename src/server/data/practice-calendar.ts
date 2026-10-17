import "server-only";
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, notExists, or } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import type { PracticeActor } from "../practice/types";
import type { PracticeEventWrite, PracticeRawCursor, PracticeWindow } from "../../lib/practice-calendar/types";
import * as s from "../db/index";

export type CalendarActor = StudentActor | PracticeActor;
export type EventRow = typeof s.practiceEvent.$inferSelect;
const d = s.practiceDay, e = s.practiceEvent;
const scope = (table: typeof d | typeof e, tenantId: string, studentId: string) => and(eq(table.tenantId, tenantId), eq(table.studentId, studentId));
export async function calendar<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: CalendarActor, window: PracticeWindow) {
  return tx.select({ practiceDay: d.practiceDay }).from(d).where(and(scope(d, actor.tenantId, actor.studentId), gte(d.practiceDay, window.fromDate), lte(d.practiceDay, window.throughDate))).orderBy(asc(d.practiceDay)).limit(367);
}
export async function events<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: CalendarActor, after: Date, now: Date, before?: PracticeRawCursor) {
  return tx.select().from(e).where(and(scope(e, actor.tenantId, actor.studentId), gt(e.receivedAt, after), lte(e.receivedAt, now),
    before ? or(lt(e.receivedAt, new Date(before.receivedAt)), and(eq(e.receivedAt, new Date(before.receivedAt)), lt(e.eventId, before.eventId))) : undefined))
    .orderBy(desc(e.receivedAt), desc(e.eventId)).limit(51);
}
export async function ensureDay<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: CalendarActor, practiceDay: string) {
  await tx.insert(d).values({ tenantId: actor.tenantId, studentId: actor.studentId, practiceDay }).onConflictDoNothing();
}
export async function lockDay<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: CalendarActor, practiceDay: string) {
  const [row] = await tx.select().from(d).where(and(scope(d, actor.tenantId, actor.studentId), eq(d.practiceDay, practiceDay))).for("update");
  if (!row) throw new Error("Practice day unavailable");
}
export async function countDay<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: CalendarActor, practiceDay: string) {
  const [row] = await tx.select({ count: count() }).from(e).where(and(scope(e, actor.tenantId, actor.studentId), eq(e.practiceDay, practiceDay))); return row.count;
}
export async function insertEvent<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: CalendarActor, write: PracticeEventWrite, receivedAt: Date) {
  if (actor.mode !== "student" && actor.mode !== "child-practice") throw new Error("Practice mode unavailable");
  await tx.insert(e).values({ tenantId: actor.tenantId, studentId: actor.studentId, practiceDay: write.expectedDay, eventId: write.eventId, receivedAt, action: write.action, sourceMode: actor.mode, target: write.target }).onConflictDoNothing();
}
export async function lockStudents<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentIds: string[]) {
  return tx.select({ id: s.student.id, ceremonyDate: s.student.ceremonyDate }).from(s.student).where(and(eq(s.student.tenantId, tenantId), inArray(s.student.id, studentIds))).orderBy(asc(s.student.id)).for("update");
}
export async function deleteRaw<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, fresh: () => { rawAfter: Date; expired: boolean }, limit: number) {
  const eligible = () => { const state = fresh(); return and(scope(e, tenantId, studentId), state.expired ? undefined : lte(e.receivedAt, state.rawAfter)); };
  // The caller already holds the student UPDATE lock, serializing application
  // writers and ceremony pruning. Raw rows are immutable; DELETE rechecks both
  // selected keys and the fresh cutoff without granting raw UPDATE privilege.
  const rows = await tx.select({ practiceDay: e.practiceDay, eventId: e.eventId }).from(e).where(eligible()).orderBy(asc(e.receivedAt), asc(e.eventId)).limit(limit); fresh();
  if (!rows.length) return 0;
  const changed = await tx.delete(e).where(and(eligible(), or(...rows.map(row => and(eq(e.practiceDay, row.practiceDay), eq(e.eventId, row.eventId)))))).returning({ eventId: e.eventId }); fresh();
  return changed.length;
}
export async function deleteDays<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, stillExpired: () => boolean, limit: number) {
  const eligible = and(scope(d, tenantId, studentId), notExists(tx.select({ eventId: e.eventId }).from(e).where(and(eq(e.tenantId, d.tenantId), eq(e.studentId, d.studentId), eq(e.practiceDay, d.practiceDay)))));
  const rows = await tx.select({ practiceDay: d.practiceDay }).from(d).where(eligible).orderBy(asc(d.practiceDay)).limit(limit).for("update");
  if (!stillExpired() || !rows.length) return 0;
  const changed = await tx.delete(d).where(and(eligible, inArray(d.practiceDay, rows.map(row => row.practiceDay)))).returning({ practiceDay: d.practiceDay }); stillExpired(); return changed.length;
}
export async function hasExpired<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, fresh: () => { rawAfter: Date; expired: boolean }) {
  let state = fresh();
  const raw = await tx.select({ receivedAt: e.receivedAt }).from(e).where(and(scope(e, tenantId, studentId), state.expired ? undefined : lte(e.receivedAt, state.rawAfter))).limit(1); state = fresh();
  if (raw.some(row => state.expired || row.receivedAt <= state.rawAfter)) return true;
  if (!state.expired) return false;
  const days = await tx.select({ practiceDay: d.practiceDay }).from(d).where(scope(d, tenantId, studentId)).limit(1); state = fresh(); return state.expired && days.length > 0;
}
