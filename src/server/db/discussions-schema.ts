import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { membership, tenant } from "./tenant-schema";

/**
 * Release 1.7 M6 (spec 2026-10-24-curated-discussions-design): source-only curated discussions and credited Claude
 * translations, written only through the admin MCP tools and read publicly. A discussion is a title and an ordered set of
 * original sources, each anchored to one verse; there is no introduction, essay or synthesis column anywhere. The database
 * stores references and our own translations, never Sefaria text. `selected_by` is the curating membership: the runtime
 * may insert it but never read it back (migration 0042 grants SELECT on every other column only), so no read path,
 * public or staff, can return it. Row security, grants, triggers and the public view are hand-written in 0042.
 */
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
// One verse, "Book C:V", exactly the guide notes' VERSE_REF (study-guides/validation.ts).
const VERSE = "^[A-Za-z ]+ [1-9][0-9]*:[1-9][0-9]*$";

/** A Claude translation of one exact original reference in one Hebrew or Aramaic edition. Insert-only, never edited. */
export const sourceTranslation = pgTable("source_translation", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(),
  originalRef: text("original_ref").notNull(), originalEdition: text("original_edition").notNull(), body: text("body").notNull(),
  selectedBy: uuid("selected_by").notNull(), mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(), createdAt: createdAt(),
}, t => [
  unique("source_translation_receipt_key").on(t.tenantId, t.mutationId),
  // A discussion source may name a translation only together with the translation's own original reference.
  unique("source_translation_ref_key").on(t.tenantId, t.id, t.originalRef),
  foreignKey({ name: "source_translation_selector_fk", columns: [t.tenantId, t.selectedBy], foreignColumns: [membership.tenantId, membership.id] }),
  check("source_translation_ref", sql`public.portal_source_plain(${t.originalRef}, 256)`),
  check("source_translation_edition", sql`public.portal_source_plain(${t.originalEdition}, 300)`),
  check("source_translation_body", sql`public.portal_study_markdown(${t.body}, 16384)`),
  check("source_translation_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
  check("source_translation_instant", sql`isfinite(${t.createdAt})`),
]);

/** A question or title. Published at once; revised in place under `revision`; withdrawn, never deleted. */
export const curatedDiscussion = pgTable("curated_discussion", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), slug: text("slug").notNull(), title: text("title").notNull(),
  kind: text("kind").$type<"torah" | "haftarah">().notNull(), status: text("status").$type<"published" | "withdrawn">().notNull(),
  selectedBy: uuid("selected_by").notNull(), revision: integer("revision").default(1).notNull(),
  mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(),
  createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("curated_discussion_slug_key").on(t.tenantId, t.slug),
  unique("curated_discussion_receipt_key").on(t.tenantId, t.mutationId),
  unique("curated_discussion_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "curated_discussion_selector_fk", columns: [t.tenantId, t.selectedBy], foreignColumns: [membership.tenantId, membership.id] }),
  check("curated_discussion_slug", sql`octet_length(${t.slug}) <= 80 and ${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("curated_discussion_title", sql`public.portal_source_plain(${t.title}, 160)`),
  check("curated_discussion_kind", sql`${t.kind} in ('torah','haftarah')`),
  check("curated_discussion_status", sql`${t.status} in ('published','withdrawn')`),
  check("curated_discussion_revision", sql`${t.revision} > 0`),
  check("curated_discussion_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
  check("curated_discussion_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt})`),
]);

/**
 * One source of one revision's ordered set. A revision that changes the sources inserts a whole new set under the
 * discussion's new revision; the current set is the latest. Exactly one of a Sefaria edition (an English version title)
 * or one of our translations. Insert-only.
 */
export const curatedDiscussionSource = pgTable("curated_discussion_source", {
  tenantId: tenantId(), discussionId: uuid("discussion_id").notNull(), revision: integer("revision").notNull(), position: integer("position").notNull(),
  ref: text("ref").notNull(), anchorRef: text("anchor_ref").notNull(), edition: text("edition"), translationId: uuid("translation_id"),
  selectedBy: uuid("selected_by").notNull(), createdAt: createdAt(),
}, t => [
  primaryKey({ name: "curated_discussion_source_key", columns: [t.tenantId, t.discussionId, t.revision, t.position] }),
  index("curated_discussion_source_anchor_idx").on(t.tenantId, t.anchorRef),
  foreignKey({ name: "curated_discussion_source_discussion_fk", columns: [t.tenantId, t.discussionId], foreignColumns: [curatedDiscussion.tenantId, curatedDiscussion.id] }),
  foreignKey({ name: "curated_discussion_source_translation_fk", columns: [t.tenantId, t.translationId, t.ref], foreignColumns: [sourceTranslation.tenantId, sourceTranslation.id, sourceTranslation.originalRef] }),
  foreignKey({ name: "curated_discussion_source_selector_fk", columns: [t.tenantId, t.selectedBy], foreignColumns: [membership.tenantId, membership.id] }),
  check("curated_discussion_source_position", sql`${t.position} between 1 and 24`),
  check("curated_discussion_source_revision", sql`${t.revision} > 0`),
  check("curated_discussion_source_ref", sql`public.portal_source_plain(${t.ref}, 256)`),
  check("curated_discussion_source_anchor", sql`octet_length(${t.anchorRef}) <= 100 and ${t.anchorRef} ~ ${sql.raw(`'${VERSE}'`)}`),
  check("curated_discussion_source_one", sql`num_nonnulls(${t.edition}, ${t.translationId}) = 1`),
  check("curated_discussion_source_edition", sql`${t.edition} is null or public.portal_source_plain(${t.edition}, 300)`),
  check("curated_discussion_source_instant", sql`isfinite(${t.createdAt})`),
]);
