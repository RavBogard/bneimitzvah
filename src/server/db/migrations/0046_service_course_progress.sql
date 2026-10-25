CREATE TABLE "service_course_progress" (
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"progress" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_course_progress_key" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "service_course_progress_document" CHECK (jsonb_typeof("service_course_progress"."progress") = 'object' and coalesce("service_course_progress"."progress"->>'schema' = 'service-course-progress/v1' and jsonb_typeof("service_course_progress"."progress"->'lessons') = 'object' and jsonb_typeof("service_course_progress"."progress"->'cards') = 'object', false) and octet_length("service_course_progress"."progress"::text) <= 98304),
	CONSTRAINT "service_course_progress_version" CHECK ("service_course_progress"."version" > 0),
	CONSTRAINT "service_course_progress_instants" CHECK (isfinite("service_course_progress"."created_at") and isfinite("service_course_progress"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "service_course_progress" ADD CONSTRAINT "service_course_progress_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_course_progress" ADD CONSTRAINT "service_course_progress_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Release 2.0 SC4 (A4 6.2, migration A): a member's own progress in the service course, a copy of 0037 with its own
-- owner setting. Only the owner reads: one forced owner_only policy on the tenant and app.service_course_owner, a
-- transaction-local membership id that only src/server/service-course/progress-access.ts sets after the session and
-- eligibility checks. Unset or empty matches nothing; a malformed value fails the uuid cast. Staff, Daniel, MCP, cron and
-- the Sheet never set it. Column UPDATE only; no DELETE and no TRUNCATE.
ALTER TABLE service_course_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_course_progress FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON service_course_progress FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON service_course_progress FROM portal_runtime;
--> statement-breakpoint
-- One document per member, replaced in place under an optimistic version; who owns it never changes.
GRANT SELECT, INSERT ON service_course_progress TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (progress, version, updated_at) ON service_course_progress TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON service_course_progress TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.service_course_owner', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.service_course_owner', true), '')::uuid);
