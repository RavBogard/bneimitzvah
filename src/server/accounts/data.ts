import "server-only";
import { createHmac } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor } from "../access/types";
import * as s from "../db/index";

/**
 * Accounts queries (plan section 2b). Every query filters on the tenant and runs under tenant_isolation. Nothing
 * here touches role_grant except to read it, and nothing reads a saved table (a structural test holds both).
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
const DAY = 24 * 60 * 60_000, HOUR = 60 * 60_000;
export const ACCOUNT_LIMITS = Object.freeze({ requestsPerDay: 3, pendingPerTenant: 50, requestMailsPerHour: 12, recipients: 20 });

export async function activeMember<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string, lock: "share" | "update" = "share") {
  const [row] = await tx.select().from(s.tenantMember).where(and(eq(s.tenantMember.tenantId, tenantId), eq(s.tenantMember.membershipId, membershipId), isNull(s.tenantMember.revokedAt))).limit(1).for(lock);
  return row ?? null;
}
/** Whether an admin ever ended a Member role on this membership (only admins end one). */
export async function wasEnded<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [row] = await tx.select({ id: s.tenantMember.id }).from(s.tenantMember).where(and(eq(s.tenantMember.tenantId, tenantId), eq(s.tenantMember.membershipId, membershipId), isNotNull(s.tenantMember.revokedAt))).limit(1);
  return Boolean(row);
}
/** A live designation for this tutor grant of this membership, share-locked so revoking it waits for the request. */
export async function liveDesignation<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string, tutorGrantId: string) {
  const [row] = await tx.select({ id: s.accountApprover.id }).from(s.accountApprover).where(and(eq(s.accountApprover.tenantId, tenantId), eq(s.accountApprover.membershipId, membershipId),
    eq(s.accountApprover.tutorGrantId, tutorGrantId), isNull(s.accountApprover.revokedAt))).limit(1).for("share");
  return row ?? null;
}
/** Whether a membership approves: an active admin grant, or a live designation backed by its active tutor grant. */
export async function approves<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const grants = await tx.select({ id: s.roleGrant.id, role: s.roleGrant.role }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    inArray(s.roleGrant.role, ["admin", "tutor"]), isNull(s.roleGrant.revokedAt)));
  if (grants.some(grant => grant.role === "admin")) return true;
  const tutor = grants.find(grant => grant.role === "tutor");
  if (!tutor) return false;
  const [row] = await tx.select({ id: s.accountApprover.id }).from(s.accountApprover).where(and(eq(s.accountApprover.tenantId, tenantId), eq(s.accountApprover.membershipId, membershipId),
    eq(s.accountApprover.tutorGrantId, tutor.id), isNull(s.accountApprover.revokedAt))).limit(1);
  return Boolean(row);
}

export async function requestOf<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, userId: string) {
  const [row] = await tx.select({ id: s.accountRequest.id }).from(s.accountRequest).where(and(eq(s.accountRequest.tenantId, tenantId), eq(s.accountRequest.userId, userId))).limit(1);
  return row ?? null;
}
/** One request at a time per congregation, so the pending cap holds exactly. */
export async function lockRequestQueue<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-account-requests:${tenantId}`}, 0))`);
}
export async function pendingCount<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  const [row] = await tx.select({ n: count() }).from(s.accountRequest).where(eq(s.accountRequest.tenantId, tenantId));
  return row?.n ?? 0;
}
/** A fixed-window budget in the shared throttle table, keyed by an HMAC so no identifier is stored. False when spent. */
export async function consume<Q extends PgQueryResultHKT>(tx: Tx<Q>, input: { tenantId: string; scope: "account-request" | "account-mail"; subject: string; limit: number; secret: string; now: number }) {
  const window = input.scope === "account-request" ? DAY : HOUR, bucketStart = Math.floor(input.now / window) * window;
  const key = createHmac("sha256", input.secret).update(JSON.stringify([input.scope, input.tenantId, input.subject])).digest("hex");
  const [counter] = await tx.insert(s.invitationThrottle).values({ tenantId: input.tenantId, scope: input.scope, key, bucketStart, count: 1 })
    .onConflictDoUpdate({ target: [s.invitationThrottle.tenantId, s.invitationThrottle.scope, s.invitationThrottle.key, s.invitationThrottle.bucketStart],
      set: { count: sql`${s.invitationThrottle.count} + 1` }, setWhere: sql`${s.invitationThrottle.count} < ${input.limit}` }).returning({ count: s.invitationThrottle.count });
  return Boolean(counter);
}
export async function insertRequest<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, userId: string, displayName: string, purpose: string | null) {
  const [row] = await tx.insert(s.accountRequest).values({ tenantId, userId, displayName, purpose }).onConflictDoNothing().returning({ id: s.accountRequest.id });
  return row ?? null;
}
export async function markRequestNotice<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string, status: "sent" | "failed" | "skipped", at: Date) {
  await tx.update(s.accountRequest).set(status === "skipped" ? { notifyStatus: status } : { notifyStatus: status, notifyAttemptedAt: at })
    .where(and(eq(s.accountRequest.tenantId, tenantId), eq(s.accountRequest.id, id), eq(s.accountRequest.notifyStatus, "pending")));
}

