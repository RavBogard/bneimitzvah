import "server-only";
import { sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import { AccessDenied } from "../access/errors";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { savedEligibility } from "../data/saved";
import { canView, liveStaffGrant, type StaffGrant } from "../data/learner-claims";
import type { createMcpAuthService, McpActor } from "../mcp/service";

/** The person whose rows a saved read is about: the owner's own, or (readings for everyone) a learner a staff viewer may see. */
export type SavedScope = Readonly<{ tenantId: string; membershipId: string }>;
/** The verified owner of a saved layer, fixed for one request. */
export type SavedOwner = SavedScope & Readonly<{ userId: string; sessionExpiresAt: number }>;
export type SavedIntent = "read" | "data-write";
/** The staff person reading a learner's shelf: their own membership and the live grant that lets them. */
export type Viewer = Readonly<{ membershipId: string; grant: StaffGrant }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    // Defence in depth: withLive re-derives `live` from this same connection, so these agree today; a record for any other
    // connection, tenant or person is refused before anything is bound.
    if (live.unattended || live.connectionId !== actor.connectionId || live.tenantId !== actor.tenantId || live.membershipId !== actor.membershipId) throw new AccessDenied(403);
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

/**
 * Readings for everyone (Daniel, 2026-10-27; plan decision 3): the staff read path. The one private binding that sets
 * app.saved_viewer (a structural test holds this): the same tenant check as bindOwner, the learner a live, undisabled
 * membership of this tenant under a share lock, then the transaction-local viewer setting that 0054's staff_read policies
 * read. The owner setting is never set on this path, so owner_only's WITH CHECK admits no insert, and no row is visible to an
 * update or delete: the database refuses a write here whatever the action asks.
 */
async function bindViewer<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, learner: SavedScope) {
  const [scope] = await tx.select({ tenant: sql<string | null>`current_setting('app.tenant_id', true)` }).from(sql`(select 1) as scope`);
  if (!scope || scope.tenant !== learner.tenantId) throw new AccessDenied(403);
  if (!await savedEligibility(tx, learner.tenantId, learner.membershipId)) throw new AccessDenied(404);
  await tx.execute(sql`select set_config('app.saved_viewer', ${learner.membershipId}, true)`);
}

/**
 * The staff entrances to other people's shelves, read-only, both under a verified cookie session with a membership in the
 * host's tenant (never a practice-context header):
 * - withSavedViewer: canView decides, from the viewer's own live grants in this tenant, whether this learner's shelf is theirs
 *   to see (a live admin grant; a tutor grant holding the learner's live claim, or linked to the learner's student); anyone
 *   else, a learner id of another tenant and a learner that does not exist are the same 404. Then bindViewer, then the action
 *   with the learner as its scope. Nothing a request sends is ever bound without canView.
 * - withDirectory: a live admin or tutor grant, else 404; then the transaction-local directory setting that 0054's
 *   directory_read policy reads on the readings table alone, so the learner directory can count readings and find the
 *   nearest date and nothing more. Only the saved service's directory read calls it (a structural test holds this).
 */
export function createSavedViewerAccess<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  async function withSavedViewer<T>(request: AccessRequest & { method?: string }, learnerMembershipId: string, action: (tx: AccessTransaction<Q>, scope: SavedScope, viewer: Viewer) => Promise<T>): Promise<T> {
    if (typeof learnerMembershipId !== "string" || !uuid.test(learnerMembershipId)) throw new AccessDenied(404);
    return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      const grant = await canView(tx, identity.tenantId, identity.membership.id, learnerMembershipId);
      if (!grant) throw new AccessDenied(404);
      const scope: SavedScope = Object.freeze({ tenantId: identity.tenantId, membershipId: learnerMembershipId });
      await bindViewer(tx, scope);
      return action(tx, scope, Object.freeze({ membershipId: identity.membership.id, grant }));
    });
  }
  async function withDirectory<T>(request: AccessRequest & { method?: string }, action: (tx: AccessTransaction<Q>, actor: Viewer & Readonly<{ tenantId: string }>) => Promise<T>): Promise<T> {
    return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      const grant = await liveStaffGrant(tx, identity.tenantId, identity.membership.id);
      if (!grant) throw new AccessDenied(404);
      const [scope] = await tx.select({ tenant: sql<string | null>`current_setting('app.tenant_id', true)` }).from(sql`(select 1) as scope`);
      if (!scope || scope.tenant !== identity.tenantId) throw new AccessDenied(403);
      await tx.execute(sql`select set_config('app.saved_directory', 'on', true)`);
      return action(tx, Object.freeze({ tenantId: identity.tenantId, membershipId: identity.membership.id, grant }));
    });
  }
  return Object.freeze({ withSavedViewer, withDirectory });
}
