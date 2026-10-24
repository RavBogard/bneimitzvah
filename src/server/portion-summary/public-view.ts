import { integer, pgView, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The one public read of portion summaries (migration 0044, hand-written there): approved revisions only, with their credit.
 * Security invoker, so the forced tenant policy and the column grants apply to the caller; it carries no membership, grant or
 * receipt, and no draft or withdrawn revision. Declared `existing` and kept outside the `*schema.ts` files, so schema
 * generation never tries to own it.
 */
export const portionSummaryPublic = pgView("portion_summary_public", {
  tenantId: text("tenant_id").notNull(), readingKey: text("reading_key").notNull(), revision: integer("revision").notNull(),
  summary: text("summary").notNull(), outline: text("outline").array().notNull(), credit: text("credit").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
}).existing();
