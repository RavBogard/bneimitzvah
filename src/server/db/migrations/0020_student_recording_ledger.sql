CREATE TABLE "student_recording" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"content_sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"state" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	CONSTRAINT "student_recording_asset_key" UNIQUE("asset_id"),
	CONSTRAINT "student_recording_hash" CHECK ("student_recording"."content_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "student_recording_media" CHECK ("student_recording"."media_type" in ('audio/webm;codecs=opus','audio/mp4;codecs=mp4a.40.2') and "student_recording"."byte_length" between 1 and 33554432 and "student_recording"."duration_ms" between 1 and 600000),
	CONSTRAINT "student_recording_instants" CHECK (isfinite("student_recording"."created_at") and ("student_recording"."submitted_at" is null or (isfinite("student_recording"."submitted_at") and "student_recording"."submitted_at" >= "student_recording"."created_at")) and ("student_recording"."deletion_requested_at" is null or (isfinite("student_recording"."deletion_requested_at") and "student_recording"."deletion_requested_at" >= coalesce("student_recording"."submitted_at", "student_recording"."created_at")))),
	CONSTRAINT "student_recording_lifecycle" CHECK (("student_recording"."state" = 'private' and "student_recording"."revision" = 1 and "student_recording"."submitted_at" is null and "student_recording"."deletion_requested_at" is null) or ("student_recording"."state" = 'submitted' and "student_recording"."revision" = 2 and "student_recording"."submitted_at" is not null and "student_recording"."deletion_requested_at" is null) or ("student_recording"."state" = 'deleting' and "student_recording"."deletion_requested_at" is not null and (("student_recording"."revision" = 2 and "student_recording"."submitted_at" is null) or ("student_recording"."revision" = 3 and "student_recording"."submitted_at" is not null))))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "student_recording" ADD CONSTRAINT "student_recording_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_recording" ADD CONSTRAINT "student_recording_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_recording_creation_idx" ON "student_recording" USING btree ("tenant_id","student_id","created_at","id");--> statement-breakpoint
CREATE INDEX "student_recording_submission_idx" ON "student_recording" USING btree ("tenant_id","student_id","submitted_at","id");--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request'));
--> statement-breakpoint
ALTER TABLE student_recording ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE student_recording FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON student_recording FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON student_recording FROM portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON student_recording TO portal_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT, INSERT ON student_recording TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (state, revision, submitted_at, deletion_requested_at) ON student_recording TO portal_runtime;
--> statement-breakpoint
CREATE TRIGGER immutable_student_recording BEFORE UPDATE ON student_recording FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('id','tenant_id','student_id','asset_id','content_sha256','media_type','byte_length','duration_ms','created_at');
--> statement-breakpoint
CREATE FUNCTION portal_student_recording_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'private' OR NEW.revision <> 1 OR NEW.submitted_at IS NOT NULL OR NEW.deletion_requested_at IS NOT NULL THEN
      RAISE EXCEPTION 'Initial private recording required' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  ELSIF NEW.revision::bigint <> OLD.revision::bigint + 1
      OR NOT ((OLD.state = 'private' AND NEW.state IN ('submitted','deleting')) OR (OLD.state = 'submitted' AND NEW.state = 'deleting'))
      OR (OLD.state = 'submitted' AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN
    RAISE EXCEPTION 'Consecutive recording transition required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER student_recording_transition BEFORE INSERT OR UPDATE ON student_recording FOR EACH ROW
  EXECUTE FUNCTION portal_student_recording_transition();
--> statement-breakpoint
CREATE FUNCTION portal_recording_ceremony_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE actual_now timestamptz;
BEGIN
  -- The student UPDATE lock has already been acquired; never use transaction
  -- start time after a lock wait. The existing helper deliberately supports
  -- the valid year-9999 ceremony's year-10000 calendar anniversary.
  actual_now := clock_timestamp();
  IF public.portal_practice_anniversary_due(OLD.ceremony_date, actual_now)
      OR public.portal_practice_anniversary_due(NEW.ceremony_date, actual_now) THEN
    UPDATE public.student_recording SET state = 'deleting', revision = revision + 1,
      deletion_requested_at = greatest(actual_now, created_at, submitted_at)
      WHERE tenant_id = OLD.tenant_id AND student_id = OLD.id AND state = 'submitted';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recording_ceremony_retention BEFORE UPDATE OF ceremony_date ON student
  FOR EACH ROW WHEN (OLD.ceremony_date IS DISTINCT FROM NEW.ceremony_date)
  EXECUTE FUNCTION portal_recording_ceremony_change();
