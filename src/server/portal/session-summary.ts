import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, VerifiedIdentity } from "../access/types";
import { activeMember, approves } from "../accounts/data";
import { availableRoles } from "../data/portal";

/**
 * One summary for both entrances. `saved`: this account keeps its own saved layer, which since readings for everyone
 * (Daniel, 2026-10-27) is every live membership; `approver`: it may approve link requests. The Member role (an approved
 * request) and approving are worked out live, never granted (accounts plan choice B).
 */
export async function summarizePortalSession<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, identity: VerifiedIdentity, membership: VerifiedIdentity["membership"], secret: string) {
  const grants = membership ? await availableRoles(tx, identity.tenantId, membership.id) : [];
  const member = membership ? await activeMember(tx, identity.tenantId, membership.id) : null;
  const approver = membership ? await approves(tx, identity.tenantId, membership.id) : false;
  const sessionBinding = createHmac("sha256", secret).update(JSON.stringify(["session-ui-binding:v2", identity.origin, identity.tenantId, identity.userId,
    identity.authSessionId, membership?.id ?? null, membership?.authorityRevision ?? null, grants.map(grant => [grant.role, grant.id, grant.revision]),
    member?.id ?? null, approver])).digest("base64url");
  return Object.freeze({ membershipAvailable: membership !== null, roles: Object.freeze(grants.map(grant => grant.role)), saved: membership !== null, approver, sessionBinding });
}

export async function matchesSessionBinding<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, identity: VerifiedIdentity, supplied: string | null, secret: string) {
  if (supplied === null || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  const { sessionBinding } = await summarizePortalSession(tx, identity, identity.membership, secret);
  return timingSafeEqual(Buffer.from(sessionBinding), Buffer.from(supplied));
}
