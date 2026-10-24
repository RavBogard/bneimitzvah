CREATE TABLE "account_preference" (
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_preference_key" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "account_preference_document" CHECK (jsonb_typeof("account_preference"."preferences") = 'object' and coalesce("account_preference"."preferences"->'version' = '1'::jsonb, false) and ("account_preference"."preferences" - array['version','works','studyEnglish','colors','translation','size','tikkunView']) = '{}'::jsonb and octet_length("account_preference"."preferences"::text) <= 1024),
	CONSTRAINT "account_preference_works" CHECK (case when "account_preference"."preferences"->'works' is null then true when jsonb_typeof("account_preference"."preferences"->'works') <> 'array' then false else jsonb_array_length("account_preference"."preferences"->'works') <= 3 and not jsonb_path_exists("account_preference"."preferences"->'works', '$[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9-]{0,31}$"))') end),
	CONSTRAINT "account_preference_values" CHECK (coalesce(jsonb_typeof("account_preference"."preferences"->'studyEnglish') = 'boolean', true) and coalesce(jsonb_typeof("account_preference"."preferences"->'colors') = 'boolean', true) and coalesce(jsonb_typeof("account_preference"."preferences"->'translation') = 'boolean', true) and coalesce(jsonb_typeof("account_preference"."preferences"->'size') = 'string' and "account_preference"."preferences"->>'size' in ('small','standard','large','huge'), true) and coalesce(jsonb_typeof("account_preference"."preferences"->'tikkunView') = 'string' and "account_preference"."preferences"->>'tikkunView' in ('off','beside','only'), true)),
	CONSTRAINT "account_preference_revision" CHECK ("account_preference"."revision" > 0),
	CONSTRAINT "account_preference_instants" CHECK (isfinite("account_preference"."created_at") and isfinite("account_preference"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "account_preference" ADD CONSTRAINT "account_preference_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_preference" ADD CONSTRAINT "account_preference_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Release 1.7 M3b (PLAN-1-7): the account keeps a member's preferred commentaries and reading settings. On the 0036 saved
-- layer's owner binding exactly: one forced owner_only policy on the tenant and app.saved_owner, the transaction-local membership
-- id that only src/server/saved/access.ts sets after the session and eligibility checks. Unset or empty matches nothing; a
-- malformed value fails the uuid cast. Staff, Daniel, MCP, cron, the roster Sheet and notifications never set it and see no rows.
-- One small validated document per member, replaced in place under its revision; who owns it never changes. No DELETE, no TRUNCATE.
ALTER TABLE account_preference ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_preference FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON account_preference FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON account_preference FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON account_preference TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (preferences, revision, updated_at) ON account_preference TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON account_preference TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid);