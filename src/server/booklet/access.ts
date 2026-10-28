import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { lockRoleGrant, lockStudent, lockStudentRelationship } from "../data/authority";
import { learnerMembershipOf, tutorLinkPassesA1 } from "../data/learner-claims";
import { grantHolder, tutorOfLearner } from "../learners/data";
import { displayName } from "../relationships/service";
import * as s from "../db/index";

/**
 * Who may open a student's study booklet (replacing the study-guide booklet, B2). The booklet carries family data (the ceremony
 * and rehearsal dates, the tutor), so it is never public and never signed out. It reuses the reads each role already has:
 * - the learner: a live student grant with a live identity on this student (the student's own reading page);
 * - a parent: a live parent grant with a live guardian link to this student (the parent's child page);
 * - an admin of this congregation;
 * - a tutor with a live tutor link to this student, where a link a claim made also has to pass A1 (tutorLinkPassesA1, canView): a claim
 *   never opens a colleague's, the rabbi's or a parent's booklet. A revoked claim ends its link, so that tutor has nothing.
 * Null for everyone else, which the caller answers with the same 404 an unknown student gets. The viewer's grants are read first, so a
 * viewer with none answers before any student lookup; the student is looked up in the viewer's own congregation only.
 */
export type BookletMode = "student" | "parent" | "tutor" | "admin";

export async function bookletMode<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, viewerMembershipId: string, studentId: string): Promise<BookletMode | null> {
  const grants = {
    student: await lockRoleGrant(tx, tenantId, viewerMembershipId, "student", "read"), parent: await lockRoleGrant(tx, tenantId, viewerMembershipId, "parent", "read"),
    admin: await lockRoleGrant(tx, tenantId, viewerMembershipId, "admin", "read"), tutor: await lockRoleGrant(tx, tenantId, viewerMembershipId, "tutor", "read"),
  };
  if (!grants.student && !grants.parent && !grants.admin && !grants.tutor) return null;
  const student = await lockStudent(tx, tenantId, studentId, "read");
  if (!student || student.disabledAt) return null;
  for (const mode of ["student", "parent"] as const) {
    const grant = grants[mode];
    if (grant && await lockStudentRelationship(tx, tenantId, student.id, grant.id, mode, "read")) return mode;
  }
  if (grants.admin) return "admin";
  if (!grants.tutor) return null;
  const link = await lockStudentRelationship(tx, tenantId, student.id, grants.tutor.id, "tutor", "read");
  if (!link?.id) return null;
  return await tutorLinkPassesA1(tx, tenantId, viewerMembershipId, link.id) ? "tutor" : null;
}

/**
 * The student's tutor's name for the booklet's cover, by the learner's own tutor line (tutorOfLearner: the claim first, then the rabbi's
 * assignment; a revoked grant or a disabled membership is nobody's tutor). A student no one has signed in as yet has no claims, so the first
 * live tutor link stands. Only for the learner, the tutor and the admin, who already see it; a parent's booklet leaves the line out.
 */
export async function bookletTutorName<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string): Promise<string | null> {
  const learner = await learnerMembershipOf(tx, tenantId, studentId);
  if (learner) { const tutor = await tutorOfLearner(tx, tenantId, learner); return tutor ? displayName(tutor.name, "Tutor") : null; }
  const links = await tx.select({ tutorGrantId: s.tutorStudent.tutorGrantId }).from(s.tutorStudent)
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), isNull(s.tutorStudent.revokedAt))).orderBy(asc(s.tutorStudent.id)).limit(10);
  for (const link of links) {
    const holder = await grantHolder(tx, tenantId, link.tutorGrantId);
    if (holder && !holder.revokedAt && !holder.disabledAt) return displayName(holder.name, "Tutor");
  }
  return null;
}
