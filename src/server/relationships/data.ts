import "server-only";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor, LockIntent } from "../access/types";
import { lockStrength } from "../access/types";
import { AccessDenied } from "../access/errors";
import * as s from "../db/index";

// All callers already hold the tenant authority lock. Provisional tenant-only
// lookups select immutable keys; locked rows are the authority, never the probe.
export async function subjectGrant<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, intent: LockIntent) {
  const [probe] = await tx.select({ membershipId: s.roleGrant.membershipId }).from(s.roleGrant)
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.id, id))).limit(1);
  if (!probe) throw new AccessDenied(404);
  const [membership] = await tx.select().from(s.membership).where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.id, probe.membershipId))).for(lockStrength(intent));
  const [grant] = await tx.select().from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.id, id))).for(lockStrength(intent));
  if (!membership || !grant || grant.membershipId !== membership.id) throw new AccessDenied(404);
  // Target profile/verification is a snapshot after scoped authority is locked.
  // A global target-user lock could invert actor-user locks across two tenants.
  // This does not authenticate that target; its next action verifies identity.
  const [user] = await tx.select({ verified: s.user.emailVerified }).from(s.user).where(eq(s.user.id, membership.userId));
  if (!user) throw new AccessDenied(404);
  return { membership, grant, verified: user.verified };
}

export async function student<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, intent: LockIntent) {
  const [row] = await tx.select({ id: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName,
    ceremonyDate: s.student.ceremonyDate, revision: s.student.revision, disabledAt: s.student.disabledAt }).from(s.student)
    .where(and(eq(s.student.tenantId, tenantId), eq(s.student.id, id))).for(lockStrength(intent));
  if (!row) throw new AccessDenied(404);
  return row;
}

export async function eligibleTutors<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, afterId: string | undefined, limit: number) {
  return tx.select({ grant: s.roleGrant, displayName: s.user.name }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId)).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.role, "tutor"),
      isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt), eq(s.user.emailVerified, true), afterId ? gt(s.roleGrant.id, afterId) : undefined))
    .orderBy(asc(s.roleGrant.id)).limit(limit).for("share", { of: [s.membership, s.roleGrant] });
}

export async function guardianProbe<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, linkId: string) {
  const [row] = await tx.select({ grantId: s.guardian.parentGrantId }).from(s.guardian)
    .where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.studentId, studentId), eq(s.guardian.id, linkId))).limit(1);
  if (!row) throw new AccessDenied(404); return row;
}
export async function identityProbe<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, linkId: string) {
  const [row] = await tx.select({ grantId: s.studentIdentity.roleGrantId }).from(s.studentIdentity)
    .where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.studentIdentity.studentId, studentId), eq(s.studentIdentity.id, linkId))).limit(1);
  if (!row) throw new AccessDenied(404); return row;
}
export async function tutorProbe<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, linkId: string) {
  const [row] = await tx.select({ grantId: s.tutorStudent.tutorGrantId }).from(s.tutorStudent)
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), eq(s.tutorStudent.id, linkId))).limit(1);
  if (!row) throw new AccessDenied(404); return row;
}

export async function guardian<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, linkId: string) {
  const [row] = await tx.select().from(s.guardian).where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.studentId, studentId), eq(s.guardian.id, linkId))).for("update");
  if (!row) throw new AccessDenied(404); return row;
}
export async function identity<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, linkId: string) {
  const [row] = await tx.select().from(s.studentIdentity).where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.studentIdentity.studentId, studentId), eq(s.studentIdentity.id, linkId))).for("update");
  if (!row) throw new AccessDenied(404); return row;
}
export async function tutorLink<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, linkId: string) {
  const [row] = await tx.select().from(s.tutorStudent).where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), eq(s.tutorStudent.id, linkId))).for("update");
  if (!row) throw new AccessDenied(404); return row;
}

export async function inspectLinks<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string) {
  const guardians = await tx.select({ link: s.guardian, revokedGrant: s.roleGrant.revokedAt, grantRevision: s.roleGrant.revision, disabledMembership: s.membership.disabledAt, verified: s.user.emailVerified, displayName: s.user.name }).from(s.guardian)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.guardian.tenantId), eq(s.roleGrant.id, s.guardian.parentGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId))).innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.studentId, studentId), isNull(s.guardian.revokedAt))).orderBy(asc(s.guardian.id)).limit(501);
  const identities = await tx.select({ link: s.studentIdentity, revokedGrant: s.roleGrant.revokedAt, grantRevision: s.roleGrant.revision, disabledMembership: s.membership.disabledAt, verified: s.user.emailVerified, displayName: s.user.name }).from(s.studentIdentity)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.studentIdentity.tenantId), eq(s.roleGrant.id, s.studentIdentity.roleGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId))).innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.studentIdentity.studentId, studentId), isNull(s.studentIdentity.revokedAt))).orderBy(asc(s.studentIdentity.id)).limit(501);
  const tutors = await tx.select({ link: s.tutorStudent, revokedGrant: s.roleGrant.revokedAt, grantRevision: s.roleGrant.revision, disabledMembership: s.membership.disabledAt, verified: s.user.emailVerified, displayName: s.user.name, isCantor: s.roleGrant.isCantor }).from(s.tutorStudent)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.tutorStudent.tenantId), eq(s.roleGrant.id, s.tutorStudent.tutorGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId))).innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), isNull(s.tutorStudent.revokedAt))).orderBy(asc(s.tutorStudent.id)).limit(501);
  if ([guardians, identities, tutors].some(rows => rows.length > 500)) throw new Error("Relationship view unavailable");
  return { guardians, identities, tutors };
}


export async function activeTutorLink<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, grantId: string) {
  const [row] = await tx.select({ id: s.tutorStudent.id }).from(s.tutorStudent).where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId),
    eq(s.tutorStudent.tutorGrantId, grantId), isNull(s.tutorStudent.revokedAt))).for("update");
  return row;
}
export async function insertTutor<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, grantId: string) {
  const [row] = await tx.insert(s.tutorStudent).values({ tenantId, studentId, tutorGrantId: grantId }).returning({ id: s.tutorStudent.id }); return row;
}
export async function revokeTutor<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, now: Date) {
  const [row] = await tx.update(s.tutorStudent).set({ revokedAt: now }).where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.id, id), isNull(s.tutorStudent.revokedAt))).returning({ id: s.tutorStudent.id }); return row;
}
export async function revokeGuardian<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, expected: number, now: Date) {
  const [row] = await tx.update(s.guardian).set({ revokedAt: now, revision: expected + 1 }).where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.id, id),
    eq(s.guardian.revision, expected), isNull(s.guardian.revokedAt))).returning({ id: s.guardian.id, revision: s.guardian.revision }); return row;
}
export async function revokeIdentity<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, now: Date) {
  const [row] = await tx.update(s.studentIdentity).set({ revokedAt: now }).where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.studentIdentity.id, id), isNull(s.studentIdentity.revokedAt))).returning({ id: s.studentIdentity.id }); return row;
}
export async function guardianPractice<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, expected: number, enabled: boolean) {
  const [row] = await tx.update(s.guardian).set({ practiceEnabled: enabled, revision: expected + 1 }).where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.id, id),
    eq(s.guardian.revision, expected), isNull(s.guardian.revokedAt))).returning({ id: s.guardian.id, revision: s.guardian.revision }); return row;
}
export async function cantorFlag<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, expected: number, enabled: boolean) {
  const [row] = await tx.update(s.roleGrant).set({ isCantor: enabled, revision: expected + 1 }).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.id, id),
    eq(s.roleGrant.revision, expected), isNull(s.roleGrant.revokedAt), eq(s.roleGrant.role, "tutor"))).returning({ id: s.roleGrant.id, revision: s.roleGrant.revision }); return row;
}
export async function revokeGrant<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, expected: number, now: Date) {
  const [row] = await tx.update(s.roleGrant).set({ revokedAt: now, revision: expected + 1 }).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.id, id),
    eq(s.roleGrant.revision, expected), isNull(s.roleGrant.revokedAt))).returning({ id: s.roleGrant.id, revision: s.roleGrant.revision }); return row;
}

export async function revokeContexts<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, target: { kind: "guardian" | "identity" | "grant"; id: string }, now: Date) {
  // Tenant UPDATE has already waited for in-flight practice SHARE transactions;
  // lock/update contexts last. Bulk update avoids buffering unlimited tab rows.
  const column = target.kind === "guardian" ? s.practiceContext.guardianId : target.kind === "identity" ? s.practiceContext.studentIdentityId : s.practiceContext.roleGrantId;
  await tx.update(s.practiceContext).set({ revokedAt: now }).where(and(eq(s.practiceContext.tenantId, tenantId), eq(column, target.id), isNull(s.practiceContext.revokedAt)));
}
export async function audit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor,
  action: "tutor.assign" | "tutor.revoke" | "guardian.revoke" | "guardian.practice-set" | "identity.revoke" | "grant.revoke" | "tutor.cantor-set",
  targetId: string, studentId: string | null = null, guardianId: string | null = null) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: "admin", actingStudentId: studentId, guardianId, action, targetType: action === "grant.revoke" || action === "tutor.cantor-set" ? "role_grant"
      : action === "identity.revoke" ? "student_identity" : action.startsWith("guardian.") ? "guardian" : "tutor_student", targetId, requestId: crypto.randomUUID() });
}
