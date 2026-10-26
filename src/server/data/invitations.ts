import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction, Actor, LockIntent, VerifiedIdentity } from "../access/types";
import { lockStrength } from "../access/types";
import * as s from "../db/index";

export type InvitedRole = "parent" | "student" | "tutor";
const HOUR = 60 * 60_000;

export async function listInvitations<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, afterId: string | undefined, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AccessDenied(403);
  // Explicit private-admin contact projection. Never select token hashes,
  // inviter/acceptor identities, sessions, or global user profiles.
  return tx.select({ id: s.invite.id, role: s.invite.role, recipientEmail: s.invite.email, studentId: s.invite.studentId,
    firstName: s.student.firstName, lastName: s.student.lastName, targetId: s.student.id,
    createdAt: s.invite.createdAt, expiresAt: s.invite.expiresAt, acceptedAt: s.invite.acceptedAt, revokedAt: s.invite.revokedAt,
    deliveryStatus: s.invite.deliveryStatus, deliveryAttemptedAt: s.invite.deliveryAttemptedAt })
    .from(s.invite).leftJoin(s.student, and(eq(s.student.tenantId, s.invite.tenantId), eq(s.student.id, s.invite.studentId)))
    .where(and(eq(s.invite.tenantId, tenantId), afterId === undefined ? undefined : gt(s.invite.id, afterId)))
    .orderBy(s.invite.id).limit(limit).for("share", { of: s.invite });
}

/**
 * "Needs a parent invitation" (G13): approved members (tenant_member, live) whose verified address is a parent contact
 * on an enabled student's roster record, with no live guardian link to that student through a live parent grant of
 * their own membership, and no live, unexpired parent invitation to that address for that student. Never selects a
 * token hash, a session or anything saved.
 */
export async function listParentInvitationsNeeded<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, now: Date, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AccessDenied(403);
  const address = sql`lower(trim(${s.user.email}))`;
  return tx.select({ memberId: s.tenantMember.id, name: s.tenantMember.displayName, email: s.user.email,
    studentId: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName })
    .from(s.tenantMember)
    .innerJoin(s.user, eq(s.user.id, s.tenantMember.userId))
    .innerJoin(s.student, and(eq(s.student.tenantId, s.tenantMember.tenantId), isNull(s.student.disabledAt),
      sql`(lower(trim(${s.student.parentEmail})) = ${address} or lower(trim(${s.student.secondParentEmail})) = ${address})`))
    .where(and(eq(s.tenantMember.tenantId, tenantId), isNull(s.tenantMember.revokedAt), eq(s.user.emailVerified, true),
      sql`not exists (select 1 from ${s.guardian} inner join ${s.roleGrant} on ${s.roleGrant.tenantId} = ${s.guardian.tenantId} and ${s.roleGrant.id} = ${s.guardian.parentGrantId}
        where ${s.guardian.tenantId} = ${tenantId} and ${s.guardian.studentId} = ${s.student.id} and ${s.guardian.revokedAt} is null
          and ${s.roleGrant.membershipId} = ${s.tenantMember.membershipId} and ${s.roleGrant.revokedAt} is null)`,
      sql`not exists (select 1 from ${s.invite} where ${s.invite.tenantId} = ${tenantId} and ${s.invite.role} = 'parent' and ${s.invite.studentId} = ${s.student.id}
        and ${s.invite.email} = ${address} and ${s.invite.acceptedAt} is null and ${s.invite.revokedAt} is null and ${s.invite.expiresAt} > ${now.toISOString()}::timestamptz)`))
    .orderBy(s.tenantMember.id, s.student.id).limit(limit);
}

