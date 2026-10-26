CREATE TABLE "student_ceremony_done" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"set_by_grant_id" uuid NOT NULL,
	"set_by_role" "portal_role" DEFAULT 'admin' NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_grant_id" uuid,
	"reversed_by_role" "portal_role",
	"reversed_at" timestamp with time zone,
	CONSTRAINT "student_ceremony_done_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_ceremony_done_set_by_admin" CHECK ("student_ceremony_done"."set_by_role" = 'admin'),
	CONSTRAINT "student_ceremony_done_reversal_whole" CHECK (("student_ceremony_done"."reversed_at" is null and "student_ceremony_done"."reversed_by_grant_id" is null and "student_ceremony_done"."reversed_by_role" is null)
    or ("student_ceremony_done"."reversed_at" is not null and "student_ceremony_done"."reversed_by_grant_id" is not null and "student_ceremony_done"."reversed_by_role" = 'admin' and "student_ceremony_done"."reversed_at" >= "student_ceremony_done"."set_at")),
	CONSTRAINT "student_ceremony_done_instants" CHECK (isfinite("student_ceremony_done"."set_at") and ("student_ceremony_done"."reversed_at" is null or isfinite("student_ceremony_done"."reversed_at")))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "student_ceremony_done" ADD CONSTRAINT "student_ceremony_done_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_ceremony_done" ADD CONSTRAINT "student_ceremony_done_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_ceremony_done" ADD CONSTRAINT "student_ceremony_done_set_by_fk" FOREIGN KEY ("tenant_id","set_by_grant_id","set_by_role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_ceremony_done" ADD CONSTRAINT "student_ceremony_done_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by_grant_id","reversed_by_role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_ceremony_done_live_key" ON "student_ceremony_done" USING btree ("tenant_id","student_id") WHERE "student_ceremony_done"."reversed_at" is null;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe','mcp-connection.revoke','source-identity.revoke','account-request.approve','account-request.decline','member.revoke','approver.designate','approver.revoke','service-part.finish','ceremony-done.set','ceremony-done.reverse'));
--> statement-breakpoint
-- Release 1.9 N21, "Ceremony done" (Daniel, decision 13; PLAN Decided here 5: ceremony done narrows access, never widens it).
-- Forced row security, as on the other student tables, with a RESTRICTIVE tenant_isolation ANDed with every permissive policy.
-- Any reader of the tenant may see the state (every active list filters on it). Writes need app.ceremony_done_actor, a role grant
-- id that only src/server/students/ceremony-done.ts sets, transaction-locally, after withAdminCapability; the policies hold it to
-- a live admin grant (rabbis are admins) of an enabled membership. Setting it also needs an enabled student and no live
-- tutor_student row left for that student: the tutor rows end first, in the same transaction. Reversing fills reversed_by and
-- reversed_at (the trigger writes the server's now()) on the live row; it restores no tutor row. No DELETE, no TRUNCATE; a
-- reversed row never changes again. While the state is live, a trigger refuses any new tutor_student row for that student.
ALTER TABLE student_ceremony_done ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE student_ceremony_done FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON student_ceremony_done FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON student_ceremony_done FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT ON student_ceremony_done TO portal_runtime;
--> statement-breakpoint
GRANT INSERT (tenant_id, student_id, set_by_grant_id) ON student_ceremony_done TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (reversed_by_grant_id, reversed_by_role) ON student_ceremony_done TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON student_ceremony_done AS RESTRICTIVE TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY tenant_readers ON student_ceremony_done FOR SELECT TO portal_runtime USING (true);
--> statement-breakpoint
CREATE POLICY admin_setter ON student_ceremony_done FOR INSERT TO portal_runtime WITH CHECK (
  set_by_grant_id = nullif(current_setting('app.ceremony_done_actor', true), '')::uuid
  AND EXISTS (SELECT 1 FROM role_grant g
    JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id AND m.disabled_at IS NULL
    WHERE g.tenant_id = student_ceremony_done.tenant_id AND g.id = student_ceremony_done.set_by_grant_id AND g.role = 'admin' AND g.revoked_at IS NULL)
  AND EXISTS (SELECT 1 FROM student s WHERE s.tenant_id = student_ceremony_done.tenant_id AND s.id = student_ceremony_done.student_id AND s.disabled_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM tutor_student t WHERE t.tenant_id = student_ceremony_done.tenant_id AND t.student_id = student_ceremony_done.student_id AND t.revoked_at IS NULL));
--> statement-breakpoint
CREATE POLICY admin_reverser ON student_ceremony_done FOR UPDATE TO portal_runtime USING (reversed_at IS NULL) WITH CHECK (
  reversed_by_grant_id = nullif(current_setting('app.ceremony_done_actor', true), '')::uuid
  AND EXISTS (SELECT 1 FROM role_grant g
    JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id AND m.disabled_at IS NULL
    WHERE g.tenant_id = student_ceremony_done.tenant_id AND g.id = student_ceremony_done.reversed_by_grant_id AND g.role = 'admin' AND g.revoked_at IS NULL));
--> statement-breakpoint
CREATE FUNCTION portal_ceremony_done_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Ceremony done history is kept' USING ERRCODE = '23514'; END IF;
  IF OLD.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'A reversed ceremony done cannot change' USING ERRCODE = '23514'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.student_id IS DISTINCT FROM OLD.student_id
      OR NEW.set_by_grant_id IS DISTINCT FROM OLD.set_by_grant_id OR NEW.set_by_role IS DISTINCT FROM OLD.set_by_role OR NEW.set_at IS DISTINCT FROM OLD.set_at THEN
    RAISE EXCEPTION 'Ceremony done identity is immutable' USING ERRCODE = '23514';
  END IF;
  NEW.reversed_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_student_ceremony_done BEFORE UPDATE OR DELETE ON student_ceremony_done FOR EACH ROW EXECUTE FUNCTION portal_ceremony_done_guard();
--> statement-breakpoint
CREATE FUNCTION portal_tutor_after_ceremony() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NULL AND EXISTS (SELECT 1 FROM student_ceremony_done c
      WHERE c.tenant_id = NEW.tenant_id AND c.student_id = NEW.student_id AND c.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'No tutor assignment while ceremony done' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tutor_student_ceremony_done BEFORE INSERT ON tutor_student FOR EACH ROW EXECUTE FUNCTION portal_tutor_after_ceremony();
