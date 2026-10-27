import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor } from "../access/types";
import * as s from "../db/index";

// Students held for a tutor invitation (migration 0053). Only src/server/invitations/service.ts calls these: holds are written
// with a tutor invitation, copied when it rotates, and read once when it is accepted. A hold grants nothing by itself.

/** At most this many students are held for one invitation. */
export const MAX_HELD_STUDENTS = 50;

/** Hold students for a live tutor invitation, written by the admin's grant; a student this admin already holds on it is left as it is. */
export async function insertHolds<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, inviteId: string, studentIds: readonly string[]) {
  let added = 0;
  // 0053's insert policy binds held_by_grant_id to app.tutor_hold_actor, which only this module sets, transaction-locally, to the
  // writing admin's own grant; it is cleared again before returning.
  await tx.execute(sql`select set_config('app.tutor_hold_actor', ${actor.roleGrantId}, true)`);
  // Only the four granted columns are named (0053 grants INSERT on exactly these); the id, role and instant take their defaults.
  for (const studentId of studentIds) {
    const result = await tx.execute(sql`insert into tutor_invite_hold (tenant_id, invite_id, student_id, held_by_grant_id)
      values (${actor.tenantId}, ${inviteId}, ${studentId}, ${actor.roleGrantId}) on conflict (tenant_id, invite_id, student_id, held_by_grant_id) do nothing returning id`) as unknown as { rows: { id: string }[] };
    added += result.rows.length;
  }
  await tx.execute(sql`select set_config('app.tutor_hold_actor', '', true)`);
  return added;
}

/**
 * The students held for one invitation, in student-id order (so every acceptance locks them in one order). Only holds whose writer
 * is still a live admin grant of an enabled membership count: a hold written by an admin since revoked or disabled never applies.
 */
export async function heldStudents<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, inviteId: string) {
  const rows = await tx.selectDistinct({ studentId: s.tutorInviteHold.studentId }).from(s.tutorInviteHold)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.tutorInviteHold.tenantId), eq(s.roleGrant.id, s.tutorInviteHold.heldByGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .where(and(eq(s.tutorInviteHold.tenantId, tenantId), eq(s.tutorInviteHold.inviteId, inviteId), eq(s.roleGrant.role, "admin"), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt)))
    .orderBy(asc(s.tutorInviteHold.studentId)).limit(MAX_HELD_STUDENTS + 1);
  return rows.map(row => row.studentId);
}
