import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { session } from "./auth-schema";
import { membership, role, roleGrant, tenant } from "./tenant-schema";

// Dormant evidence only. Live session, Google provenance, staff authority and
// provider consent must be locked/rechecked by the future authorization service.
export const mcpDelegation = pgTable("mcp_delegation", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenant.id),
  userId: text("user_id").notNull(), sessionId: text("session_id").notNull(),
  membershipId: uuid("membership_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(),
  role: role("role").notNull(), membershipRevision: integer("membership_revision").notNull(), grantRevision: integer("grant_revision").notNull(),
  pendingCookieHash: text("pending_cookie_hash").notNull(), requestFingerprint: text("request_fingerprint").notNull(),
  scope: text("scope").notNull(), resource: text("resource").notNull(), clientId: text("client_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  selectionDeadline: timestamp("selection_deadline", { withTimezone: true }).notNull(),
  hardDeadline: timestamp("hard_deadline", { withTimezone: true }).notNull(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }), consentId: text("consent_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [
  unique("mcp_delegation_tenant_key").on(t.tenantId, t.id),
  unique("mcp_delegation_pending_hash_key").on(t.pendingCookieHash),
  foreignKey({ name: "mcp_delegation_session_actor_fk", columns: [t.sessionId, t.userId], foreignColumns: [session.id, session.userId] }).onDelete("cascade"),
  foreignKey({ name: "mcp_delegation_membership_actor_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "mcp_delegation_grant_actor_fk", columns: [t.tenantId, t.roleGrantId, t.membershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "mcp_delegation_grant_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("mcp_delegation_policy", sql`${t.role} in ('admin','tutor') and ${t.membershipRevision}>0 and ${t.grantRevision}>0 and ${t.scope}='portal:read' and ${t.resource}='https://beitmitzvah.centralreform.org/api/mcp'`),
  check("mcp_delegation_hashes", sql`${t.pendingCookieHash} ~ '^[a-f0-9]{64}$' and ${t.requestFingerprint} ~ '^[a-f0-9]{64}$'`),
  check("mcp_delegation_client", sql`octet_length(${t.clientId}) between 1 and 255 and length(trim(${t.clientId}))>0 and ${t.clientId}=btrim(${t.clientId}) and ${t.clientId} !~ '[\x01-\x1f\x7f]'`),
  check("mcp_delegation_consent", sql`(${t.authorizedAt} is null) = (${t.consentId} is null) and (${t.consentId} is null or (octet_length(${t.consentId}) between 1 and 255 and length(trim(${t.consentId}))>0 and ${t.consentId}=btrim(${t.consentId}) and ${t.consentId} !~ '[\x01-\x1f\x7f]'))`),
  check("mcp_delegation_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.selectionDeadline}) and isfinite(${t.hardDeadline}) and ${t.selectionDeadline}>${t.createdAt} and ${t.selectionDeadline}<=${t.createdAt}+interval '10 minutes' and ${t.selectionDeadline}<=${t.hardDeadline} and (${t.authorizedAt} is null or (isfinite(${t.authorizedAt}) and ${t.authorizedAt}>=${t.createdAt})) and (${t.revokedAt} is null or (isfinite(${t.revokedAt}) and ${t.revokedAt}>=${t.createdAt}))`),
]);
