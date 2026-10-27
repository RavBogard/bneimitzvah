import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { notCeremonyDone } from "./ceremony-done";
import * as s from "../db/index";

/**
 * Who may see whose shelf, and the claims behind it (readings for everyone, Daniel 2026-10-27; plan decisions 2 and 3).
 * Read by the saved layer's viewer binding (src/server/saved/access.ts) and by the learners service. Nothing here names a
 * saved table; the saved layer's own policies decide what a bound viewer then reads.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
export type StaffRole = "admin" | "tutor";
export type StaffGrant = Readonly<{ id: string; role: StaffRole }>;

/** A live admin grant of this membership, else a live tutor grant, share-locked so a concurrent revocation waits; null without one. */
export async function liveStaffGrant<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string, prefer: StaffRole = "admin"): Promise<StaffGrant | null> {
  const rows = await tx.select({ id: s.roleGrant.id, role: s.roleGrant.role }).from(s.roleGrant)
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId), isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.role), asc(s.roleGrant.id)).for("share");
  const grant = rows.find(row => row.role === prefer) ?? rows.find(row => row.role === "admin" || row.role === "tutor");
  return grant ? Object.freeze({ id: grant.id, role: grant.role as StaffRole }) : null;
}

/** The learner's live, unrevoked claim, if any, share-locked (or locked for update when a write follows). */
export async function activeClaimOf<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, learnerMembershipId: string, lock: "share" | "update" = "share") {
  const [row] = await tx.select().from(s.learnerClaim)
    .where(and(eq(s.learnerClaim.tenantId, tenantId), eq(s.learnerClaim.learnerMembershipId, learnerMembershipId), isNull(s.learnerClaim.revokedAt))).limit(1).for(lock);
  return row ?? null;
}

/**
 * The learner's live tutor links through their student record: a live student_identity whose grant is the learner's, on a
 * student not disabled and not ceremony-done, with the unrevoked tutor_student rows on it. Empty for anyone without a student record.
 */
export async function liveTutorLinksOf<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, learnerMembershipId: string) {
  return tx.select({ linkId: s.tutorStudent.id, tutorGrantId: s.tutorStudent.tutorGrantId, studentId: s.tutorStudent.studentId }).from(s.tutorStudent)
    .innerJoin(s.studentIdentity, and(eq(s.studentIdentity.tenantId, s.tutorStudent.tenantId), eq(s.studentIdentity.studentId, s.tutorStudent.studentId), isNull(s.studentIdentity.revokedAt)))
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.studentIdentity.tenantId), eq(s.roleGrant.id, s.studentIdentity.roleGrantId), isNull(s.roleGrant.revokedAt), eq(s.roleGrant.role, "student")))
    .innerJoin(s.student, and(eq(s.student.tenantId, s.tutorStudent.tenantId), eq(s.student.id, s.tutorStudent.studentId), isNull(s.student.disabledAt)))
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.roleGrant.membershipId, learnerMembershipId), isNull(s.tutorStudent.revokedAt),
      notCeremonyDone(s.tutorStudent.tenantId, s.tutorStudent.studentId))).orderBy(asc(s.tutorStudent.id)).limit(50);
}

/**
 * Whether the viewer may read the learner's shelf: a live admin grant; or a live tutor grant that holds the learner's unrevoked
 * claim, or an unrevoked tutor link to the student whose live identity is the learner's. Null for everyone else, which the
 * caller turns into the same 404 a missing learner gets. Both memberships are the same tenant's; nothing crosses it.
 */
export async function canView<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, viewerMembershipId: string, learnerMembershipId: string): Promise<StaffGrant | null> {
  const grant = await liveStaffGrant(tx, tenantId, viewerMembershipId);
  if (!grant) return null;
  if (grant.role === "admin") return grant;
  const claim = await activeClaimOf(tx, tenantId, learnerMembershipId);
  if (claim && claim.tutorGrantId === grant.id) return grant;
  const links = await liveTutorLinksOf(tx, tenantId, learnerMembershipId);
  return links.some(link => link.tutorGrantId === grant.id) ? grant : null;
}
