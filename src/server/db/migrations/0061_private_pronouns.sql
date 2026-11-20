CREATE TABLE "private_pronouns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid,
	"student_id" uuid,
	"pronouns" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "private_pronouns_member_key" UNIQUE("tenant_id","membership_id"),
	CONSTRAINT "private_pronouns_student_key" UNIQUE("tenant_id","student_id"),
	CONSTRAINT "private_pronouns_subject" CHECK (("private_pronouns"."membership_id" is null) <> ("private_pronouns"."student_id" is null)),
	CONSTRAINT "private_pronouns_shape" CHECK (char_length("private_pronouns"."pronouns") <= 80 and "private_pronouns"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "private_pronouns" ADD CONSTRAINT "private_pronouns_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_pronouns" ADD CONSTRAINT "private_pronouns_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_pronouns" ADD CONSTRAINT "private_pronouns_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE private_pronouns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE private_pronouns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON private_pronouns FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON private_pronouns FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON private_pronouns TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (pronouns, revision) ON private_pronouns TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON private_pronouns TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE TRIGGER immutable_private_pronouns BEFORE UPDATE ON private_pronouns FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('id', 'tenant_id', 'membership_id', 'student_id');
--> statement-breakpoint
