import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import type { StudyChapterContent } from "../study/cache";

// Numeric public catalog only; never tenant or provider text. Freeze the same
// finite chapter universe into the migration rather than accepting arbitrary refs.
const chapterMaximum = Object.entries(TANAKH_VERSE_COUNTS)
  .map(([book, chapters]) => `when '${book.replaceAll("'", "''")}' then ${chapters.length}`).join(" ");
export const sefariaTextCache = pgTable("sefaria_text_cache", {
  provider: text("provider").notNull(), apiVersion: text("api_version").notNull(),
  parserVersion: text("parser_version").notNull(), policyVersion: text("policy_version").notNull(),
  book: text("book").notNull(), chapter: integer("chapter").notNull(),
  hebrewEdition: text("hebrew_edition").notNull(), hebrewLanguage: text("hebrew_language").notNull(),
  translationEdition: text("translation_edition").notNull(), translationLanguage: text("translation_language").notNull(),
  payload: jsonb("payload").$type<StudyChapterContent>().notNull(), contentHash: text("content_hash").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ name: "sefaria_text_cache_key", columns: [t.provider, t.apiVersion, t.parserVersion, t.policyVersion,
    t.book, t.chapter, t.hebrewEdition, t.hebrewLanguage, t.translationEdition, t.translationLanguage] }),
  check("sefaria_text_cache_namespace", sql`${t.provider} = 'sefaria' and ${t.apiVersion} = 'v3'
    and ${t.parserVersion} = 'parse5-8.0.1' and ${t.policyVersion} = 'study-normalized-v1'
    and ${t.hebrewEdition} = 'mam' and ${t.hebrewLanguage} = 'he'
    and ${t.translationEdition} = 'jps2023' and ${t.translationLanguage} = 'en'`),
  check("sefaria_text_cache_chapter", sql`${t.chapter} between 1 and case ${t.book} ${sql.raw(chapterMaximum)} else 0 end`),
  check("sefaria_text_cache_payload", sql`jsonb_typeof(${t.payload}) = 'object'
    and ${t.payload} ?& array['verses','editions'] and (${t.payload} - 'verses' - 'editions') = '{}'::jsonb
    and jsonb_typeof(${t.payload}->'verses') = 'array' and jsonb_typeof(${t.payload}->'editions') = 'array'
    and jsonb_array_length(${t.payload}->'verses') between 1 and 176
    and jsonb_array_length(${t.payload}->'editions') between 1 and 2
    and octet_length(${t.payload}::text) <= 524288`),
  check("sefaria_text_cache_hash", sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`),
  check("sefaria_text_cache_times", sql`isfinite(${t.fetchedAt}) and isfinite(${t.expiresAt})
    and extract(epoch from ${t.fetchedAt}) >= 0 and extract(epoch from ${t.expiresAt}) <= 8640000000000
    and extract(epoch from ${t.fetchedAt}) * 1000 = trunc(extract(epoch from ${t.fetchedAt}) * 1000)
    and ${t.expiresAt} = ${t.fetchedAt} + interval '24 hours'`),
  index("sefaria_text_cache_expiry").on(t.expiresAt),
]);
