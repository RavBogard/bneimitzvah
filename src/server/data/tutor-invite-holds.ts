import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor } from "../access/types";
import * as s from "../db/index";

// Students held for a tutor invitation (migration 0053). Only src/server/invitations/service.ts calls these: holds are written
// with a tutor invitation, copied when it rotates, and read once when it is accepted. A hold grants nothing by itself.

/** At most this many students are held for one invitation. */
export const MAX_HELD_STUDENTS = 50;

/** Hold students for a live tutor invitation, written by the admin's grant; a student already held for it is left as it is. */
export async function insertHolds<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, inviteId: string, studentIds: readonly string[]) {
  let added = 0;
  // Only the four granted columns are named (0053 grants INSERT on exactly these); the id, role and instant take their defaults.
  for (const studentId of studentIds) {
    const result = await tx.execute(sql`insert into tutor_invite_hold (tenant_id, invite_id, student_id, held_by_grant_id)
      values (${actor.tenantId}, ${inviteId}, ${studentId}, ${actor.roleGrantId}) on conflict (tenant_id, invite_id, student_id) do nothing returning id`) as unknown as { rows: { id: string }[] };
    added += result.rows.length;
  }
  return added;
}

/** The students held for one invitation, oldest first. */
export async function heldStudents<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, inviteId: string) {
  const rows = await tx.select({ studentId: s.tutorInviteHold.studentId }).from(s.tutorInviteHold)
    .where(and(eq(s.tutorInviteHold.tenantId, tenantId), eq(s.tutorInviteHold.inviteId, inviteId))).orderBy(asc(s.tutorInviteHold.createdAt), asc(s.tutorInviteHold.id)).limit(MAX_HELD_STUDENTS + 1);
  return rows.map(row => row.studentId);
}
