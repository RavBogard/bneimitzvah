import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { membership, tenant } from "./tenant-schema";

/**
 * Release 1.4 saved layer (accounts plan §1a): a member's own readings, translation, notes,
 * marks and starred comments. Only the owner reads them: every table carries one forced
 * `owner_only` policy keyed on a transaction-local owner setting that only src/server/saved/access.ts sets.
 * Staff, MCP, cron, the roster Sheet and notifications never set it and see no rows.
 * No audit rows are written for these tables: audit is staff-readable.
 */
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
// One canonical segment ("Genesis 12:1-20", "Isaiah 27:6-28:13", "Exodus 30:11"), joined by "; " as in assignment.ref.
// The book starts with a letter (stricter than assignment_verse_full_ref), so a doubled space after "; " cannot pass.
const segment = "[[:alpha:]][[:alpha:] 0-9]* [1-9][0-9]*:[1-9][0-9]*(-([1-9][0-9]*:)?[1-9][0-9]*)?";
const verseRef = "^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$";
// Locale-independent control characters, exactly the code points the app refuses (saved/validation.ts), so a CHECK is never
// the first to fail: C0 except tab and newline (and carriage return, which the app normalizes away), DEL, C1 including U+0085,
// and the line and paragraph separators (Postgres reads \x2028 as one code point). [[:cntrl:]] would depend on the locale.
export const SAVED_TEXT_CONTROLS = String.raw`[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\x2028\x2029]`;
export const SAVED_NAME_CONTROLS = String.raw`[\x01-\x1f\x7f-\x9f\x2028\x2029]`;

export const savedReading = pgTable("saved_reading", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(),
  name: text("name").notNull(), readingDate: date("reading_date"), kind: text("kind").$type<"torah" | "haftarah">().notNull(),
  ranges: text("ranges").notNull(), verseCount: integer("verse_count").notNull(), revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: updatedAt(),
}, t => [
  // The child tables' FK target: a child row can only ever point at a reading of its own member.
  unique("saved_reading_owner_key").on(t.tenantId, t.id, t.membershipId),
  index("saved_reading_member_idx").on(t.tenantId, t.membershipId),
  foreignKey({ name: "saved_reading_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  check("saved_reading_name", sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 80 and ${t.name} !~ ${sql.raw(`'${SAVED_NAME_CONTROLS}'`)}`),
  check("saved_reading_kind", sql`${t.kind} in ('torah','haftarah')`),
  // The "; " separator is written as \x3b (a regex escape) and chr(59): drizzle-kit's SQL writer cuts a CHECK at a literal semicolon.
  check("saved_reading_ranges", sql`octet_length(${t.ranges}) <= 1000 and ${t.ranges} ~ ${sql.raw(String.raw`'^${segment}(\x3b ${segment})*$'`)} and cardinality(string_to_array(${t.ranges}, chr(59) || ' ')) <= 32`),
  check("saved_reading_verse_count", sql`${t.verseCount} between 1 and 1000`),
  check("saved_reading_revision", sql`${t.revision} > 0`),
  check("saved_reading_instants", sql`isfinite(${t.createdAt}) and isfinite(${t.updatedAt})`),
]);

/** My translation and My notes: one head row per (reading, verse, stream), changed in place under an optimistic version. */
export const savedVerseWork = pgTable("saved_verse_work", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), membershipId: uuid("membership_id").notNull(), savedReadingId: uuid("saved_reading_id").notNull(),
  verseRef: text("verse_ref").notNull(), stream: text("stream").$type<"translation" | "note">().notNull(), text: text("text").notNull(),
  version: integer("version").notNull(), updatedAt: updatedAt(),
}, t => [
  unique("saved_verse_work_key").on(t.tenantId, t.savedReadingId, t.verseRef, t.stream),
  index("saved_verse_work_member_idx").on(t.tenantId, t.membershipId),
  foreignKey({ name: "saved_verse_work_reading_fk", columns: [t.tenantId, t.savedReadingId, t.membershipId], foreignColumns: [savedReading.tenantId, savedReading.id, savedReading.membershipId] }).onDelete("cascade"),
  check("saved_verse_work_stream", sql`${t.stream} in ('translation','note')`),
  check("saved_verse_work_text_bound", sql`octet_length(${t.text}) <= 4096 and ${t.text} !~ ${sql.raw(`'${SAVED_TEXT_CONTROLS}'`)}`),
  check("saved_verse_work_ref", sql`${t.verseRef} ~ ${sql.raw(`'${verseRef}'`)}`),
  check("saved_verse_work_version", sql`${t.version} >= 1`),
  check("saved_verse_work_instant", sql`isfinite(${t.updatedAt})`),
]);

/** Lein's per-verse Working / Got it marks on a saved reading. */
export const savedVerseMark = pgTable("saved_verse_mark", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: tenantId(), membershipId: uuid("membership_id").notNull(), savedReadingId: uuid("saved_reading_id").notNull(),
  verseRef: text("verse_ref").notNull(), state: text("state").$type<"unmarked" | "working" | "got-it">().notNull(),
  version: integer("version").notNull(), updatedAt: updatedAt(),
}, t => [
  unique("saved_verse_mark_key").on(t.tenantId, t.savedReadingId, t.verseRef),
  index("saved_verse_mark_member_idx").on(t.tenantId, t.membershipId),
  foreignKey({ name: "saved_verse_mark_reading_fk", columns: [t.tenantId, t.savedReadingId, t.membershipId], foreignColumns: [savedReading.tenantId, savedReading.id, savedReading.membershipId] }).onDelete("cascade"),
  check("saved_verse_mark_state", sql`${t.state} in ('unmarked','working','got-it')`),
  check("saved_verse_mark_ref", sql`${t.verseRef} ~ ${sql.raw(`'${verseRef}'`)}`),
  check("saved_verse_mark_version", sql`${t.version} >= 1`),
  check("saved_verse_mark_instant", sql`isfinite(${t.updatedAt})`),
]);

/**
 * A member's starred commentary comments, across all readings: a row is a star, and unstarring deletes it, so the cap
 * counts only live stars. `work` is checked in the app against COMMENTARY_WORKS.
 */
export const starredComment = pgTable("starred_comment", {
  tenantId: tenantId(), membershipId: uuid("membership_id").notNull(), userId: text("user_id").notNull(),
  work: text("work").notNull(), verseRef: text("verse_ref").notNull(), commentIndex: integer("comment_index").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: "starred_comment_key", columns: [t.tenantId, t.membershipId, t.work, t.verseRef, t.commentIndex] }),
  foreignKey({ name: "starred_comment_member_fk", columns: [t.tenantId, t.membershipId, t.userId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  check("starred_comment_work", sql`${t.work} ~ '^[a-z][a-z0-9-]{0,31}$'`),
  check("starred_comment_ref", sql`${t.verseRef} ~ ${sql.raw(`'${verseRef}'`)}`),
  check("starred_comment_index", sql`${t.commentIndex} between 1 and 60`),
  check("starred_comment_instant", sql`isfinite(${t.createdAt})`),
]);
