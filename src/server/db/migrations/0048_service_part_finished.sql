CREATE TABLE "service_part_finished" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_part_finished_key" PRIMARY KEY("tenant_id","student_id","lesson_id"),
	CONSTRAINT "service_part_finished_lesson" CHECK ("service_part_finished"."lesson_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "service_part_finished_instant" CHECK (isfinite("service_part_finished"."finished_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "service_part_finished" ADD CONSTRAINT "service_part_finished_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_part_finished" ADD CONSTRAINT "service_part_finished_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe','mcp-connection.revoke','source-identity.revoke','account-request.approve','account-request.decline','member.revoke','approver.designate','approver.revoke','service-part.finish'));
--> statement-breakpoint
-- Release 2.0 SC5 (A4 9, Batch 3 Q12): the per-part finished mark, staff-readable as ruled and insert-only. Forced row security:
-- a RESTRICTIVE tenant_isolation policy ANDed with one permissive SELECT policy for the ruled readers and one permissive INSERT
-- policy for the student alone. The reader is app.service_part_reader, a role grant id that only
-- src/server/service-course/finished.ts sets, transaction-locally, after the live checks; a parent in child practice also needs
-- app.service_part_context, a live child-practice context naming that child. Unset or empty matches nothing; a malformed value
-- fails the uuid cast. Readers: the student (live student_identity), a parent only in live child practice for that child, a tutor
-- only with a live tutor_student row for that student, and admins (rabbis are admins); each grant live, its membership enabled,
-- the student enabled. A parent in parent view, MCP, cron, the Sheet and notifications never set it and see no rows.
-- Column INSERT only (finished_at is always the server's now()); no UPDATE, DELETE or TRUNCATE, and a trigger refuses UPDATE and DELETE.
ALTER TABLE service_part_finished ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_part_finished FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON service_part_finished FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON service_part_finished FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT ON service_part_finished TO portal_runtime;
--> statement-breakpoint
GRANT INSERT (tenant_id, student_id, lesson_id) ON service_part_finished TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON service_part_finished AS RESTRICTIVE TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY ruled_readers ON service_part_finished FOR SELECT TO portal_runtime USING (EXISTS (
  SELECT 1 FROM role_grant g
    JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id AND m.disabled_at IS NULL
    JOIN student s ON s.tenant_id = g.tenant_id AND s.id = service_part_finished.student_id AND s.disabled_at IS NULL
  WHERE g.tenant_id = service_part_finished.tenant_id
    AND g.id = nullif(current_setting('app.service_part_reader', true), '')::uuid
    AND g.revoked_at IS NULL
    AND (g.role = 'admin'
      OR (g.role = 'tutor' AND EXISTS (SELECT 1 FROM tutor_student t WHERE t.tenant_id = g.tenant_id AND t.tutor_grant_id = g.id AND t.student_id = s.id AND t.revoked_at IS NULL))
      OR (g.role = 'student' AND EXISTS (SELECT 1 FROM student_identity i WHERE i.tenant_id = g.tenant_id AND i.role_grant_id = g.id AND i.student_id = s.id AND i.revoked_at IS NULL))
      OR (g.role = 'parent' AND EXISTS (SELECT 1 FROM practice_context c
          JOIN guardian d ON d.tenant_id = c.tenant_id AND d.id = c.guardian_id AND d.student_id = s.id AND d.parent_grant_id = g.id AND d.revoked_at IS NULL AND d.practice_enabled
        WHERE c.tenant_id = g.tenant_id AND c.id = nullif(current_setting('app.service_part_context', true), '')::uuid AND c.role_grant_id = g.id
          AND c.mode = 'child-practice' AND c.acting_student_id = s.id AND c.revoked_at IS NULL AND c.expires_at > now())))));
--> statement-breakpoint
CREATE POLICY student_writer ON service_part_finished FOR INSERT TO portal_runtime WITH CHECK (EXISTS (
  SELECT 1 FROM role_grant g
    JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id AND m.disabled_at IS NULL
    JOIN student s ON s.tenant_id = g.tenant_id AND s.id = service_part_finished.student_id AND s.disabled_at IS NULL
    JOIN student_identity i ON i.tenant_id = g.tenant_id AND i.role_grant_id = g.id AND i.student_id = s.id AND i.revoked_at IS NULL
  WHERE g.tenant_id = service_part_finished.tenant_id
    AND g.id = nullif(current_setting('app.service_part_reader', true), '')::uuid
    AND g.revoked_at IS NULL AND g.role = 'student'));
--> statement-breakpoint
CREATE TRIGGER immutable_service_part_finished BEFORE UPDATE OR DELETE ON service_part_finished FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
