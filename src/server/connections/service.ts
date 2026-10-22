import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, LockIntent, VerifiedIdentity } from "../access/types";
import { lockRoleGrant } from "../data/authority";
import * as data from "../data/mcp-connections";

/** What a connection may do, in the words the page shows: read, study guides, roster. */
export type ConnectionAccess = "read" | "study" | "roster";
export type ConnectionView = Readonly<{
  id: string; client: string; role: "admin" | "tutor"; access: readonly ConnectionAccess[]; routine: boolean;
  approvedAt: string; expiresAt: string; mine: boolean;
  /** Another staff member's display name (an admin's view only); never an address. */
  staffName: string | null;
}>;
export type ConnectionsView = Readonly<{ role: "admin" | "tutor"; connections: readonly ConnectionView[]; truncated: boolean }>;
export type RevokeResult = Readonly<{ ok: true; ended: boolean }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCESS: Record<string, ConnectionAccess> = { "portal:read": "read", "portal:study": "study", "portal:roster": "roster" };
const plain = (value: string | null | undefined, fallback: string) => {
  const text = (value ?? "").trim();
  // An address never leaves the server, even as a display name.
  return text && !text.includes("@") && !/[\u0000-\u001f\u007f<>]/.test(text) ? text.slice(0, 80) : fallback;
};

/**
 * Claude connections for a staff member's own page (release 1.1): a tutor sees and ends only their own; an admin also
 * sees and ends every other staff connection in the congregation. Ending one needs a sign-in from the last 15 minutes,
 * like the portal's other access changes (invitations, tutor and family links), and is audited.
 */
export function createClaudeConnectionsService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">; now?: () => number }) {
  const now = input.now ?? Date.now;
  async function staff(tx: AccessTransaction<Q>, identity: VerifiedIdentity, intent: LockIntent) {
    if (!identity.membership) throw new AccessDenied(403);
    const admin = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "admin", intent);
    if (admin && !admin.revokedAt) return { role: "admin" as const, grantId: admin.id, membershipId: identity.membership.id };
    const tutor = await lockRoleGrant(tx, identity.tenantId, identity.membership.id, "tutor", intent);
    if (tutor && !tutor.revokedAt) return { role: "tutor" as const, grantId: tutor.id, membershipId: identity.membership.id };
    throw new AccessDenied(403);
  }
  return Object.freeze({
    async list(request: AccessRequest & { method?: string }): Promise<ConnectionsView> {
      return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
        const viewer = await staff(tx, identity, "read");
        const rows = await data.liveConnections(tx, identity.tenantId, new Date(now()), viewer.role === "admin" ? undefined : viewer.membershipId);
        const connections = rows.slice(0, 100).map((row): ConnectionView => {
          const mine = row.membershipId === viewer.membershipId;
          return Object.freeze({ id: row.id, client: plain(row.clientName, "Claude"), role: row.role === "admin" ? "admin" : "tutor",
            access: Object.freeze(row.scope.split(" ").map(scope => ACCESS[scope]).filter((x): x is ConnectionAccess => !!x)), routine: row.unattended,
            approvedAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), mine, staffName: mine ? null : plain(row.staffName, "A staff member") });
        });
        return Object.freeze({ role: viewer.role, connections: Object.freeze(connections), truncated: rows.length > 100 });
      });
    },
    async revoke(request: AccessRequest & { method?: string }, connectionId: unknown): Promise<RevokeResult> {
      if (typeof connectionId !== "string" || !UUID.test(connectionId)) throw new AccessDenied(404);
      return input.access.withVerifiedIdentity(request, { intent: "data-write", mutation: true, fresh: true }, async (tx, identity) => {
        const actor = await staff(tx, identity, "data-write");
        const connection = await data.lockConnectionForRevoke(tx, identity.tenantId, connectionId, actor.role === "admin" ? undefined : actor.membershipId);
        // Another congregation's, a missing one, or (for a tutor) someone else's all look the same.
        if (!connection || (actor.role !== "admin" && connection.membershipId !== actor.membershipId)) throw new AccessDenied(404);
        if (connection.revokedAt || connection.expiresAt.getTime() <= now()) return Object.freeze({ ok: true as const, ended: false });
        const ended = await data.revokeFromPortal(tx, { tenantId: identity.tenantId, userId: identity.userId, membershipId: actor.membershipId, roleGrantId: actor.grantId, role: actor.role }, connection, new Date(now()));
        return Object.freeze({ ok: true as const, ended });
      });
    },
  });
}
