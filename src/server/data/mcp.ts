import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, LockIntent } from "../access/types";
import { lockStrength } from "../access/types";
import * as s from "../db/index";

export type McpConnectionRow = typeof s.mcpConnection.$inferSelect;
export type TokenKind = "code" | "access" | "refresh";

export async function insertConnection<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: typeof s.mcpConnection.$inferInsert) {
  const [created] = await tx.insert(s.mcpConnection).values(row).returning();
  return created;
}
export async function insertToken<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: { tokenHash: string; tenantId: string; connectionId: string; kind: TokenKind; codeChallenge?: string | null; createdAt: Date; expiresAt: Date }) {
  await tx.insert(s.mcpToken).values({ ...row, codeChallenge: row.codeChallenge ?? null });
}
/** The token row, locked for update when it is a one-use code or refresh token. */
export async function lockToken<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, tokenHash: string, kind: TokenKind) {
  const query = tx.select().from(s.mcpToken).where(and(eq(s.mcpToken.tenantId, tenantId), eq(s.mcpToken.tokenHash, tokenHash), eq(s.mcpToken.kind, kind)));
  const [row] = await (kind === "access" ? query.for("share") : query.for("update"));
  return row;
}
/** Marks a one-use token used; false when another request already did. */
export async function useToken<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, tokenHash: string, at: Date) {
  const rows = await tx.update(s.mcpToken).set({ usedAt: at }).where(and(eq(s.mcpToken.tenantId, tenantId), eq(s.mcpToken.tokenHash, tokenHash), isNull(s.mcpToken.usedAt))).returning({ hash: s.mcpToken.tokenHash });
  return rows.length === 1;
}
export async function lockConnection<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, connectionId: string, intent: LockIntent) {
  const [row] = await tx.select().from(s.mcpConnection).where(and(eq(s.mcpConnection.tenantId, tenantId), eq(s.mcpConnection.id, connectionId))).for(lockStrength(intent));
  return row;
}
/** The connection's client hash, read without a lock (a replay check before a plain revoking UPDATE). */
export async function connectionClient<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, connectionId: string) {
  const [row] = await tx.select({ clientHash: s.mcpConnection.clientHash }).from(s.mcpConnection).where(and(eq(s.mcpConnection.tenantId, tenantId), eq(s.mcpConnection.id, connectionId)));
  return row?.clientHash ?? null;
}
export async function revokeConnection<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, connectionId: string, at: Date) {
  await tx.update(s.mcpConnection).set({ revokedAt: at }).where(and(eq(s.mcpConnection.tenantId, tenantId), eq(s.mcpConnection.id, connectionId), isNull(s.mcpConnection.revokedAt)));
}
/** A membership's live connections for its own account page: names and dates only. */
export async function memberConnections<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string, now: Date) {
  return tx.select({ id: s.mcpConnection.id, clientName: s.mcpConnection.clientName, role: s.mcpConnection.role, scope: s.mcpConnection.scope,
    unattended: s.mcpConnection.unattended, createdAt: s.mcpConnection.createdAt, expiresAt: s.mcpConnection.expiresAt })
    .from(s.mcpConnection).where(and(eq(s.mcpConnection.tenantId, tenantId), eq(s.mcpConnection.membershipId, membershipId), isNull(s.mcpConnection.revokedAt), gt(s.mcpConnection.expiresAt, now)))
    .orderBy(sql`${s.mcpConnection.createdAt} desc`).limit(20);
}
export async function sessionGoogleMarker<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, sessionId: string, userId: string) {
  const [row] = await tx.select({ at: s.session.googleAuthenticatedAt }).from(s.session).where(and(eq(s.session.id, sessionId), eq(s.session.userId, userId))).for("share");
  return row?.at ?? null;
}
export async function lockUser<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, userId: string, intent: LockIntent) {
  const [row] = await tx.select({ id: s.user.id, verified: s.user.emailVerified, name: s.user.name }).from(s.user).where(eq(s.user.id, userId)).for(lockStrength(intent));
  return row;
}
export async function lockMembership<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string, intent: LockIntent) {
  const [row] = await tx.select({ id: s.membership.id, userId: s.membership.userId, disabledAt: s.membership.disabledAt, authorityRevision: s.membership.authorityRevision })
    .from(s.membership).where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.id, membershipId))).for(lockStrength(intent));
  return row;
}
export async function lockTenant<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, intent: LockIntent) {
  const [row] = await tx.select({ enabled: s.tenant.enabled }).from(s.tenant).where(eq(s.tenant.id, tenantId)).for(lockStrength(intent));
  return row;
}