export async function consumeInvitationBudget<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, email: string, secret: string, now: number) {
  const bucketStart = Math.floor(now / HOUR) * HOUR;
  for (const [scope, value, limit] of [["actor", actor.membershipId, 20], ["recipient", email, 5]] as const) {
    const key = createHmac("sha256", secret).update(JSON.stringify(["invitation.issue", actor.tenantId, scope, value])).digest("hex");
    const [counter] = await tx.insert(s.invitationThrottle).values({ tenantId: actor.tenantId, scope, key, bucketStart, count: 1 })
      .onConflictDoUpdate({ target: [s.invitationThrottle.tenantId, s.invitationThrottle.scope, s.invitationThrottle.key, s.invitationThrottle.bucketStart],
        set: { count: sql`${s.invitationThrottle.count} + 1` }, setWhere: sql`${s.invitationThrottle.count} < ${limit}` }).returning({ count: s.invitationThrottle.count });
    if (!counter) throw new AccessDenied(403);
  }
}

export async function lockInvitation<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string) {
  const [row] = await tx.select().from(s.invite).where(and(eq(s.invite.tenantId, tenantId), eq(s.invite.id, id))).for("update");
  return row;
}
export async function lockInvitationByHash<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, tokenHash: string, intent: LockIntent = "authority-write") {
  const [row] = await tx.select().from(s.invite).where(and(eq(s.invite.tenantId, tenantId), eq(s.invite.tokenHash, tokenHash))).for(lockStrength(intent));
  return row;
}
export async function insertInvitation<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, input: typeof s.invite.$inferInsert) {
  const [row] = await tx.insert(s.invite).values(input).returning();
  return row;
}
export async function revokeInvitation<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, now: Date) {
  const [row] = await tx.update(s.invite).set({ revokedAt: now }).where(and(eq(s.invite.tenantId, tenantId), eq(s.invite.id, id), isNull(s.invite.acceptedAt), isNull(s.invite.revokedAt))).returning({ id: s.invite.id });
  return row;
}
export async function consumeInvitation<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string, membershipId: string, now: Date) {
  const [row] = await tx.update(s.invite).set({ acceptedAt: now, acceptedMembershipId: membershipId }).where(and(
    eq(s.invite.tenantId, tenantId), eq(s.invite.id, id), isNull(s.invite.acceptedAt), isNull(s.invite.revokedAt), gt(s.invite.expiresAt, now),
  )).returning({ id: s.invite.id });
  return row;
}

export async function lockInvitationStudent<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, intent: LockIntent = "authority-write") {
  const [row] = await tx.select({ id: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName, parentEmail: s.student.parentEmail, secondParentEmail: s.student.secondParentEmail, disabledAt: s.student.disabledAt })
    .from(s.student).where(and(eq(s.student.tenantId, tenantId), eq(s.student.id, studentId))).for(lockStrength(intent));
  return row;
}

export async function mailboxHasParentIdentity<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, email: string) {
  const rows = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.role, "parent"), sql`lower(${s.user.email}) = ${email}`)).limit(1);
  return rows.length > 0;
}

export async function obtainMembership<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, identity: VerifiedIdentity) {
  if (identity.membership) return identity.membership.id;
  const [row] = await tx.insert(s.membership).values({ tenantId: identity.tenantId, userId: identity.userId }).returning({ id: s.membership.id });
  return row.id;
}
export async function lockMembershipGrants<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string, intent: LockIntent = "authority-write") {
  return tx.select().from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId))).orderBy(s.roleGrant.id).for(lockStrength(intent));
}
export async function insertGrant<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string, role: InvitedRole) {
  const [row] = await tx.insert(s.roleGrant).values({ tenantId, membershipId, role }).returning({ id: s.roleGrant.id });
  return row.id;
}

// The same read-only eligibility check serves preview and locked acceptance.
// A missing future grant must still check occupied/revoked student history.
export async function eligibleInvitedStudentLink<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, grantId: string | null, role: "parent" | "student", issuedAt: Date, intent: LockIntent) {
  if (role === "parent") {
    if (!grantId) return null;
    const history = await tx.select().from(s.guardian).where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.studentId, studentId), eq(s.guardian.parentGrantId, grantId))).orderBy(s.guardian.id).for(lockStrength(intent));
    if (history.some(link => link.revokedAt && link.revokedAt >= issuedAt)) throw new AccessDenied(404);
    return history.find(link => !link.revokedAt) ?? null;
  }
  const history = await tx.select().from(s.studentIdentity).where(and(eq(s.studentIdentity.tenantId, tenantId),
    grantId ? sql`(${s.studentIdentity.studentId} = ${studentId} or ${s.studentIdentity.roleGrantId} = ${grantId})` : eq(s.studentIdentity.studentId, studentId)))
    .orderBy(s.studentIdentity.id).for(lockStrength(intent));
  if (history.some(link => link.revokedAt && link.revokedAt >= issuedAt)) throw new AccessDenied(404);
  const links = history.filter(link => !link.revokedAt);
  if (links.some(link => link.studentId !== studentId || link.roleGrantId !== grantId)) throw new AccessDenied(404);
  return links[0] ?? null;
}

