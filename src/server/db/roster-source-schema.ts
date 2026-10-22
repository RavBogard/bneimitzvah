import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mcpConnection } from "./mcp-schema";
import { membership, role, roleGrant, student, tenant } from "./tenant-schema";

/**
 * Which external roster record a portal student is (Maven intake, Decided 2026-10-21). Identity is
 * the stable source record id within one tenant and namespace, never a name or a date: while a link is
 * current, one record names at most one student and one student at most one record per namespace.
 * Written only by an admin's explicit apply through the portal MCP. An admin may undo a wrong link
 * (release 1.1): the row is kept and stamped revoked once, never deleted and never revived; linking
 * again makes a new row. The runtime role may insert and set only the revocation columns, once.
 */
export const studentSourceIdentity = pgTable("student_source_identity", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  sourceNamespace: text("source_namespace").notNull(), sourceRecordId: text("source_record_id").notNull(), studentId: uuid("student_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: text("created_by_user_id").notNull(), createdByMembershipId: uuid("created_by_membership_id").notNull(),
  roleGrantId: uuid("role_grant_id").notNull(), role: role("role").notNull(), mcpConnectionId: uuid("mcp_connection_id").notNull(),
  /** created: the intake created this student for the record; linked: the rabbi linked an existing student. */
  linkKind: text("link_kind").$type<"created" | "linked">().notNull(),
  /** Set together, once, when an admin unlinks the record (in the portal, or through the MCP with its connection). */
  revokedAt: timestamp("revoked_at", { withTimezone: true }), revokedByUserId: text("revoked_by_user_id"), revokedByMembershipId: uuid("revoked_by_membership_id"),
  revokedRoleGrantId: uuid("revoked_role_grant_id"), revokedRole: role("revoked_role"), revokedChannel: text("revoked_channel").$type<"web" | "mcp">(),
  revokedMcpConnectionId: uuid("revoked_mcp_connection_id"),
}, t => [
  uniqueIndex("student_source_identity_record_current").on(t.tenantId, t.sourceNamespace, t.sourceRecordId).where(sql`${t.revokedAt} is null`),
  uniqueIndex("student_source_identity_student_current").on(t.tenantId, t.sourceNamespace, t.studentId).where(sql`${t.revokedAt} is null`),
  foreignKey({ name: "student_source_identity_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "student_source_identity_member_fk", columns: [t.tenantId, t.createdByMembershipId, t.createdByUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "student_source_identity_grant_fk", columns: [t.tenantId, t.roleGrantId, t.createdByMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "student_source_identity_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "student_source_identity_connection_fk", columns: [t.tenantId, t.mcpConnectionId], foreignColumns: [mcpConnection.tenantId, mcpConnection.id] }),
  foreignKey({ name: "student_source_identity_revoker_fk", columns: [t.tenantId, t.revokedByMembershipId, t.revokedByUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "student_source_identity_revoker_grant_fk", columns: [t.tenantId, t.revokedRoleGrantId, t.revokedByMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "student_source_identity_revoker_role_fk", columns: [t.tenantId, t.revokedRoleGrantId, t.revokedRole], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "student_source_identity_revoker_connection_fk", columns: [t.tenantId, t.revokedMcpConnectionId], foreignColumns: [mcpConnection.tenantId, mcpConnection.id] }),
  // One closed source today: a Salesforce Contact id from Maven (18 characters, case-sensitive).
  check("student_source_identity_source", sql`${t.sourceNamespace} = 'maven' and ${t.sourceRecordId} ~ '^[A-Za-z0-9]{18}$'`),
  check("student_source_identity_admin", sql`${t.role} = 'admin'`),
  check("student_source_identity_link_kind", sql`${t.linkKind} in ('created', 'linked')`),
  check("student_source_identity_created", sql`isfinite(${t.createdAt})`),
  // Current, or revoked by an admin with every revocation fact present; the connection exactly when through the MCP.
  check("student_source_identity_revoked", sql`(${t.revokedAt} is null and ${t.revokedByUserId} is null and ${t.revokedByMembershipId} is null and ${t.revokedRoleGrantId} is null and ${t.revokedRole} is null and ${t.revokedChannel} is null and ${t.revokedMcpConnectionId} is null)
    or (${t.revokedAt} is not null and isfinite(${t.revokedAt}) and ${t.revokedAt} >= ${t.createdAt} and ${t.revokedByUserId} is not null and ${t.revokedByMembershipId} is not null and ${t.revokedRoleGrantId} is not null
      and ${t.revokedRole} = 'admin' and ((${t.revokedChannel} = 'web' and ${t.revokedMcpConnectionId} is null) or (${t.revokedChannel} = 'mcp' and ${t.revokedMcpConnectionId} is not null)))`),
]);
