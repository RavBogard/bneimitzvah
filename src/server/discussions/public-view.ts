import { integer, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The one public read of curated discussions (migration 0042, hand-written there): published discussions only, each with its
 * current ordered source set and the translations those sources use. Security invoker, so the forced tenant policy and the
 * column grants apply to the caller; it carries no curator and no receipt. Declared `existing` and kept outside the
 * `*schema.ts` files, so schema generation never tries to own it.
 */
export const curatedDiscussionPublic = pgView("curated_discussion_public", {
  tenantId: text("tenant_id").notNull(), slug: text("slug").notNull(), title: text("title").notNull(), kind: text("kind").$type<"torah" | "haftarah">().notNull(),
  revision: integer("revision").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), position: integer("position").notNull(),
  ref: text("ref").notNull(), anchorRef: text("anchor_ref").notNull(), edition: text("edition"), translationId: uuid("translation_id"),
  translationEdition: text("translation_edition"), translationBody: text("translation_body"),
}).existing();