export async function linkInvitedStudent<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, grantId: string, role: "parent" | "student", inviteId: string, issuedAt: Date) {
  const existing = await eligibleInvitedStudentLink(tx, tenantId, studentId, grantId, role, issuedAt, "authority-write");
  if (existing) return { id: existing.id, created: false };
  if (role === "parent") {
    const [link] = await tx.insert(s.guardian).values({ tenantId, studentId, parentGrantId: grantId, linkProvenance: `invite:${inviteId}` }).returning({ id: s.guardian.id });
    return { id: link.id, created: true };
  }
  const [link] = await tx.insert(s.studentIdentity).values({ tenantId, studentId, roleGrantId: grantId }).returning({ id: s.studentIdentity.id });
  return { id: link.id, created: true };
}

export async function writeInvitationAudit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, action: "invite.issue" | "invite.accept" | "invite.revoke" | "invite.delivery-sent" | "invite.delivery-failed" | "grant.issue" | "guardian.link" | "identity.link", targetId: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: actor.mode, action, targetType: action === "grant.issue" ? "role_grant" : action === "guardian.link" ? "guardian" : action === "identity.link" ? "student_identity" : "invitation", targetId, requestId: crypto.randomUUID() });
}

// Narrow postcommit receipt recorder: historical immutable identities are checked,
// not current authorization. Logout/revocation cannot erase a transport outcome.
export type IssuedInvitation = typeof s.invite.$inferSelect;
export async function recordDeliveryOutcome<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, issued: IssuedInvitation, actor: Actor, outcome: "sent" | "failed") {
  const [tenant] = await tx.select({ id: s.tenant.id }).from(s.tenant).where(eq(s.tenant.id, actor.tenantId)).for("update");
  if (!tenant || actor.mode !== "admin" || issued.tenantId !== actor.tenantId || issued.inviterMembershipId !== actor.membershipId) throw new Error("Delivery receipt unavailable");
  const current = await lockInvitation(tx, actor.tenantId, issued.id);
  if (!current || current.deliveryStatus !== "pending" || current.tokenHash !== issued.tokenHash || current.email !== issued.email || current.role !== issued.role
    || current.studentId !== issued.studentId || current.inviterMembershipId !== issued.inviterMembershipId
    || current.createdAt.getTime() !== issued.createdAt.getTime() || current.expiresAt.getTime() !== issued.expiresAt.getTime()) throw new Error("Delivery receipt unavailable");
  // Immutable composite FKs and authority identity triggers retain these records
  // after revocation; no session/active grant is needed to append this provenance.
  const provenance = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .where(and(eq(s.roleGrant.tenantId, actor.tenantId), eq(s.roleGrant.id, actor.roleGrantId), eq(s.roleGrant.role, "admin"),
      eq(s.roleGrant.membershipId, actor.membershipId), eq(s.membership.userId, actor.userId)));
  if (provenance.length !== 1) throw new Error("Delivery receipt unavailable");
  const [updated] = await tx.update(s.invite).set({ deliveryStatus: outcome, deliveryAttemptedAt: new Date() })
    .where(and(eq(s.invite.tenantId, actor.tenantId), eq(s.invite.id, issued.id), eq(s.invite.deliveryStatus, "pending"))).returning({ id: s.invite.id });
  if (!updated) throw new Error("Delivery receipt unavailable");
  await writeInvitationAudit(tx, actor, outcome === "sent" ? "invite.delivery-sent" : "invite.delivery-failed", issued.id);
}
