import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

/**
 * Per-part finished-mark queries (2.0 SC5, A4 9). Imported only from src/server/service-course/finished.ts (a structural test
 * holds this). Every query runs under the forced policies of 0048 AND filters on the tenant and student itself, so a forgotten
 * WHERE still sees only what the reader may see, and a forgotten policy still filters.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/** Names the reader for 0048's policies, transaction-locally: a role grant the caller has just checked live. */
export async function setReader<Q extends PgQueryResultHKT>(tx: Tx<Q>, roleGrantId: string) {
  await tx.execute(sql`select set_config('app.service_part_reader', ${roleGrantId}, true)`);
}
/** Clears the reader again before the transaction goes on to anything else. */
export async function clearReader<Q extends PgQueryResultHKT>(tx: Tx<Q>) {
  await tx.execute(sql`select set_config('app.service_part_reader', '', true)`);
}

/** The one live student link of a live student grant (a grant names at most one student), or null. */
export async function studentOfGrant<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, roleGrantId: string) {
  const rows = await tx.select({ studentId: s.studentIdentity.studentId }).from(s.studentIdentity)
    .where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.studentIdentity.roleGrantId, roleGrantId), isNull(s.studentIdentity.revokedAt))).limit(2);
  return rows.length === 1 ? rows[0].studentId : null;
}

/** The student's service plan's selected unit ids (feed ids, in service order), share-locked; null with no plan. */
export async function planUnits<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string): Promise<readonly string[] | null> {
  const [row] = await tx.select({ selectedIds: s.studentServicePlan.selectedIds }).from(s.studentServicePlan)
    .where(and(eq(s.studentServicePlan.tenantId, tenantId), eq(s.studentServicePlan.studentId, studentId))).for("share");
  return row ? row.selectedIds : null;
}

/** The student's finished lessons with the day each was recorded, in the congregation's time zone (dates only, no time of day). */
export async function finishedDays<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  return tx.select({ lessonId: s.servicePartFinished.lessonId,
    day: sql<string>`to_char(${s.servicePartFinished.finishedAt} at time zone 'America/Chicago', 'YYYY-MM-DD')` })
    .from(s.servicePartFinished).where(and(eq(s.servicePartFinished.tenantId, tenantId), eq(s.servicePartFinished.studentId, studentId)));
}

/** Records these lessons as finished, once each: a lesson already marked stays as it was. Returns the lessons newly marked. */
export async function insertFinished<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, lessonIds: readonly string[]) {
  if (!lessonIds.length) return [];
  // Written by hand rather than with the query builder, which names every column: 0048 grants INSERT on these three columns
  // only, so finished_at is always the server's now() and never a value a caller chose.
  const values = sql.join(lessonIds.map(lessonId => sql`(${tenantId}, ${studentId}, ${lessonId})`), sql`, `);
  const result = await tx.execute(sql`insert into service_part_finished (tenant_id, student_id, lesson_id) values ${values}
    on conflict (tenant_id, student_id, lesson_id) do nothing returning lesson_id`) as unknown as { rows: { lesson_id: string }[] };
  return result.rows.map(row => row.lesson_id);
}

/** One audit row per newly finished part, in the student's own name. */
export async function auditFinished<Q extends PgQueryResultHKT>(tx: Tx<Q>, actor: { tenantId: string; userId: string; membershipId: string; roleGrantId: string }, studentId: string, lessonIds: readonly string[]) {
  if (!lessonIds.length) return;
  await tx.insert(s.auditEvent).values(lessonIds.map(lessonId => ({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId,
    roleGrantId: actor.roleGrantId, mode: "student" as const, actingStudentId: studentId, action: "service-part.finish", targetType: "service-part", targetId: lessonId, requestId: randomUUID() })));
}
