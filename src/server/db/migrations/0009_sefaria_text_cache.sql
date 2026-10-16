CREATE TABLE "sefaria_text_cache" (
	"provider" text NOT NULL,
	"api_version" text NOT NULL,
	"parser_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"book" text NOT NULL,
	"chapter" integer NOT NULL,
	"hebrew_edition" text NOT NULL,
	"hebrew_language" text NOT NULL,
	"translation_edition" text NOT NULL,
	"translation_language" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sefaria_text_cache_key" PRIMARY KEY("provider","api_version","parser_version","policy_version","book","chapter","hebrew_edition","hebrew_language","translation_edition","translation_language"),
	CONSTRAINT "sefaria_text_cache_namespace" CHECK ("sefaria_text_cache"."provider" = 'sefaria' and "sefaria_text_cache"."api_version" = 'v3'
    and "sefaria_text_cache"."parser_version" = 'parse5-8.0.1' and "sefaria_text_cache"."policy_version" = 'study-normalized-v1'
    and "sefaria_text_cache"."hebrew_edition" = 'mam' and "sefaria_text_cache"."hebrew_language" = 'he'
    and "sefaria_text_cache"."translation_edition" = 'jps2023' and "sefaria_text_cache"."translation_language" = 'en'),
	CONSTRAINT "sefaria_text_cache_chapter" CHECK ("sefaria_text_cache"."chapter" between 1 and case "sefaria_text_cache"."book" when 'Genesis' then 50 when 'Exodus' then 40 when 'Leviticus' then 27 when 'Numbers' then 36 when 'Deuteronomy' then 34 when 'Joshua' then 24 when 'Judges' then 21 when 'I Samuel' then 31 when 'II Samuel' then 24 when 'I Kings' then 22 when 'II Kings' then 25 when 'Isaiah' then 66 when 'Jeremiah' then 52 when 'Ezekiel' then 48 when 'Hosea' then 14 when 'Joel' then 4 when 'Amos' then 9 when 'Obadiah' then 1 when 'Jonah' then 4 when 'Micah' then 7 when 'Nahum' then 3 when 'Habakkuk' then 3 when 'Zephaniah' then 3 when 'Haggai' then 2 when 'Zechariah' then 14 when 'Malachi' then 3 when 'Psalms' then 150 when 'Proverbs' then 31 when 'Job' then 42 when 'Song of Songs' then 8 when 'Ruth' then 4 when 'Lamentations' then 5 when 'Ecclesiastes' then 12 when 'Esther' then 10 when 'Daniel' then 12 when 'Ezra' then 10 when 'Nehemiah' then 13 when 'I Chronicles' then 29 when 'II Chronicles' then 36 else 0 end),
	CONSTRAINT "sefaria_text_cache_payload" CHECK (jsonb_typeof("sefaria_text_cache"."payload") = 'object'
    and "sefaria_text_cache"."payload" ?& array['verses','editions'] and ("sefaria_text_cache"."payload" - 'verses' - 'editions') = '{}'::jsonb
    and jsonb_typeof("sefaria_text_cache"."payload"->'verses') = 'array' and jsonb_typeof("sefaria_text_cache"."payload"->'editions') = 'array'
    and jsonb_array_length("sefaria_text_cache"."payload"->'verses') between 1 and 176
    and jsonb_array_length("sefaria_text_cache"."payload"->'editions') between 1 and 2
    and octet_length("sefaria_text_cache"."payload"::text) <= 524288),
	CONSTRAINT "sefaria_text_cache_hash" CHECK ("sefaria_text_cache"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "sefaria_text_cache_times" CHECK (isfinite("sefaria_text_cache"."fetched_at") and isfinite("sefaria_text_cache"."expires_at")
    and extract(epoch from "sefaria_text_cache"."fetched_at") >= 0 and extract(epoch from "sefaria_text_cache"."expires_at") <= 8640000000000
    and extract(epoch from "sefaria_text_cache"."fetched_at") * 1000 = trunc(extract(epoch from "sefaria_text_cache"."fetched_at") * 1000)
    and "sefaria_text_cache"."expires_at" = "sefaria_text_cache"."fetched_at" + interval '24 hours')
);
--> statement-breakpoint
CREATE INDEX "sefaria_text_cache_expiry" ON "sefaria_text_cache" USING btree ("expires_at");
--> statement-breakpoint
-- Public normalized chapters only. No tenant grants or runtime cleanup powers.
REVOKE ALL ON sefaria_text_cache FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON sefaria_text_cache TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (payload, content_hash, fetched_at, expires_at) ON sefaria_text_cache TO portal_runtime;
