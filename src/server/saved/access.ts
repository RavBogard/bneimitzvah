import "server-only";
import { sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import { AccessDenied } from "../access/errors";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { savedEligibility } from "../data/saved";
import type { createMcpAuthService, McpActor } from "../mcp/service";

/** The verified owner of a saved layer, fixed for one request. */
export type SavedOwner = Readonly<{ tenantId: string; membershipId: string; userId: string; sessionExpiresAt: number }>;
export type SavedIntent = "read" | "data-write";

/**
 * The one private binding both entrances share (a structural test holds this): inside a tenant transaction that
 * withTenantTransaction opened for this same tenant, live eligibility under a share lock, then the transaction-local
 * owner setting the forced owner_only policy reads. The owner is always a server-verified membership: the cookie
 * session's own (createSavedAccess) or the MCP connection's own (withConnectionOwner), never a caller's id.
 */
async function bindOwner<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, owner: Readonly<{ tenantId: string; membershipId: string }>) {
  // The tenant the policy reads must be this owner's: both come from the same resolved host, and this makes it hold here too.
  const [scope] = await tx.select({ tenant: sql<string | null>`current_setting('app.tenant_id', true)` }).from(sql`(select 1) as scope`);
  if (!scope || scope.tenant !== owner.tenantId) throw new AccessDenied(403);
  if (!await savedEligibility(tx, owner.tenantId, owner.membershipId)) throw new AccessDenied(403);
  await tx.execute(sql`select set_config('app.saved_owner', ${owner.membershipId}, true)`);
}

/**
 * The only place that sets app.saved_owner (a structural test holds this). The cookie entrance, in order:
 * 1. a verified cookie session (no practice-context header; a POST needs the exact Origin);
 * 2. a membership in the host's tenant, not disabled;
 * 3. bindOwner: live eligibility under a share lock, then the transaction-local owner setting;
 * 4. the action, with the session's expiry checked before and after it.
 * Staff, cron, the roster Sheet and notifications never come through here and see no saved rows. The MCP comes
 * through withConnectionOwner below, and only for the connection's own person.
 */
export function createSavedAccess<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  return async function withSavedOwner<T>(request: AccessRequest & { method?: string }, intent: SavedIntent, action: (tx: AccessTransaction<Q>, owner: SavedOwner) => Promise<T>): Promise<T> {
    if (intent !== "read" && intent !== "data-write") throw new AccessDenied(403);
    return input.access.withVerifiedIdentity(request, { intent, mutation: intent !== "read" }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      await bindOwner(tx, { tenantId: identity.tenantId, membershipId: identity.membership.id });
      const owner: SavedOwner = Object.freeze({ tenantId: identity.tenantId, membershipId: identity.membership.id, userId: identity.userId,
        sessionExpiresAt: identity.sessionExpiresAt.getTime() });
      const assertLive = () => { if (owner.sessionExpiresAt <= Date.now()) throw new AccessDenied(401); };
      assertLive();
      const result = await action(tx, owner);
      // Lock waits inside the action can outlast the session; an expiry rolls the whole write back.
      assertLive();
      return result;
    });
  };
}

/**
 * The MCP entrance (release 1.7 M4; MISSION 2026-10-23, "Existing MCP users"): the person a connection acts for reaches
 * their own saved readings, and no one else's. In order:
 * 1. withLive re-locks the connection inside its tenant transaction: the tenant enabled, the connection unrevoked and
 *    unexpired, its user verified, its membership live and undisabled at the same authority revision, and its own admin
 *    or tutor grant unrevoked at the same revision;
 * 2. an attended connection only: a scheduled routine (unattended) never reaches anyone's saved readings;
 * 3. bindOwner with the connection's own membership, the same binding the cookie entrance uses;
 * 4. the action, with the token and connection expiry checked before and after it.
 * Nothing a tool's caller sends names the owner. Staff connections reach only their own person's rows, like anyone else's.
 */
export async function withConnectionOwner<Q extends PgQueryResultHKT, T>(mcp: Pick<ReturnType<typeof createMcpAuthService<Q>>, "withLive">, actor: McpActor,
  intent: SavedIntent, signal: AbortSignal, action: (tx: AccessTransaction<Q>, owner: SavedOwner) => Promise<T>): Promise<T> {
  if (intent !== "read" && intent !== "data-write") throw new AccessDenied(403);
  if (actor.unattended) throw new AccessDenied(403);
  return mcp.withLive(actor, intent, async (tx, live, alive) => {
    if (live.unattended || live.connectionId !== actor.connectionId || live.tenantId !== actor.tenantId) throw new AccessDenied(403);
    if (live.role !== "admin" && live.role !== "tutor") throw new AccessDenied(403);
    await bindOwner(tx, { tenantId: live.tenantId, membershipId: live.membershipId });
    const owner: SavedOwner = Object.freeze({ tenantId: live.tenantId, membershipId: live.membershipId, userId: live.userId, sessionExpiresAt: live.expiresAt });
    const assertLive = () => { alive(); if (signal.aborted) throw new AccessDenied(401); };
    assertLive();
    const result = await action(tx, owner);
    // As above: a lock wait that outlasts the token, or a call the transport already gave up on, rolls the write back.
    assertLive();
    return result;
  });
}
