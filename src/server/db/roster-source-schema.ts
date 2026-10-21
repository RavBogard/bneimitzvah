import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { mcpConnection } from "./mcp-schema";
import { membership, role, roleGrant, student, tenant } from "./tenant-schema";

/**
 * Which external roster record a portal student is (Maven intake, Decided 2026-10-21). Identity is
 * the stable source record id within one tenant and namespace, never a name or a date: one record
 * names at most one student and one student at most one record per namespace. Written only by an
 * admin's explicit apply through the portal MCP; insert-only for the runtime role.
 */
export const studentSourceIdentity = pgTable("student_source_identity", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  sourceNamespace: text("source_namespace").notNull(), sourceRecordId: text("source_record_id").notNull(), studentId: uuid("student_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: text("created_by_user_id").notNull(), createdByMembershipId: uuid("created_by_membership_id").notNull(),
  roleGrantId: uuid("role_grant_id").notNull(), role: role("role").notNull(), mcpConnectionId: uuid("mcp_connection_id").notNull(),
}, t => [
  unique("student_source_identity_record_key").on(t.tenantId, t.sourceNamespace, t.sourceRecordId),
  unique("student_source_identity_student_key").on(t.tenantId, t.sourceNamespace, t.studentId),
  foreignKey({ name: "student_source_identity_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "student_source_identity_member_fk", columns: [t.tenantId, t.createdByMembershipId, t.createdByUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "student_source_identity_grant_fk", columns: [t.tenantId, t.roleGrantId, t.createdByMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "student_source_identity_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "student_source_identity_connection_fk", columns: [t.tenantId, t.mcpConnectionId], foreignColumns: [mcpConnection.tenantId, mcpConnection.id] }),
  // One closed source today: a Salesforce Contact id from Maven (18 characters, case-sensitive).
  check("student_source_identity_source", sql`${t.sourceNamespace} = 'maven' and ${t.sourceRecordId} ~ '^[A-Za-z0-9]{18}$'`),
  check("student_source_identity_admin", sql`${t.role} = 'admin'`),
  check("student_source_identity_created", sql`isfinite(${t.createdAt})`),
]);
