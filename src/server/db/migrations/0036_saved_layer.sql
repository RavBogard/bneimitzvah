CREATE TABLE "saved_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"reading_date" date,
	"kind" text NOT NULL,
	"ranges" text NOT NULL,
	"verse_count" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_reading_owner_key" UNIQUE("tenant_id","id","membership_id"),
	CONSTRAINT "saved_reading_name" CHECK ("saved_reading"."name" = btrim("saved_reading"."name") and char_length("saved_reading"."name") between 1 and 80 and "saved_reading"."name" !~ '[\x01-\x1f\x7f-\x9f\x2028\x2029]'),
	CONSTRAINT "saved_reading_kind" CHECK ("saved_reading"."kind" in ('torah','haftarah')),
	CONSTRAINT "saved_reading_ranges" CHECK (octet_length("saved_reading"."ranges") <= 1000 and "saved_reading"."ranges" ~ '^[[:alpha:]][[:alpha:] 0-9]* [1-9][0-9]*:[1-9][0-9]*(-([1-9][0-9]*:)?[1-9][0-9]*)?(\x3b [[:alpha:]][[:alpha:] 0-9]* [1-9][0-9]*:[1-9][0-9]*(-([1-9][0-9]*:)?[1-9][0-9]*)?)*$' and cardinality(string_to_array("saved_reading"."ranges", chr(59) || ' ')) <= 32),
	CONSTRAINT "saved_reading_verse_count" CHECK ("saved_reading"."verse_count" between 1 and 1000),
	CONSTRAINT "saved_reading_revision" CHECK ("saved_reading"."revision" > 0),
	CONSTRAINT "saved_reading_instants" CHECK (isfinite("saved_reading"."created_at") and isfinite("saved_reading"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "saved_verse_mark" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"saved_reading_id" uuid NOT NULL,
	"verse_ref" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_verse_mark_key" UNIQUE("tenant_id","saved_reading_id","verse_ref"),
	CONSTRAINT "saved_verse_mark_state" CHECK ("saved_verse_mark"."state" in ('unmarked','working','got-it')),
	CONSTRAINT "saved_verse_mark_ref" CHECK ("saved_verse_mark"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "saved_verse_mark_version" CHECK ("saved_verse_mark"."version" >= 1),
	CONSTRAINT "saved_verse_mark_instant" CHECK (isfinite("saved_verse_mark"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "saved_verse_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"saved_reading_id" uuid NOT NULL,
	"verse_ref" text NOT NULL,
	"stream" text NOT NULL,
	"text" text NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_verse_work_key" UNIQUE("tenant_id","saved_reading_id","verse_ref","stream"),
	CONSTRAINT "saved_verse_work_stream" CHECK ("saved_verse_work"."stream" in ('translation','note')),
	CONSTRAINT "saved_verse_work_text_bound" CHECK (octet_length("saved_verse_work"."text") <= 4096 and "saved_verse_work"."text" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\x2028\x2029]'),
	CONSTRAINT "saved_verse_work_ref" CHECK ("saved_verse_work"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "saved_verse_work_version" CHECK ("saved_verse_work"."version" >= 1),
	CONSTRAINT "saved_verse_work_instant" CHECK (isfinite("saved_verse_work"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "starred_comment" (
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"work" text NOT NULL,
	"verse_ref" text NOT NULL,
	"comment_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "starred_comment_key" PRIMARY KEY("tenant_id","membership_id","work","verse_ref","comment_index"),
	CONSTRAINT "starred_comment_work" CHECK ("starred_comment"."work" ~ '^[a-z][a-z0-9-]{0,31}$'),
	CONSTRAINT "starred_comment_ref" CHECK ("starred_comment"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "starred_comment_index" CHECK ("starred_comment"."comment_index" between 1 and 60),
	CONSTRAINT "starred_comment_instant" CHECK (isfinite("starred_comment"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "saved_reading" ADD CONSTRAINT "saved_reading_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reading" ADD CONSTRAINT "saved_reading_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_verse_mark" ADD CONSTRAINT "saved_verse_mark_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_verse_mark" ADD CONSTRAINT "saved_verse_mark_reading_fk" FOREIGN KEY ("tenant_id","saved_reading_id","membership_id") REFERENCES "public"."saved_reading"("tenant_id","id","membership_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_verse_work" ADD CONSTRAINT "saved_verse_work_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_verse_work" ADD CONSTRAINT "saved_verse_work_reading_fk" FOREIGN KEY ("tenant_id","saved_reading_id","membership_id") REFERENCES "public"."saved_reading"("tenant_id","id","membership_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_comment" ADD CONSTRAINT "starred_comment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_comment" ADD CONSTRAINT "starred_comment_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_reading_member_idx" ON "saved_reading" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "saved_verse_mark_member_idx" ON "saved_verse_mark" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "saved_verse_work_member_idx" ON "saved_verse_work" USING btree ("tenant_id","membership_id");
--> statement-breakpoint
-- Release 1.4 saved layer (accounts plan, section 1a). Only the owner reads: every table has one forced owner_only policy on the
-- tenant and app.saved_owner, a transaction-local membership id that only src/server/saved/access.ts sets after the session and
-- eligibility checks. Unset or empty matches nothing; a malformed value fails the uuid cast. No table-level UPDATE anywhere;
-- DELETE only on saved_reading (cascading to its children as the table owner) and starred_comment, both limited by owner_only.
ALTER TABLE saved_reading ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE saved_reading FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON saved_reading FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON saved_reading FROM portal_runtime;
--> statement-breakpoint
-- A member renames, re-dates or hard-deletes their own reading; who owns it, its kind and its ranges never change.
GRANT SELECT, INSERT, DELETE ON saved_reading TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (name, reading_date, revision, updated_at) ON saved_reading TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON saved_reading TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE saved_verse_work ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE saved_verse_work FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON saved_verse_work FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON saved_verse_work FROM portal_runtime;
--> statement-breakpoint
-- Head rows changed in place; no DELETE: removing the reading cascades as the table owner.
GRANT SELECT, INSERT ON saved_verse_work TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (text, version, updated_at) ON saved_verse_work TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON saved_verse_work TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE saved_verse_mark ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE saved_verse_mark FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON saved_verse_mark FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON saved_verse_mark FROM portal_runtime;
--> statement-breakpoint
-- Head rows changed in place; no DELETE: removing the reading cascades as the table owner.
GRANT SELECT, INSERT ON saved_verse_mark TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (state, version, updated_at) ON saved_verse_mark TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON saved_verse_mark TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE starred_comment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE starred_comment FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON starred_comment FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON starred_comment FROM portal_runtime;
--> statement-breakpoint
-- A row is a star: starring inserts it and unstarring is the member's own delete, so the cap counts only live stars. Nothing is updated.
GRANT SELECT, INSERT, DELETE ON starred_comment TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON starred_comment TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid);
