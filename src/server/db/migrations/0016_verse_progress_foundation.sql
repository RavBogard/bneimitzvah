CREATE TABLE "verse_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"verse_ref" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "verse_assessment_head_key" UNIQUE("tenant_id","student_id","assignment_id","verse_ref"),
	CONSTRAINT "verse_assessment_version_positive" CHECK ("verse_assessment"."version" > 0),
	CONSTRAINT "verse_assessment_ref" CHECK ("verse_assessment"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "verse_assessment_state" CHECK ("verse_assessment"."state" in ('not-started','working','solid'))
);
--> statement-breakpoint
CREATE TABLE "verse_self_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"verse_ref" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "verse_self_check_head_key" UNIQUE("tenant_id","student_id","assignment_id","verse_ref"),
	CONSTRAINT "verse_self_check_version_positive" CHECK ("verse_self_check"."version" > 0),
	CONSTRAINT "verse_self_check_ref" CHECK ("verse_self_check"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "verse_self_check_state" CHECK ("verse_self_check"."state" in ('unmarked','working','got-it'))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "verse_assessment" ADD CONSTRAINT "verse_assessment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_assessment" ADD CONSTRAINT "verse_assessment_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_assessment" ADD CONSTRAINT "verse_assessment_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_self_check" ADD CONSTRAINT "verse_self_check_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_self_check" ADD CONSTRAINT "verse_self_check_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_self_check" ADD CONSTRAINT "verse_self_check_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set'));
--> statement-breakpoint
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['verse_self_check','verse_assessment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM portal_runtime', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I TO portal_runtime', table_name);
    EXECUTE format('GRANT UPDATE (state, version) ON %I TO portal_runtime', table_name);
    EXECUTE format('CREATE TRIGGER immutable_progress_identity BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns(''tenant_id'',''id'',''student_id'',''assignment_id'',''verse_ref'')', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION portal_progress_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version::bigint <> OLD.version::bigint + 1 THEN
    RAISE EXCEPTION 'Progress revision required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER progress_version BEFORE UPDATE ON verse_self_check FOR EACH ROW EXECUTE FUNCTION portal_progress_version();
--> statement-breakpoint
CREATE TRIGGER progress_version BEFORE UPDATE ON verse_assessment FOR EACH ROW EXECUTE FUNCTION portal_progress_version();
