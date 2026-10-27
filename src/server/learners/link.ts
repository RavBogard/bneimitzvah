import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction, Actor } from "../access/types";
import { insertGrant, lockMembershipGrants, writeInvitationAudit } from "../data/invitations";
import { activeTutorLink, student as lockStudentRow } from "../relationships/data";
import * as s from "../db/index";

/**
 * Readings for everyone (plan D6, decision 4): approving a link request with a target links the account to that student record
 * the way accepting a student invitation does: a live student grant of the membership (made if none, audited grant.issue) and
 * a student_identity on the student (audited identity.link), both the invitation layer's own writes. A tutor approver links
 * only to a student the rabbi assigned them; an admin to any enabled student of the congregation; another congregation's, a
 * disabled or an unknown student is 404. A student who already has a live identity is identity-taken; an account already
 * linked to a student is already-linked. Nothing is written before those answers. Called by the accounts service alone.
 */
export type LinkRefusal = "identity-taken" | "already-linked";
export async function linkRequestedStudent<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: Actor, membershipId: string, studentId: string) {
  const target = await lockStudentRow(tx, actor.tenantId, studentId, "authority-write");
  if (target.disabledAt) throw new AccessDenied(404);
  if (actor.mode === "tutor" && !await activeTutorLink(tx, actor.tenantId, studentId, actor.roleGrantId)) throw new AccessDenied(404);
  const taken = await tx.select({ id: s.studentIdentity.id }).from(s.studentIdentity)
    .where(and(eq(s.studentIdentity.tenantId, actor.tenantId), eq(s.studentIdentity.studentId, studentId), isNull(s.studentIdentity.revokedAt))).limit(1).for("update");
  if (taken.length) return { ok: false as const, code: "identity-taken" as const };
  const grants = await lockMembershipGrants(tx, actor.tenantId, membershipId, "authority-write");
  const existing = grants.find(grant => grant.role === "student" && !grant.revokedAt);
  if (existing) {
    const held = await tx.select({ id: s.studentIdentity.id }).from(s.studentIdentity)
      .where(and(eq(s.studentIdentity.tenantId, actor.tenantId), eq(s.studentIdentity.roleGrantId, existing.id), isNull(s.studentIdentity.revokedAt))).limit(1).for("update");
    if (held.length) return { ok: false as const, code: "already-linked" as const };
  }
  const grantId = existing?.id ?? await insertGrant(tx, actor.tenantId, membershipId, "student");
  if (!existing) await writeInvitationAudit(tx, actor, "grant.issue", grantId);
  const [identity] = await tx.insert(s.studentIdentity).values({ tenantId: actor.tenantId, studentId, roleGrantId: grantId }).returning({ id: s.studentIdentity.id });
  await writeInvitationAudit(tx, actor, "identity.link", identity.id);
  return { ok: true as const, identityId: identity.id, grantId };
}
