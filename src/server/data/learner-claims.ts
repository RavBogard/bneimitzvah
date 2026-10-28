import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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

/**
 * Whether a membership is staff or a parent rather than a learner (A1, tutor and admin walks 2026-10-28): a live admin or tutor grant,
 * or a live parent grant with a live guardian link and no live student identity (an adult student who is also a parent is a learner). Share-locked like the viewer's own grants. Such a person is never claimed, and a
 * claim never opens their shelf; the rabbi's assignment (a tutor link) still does.
 */
export async function notALearner<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string): Promise<boolean> {
  const grants = await tx.select({ id: s.roleGrant.id, role: s.roleGrant.role }).from(s.roleGrant)
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId), isNull(s.roleGrant.revokedAt), inArray(s.roleGrant.role, ["admin", "tutor", "parent"]))).orderBy(asc(s.roleGrant.id)).for("share");
  if (grants.some(grant => grant.role !== "parent")) return true;
  const parents = grants.map(grant => grant.id);
  if (!parents.length) return false;
  const [link] = await tx.select({ id: s.guardian.id }).from(s.guardian)
    .where(and(eq(s.guardian.tenantId, tenantId), inArray(s.guardian.parentGrantId, parents), isNull(s.guardian.revokedAt))).limit(1);
  if (!link) return false;
  // An adult student who is also a parent is a learner: a live student identity through a live student grant of this membership.
  const [identity] = await tx.select({ id: s.studentIdentity.id }).from(s.studentIdentity)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.studentIdentity.tenantId), eq(s.roleGrant.id, s.studentIdentity.roleGrantId), isNull(s.roleGrant.revokedAt), eq(s.roleGrant.role, "student")))
    .innerJoin(s.student, and(eq(s.student.tenantId, s.studentIdentity.tenantId), eq(s.student.id, s.studentIdentity.studentId), isNull(s.student.disabledAt)))
    .where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId), isNull(s.studentIdentity.revokedAt),
      notCeremonyDone(s.studentIdentity.tenantId, s.studentIdentity.studentId))).limit(1);
  return !identity;
}

/**
 * The learner's live, unrevoked claim, if any, share-locked (or locked for update when a write follows). A claim whose tutor grant
 * was revoked no longer counts (revokeRoleGrant ends such claims too; this is the belt to that brace), so the learner's line clears
 * and another tutor may claim.
 */
export async function activeClaimOf<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, learnerMembershipId: string, lock: "share" | "update" = "share") {
  const [row] = await tx.select({ claim: s.learnerClaim }).from(s.learnerClaim)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.learnerClaim.tenantId), eq(s.roleGrant.id, s.learnerClaim.tutorGrantId), isNull(s.roleGrant.revokedAt)))
    .where(and(eq(s.learnerClaim.tenantId, tenantId), eq(s.learnerClaim.learnerMembershipId, learnerMembershipId), isNull(s.learnerClaim.revokedAt))).limit(1).for(lock, { of: s.learnerClaim });
  return row?.claim ?? null;
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
 * The rabbi's assignments of the learner: liveTutorLinksOf without the links a tutor's own claim made (learner_claim.tutor_link_id),
 * so a claim-made link never counts as an assignment and A1's notALearner still decides it.
 */
export async function assignedLinksOf<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, learnerMembershipId: string) {
  const links = await liveTutorLinksOf(tx, tenantId, learnerMembershipId);
  if (!links.length) return links;
  const claimed = await tx.select({ linkId: s.learnerClaim.tutorLinkId }).from(s.learnerClaim)
    .where(and(eq(s.learnerClaim.tenantId, tenantId), inArray(s.learnerClaim.tutorLinkId, links.map(link => link.linkId)), isNull(s.learnerClaim.revokedAt)));
  return links.filter(link => !claimed.some(row => row.linkId === link.linkId));
}

/**
 * Whether the viewer may read the learner's shelf: a live admin grant; or a live tutor grant, on a learner who is neither staff nor a
 * parent (notALearner), that holds the learner's unrevoked claim, or an unrevoked tutor link to the student whose live identity is the learner's. Null for everyone else, which the
 * caller turns into the same 404 a missing learner gets. Both memberships are the same tenant's; nothing crosses it.
 */
export async function canView<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, viewerMembershipId: string, learnerMembershipId: string): Promise<StaffGrant | null> {
  const grant = await liveStaffGrant(tx, tenantId, viewerMembershipId);
  if (!grant) return null;
  if (grant.role === "admin") return grant;
  // The rabbi's assignment always wins: a tutor linked to the learner's student sees the shelf, whatever else the learner is.
  const links = await assignedLinksOf(tx, tenantId, learnerMembershipId);
  if (links.some(link => link.tutorGrantId === grant.id)) return grant;
  // A1 (tutor and admin walks 2026-10-28): a claim never opens a colleague's, the rabbi's or a parent's shelf, even one made before they were refused.
  if (await notALearner(tx, tenantId, learnerMembershipId)) return null;
  const claim = await activeClaimOf(tx, tenantId, learnerMembershipId);
  return claim && claim.tutorGrantId === grant.id ? grant : null;
}
