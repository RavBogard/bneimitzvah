import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "./types";
import { SAVED_ELIGIBLE_ROLES } from "../saved/eligibility";
import * as s from "../db/index";

/**
 * Whether a membership keeps member features now (accounts plan choice B): a live parent, tutor or admin grant,
 * or a live tenant_member row. Share-locks what it finds, so a concurrent revocation or end of membership waits.
 * Reads only role_grant and tenant_member; the saved layer and the accounts code both ask here.
 */
export async function memberEligible<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string) {
  const [grant] = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    inArray(s.roleGrant.role, [...SAVED_ELIGIBLE_ROLES]), isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.role), asc(s.roleGrant.id)).limit(1).for("share");
  if (grant) return true;
  const [member] = await tx.select({ id: s.tenantMember.id }).from(s.tenantMember).where(and(eq(s.tenantMember.tenantId, tenantId), eq(s.tenantMember.membershipId, membershipId),
    isNull(s.tenantMember.revokedAt))).limit(1).for("share");
  return member !== undefined;
}
