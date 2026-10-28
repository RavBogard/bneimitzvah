import "server-only";
import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

/**
 * 1.9 N23 (decision 7) practice-visibility queries. Imported only from src/server/practice-visibility/service.ts (a structural
 * test holds this). The tutor's reads go through 0052's three security-barrier views, which show rows only while
 * app.practice_reader names a live tutor grant with a live tutor_student row for that student; every query here also filters on
 * the tenant and the student itself, so a forgotten WHERE still sees only what the reader may see, and a forgotten policy still filters.
 * The views carry dates only: no time of day, action, count or duration is selectable through them.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
type Rows<T> = { rows: T[] };

/** Names the reader for 0052's views and its course-progress reader policy, transaction-locally: a tutor grant the caller has just checked live. */
export async function setReader<Q extends PgQueryResultHKT>(tx: Tx<Q>, roleGrantId: string) {
  await tx.execute(sql`select set_config('app.practice_reader', ${roleGrantId}, true)`);
}
/** Clears the reader again before the transaction goes on to anything else. */
export async function clearReader<Q extends PgQueryResultHKT>(tx: Tx<Q>) {
  await tx.execute(sql`select set_config('app.practice_reader', '', true)`);
}

/** Verses opened per day from `since` through `through`: one row per day and verse, through practice_visibility_opened. */
export async function opened<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, since: string, through: string) {
  const result = await tx.execute(sql`select to_char(practice_day, 'YYYY-MM-DD') as day, kind, assignment_id::text as assignment_id, verse_ref
    from practice_visibility_opened where tenant_id = ${tenantId} and student_id = ${studentId} and practice_day between ${since}::date and ${through}::date
    order by practice_day desc limit 5001`) as unknown as Rows<{ day: string; kind: string; assignment_id: string; verse_ref: string }>;
  if (result.rows.length > 5000) throw new Error("Practice visibility unavailable");
  return result.rows;
}
/** The student's current Still working and Got it marks, with the source and the day of each, through practice_visibility_marks. */
export async function marks<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  const result = await tx.execute(sql`select assignment_id::text as assignment_id, verse_ref, state, source_mode, to_char(marked_day, 'YYYY-MM-DD') as day
    from practice_visibility_marks where tenant_id = ${tenantId} and student_id = ${studentId} limit 2001`) as unknown as
    Rows<{ assignment_id: string; verse_ref: string; state: string; source_mode: string | null; day: string | null }>;
  if (result.rows.length > 2000) throw new Error("Practice visibility unavailable");
  return result.rows;
}
/** Learn to lein: lesson ids done and card boxes, through practice_visibility_learn; null when the student keeps no course progress. */
export async function learn<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  const result = await tx.execute(sql`select lessons, boxes from practice_visibility_learn where tenant_id = ${tenantId} and student_id = ${studentId} limit 2`) as unknown as
    Rows<{ lessons: string[]; boxes: Record<string, unknown> }>;
  // A student has at most one live student grant; two rows would be two accounts' progress, so nothing is shown.
  return result.rows.length === 1 ? result.rows[0] : null;
}

/** How many of these days (dates only, already visible to the student's staff under ruling 45) the student practiced. */
export async function practisedDays<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, since: string, through: string) {
  const d = s.practiceDay;
  const [row] = await tx.select({ n: count() }).from(d).where(and(eq(d.tenantId, tenantId), eq(d.studentId, studentId), gte(d.practiceDay, since), lte(d.practiceDay, through)));
  return row.n;
}
/** The latest lesson date logged for the student, on or before today, or null. */
export async function lastLesson<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, through: string) {
  const l = s.lessonLog;
  const [row] = await tx.select({ day: l.lessonDate }).from(l).where(and(eq(l.tenantId, tenantId), eq(l.studentId, studentId), eq(l.deleted, false), lte(l.lessonDate, through)))
    .orderBy(desc(l.lessonDate)).limit(1);
  return row?.day ?? null;
}

/** A parent's counts: the student's own marks on these assignments, state and verse only (no source, no day). */
export async function markStates<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, assignmentIds: readonly string[]) {
  if (!assignmentIds.length) return [];
  const v = s.verseSelfCheck;
  return tx.select({ assignmentId: v.assignmentId, verseRef: v.verseRef, state: v.state }).from(v)
    .where(and(eq(v.tenantId, tenantId), eq(v.studentId, studentId), inArray(v.assignmentId, [...assignmentIds]), inArray(v.state, ["working", "got-it"]))).limit(2001);
}