export type Recipient = Readonly<{ userId: string; email: string }>;
/** Who is told of a request: active admins, and tutors with a live designation; enabled memberships, verified addresses, at most 20. */
export async function approverRecipients<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, limit: number): Promise<Recipient[]> {
  const admins = tx.select({ userId: s.user.id, email: s.user.email }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.role, "admin"), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt), eq(s.user.emailVerified, true)));
  const tutors = tx.select({ userId: s.user.id, email: s.user.email }).from(s.accountApprover)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.accountApprover.tenantId), eq(s.roleGrant.id, s.accountApprover.tutorGrantId), eq(s.roleGrant.membershipId, s.accountApprover.membershipId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.accountApprover.tenantId), eq(s.membership.id, s.accountApprover.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.accountApprover.tenantId, tenantId), isNull(s.accountApprover.revokedAt), eq(s.roleGrant.role, "tutor"), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt), eq(s.user.emailVerified, true)));
  const rows = [...await admins, ...await tutors].sort((a, b) => a.userId.localeCompare(b.userId));
  const seen = new Set<string>(), out: Recipient[] = [];
  for (const row of rows) { if (seen.has(row.userId) || out.length >= limit) continue; seen.add(row.userId); out.push(Object.freeze({ userId: row.userId, email: row.email })); }
  return out;
}
export { readTenantNames as tenantNames } from "../data/product-name";

export async function listRequests<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, limit: number) {
  return tx.select({ id: s.accountRequest.id, name: s.accountRequest.displayName, purpose: s.accountRequest.purpose, email: s.user.email, verified: s.user.emailVerified, requestedAt: s.accountRequest.createdAt })
    .from(s.accountRequest).innerJoin(s.user, eq(s.user.id, s.accountRequest.userId))
    .where(eq(s.accountRequest.tenantId, tenantId)).orderBy(asc(s.accountRequest.createdAt), asc(s.accountRequest.id)).limit(limit);
}
export async function lockRequest<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string) {
  const [row] = await tx.select().from(s.accountRequest).where(and(eq(s.accountRequest.tenantId, tenantId), eq(s.accountRequest.id, id))).for("update");
  return row ?? null;
}
export async function deleteRequest<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string) {
  const rows = await tx.delete(s.accountRequest).where(and(eq(s.accountRequest.tenantId, tenantId), eq(s.accountRequest.id, id))).returning({ id: s.accountRequest.id });
  return rows.length === 1;
}
/** The requester's account, locked before their membership (the global lock order: user, then membership). */
export async function lockRequester<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, userId: string) {
  const [account] = await tx.select({ id: s.user.id, email: s.user.email, verified: s.user.emailVerified }).from(s.user).where(eq(s.user.id, userId)).for("update");
  const [member] = await tx.select().from(s.membership).where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.userId, userId))).for("update");
  return { account: account ?? null, membership: member ?? null };
}
export async function insertMembership<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, userId: string) {
  const [row] = await tx.insert(s.membership).values({ tenantId, userId }).returning();
  return row;
}
export async function insertMember<Q extends PgQueryResultHKT>(tx: Tx<Q>, value: { tenantId: string; membershipId: string; userId: string; displayName: string; approvedBy: string }) {
  const [row] = await tx.insert(s.tenantMember).values({ tenantId: value.tenantId, membershipId: value.membershipId, userId: value.userId, displayName: value.displayName,
    approvedByMembershipId: value.approvedBy }).returning();
  return row;
}
export async function markWelcome<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string, status: "sent" | "failed" | "skipped", at: Date) {
  await tx.update(s.tenantMember).set(status === "skipped" ? { welcomeStatus: status } : { welcomeStatus: status, welcomeAttemptedAt: at })
    .where(and(eq(s.tenantMember.tenantId, tenantId), eq(s.tenantMember.id, id), eq(s.tenantMember.welcomeStatus, "pending")));
}

