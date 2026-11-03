import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction, Actor } from "../access/types";
import { insertGrantUnlessActive, lockMembershipGrants, writeInvitationAudit } from "../data/invitations";
import * as s from "../db/index";

/**
 * People with access, Make tutor (docs/planning/2026-11-03-people-tutor/SPEC.md): an admin, with a fresh session, gives a
 * listed person the tutor role. Inside the caller's tenant transaction: the membership is locked first, then its grants. A
 * missing, another congregation's, a disabled or an unverified-address membership is 404, as is one whose Member row was
 * ended with no grant left: fail closed. Someone who has only signed in (a bare
 * membership, made at first sign-in by portal/service.ts beginSession) is listed and may be made a tutor (lead, 2026-11-03). An active tutor grant is already-tutor; an active student grant (child or adult
 * learner) is student. A tutor grant revoked earlier does not block. The grant is the invitation layer's own write, audited
 * grant.issue; a concurrent grant of the same role makes it already-tutor, never an error. No email. Called by the accounts
 * service alone (the structural test names it).
 */
export type MakeTutorRefusal = "already-tutor" | "student";
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
  if (active.some(grant => grant.role === "student")) return { ok: false as const, code: "student" as const };
  const grantId = await insertGrantUnlessActive(tx, actor.tenantId, target.id, "tutor");
  if (!grantId) return { ok: false as const, code: "already-tutor" as const };
  await writeInvitationAudit(tx, actor, "grant.issue", grantId);
  return { ok: true as const };
}
