import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { membership, role, roleGrant, tenant } from "./tenant-schema";

/**
 * Release 1.9 N6 (decision 4, "Claude drafts, you approve"): one congregation's summary of one parashah and a one-line outline
 * of each of its seven aliyot. Claude drafts through the MCP; nothing is shown anywhere until the rabbi approves that exact
 * revision, and then it is shown with the congregation's credit ("Rabbi Daniel Bogard" at CRC). Each draft is a new revision
 * whose text never changes afterwards, so an approval approves exactly the words that were read. A revision moves draft →
 * approved → withdrawn, or draft → withdrawn, and withdrawn is final; at most one revision per parashah is approved at a time.
 * `drafted_by`, `approved_by` and `approved_grant_id` name memberships and grants: the runtime may write them but never read
 * them back (migration 0044 grants SELECT on every other column only). Row security, grants, the transition trigger and the
 * public view (approved rows only) are hand-written in 0044.
 */
export const portionSummary = pgTable("portion_summary", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  readingKey: text("reading_key").notNull(), revision: integer("revision").notNull(),
  status: text("status").$type<"draft" | "approved" | "withdrawn">().notNull(),
  summary: text("summary").notNull(), outline: text("outline").array().notNull(),
  draftedBy: uuid("drafted_by").notNull(),
  approvedBy: uuid("approved_by"), approvedGrantId: uuid("approved_grant_id"), approvedRole: role("approved_role"),
  approvedAt: timestamp("approved_at", { withTimezone: true }), credit: text("credit"),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  // Migration 0055 (guide sharing): the original author of a summary that arrived by import. Set at insert, never changed; an approval of
  // such a revision carries exactly this credit instead of the congregation's own.
  importCredit: text("import_credit"),
  mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("portion_summary_revision_key").on(t.tenantId, t.readingKey, t.revision),
  unique("portion_summary_receipt_key").on(t.tenantId, t.mutationId),
  // At most one approved revision per parashah: approving a new one withdraws the old in the same transaction.
  uniqueIndex("portion_summary_approved_key").on(t.tenantId, t.readingKey).where(sql`${t.status} = 'approved'`),
  foreignKey({ name: "portion_summary_drafter_fk", columns: [t.tenantId, t.draftedBy], foreignColumns: [membership.tenantId, membership.id] }),
  // The approver's own admin grant: a tutor's, parent's or student's grant can never stand behind an approval.
  foreignKey({ name: "portion_summary_approver_fk", columns: [t.tenantId, t.approvedGrantId, t.approvedBy], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "portion_summary_approver_role_fk", columns: [t.tenantId, t.approvedGrantId, t.approvedRole], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("portion_summary_reading_key", sql`octet_length(${t.readingKey}) <= 80 and ${t.readingKey} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("portion_summary_revision", sql`${t.revision} > 0`),
  check("portion_summary_status", sql`${t.status} in ('draft','approved','withdrawn')`),
  check("portion_summary_summary", sql`public.portal_study_markdown(${t.summary}, 4096)`),
  check("portion_summary_outline", sql`public.portal_portion_outline(${t.outline})`),
  // An approval is whole or absent: approver, grant, role 'admin', instant and credit together; a draft has none of them.
  check("portion_summary_approval", sql`(${t.approvedBy} is null and ${t.approvedGrantId} is null and ${t.approvedRole} is null and ${t.approvedAt} is null and ${t.credit} is null)
    or (${t.approvedBy} is not null and ${t.approvedGrantId} is not null and ${t.approvedRole} = 'admin' and ${t.approvedAt} is not null and ${t.credit} is not null)`),
  check("portion_summary_approved_state", sql`(${t.status} = 'draft' and ${t.approvedBy} is null) or (${t.status} = 'approved' and ${t.approvedBy} is not null) or ${t.status} = 'withdrawn'`),
  check("portion_summary_withdrawn_state", sql`(${t.status} = 'withdrawn') = (${t.withdrawnAt} is not null)`),
  check("portion_summary_credit", sql`${t.credit} is null or (public.portal_source_plain(${t.credit}, 240) and strpos(${t.credit}, '@') = 0)`),
  check("portion_summary_import_credit", sql`${t.importCredit} is null or (public.portal_source_plain(${t.importCredit}, 240) and strpos(${t.importCredit}, '@') = 0)`),
  check("portion_summary_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
  check("portion_summary_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt}) and (${t.approvedAt} is null or isfinite(${t.approvedAt})) and (${t.withdrawnAt} is null or isfinite(${t.withdrawnAt}))`),
]);
