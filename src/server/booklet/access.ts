import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { lockRoleGrant, lockStudent, lockStudentRelationship } from "../data/authority";
import { canView } from "../data/learner-claims";
import { grantHolder } from "../learners/data";
import { displayName } from "../relationships/service";
import * as s from "../db/index";

/**
 * Who may open a student's study booklet (replacing the study-guide booklet, B2). The booklet carries family data (the ceremony
 * and rehearsal dates, the tutor), so it is never public and never signed out. It reuses the reads each role already has:
 * - the learner: a live student grant with a live identity on this student (the student's own reading page);
 * - a parent: a live parent grant with a live guardian link to this student (the parent's child page);
 * - an admin of this congregation;
 * - a tutor with a live tutor link to this student, where a link a claim made also has to pass A1 (canView): a claim never opens a
 *   colleague's, the rabbi's or a parent's booklet. A revoked claim ends its link, so that tutor has nothing.
 * Null for everyone else, which the caller answers with the same 404 an unknown student gets. The student is looked up in the
 * viewer's own congregation only, so another congregation's student is unknown here.
 */
export type BookletMode = "student" | "parent" | "tutor" | "admin";

export async function bookletMode<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, viewerMembershipId: string, studentId: string): Promise<BookletMode | null> {
  const student = await lockStudent(tx, tenantId, studentId, "read");
  if (!student || student.disabledAt) return null;
  for (const mode of ["student", "parent"] as const) {
    const grant = await lockRoleGrant(tx, tenantId, viewerMembershipId, mode, "read");
    if (grant && await lockStudentRelationship(tx, tenantId, student.id, grant.id, mode, "read")) return mode;
  }
  if (await lockRoleGrant(tx, tenantId, viewerMembershipId, "admin", "read")) return "admin";
  const tutor = await lockRoleGrant(tx, tenantId, viewerMembershipId, "tutor", "read");
  if (!tutor) return null;
  const link = await lockStudentRelationship(tx, tenantId, student.id, tutor.id, "tutor", "read");
  if (!link?.id) return null;
  // The rabbi's assignment opens it; a link a live claim made opens it only under A1.
  const [claim] = await tx.select({ learnerMembershipId: s.learnerClaim.learnerMembershipId }).from(s.learnerClaim)
    .where(and(eq(s.learnerClaim.tenantId, tenantId), eq(s.learnerClaim.tutorLinkId, link.id), isNull(s.learnerClaim.revokedAt))).limit(1);
  if (!claim) return "tutor";
  const grant = await canView(tx, tenantId, viewerMembershipId, claim.learnerMembershipId);
  return grant?.role === "tutor" && grant.id === tutor.id ? "tutor" : null;
}

/**
 * The student's tutor's name for the booklet's cover: the first live tutor link whose grant is live, cleaned as staff screens clean it.
 * Only for the learner, the tutor and the admin, who already see it (the learner's own tutor line, the staff student pages); a parent's
 * booklet leaves the line out, as no parent read names the tutor.
 */
export async function bookletTutorName<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string): Promise<string | null> {
  const links = await tx.select({ tutorGrantId: s.tutorStudent.tutorGrantId }).from(s.tutorStudent)
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), isNull(s.tutorStudent.revokedAt))).orderBy(asc(s.tutorStudent.createdAt), asc(s.tutorStudent.id)).limit(10);
  for (const link of links) {
    const holder = await grantHolder(tx, tenantId, link.tutorGrantId);
    if (holder && !holder.revokedAt) return displayName(holder.name, "Tutor");
  }
  return null;
}
