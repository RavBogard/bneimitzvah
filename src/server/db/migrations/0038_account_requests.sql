CREATE TABLE "account_approver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"tutor_grant_id" uuid NOT NULL,
	"role" "portal_role" DEFAULT 'tutor' NOT NULL,
	"designated_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_membership_id" uuid,
	CONSTRAINT "account_approver_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "account_approver_role" CHECK ("account_approver"."role" = 'tutor'),
	CONSTRAINT "account_approver_revoked_pair" CHECK (("account_approver"."revoked_at" is null) = ("account_approver"."revoked_by_membership_id" is null)),
	CONSTRAINT "account_approver_instants" CHECK (isfinite("account_approver"."created_at") and ("account_approver"."revoked_at" is null or isfinite("account_approver"."revoked_at")))
);
--> statement-breakpoint
CREATE TABLE "account_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notify_status" text DEFAULT 'pending' NOT NULL,
	"notify_attempted_at" timestamp with time zone,
	CONSTRAINT "account_request_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "account_request_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "account_request_name" CHECK ("account_request"."display_name" = btrim("account_request"."display_name") and char_length("account_request"."display_name") between 1 and 80 and "account_request"."display_name" !~ '[\x01-\x1f\x7f-\x9f\xad\x61c\x115f\x1160\x200b-\x200d\x2028\x2029\x202a-\x202e\x2060-\x2064\x2066-\x2069\x3164\xfeff\xffa0\xe0000-\xe007f]'),
	CONSTRAINT "account_request_purpose" CHECK ("account_request"."purpose" is null or ("account_request"."purpose" = btrim("account_request"."purpose") and char_length("account_request"."purpose") between 1 and 500 and "account_request"."purpose" !~ '[\x01-\x1f\x7f-\x9f\xad\x61c\x115f\x1160\x200b-\x200d\x2028\x2029\x202a-\x202e\x2060-\x2064\x2066-\x2069\x3164\xfeff\xffa0\xe0000-\xe007f]')),
	CONSTRAINT "account_request_notify_shape" CHECK (("account_request"."notify_status" in ('pending','skipped') and "account_request"."notify_attempted_at" is null) or ("account_request"."notify_status" in ('sent','failed') and "account_request"."notify_attempted_at" is not null)),
	CONSTRAINT "account_request_instants" CHECK (isfinite("account_request"."created_at") and ("account_request"."notify_attempted_at" is null or isfinite("account_request"."notify_attempted_at")))
);
--> statement-breakpoint
CREATE TABLE "tenant_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"approved_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_membership_id" uuid,
	"welcome_status" text DEFAULT 'pending' NOT NULL,
	"welcome_attempted_at" timestamp with time zone,
	CONSTRAINT "tenant_member_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_member_name" CHECK ("tenant_member"."display_name" = btrim("tenant_member"."display_name") and char_length("tenant_member"."display_name") between 1 and 80 and "tenant_member"."display_name" !~ '[\x01-\x1f\x7f-\x9f\xad\x61c\x115f\x1160\x200b-\x200d\x2028\x2029\x202a-\x202e\x2060-\x2064\x2066-\x2069\x3164\xfeff\xffa0\xe0000-\xe007f]'),
	CONSTRAINT "tenant_member_revoked_pair" CHECK (("tenant_member"."revoked_at" is null) = ("tenant_member"."revoked_by_membership_id" is null)),
	CONSTRAINT "tenant_member_welcome_shape" CHECK (("tenant_member"."welcome_status" in ('pending','skipped') and "tenant_member"."welcome_attempted_at" is null) or ("tenant_member"."welcome_status" in ('sent','failed') and "tenant_member"."welcome_attempted_at" is not null)),
	CONSTRAINT "tenant_member_instants" CHECK (isfinite("tenant_member"."created_at") and ("tenant_member"."revoked_at" is null or isfinite("tenant_member"."revoked_at")) and ("tenant_member"."welcome_attempted_at" is null or isfinite("tenant_member"."welcome_attempted_at")))
);
--> statement-breakpoint
ALTER TABLE "invitation_throttle" DROP CONSTRAINT "invitation_throttle_scope";--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "account_approver" ADD CONSTRAINT "account_approver_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_approver" ADD CONSTRAINT "account_approver_grant_fk" FOREIGN KEY ("tenant_id","tutor_grant_id","membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_approver" ADD CONSTRAINT "account_approver_role_fk" FOREIGN KEY ("tenant_id","tutor_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_approver" ADD CONSTRAINT "account_approver_designator_fk" FOREIGN KEY ("tenant_id","designated_by_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_approver" ADD CONSTRAINT "account_approver_revoker_fk" FOREIGN KEY ("tenant_id","revoked_by_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_request" ADD CONSTRAINT "account_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_request" ADD CONSTRAINT "account_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_approver_fk" FOREIGN KEY ("tenant_id","approved_by_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_revoker_fk" FOREIGN KEY ("tenant_id","revoked_by_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_approver_active_key" ON "account_approver" USING btree ("tenant_id","membership_id") WHERE "account_approver"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_member_active_key" ON "tenant_member" USING btree ("tenant_id","membership_id") WHERE "tenant_member"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "invitation_throttle" ADD CONSTRAINT "invitation_throttle_scope" CHECK ("invitation_throttle"."scope" in ('actor','recipient','account-request','account-mail'));--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe','mcp-connection.revoke','source-identity.revoke','account-request.approve','account-request.decline','member.revoke','approver.designate','approver.revoke'));
--> statement-breakpoint
-- Release 1.4 accounts (accounts plan, section 1b). Tenant-isolated like every congregation table; staff see names, per the
-- ruling. Column-level UPDATE only; identities never change, and a revocation is once and final (portal_immutable_columns).
ALTER TABLE account_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON account_request FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON account_request FROM portal_runtime;
--> statement-breakpoint
-- The pending queue only: approval and decline both delete the request, so its purpose text never outlives the decision.
GRANT SELECT, INSERT, DELETE ON account_request TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (notify_status, notify_attempted_at) ON account_request TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON account_request TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE TRIGGER immutable_account_request BEFORE UPDATE ON account_request FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id', 'id', 'user_id', 'display_name', 'purpose', 'created_at');
--> statement-breakpoint
ALTER TABLE tenant_member ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_member FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON tenant_member FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON tenant_member FROM portal_runtime;
--> statement-breakpoint
-- The Member role: approved once, ended once. Never a role_grant, so never a workspace mode.
GRANT SELECT, INSERT ON tenant_member TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by_membership_id, welcome_status, welcome_attempted_at) ON tenant_member TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_member TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE TRIGGER immutable_tenant_member BEFORE UPDATE ON tenant_member FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id', 'id', 'membership_id', 'user_id', 'display_name', 'approved_by_membership_id', 'created_at');
--> statement-breakpoint
ALTER TABLE account_approver ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_approver FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON account_approver FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON account_approver FROM portal_runtime;
--> statement-breakpoint
-- A tutor an admin designated to approve requests; bound to that tutor grant, revoked once.
GRANT SELECT, INSERT ON account_approver TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by_membership_id) ON account_approver TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON account_approver TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE TRIGGER immutable_account_approver BEFORE UPDATE ON account_approver FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id', 'id', 'membership_id', 'tutor_grant_id', 'role', 'designated_by_membership_id', 'created_at');
--> statement-breakpoint
-- Final states stay final: once revoked, who and when never change; once an email outcome is recorded (anything but
-- pending), its status and attempt time never change. TG_ARGV names the status and attempt columns, when the table has them.
CREATE FUNCTION portal_account_final_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before jsonb := to_jsonb(OLD); after jsonb := to_jsonb(NEW);
BEGIN
  IF before ? 'revoked_at' AND before->>'revoked_at' IS NOT NULL
    AND (before->'revoked_at' IS DISTINCT FROM after->'revoked_at' OR before->'revoked_by_membership_id' IS DISTINCT FROM after->'revoked_by_membership_id') THEN
    RAISE EXCEPTION 'Revocation is final' USING ERRCODE = '23514';
  END IF;
  IF TG_NARGS = 2 AND before->>TG_ARGV[0] <> 'pending'
    AND (before->TG_ARGV[0] IS DISTINCT FROM after->TG_ARGV[0] OR before->TG_ARGV[1] IS DISTINCT FROM after->TG_ARGV[1]) THEN
    RAISE EXCEPTION 'Recorded outcome is final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER final_account_request BEFORE UPDATE ON account_request FOR EACH ROW EXECUTE FUNCTION portal_account_final_state('notify_status', 'notify_attempted_at');
--> statement-breakpoint
CREATE TRIGGER final_tenant_member BEFORE UPDATE ON tenant_member FOR EACH ROW EXECUTE FUNCTION portal_account_final_state('welcome_status', 'welcome_attempted_at');
--> statement-breakpoint
CREATE TRIGGER final_account_approver BEFORE UPDATE ON account_approver FOR EACH ROW EXECUTE FUNCTION portal_account_final_state();
