import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction, Actor } from "../access/types";
import { insertGrantUnlessActive, lockMembershipGrants, writeInvitationAudit } from "../data/invitations";
import { writeGrantRevocation, writeTutorRevocation } from "../relationships/service";
import * as s from "../db/index";

/**
 * People with access, Make tutor (docs/planning/2026-11-03-people-tutor/SPEC.md): an admin, with a fresh session, gives a
 * listed person the tutor role. Inside the caller's tenant transaction: the membership is locked first, then its grants. A
 * missing, another congregation's, a disabled or an unverified-address membership is 404, as is one whose Member row was
 * ended with no grant left: fail closed. Someone who has only signed in (a bare
 * membership, made at first sign-in by portal/service.ts beginSession) is listed and may be made a tutor (lead, 2026-11-03). An active tutor grant is already-tutor.
 * A student may also be a tutor (Daniel, SPEC-2.md answer 3), so a student grant does not block. A tutor grant revoked earlier does not block. The grant is the invitation layer's own write, audited
 * grant.issue; a concurrent grant of the same role makes it already-tutor, never an error. No email. Called by the accounts
 * service alone (the structural test names it).
 */
export type MakeTutorRefusal = "already-tutor";
export async function makeTutor<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, membershipId: string) {
  if (actor.mode !== "admin") throw new AccessDenied(403);
  const [target] = await tx.select({ id: s.membership.id, disabledAt: s.membership.disabledAt, verified: s.user.emailVerified }).from(s.membership)
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.membership.tenantId, actor.tenantId), eq(s.membership.id, membershipId))).limit(1).for("update", { of: s.membership });
  // An unverified address gives the admin nothing to tell same-named people apart by (adversarial review, 2026-11-03).
  if (!target || target.disabledAt || !target.verified) throw new AccessDenied(404);
  const active = (await lockMembershipGrants(tx, actor.tenantId, target.id, "authority-write")).filter(grant => !grant.revokedAt);
  if (!active.length) {
    // As the list: someone whose Member row an admin ended, holding no grant, is not offered.
    const members = await tx.select({ revokedAt: s.tenantMember.revokedAt }).from(s.tenantMember)
      .where(and(eq(s.tenantMember.tenantId, actor.tenantId), eq(s.tenantMember.membershipId, target.id))).for("share");
    if (!members.some(row => row.revokedAt === null) && members.some(row => row.revokedAt !== null)) throw new AccessDenied(404);
  }
  if (active.some(grant => grant.role === "tutor")) return { ok: false as const, code: "already-tutor" as const };
  const grantId = await insertGrantUnlessActive(tx, actor.tenantId, target.id, "tutor");
  if (!grantId) return { ok: false as const, code: "already-tutor" as const };
  await writeInvitationAudit(tx, actor, "grant.issue", grantId);
  return { ok: true as const };
}

/**
 * People with access, Remove tutor (docs/planning/2026-11-03-people-tutor/SPEC-2.md): an admin, with a fresh session, ends a listed
 * person's tutor role. Same lock order as Make tutor: the membership, then its grants; then each live tutor link through the one
 * tutor-revocation write (grant, student, link, students in id order, as the hand-over locks them); then the grant through the
 * one grant-revocation write the Tutors page's "Remove as a tutor" uses (the grant, its practice contexts, grant.revoke, its
 * claims). A missing, another congregation's or a disabled membership is 404; no live tutor grant is not-tutor; the admin's own
 * membership is self. Everything is revoked, never deleted. The live designation bound to the grant is the accounts service's
 * to end, in the same transaction. Called by the accounts service alone (the structural test names it).
 */
export type RemoveTutorRefusal = "not-tutor" | "self";
export async function removeTutor<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, membershipId: string) {
  if (actor.mode !== "admin") throw new AccessDenied(403);
  const [target] = await tx.select({ id: s.membership.id, disabledAt: s.membership.disabledAt }).from(s.membership)
    .where(and(eq(s.membership.tenantId, actor.tenantId), eq(s.membership.id, membershipId))).limit(1).for("update");
  if (!target || target.disabledAt) throw new AccessDenied(404);
  const grant = (await lockMembershipGrants(tx, actor.tenantId, target.id, "authority-write")).find(row => row.role === "tutor" && !row.revokedAt);
  if (!grant) return { ok: false as const, code: "not-tutor" as const };
  if (target.id === actor.membershipId) return { ok: false as const, code: "self" as const };
  const links = await tx.select({ id: s.tutorStudent.id, studentId: s.tutorStudent.studentId }).from(s.tutorStudent)
    .where(and(eq(s.tutorStudent.tenantId, actor.tenantId), eq(s.tutorStudent.tutorGrantId, grant.id), isNull(s.tutorStudent.revokedAt)))
    .orderBy(asc(s.tutorStudent.studentId), asc(s.tutorStudent.id));
  // The grant is locked for writing, and every other write to its links locks it first, so each link is still live: a refusal
  // here means something unexpected, and the whole removal rolls back (fail closed).
  for (const link of links) if (!(await writeTutorRevocation(tx, actor, link.studentId, link.id)).ok) throw new Error("Remove tutor unavailable");
  if (!await writeGrantRevocation(tx, actor, grant.id, grant.revision, new Date())) throw new Error("Remove tutor unavailable");
  return { ok: true as const, grantId: grant.id };
}