export async function listMembers<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, limit: number) {
  return tx.select({ id: s.tenantMember.id, name: s.tenantMember.displayName, since: s.tenantMember.createdAt }).from(s.tenantMember)
    .where(and(eq(s.tenantMember.tenantId, tenantId), isNull(s.tenantMember.revokedAt))).orderBy(asc(s.tenantMember.displayName), asc(s.tenantMember.id)).limit(limit);
}
export async function endMember<Q extends PgQueryResultHKT>(tx: Tx<Q>, actor: Actor, id: string) {
  const [row] = await tx.update(s.tenantMember).set({ revokedAt: new Date(), revokedByMembershipId: actor.membershipId })
    .where(and(eq(s.tenantMember.tenantId, actor.tenantId), eq(s.tenantMember.id, id), isNull(s.tenantMember.revokedAt))).returning({ id: s.tenantMember.id });
  return row ?? null;
}

/** Active admins (named), live designations (named, by id) and the tutors who could be designated. */
export async function approverView<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  const admins = await tx.select({ membershipId: s.membership.id, name: s.user.name }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.role, "admin"), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt))).orderBy(asc(s.user.name)).limit(100);
  const designated = await tx.select({ id: s.accountApprover.id, membershipId: s.accountApprover.membershipId, name: s.user.name }).from(s.accountApprover)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.accountApprover.tenantId), eq(s.roleGrant.id, s.accountApprover.tutorGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.accountApprover.tenantId), eq(s.membership.id, s.accountApprover.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.accountApprover.tenantId, tenantId), isNull(s.accountApprover.revokedAt), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt))).orderBy(asc(s.user.name)).limit(100);
  const tutors = await tx.select({ tutorGrantId: s.roleGrant.id, membershipId: s.membership.id, name: s.user.name }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.role, "tutor"), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt))).orderBy(asc(s.user.name)).limit(200);
  const adminIds = new Set(admins.map(row => row.membershipId)), designatedIds = new Set(designated.map(row => row.membershipId));
  return { admins, designated, candidates: tutors.filter(row => !adminIds.has(row.membershipId) && !designatedIds.has(row.membershipId)) };
}
/** The tutor grant to designate, locked: active, its membership enabled. */
export async function lockTutorGrant<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, grantId: string) {
  const [row] = await tx.select({ id: s.roleGrant.id, membershipId: s.roleGrant.membershipId, role: s.roleGrant.role, revokedAt: s.roleGrant.revokedAt, disabledAt: s.membership.disabledAt })
    .from(s.roleGrant).innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.id, grantId))).for("update", { of: s.roleGrant });
  return row ?? null;
}
export async function hasActiveAdmin<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [row] = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    eq(s.roleGrant.role, "admin"), isNull(s.roleGrant.revokedAt))).limit(1);
  return Boolean(row);
}
export async function activeDesignationOf<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  // With its grant's state: a designation whose tutor grant was revoked is already dead, and only blocks the unique key.
  const [row] = await tx.select({ id: s.accountApprover.id, grantRevokedAt: s.roleGrant.revokedAt }).from(s.accountApprover)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.accountApprover.tenantId), eq(s.roleGrant.id, s.accountApprover.tutorGrantId)))
    .where(and(eq(s.accountApprover.tenantId, tenantId), eq(s.accountApprover.membershipId, membershipId), isNull(s.accountApprover.revokedAt))).limit(1).for("update", { of: s.accountApprover });
  return row ?? null;
}
export async function insertDesignation<Q extends PgQueryResultHKT>(tx: Tx<Q>, actor: Actor, grant: { id: string; membershipId: string }) {
  const [row] = await tx.insert(s.accountApprover).values({ tenantId: actor.tenantId, membershipId: grant.membershipId, tutorGrantId: grant.id, designatedByMembershipId: actor.membershipId })
    .onConflictDoNothing().returning({ id: s.accountApprover.id });
  return row ?? null;
}
export async function revokeDesignation<Q extends PgQueryResultHKT>(tx: Tx<Q>, actor: Actor, id: string) {
  const [row] = await tx.update(s.accountApprover).set({ revokedAt: new Date(), revokedByMembershipId: actor.membershipId })
    .where(and(eq(s.accountApprover.tenantId, actor.tenantId), eq(s.accountApprover.id, id), isNull(s.accountApprover.revokedAt))).returning({ id: s.accountApprover.id });
  return row ?? null;
}

export type AccountsAction = "account-request.approve" | "account-request.decline" | "member.revoke" | "approver.designate" | "approver.revoke";
export async function audit<Q extends PgQueryResultHKT>(tx: Tx<Q>, actor: Actor, action: AccountsAction, targetType: "account_request" | "tenant_member" | "account_approver", targetId: string, requestId: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, mode: actor.mode, roleGrantId: actor.roleGrantId,
    action, targetType, targetId, requestId });
}
