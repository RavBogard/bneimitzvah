CREATE TABLE "lesson_log" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"creator_membership_id" uuid NOT NULL,
	"creator_user_id" text NOT NULL,
	"lesson_date" date NOT NULL,
	"summary" text NOT NULL,
	"version" integer NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "lesson_log_key" PRIMARY KEY("tenant_id","student_id","entry_id"),
	CONSTRAINT "lesson_log_version_positive" CHECK ("lesson_log"."version" > 0),
	CONSTRAINT "lesson_log_date" CHECK ("lesson_log"."lesson_date" between date '0001-01-01' and date '9999-12-31'),
	CONSTRAINT "lesson_log_summary" CHECK (("lesson_log"."deleted" and "lesson_log"."summary" = '') or (not "lesson_log"."deleted" and length(trim("lesson_log"."summary")) > 0 and octet_length("lesson_log"."summary") <= 4096))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "lesson_log" ADD CONSTRAINT "lesson_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_log" ADD CONSTRAINT "lesson_log_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_log" ADD CONSTRAINT "lesson_log_creator_fk" FOREIGN KEY ("tenant_id","creator_membership_id","creator_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete'));
--> statement-breakpoint
ALTER TABLE lesson_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lesson_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON lesson_log FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON lesson_log FROM portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON lesson_log TO portal_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT, INSERT ON lesson_log TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (lesson_date, summary, version, deleted) ON lesson_log TO portal_runtime;
--> statement-breakpoint
CREATE TRIGGER immutable_lesson_identity BEFORE UPDATE ON lesson_log FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('tenant_id','student_id','entry_id','creator_membership_id','creator_user_id');
--> statement-breakpoint
CREATE FUNCTION portal_lesson_log_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.deleted THEN
      RAISE EXCEPTION 'Initial lesson head required' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted OR NEW.version::bigint <> OLD.version::bigint + 1 THEN
    RAISE EXCEPTION 'Live lesson revision required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lesson_log_version BEFORE INSERT OR UPDATE ON lesson_log FOR EACH ROW EXECUTE FUNCTION portal_lesson_log_version();
