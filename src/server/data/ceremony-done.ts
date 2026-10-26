import "server-only";
import { and, asc, eq, isNull, notExists, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { studentCeremonyDone } from "../db/ceremony-done-schema";
import * as s from "../db/tenant-schema";

/**
 * "Ceremony done" queries (release 1.9 N21, migration 0049). Writes run under 0049's forced policies, which hold the writer to the
 * live admin grant named in `app.ceremony_done_actor`; only src/server/students/ceremony-done.ts calls setActor and the writes
 * (a structural test holds this). The read helpers are for every active list: a live (unreversed) row takes the student out.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/** Names the writer for 0049's policies, transaction-locally: an admin role grant the caller has just checked live. */
export async function setActor<Q extends PgQueryResultHKT>(tx: Tx<Q>, roleGrantId: string) {
  await tx.execute(sql`select set_config('app.ceremony_done_actor', ${roleGrantId}, true)`);
}
/** Clears the writer again before the transaction goes on to anything else. */
export async function clearActor<Q extends PgQueryResultHKT>(tx: Tx<Q>) {
  await tx.execute(sql`select set_config('app.ceremony_done_actor', '', true)`);
}

/** The student's live ceremony-done row, locked for update, or undefined. */
export async function liveRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  const [row] = await tx.select({ id: studentCeremonyDone.id, setAt: studentCeremonyDone.setAt }).from(studentCeremonyDone)
    .where(and(eq(studentCeremonyDone.tenantId, tenantId), eq(studentCeremonyDone.studentId, studentId), isNull(studentCeremonyDone.reversedAt))).for("update");
  return row;
}

/** Whether the student's ceremony is done now (a live row exists). Share-locks the row, so a concurrent reversal waits. */
export async function isCeremonyDone<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  const [row] = await tx.select({ id: studentCeremonyDone.id }).from(studentCeremonyDone)
    .where(and(eq(studentCeremonyDone.tenantId, tenantId), eq(studentCeremonyDone.studentId, studentId), isNull(studentCeremonyDone.reversedAt))).limit(1).for("share");
  return row !== undefined;
}

/** Every student of the tenant whose ceremony is done now, with the instant it was set (for the admin's ceremony-done list). */
export async function liveRows<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.select({ studentId: studentCeremonyDone.studentId, setAt: studentCeremonyDone.setAt }).from(studentCeremonyDone)
    .where(and(eq(studentCeremonyDone.tenantId, tenantId), isNull(studentCeremonyDone.reversedAt))).orderBy(asc(studentCeremonyDone.studentId)).limit(5001);
}

/** A WHERE term for an active list: the student (by its tenant and id columns) has no live ceremony-done row. */
export function notCeremonyDone(tenantId: AnyPgColumn, studentId: AnyPgColumn): SQL {
  return notExists(sql`(select 1 from ${studentCeremonyDone} where ${studentCeremonyDone.tenantId} = ${tenantId} and ${studentCeremonyDone.studentId} = ${studentId} and ${studentCeremonyDone.reversedAt} is null)`);
}

/** Ends every live tutor_student row of the student now, returning the ended rows' ids. Restoring them is impossible (0002's trigger). */
export async function endTutorRows<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, now: Date) {
  return tx.update(s.tutorStudent).set({ revokedAt: now }).where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), isNull(s.tutorStudent.revokedAt)))
    .returning({ id: s.tutorStudent.id });
}

/** Inserts the live row. Written by hand: 0049 grants INSERT on these three columns only, so set_at is the server's now(). */
export async function insertLive<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, setByGrantId: string) {
  const result = await tx.execute(sql`insert into student_ceremony_done (tenant_id, student_id, set_by_grant_id) values (${tenantId}, ${studentId}, ${setByGrantId}) returning id`) as unknown as { rows: { id: string }[] };
  return result.rows[0]?.id;
}

/** Reverses the live row (0049's trigger writes reversed_at). Touches no tutor_student row. */
export async function reverseLive<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, rowId: string, reversedByGrantId: string) {
  const result = await tx.execute(sql`update student_ceremony_done set reversed_by_grant_id = ${reversedByGrantId}, reversed_by_role = 'admin'
    where tenant_id = ${tenantId} and id = ${rowId} and reversed_at is null returning id`) as unknown as { rows: { id: string }[] };
  return result.rows[0]?.id;
}
