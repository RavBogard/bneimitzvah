import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

/**
 * The learner directory's people queries and the claim writes (readings for everyone, plan D5). The visibility rule and the
 * claim reads the saved layer shares live in src/server/data/learner-claims.ts. Nothing here names a saved table: counts and
 * nearest dates come from the saved service's own directory read.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
export type RevokedBy = "learner" | "tutor" | "admin";
const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);

/**
 * Every live membership of the tenant but the caller's own, by the account's name (case-folded) then id, at most `limit`;
 * `q` is a case-insensitive prefix on the name; `after` continues past that membership. Raw names: the caller shows them through
 * displayName, so an address-shaped name is never shown. Never an email.
 */
export async function listLearners<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, input: { exceptMembershipId: string; q: string | null; after: string | null; limit: number }) {
  let cursor: { name: string; id: string } | null = null;
  if (input.after) {
    const [row] = await tx.select({ name: s.user.name, id: s.membership.id }).from(s.membership).innerJoin(s.user, eq(s.user.id, s.membership.userId))
      .where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.id, input.after))).limit(1);
    if (!row) return [];
    cursor = { name: row.name, id: row.id };
  }
  return tx.select({ membershipId: s.membership.id, name: s.user.name }).from(s.membership).innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.membership.tenantId, tenantId), isNull(s.membership.disabledAt), sql`${s.membership.id} <> ${input.exceptMembershipId}::uuid`,
      input.q ? sql`lower(${s.user.name}) like ${escapeLike(input.q.toLowerCase()) + "%"} escape '\\'` : undefined,
      cursor ? sql`(lower(${s.user.name}), ${s.membership.id}) > (lower(${cursor.name}), ${cursor.id}::uuid)` : undefined))
    .orderBy(sql`lower(${s.user.name})`, asc(s.membership.id)).limit(input.limit);
}

/** The learner's live student record through their student identity (a live student grant of the learner's membership), or null. */
export async function liveStudentOf<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, learnerMembershipId: string) {
  const [row] = await tx.select({ id: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName, ceremonyDate: s.student.ceremonyDate }).from(s.studentIdentity)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.studentIdentity.tenantId), eq(s.roleGrant.id, s.studentIdentity.roleGrantId), isNull(s.roleGrant.revokedAt), eq(s.roleGrant.role, "student")))
    .innerJoin(s.student, and(eq(s.student.tenantId, s.studentIdentity.tenantId), eq(s.student.id, s.studentIdentity.studentId), isNull(s.student.disabledAt)))
    .where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.roleGrant.membershipId, learnerMembershipId), isNull(s.studentIdentity.revokedAt))).orderBy(asc(s.studentIdentity.id)).limit(1);
  return row ?? null;
}

/** The account name behind a grant of this tenant, raw (the caller applies displayName), with the grant's membership; null for another tenant's grant. */
export async function grantHolder<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, grantId: string) {
  const [row] = await tx.select({ name: s.user.name, membershipId: s.membership.id }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId)).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.id, grantId))).limit(1);
  return row ?? null;
}

/** One learner's claims change one at a time, so one tutor at a time holds and a second claim is a clean 409, never a unique-key error. */
export async function lockLearnerClaims<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, learnerMembershipId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-learner-claim:${tenantId}:${learnerMembershipId}`}, 0))`);
}
/** Names only the four columns 0054 grants INSERT on (the ORM's insert would name every column, defaults included, and be refused). */
export async function insertClaim<Q extends PgQueryResultHKT>(tx: Tx<Q>, value: { tenantId: string; learnerMembershipId: string; tutorGrantId: string; tutorLinkId: string | null }) {
  const result = (await tx.execute(sql`insert into ${s.learnerClaim} (tenant_id, learner_membership_id, tutor_grant_id, tutor_link_id)
    values (${value.tenantId}, ${value.learnerMembershipId}::uuid, ${value.tutorGrantId}::uuid, ${value.tutorLinkId}::uuid) returning id`)) as unknown as { rows: { id: string }[] };
  const row = result.rows[0];
  if (!row) throw new Error("Claim unavailable");
  return row;
}
/** Ends a live claim, whole: when, who (learner, tutor or admin) and which membership. Null when it was already ended. */
export async function revokeClaim<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string, by: RevokedBy, byMembershipId: string) {
  const [row] = await tx.update(s.learnerClaim).set({ revokedAt: new Date(), revokedBy: by, revokedByMembershipId: byMembershipId })
    .where(and(eq(s.learnerClaim.tenantId, tenantId), eq(s.learnerClaim.id, id), isNull(s.learnerClaim.revokedAt))).returning({ id: s.learnerClaim.id });
  return row ?? null;
}
/** The live claim that made this tutor link, locked for update, so an admin's revoke of the link ends the claim too. */
export async function liveClaimForLink<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, linkId: string) {
  const [row] = await tx.select({ id: s.learnerClaim.id }).from(s.learnerClaim)
    .where(and(eq(s.learnerClaim.tenantId, tenantId), eq(s.learnerClaim.tutorLinkId, linkId), isNull(s.learnerClaim.revokedAt))).limit(1).for("update");
  return row ?? null;
}
/** A tutor link of this tenant by id, locked for update. */
export async function tutorLinkRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, linkId: string) {
  const [row] = await tx.select({ id: s.tutorStudent.id, studentId: s.tutorStudent.studentId, tutorGrantId: s.tutorStudent.tutorGrantId, revokedAt: s.tutorStudent.revokedAt }).from(s.tutorStudent)
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.id, linkId))).for("update");
  return row ?? null;
}
/** Any live grant of a membership, for the audit row of a learner's own undo (student first); null for a membership with none. */
export async function anyLiveGrant<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [row] = await tx.select({ id: s.roleGrant.id, role: s.roleGrant.role }).from(s.roleGrant)
    .where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId), isNull(s.roleGrant.revokedAt))).orderBy(sql`${s.roleGrant.role} = 'student' desc`, asc(s.roleGrant.role), asc(s.roleGrant.id)).limit(1).for("share");
  return row ?? null;
}
/** The audit row for a claim or its undo: the actor's own membership and grant, never the learner's, in the actor's own mode. */
export async function auditClaim<Q extends PgQueryResultHKT>(tx: Tx<Q>, actor: Readonly<{ tenantId: string; userId: string; membershipId: string; roleGrantId: string; mode: "student" | "parent" | "tutor" | "admin" }>, action: "learner.claim" | "learner.unclaim", claimId: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId, mode: actor.mode,
    action, targetType: "learner_claim", targetId: claimId, requestId: crypto.randomUUID() });
}
