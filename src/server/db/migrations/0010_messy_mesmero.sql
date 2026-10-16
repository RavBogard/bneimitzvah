CREATE TABLE "translation_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"verse_ref" text NOT NULL,
	"version" integer NOT NULL,
	"assignment_id" uuid NOT NULL,
	"assignment_revision" integer NOT NULL,
	"text" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"guardian_id" uuid,
	"context_id" uuid,
	"student_identity_id" uuid,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"base_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translation_draft_stream_key" UNIQUE("tenant_id","student_id","verse_ref","version"),
	CONSTRAINT "translation_draft_receipt_key" UNIQUE("tenant_id","student_id","actor_user_id","mutation_id"),
	CONSTRAINT "translation_draft_versions" CHECK ("translation_draft"."version" > 0 and "translation_draft"."base_version" >= 0 and "translation_draft"."version" = "translation_draft"."base_version" + 1 and "translation_draft"."assignment_revision" > 0),
	CONSTRAINT "translation_draft_text_bound" CHECK (octet_length("translation_draft"."text") <= 4096 and translate("translation_draft"."text", chr(9) || chr(10), '') !~ '[[:cntrl:]]'),
	CONSTRAINT "translation_draft_digest" CHECK ("translation_draft"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "translation_draft_ref" CHECK ("translation_draft"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "translation_draft_mode" CHECK (("translation_draft"."mode" = 'student' and "translation_draft"."role" = 'student' and "translation_draft"."student_identity_id" is not null and "translation_draft"."guardian_id" is null and "translation_draft"."context_id" is null) or ("translation_draft"."mode" = 'child-practice' and "translation_draft"."role" = 'parent' and "translation_draft"."guardian_id" is not null and "translation_draft"."context_id" is not null and "translation_draft"."student_identity_id" is null))
);
--> statement-breakpoint
CREATE TABLE "tutor_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"verse_ref" text NOT NULL,
	"version" integer NOT NULL,
	"assignment_id" uuid NOT NULL,
	"assignment_revision" integer NOT NULL,
	"text" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"guardian_id" uuid,
	"context_id" uuid,
	"student_identity_id" uuid,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"base_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_note_stream_key" UNIQUE("tenant_id","student_id","verse_ref","version"),
	CONSTRAINT "tutor_note_receipt_key" UNIQUE("tenant_id","student_id","actor_user_id","mutation_id"),
	CONSTRAINT "tutor_note_versions" CHECK ("tutor_note"."version" > 0 and "tutor_note"."base_version" >= 0 and "tutor_note"."version" = "tutor_note"."base_version" + 1 and "tutor_note"."assignment_revision" > 0),
	CONSTRAINT "tutor_note_text_bound" CHECK (octet_length("tutor_note"."text") <= 4096 and translate("tutor_note"."text", chr(9) || chr(10), '') !~ '[[:cntrl:]]'),
	CONSTRAINT "tutor_note_digest" CHECK ("tutor_note"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "tutor_note_ref" CHECK ("tutor_note"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "tutor_note_mode" CHECK ("tutor_note"."mode"::text = "tutor_note"."role"::text and "tutor_note"."mode" in ('admin','tutor') and "tutor_note"."guardian_id" is null and "tutor_note"."context_id" is null and "tutor_note"."student_identity_id" is null and length(trim("tutor_note"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id","student_id","role_grant_id") REFERENCES "public"."guardian"("tenant_id","id","student_id","parent_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_draft" ADD CONSTRAINT "translation_draft_identity_fk" FOREIGN KEY ("tenant_id","student_identity_id","student_id","role_grant_id") REFERENCES "public"."student_identity"("tenant_id","id","student_id","role_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id","student_id","role_grant_id") REFERENCES "public"."guardian"("tenant_id","id","student_id","parent_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_note" ADD CONSTRAINT "tutor_note_identity_fk" FOREIGN KEY ("tenant_id","student_identity_id","student_id","role_grant_id") REFERENCES "public"."student_identity"("tenant_id","id","student_id","role_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append'));
--> statement-breakpoint
-- Context UUID is immutable historical attribution, not an FK to the ephemeral
-- session/context lifecycle and never an authority grant. Durable lineage is
-- constrained by the exact membership/grant/student/guardian tuples above.
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['translation_draft','tutor_note'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO portal_runtime', table_name);
    EXECUTE format('CREATE TRIGGER immutable_work BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit()', table_name);
  END LOOP;
END $$;
