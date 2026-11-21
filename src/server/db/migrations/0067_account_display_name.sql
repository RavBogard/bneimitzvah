CREATE TABLE "account_display_name" (
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "account_display_name_key" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "account_display_name_shape" CHECK ("account_display_name"."name" = btrim("account_display_name"."name") and char_length("account_display_name"."name") between 1 and 80
    and "account_display_name"."name" !~ '[<>@]' and "account_display_name"."name" !~ '[\x01-\x1f\x7f-\x9f\xad\x61c\x115f\x1160\x200b-\x200d\x2028\x2029\x202a-\x202e\x2060-\x2064\x2066-\x2069\x3164\xfeff\xffa0\xe0000-\xe007f]' and "account_display_name"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "account_display_name" ADD CONSTRAINT "account_display_name_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE account_display_name ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_display_name FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON account_display_name FROM PUBLIC, portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON account_display_name TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (name, revision) ON account_display_name TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON account_display_name TO portal_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE TRIGGER immutable_account_display_name BEFORE UPDATE ON account_display_name FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('tenant_id', 'membership_id');
