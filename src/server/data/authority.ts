import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, ActiveMode, LockIntent } from "../access/types";
import { lockStrength } from "../access/types";
import * as s from "../db/index";

export type SessionProof = Readonly<{ id: string; userId: string; token: string }>;

export async function lockIdentityRecords<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, proof: SessionProof, intent: LockIntent) {
  const strength = lockStrength(intent);
  const [tenant] = await tx.select({ enabled: s.tenant.enabled }).from(s.tenant).where(eq(s.tenant.id, tenantId)).for(strength);
  const [user] = await tx.select({ id: s.user.id, verified: s.user.emailVerified, email: s.user.email }).from(s.user).where(eq(s.user.id, proof.userId)).for(strength);
  const [session] = await tx.select({ id: s.session.id, userId: s.session.userId, expiresAt: s.session.expiresAt, createdAt: s.session.createdAt })
    .from(s.session).where(and(eq(s.session.id, proof.id), eq(s.session.userId, proof.userId), eq(s.session.token, proof.token))).for(strength);
  const [membership] = await tx.select().from(s.membership).where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.userId, proof.userId))).for(strength);
  return { tenant, user, session, membership };
}

export async function lockRoleGrant<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string, mode: ActiveMode, intent: LockIntent) {
  const [grant] = await tx.select().from(s.roleGrant).where(and(
    eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId), eq(s.roleGrant.role, mode), isNull(s.roleGrant.revokedAt),
  )).for(lockStrength(intent));
  return grant;
}

export async function lockActorRecords<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, proof: SessionProof, mode: ActiveMode, intent: LockIntent) {
  const records = await lockIdentityRecords(tx, tenantId, proof, intent);
  const grant = records.membership ? await lockRoleGrant(tx, tenantId, records.membership.id, mode, intent) : undefined;
  return { ...records, grant };
}

export async function lockStudent<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, intent: LockIntent) {
  const [student] = await tx.select({
    id: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName,
    ceremonyDate: s.student.ceremonyDate, rehearsal1: s.student.rehearsal1, rehearsal2: s.student.rehearsal2, serviceSlot: s.student.serviceSlot, studentKind: s.student.studentKind, revision: s.student.revision, disabledAt: s.student.disabledAt,
  }).from(s.student).where(and(eq(s.student.tenantId, tenantId), eq(s.student.id, studentId))).for(intent === "honoree-link-write" ? "update" : lockStrength(intent));
  return student;
}

export async function lockStudentRelationship<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, grantId: string, mode: ActiveMode, intent: LockIntent) {
  const strength = lockStrength(intent);
  if (mode === "admin") return { id: null, revision: null };
  if (mode === "parent") {
    const [link] = await tx.select({ id: s.guardian.id, revision: s.guardian.revision }).from(s.guardian).where(and(
      eq(s.guardian.tenantId, tenantId), eq(s.guardian.studentId, studentId), eq(s.guardian.parentGrantId, grantId), isNull(s.guardian.revokedAt),
    )).for(strength);
    return link;
  }
  if (mode === "tutor") {
    const [link] = await tx.select({ id: s.tutorStudent.id }).from(s.tutorStudent).where(and(
      eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), eq(s.tutorStudent.tutorGrantId, grantId), isNull(s.tutorStudent.revokedAt),
    )).for(strength);
    return link ? { ...link, revision: null } : undefined;
  }
  const [link] = await tx.select({ id: s.studentIdentity.id }).from(s.studentIdentity).where(and(
    eq(s.studentIdentity.tenantId, tenantId), eq(s.studentIdentity.studentId, studentId), eq(s.studentIdentity.roleGrantId, grantId), isNull(s.studentIdentity.revokedAt),
  )).for(strength);
  return link ? { ...link, revision: null } : undefined;
}
