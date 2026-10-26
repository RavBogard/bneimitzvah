CREATE TABLE "verse_review" (
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"review" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verse_review_key" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "verse_review_document" CHECK (jsonb_typeof("verse_review"."review") = 'object' and coalesce("verse_review"."review"->>'schema' = 'learn-verses/v1' and jsonb_typeof("verse_review"."review"->'cards') = 'object', false) and octet_length("verse_review"."review"::text) <= 49152),
	CONSTRAINT "verse_review_version" CHECK ("verse_review"."version" > 0),
	CONSTRAINT "verse_review_instants" CHECK (isfinite("verse_review"."created_at") and isfinite("verse_review"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "verse_review" ADD CONSTRAINT "verse_review_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_review" ADD CONSTRAINT "verse_review_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- 1.9 N19 (PLAN, Lane 3): a student's own verse review cards, a copy of 0037 with its own owner setting. Only the owner
-- reads: one forced owner_only policy on the tenant and app.verse_review_owner, a transaction-local membership id that only
-- src/server/verse-review/access.ts sets after the session and live student grant checks. Unset or empty matches nothing;
-- a malformed value fails the uuid cast. Tutors, parents, admins, Daniel, MCP, cron and the Sheet never set it. Column
-- UPDATE only; no DELETE and no TRUNCATE.
ALTER TABLE verse_review ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE verse_review FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON verse_review FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON verse_review FROM portal_runtime;
--> statement-breakpoint
-- One document per member, replaced in place under an optimistic version; who owns it never changes.
GRANT SELECT, INSERT ON verse_review TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (review, version, updated_at) ON verse_review TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON verse_review TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.verse_review_owner', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.verse_review_owner', true), '')::uuid);
