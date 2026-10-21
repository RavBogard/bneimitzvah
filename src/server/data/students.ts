import "server-only";
import { and, asc, eq, exists, gt, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor } from "../access/types";
import * as s from "../db/tenant-schema";

export type StudentView = Readonly<{ id: string; firstName: string; lastName: string; ceremonyDate: string; rehearsal1: string | null; rehearsal2: string | null; revision: number }>;
export type StudentPage = Readonly<{ afterId?: string; limit?: number }>;

export async function lockVisibleStudentCandidates<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, page: StudentPage) {
  let relationship;
  if (actor.mode === "parent") relationship = exists(tx.select({ id: s.guardian.id }).from(s.guardian).where(and(
    eq(s.guardian.tenantId, actor.tenantId), eq(s.guardian.studentId, s.student.id), eq(s.guardian.parentGrantId, actor.roleGrantId), isNull(s.guardian.revokedAt),
  )));
  if (actor.mode === "tutor") relationship = exists(tx.select({ id: s.tutorStudent.id }).from(s.tutorStudent).where(and(
    eq(s.tutorStudent.tenantId, actor.tenantId), eq(s.tutorStudent.studentId, s.student.id), eq(s.tutorStudent.tutorGrantId, actor.roleGrantId), isNull(s.tutorStudent.revokedAt),
  )));
  if (actor.mode === "student") relationship = exists(tx.select({ id: s.studentIdentity.id }).from(s.studentIdentity).where(and(
    eq(s.studentIdentity.tenantId, actor.tenantId), eq(s.studentIdentity.studentId, s.student.id), eq(s.studentIdentity.roleGrantId, actor.roleGrantId), isNull(s.studentIdentity.revokedAt),
  )));
  return tx.select({ id: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName, ceremonyDate: s.student.ceremonyDate, rehearsal1: s.student.rehearsal1, rehearsal2: s.student.rehearsal2, revision: s.student.revision, studentKind: s.student.studentKind })
    .from(s.student).where(and(eq(s.student.tenantId, actor.tenantId), isNull(s.student.disabledAt), relationship,
      page.afterId ? gt(s.student.id, page.afterId) : undefined))
    .orderBy(asc(s.student.id)).limit(page.limit ?? 100).for("share");
}
