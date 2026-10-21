import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { membership, role, roleGrant, tenant } from "./tenant-schema";

/**
 * One staff member's consent for one Claude client (spec 2026-10-21 MCP, Decided here). Bound to
 * the exact grant and membership authority it was given under: a reissued grant, a changed
 * authority revision, a disabled membership or a revocation ends it. Never outlives expires_at.
 */
export const mcpConnection = pgTable("mcp_connection", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  userId: text("user_id").notNull(), membershipId: uuid("membership_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(),
  role: role("role").notNull(), roleGrantRevision: integer("role_grant_revision").notNull(), authorityRevision: integer("authority_revision").notNull(),
  scope: text("scope").notNull(), unattended: boolean("unattended").notNull(),
  clientName: text("client_name").notNull(), clientHash: text("client_hash").notNull(), redirectUri: text("redirect_uri").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [
  unique("mcp_connection_tenant_key").on(t.tenantId, t.id),
  foreignKey({ name: "mcp_connection_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "mcp_connection_grant_fk", columns: [t.tenantId, t.roleGrantId, t.membershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "mcp_connection_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  // Staff only; only an admin grant can carry the study write scope (S21).
  check("mcp_connection_scope", sql`(${t.role}='admin' and ${t.scope} in ('portal:read','portal:read portal:study')) or (${t.role}='tutor' and ${t.scope}='portal:read')`),
  check("mcp_connection_revisions", sql`${t.roleGrantRevision} > 0 and ${t.authorityRevision} > 0`),
  check("mcp_connection_client", sql`char_length(${t.clientName}) between 1 and 120 and ${t.clientName} !~ '[[:cntrl:]<>]' and ${t.clientHash} ~ '^[a-f0-9]{64}$' and octet_length(${t.redirectUri}) between 1 and 2048`),
  check("mcp_connection_lifetime", sql`isfinite(${t.createdAt}) and ${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '31 days' and (${t.revokedAt} is null or (isfinite(${t.revokedAt}) and ${t.revokedAt} >= ${t.createdAt}))`),
  index("mcp_connection_member_idx").on(t.tenantId, t.membershipId),
]);

/** Authorization codes, access and refresh tokens: only their SHA-256 hashes are stored. */
export const mcpToken = pgTable("mcp_token", {
  tokenHash: text("token_hash").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  connectionId: uuid("connection_id").notNull(), kind: text("kind").notNull(),
  codeChallenge: text("code_challenge"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, t => [
  foreignKey({ name: "mcp_token_connection_fk", columns: [t.tenantId, t.connectionId], foreignColumns: [mcpConnection.tenantId, mcpConnection.id] }),
  check("mcp_token_hash", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check("mcp_token_kind", sql`${t.kind} in ('code','access','refresh')`),
  // Only a code carries a PKCE challenge; access tokens are never "used".
  check("mcp_token_shape", sql`(${t.kind}='code') = (${t.codeChallenge} is not null) and (${t.codeChallenge} is null or ${t.codeChallenge} ~ '^[A-Za-z0-9_-]{43}$') and (${t.kind}<>'access' or ${t.usedAt} is null)`),
  check("mcp_token_lifetime", sql`isfinite(${t.createdAt}) and ${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '31 days' and (${t.usedAt} is null or isfinite(${t.usedAt}))`),
  index("mcp_token_connection_idx").on(t.tenantId, t.connectionId),
]);
