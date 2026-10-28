CREATE TABLE "learner_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"learner_membership_id" uuid NOT NULL,
	"tutor_grant_id" uuid NOT NULL,
	"tutor_role" "portal_role" DEFAULT 'tutor' NOT NULL,
	"tutor_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoked_by_membership_id" uuid,
	CONSTRAINT "learner_claim_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "learner_claim_tutor_role" CHECK ("learner_claim"."tutor_role" = 'tutor'),
	CONSTRAINT "learner_claim_revoked_by" CHECK ("learner_claim"."revoked_by" in ('learner', 'tutor', 'admin')),
	CONSTRAINT "learner_claim_revocation_whole" CHECK (("learner_claim"."revoked_at" is null) = ("learner_claim"."revoked_by" is null) and ("learner_claim"."revoked_at" is null) = ("learner_claim"."revoked_by_membership_id" is null)),
	CONSTRAINT "learner_claim_instants" CHECK (isfinite("learner_claim"."created_at") and ("learner_claim"."revoked_at" is null or (isfinite("learner_claim"."revoked_at") and "learner_claim"."revoked_at" >= "learner_claim"."created_at")))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "account_request" ADD COLUMN "student_id" uuid;--> statement-breakpoint
ALTER TABLE "learner_claim" ADD CONSTRAINT "learner_claim_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_claim" ADD CONSTRAINT "learner_claim_learner_fk" FOREIGN KEY ("tenant_id","learner_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_claim" ADD CONSTRAINT "learner_claim_tutor_fk" FOREIGN KEY ("tenant_id","tutor_grant_id","tutor_role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_claim" ADD CONSTRAINT "learner_claim_link_fk" FOREIGN KEY ("tenant_id","tutor_link_id") REFERENCES "public"."tutor_student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_claim" ADD CONSTRAINT "learner_claim_revoker_fk" FOREIGN KEY ("tenant_id","revoked_by_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learner_claim_active_key" ON "learner_claim" USING btree ("tenant_id","learner_membership_id") WHERE "learner_claim"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "account_request" ADD CONSTRAINT "account_request_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe','mcp-connection.revoke','source-identity.revoke','account-request.approve','account-request.decline','member.revoke','approver.designate','approver.revoke','service-part.finish','ceremony-done.set','ceremony-done.reverse','invite.copy','learner.claim','learner.unclaim'));
--> statement-breakpoint
-- Readings for everyone (Daniel, 2026-10-27; plan decisions 2 and 3). A tutor's claim on a learner: forced row security with the
-- tenant_isolation policy the tenant tables have had since 0002. SELECT, INSERT of the claim's own columns and UPDATE of the three
-- revocation columns only; no DELETE, no TRUNCATE. Who claimed whom never changes once written (the trigger refuses it, as 0002
-- does for tutor_student); a claim ends by being revoked, whole: when, by whom (learner, tutor or admin) and which membership.
ALTER TABLE learner_claim ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE learner_claim FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON learner_claim FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON learner_claim FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT ON learner_claim TO portal_runtime;
--> statement-breakpoint
GRANT INSERT (tenant_id, learner_membership_id, tutor_grant_id, tutor_link_id) ON learner_claim TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by, revoked_by_membership_id) ON learner_claim TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON learner_claim TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE TRIGGER immutable_learner_claim BEFORE UPDATE ON learner_claim FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id', 'id', 'learner_membership_id', 'tutor_grant_id', 'tutor_role', 'tutor_link_id', 'created_at');
--> statement-breakpoint
-- The saved layer's two read-only policies (plan decision 3), beside the untouched owner_only policies of 0036. staff_read: the rows
-- of one learner, the membership named by app.saved_viewer, which only src/server/saved/access.ts sets, transaction-locally, after
-- the viewer is found to be a live admin, the tutor whose claim on the learner is live, or the tutor linked to the learner's student.
-- directory_read: every reading of the tenant while app.saved_directory is 'on', set in the same file for a live admin or tutor, so
-- the learner directory can count readings and find the nearest date; it opens no mark, note or star. Both are SELECT only, and
-- neither path sets the owner, so owner_only's WITH CHECK admits no insert, and no row is visible to an UPDATE or DELETE.
CREATE POLICY staff_read ON saved_reading FOR SELECT TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_viewer', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY staff_read ON saved_verse_work FOR SELECT TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_viewer', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY staff_read ON saved_verse_mark FOR SELECT TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_viewer', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY staff_read ON starred_comment FOR SELECT TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_viewer', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY directory_read ON saved_reading FOR SELECT TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND current_setting('app.saved_directory', true) = 'on');
