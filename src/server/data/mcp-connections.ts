import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

const c = s.mcpConnection;
/** Live (not revoked, not expired) Claude connections in the tenant, newest first; one membership's alone when given. Names and dates only. */
export async function liveConnections<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, now: Date, membershipId?: string) {
  return tx.select({ id: c.id, membershipId: c.membershipId, role: c.role, scope: c.scope, unattended: c.unattended, clientName: c.clientName,
    createdAt: c.createdAt, expiresAt: c.expiresAt, staffName: s.user.name })
    .from(c).innerJoin(s.user, eq(s.user.id, c.userId))
    .where(and(eq(c.tenantId, tenantId), isNull(c.revokedAt), gt(c.expiresAt, now), ...(membershipId ? [eq(c.membershipId, membershipId)] : [])))
    .orderBy(desc(c.createdAt), desc(c.id)).limit(101);
}
/** The connection row, locked for update before a revocation. */
export async function lockConnectionForRevoke<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, connectionId: string) {
  const [row] = await tx.select({ id: c.id, membershipId: c.membershipId, createdAt: c.createdAt, expiresAt: c.expiresAt, revokedAt: c.revokedAt }).from(c)
    .where(and(eq(c.tenantId, tenantId), eq(c.id, connectionId))).for("update");
  return row ?? null;
}
/**
 * End a connection from the portal and audit who did it. Every MCP request, tool call and token issue re-locks the
 * connection and refuses a revoked one, so its access and refresh tokens stop working at once.
 */
export async function revokeFromPortal<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: { tenantId: string; userId: string; membershipId: string; roleGrantId: string; role: "admin" | "tutor" }, connection: { id: string; createdAt: Date }, at: Date) {
  // Never before the connection itself (the database requires it), even if this server's clock trails the one that approved it.
  const when = new Date(Math.max(at.getTime(), connection.createdAt.getTime()));
  const rows = await tx.update(c).set({ revokedAt: when }).where(and(eq(c.tenantId, actor.tenantId), eq(c.id, connection.id), isNull(c.revokedAt))).returning({ id: c.id });
  if (rows.length !== 1) return false;
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: actor.role, action: "mcp-connection.revoke", targetType: "mcp_connection", targetId: connection.id, requestId: randomUUID() });
  return true;
}
