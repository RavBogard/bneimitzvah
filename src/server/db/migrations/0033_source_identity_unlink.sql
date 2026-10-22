-- Release 1.1 (2026-10-22): an admin may undo a wrong Maven link, in the portal's roster or through the MCP's
-- unlink_maven_record (admin, portal:roster, attended). The row is kept and stamped revoked once with who, which
-- admin grant, the channel and (through the MCP) the connection; it is never deleted or revived. Linking again
-- inserts a new row, so uniqueness now holds among current links only. Staff may also end a Claude connection
-- from the portal (mcp_connection.revoked_at, already granted in 0028). Both are audited. The audit list keeps
-- every earlier action and also carries 0032_notifications' two, so this list is right whichever lands first.
ALTER TABLE "student_source_identity" DROP CONSTRAINT "student_source_identity_record_key";--> statement-breakpoint
ALTER TABLE "student_source_identity" DROP CONSTRAINT "student_source_identity_student_key";--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD COLUMN "revoked_by_user_id" text;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD COLUMN "revoked_by_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD COLUMN "revoked_role_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD COLUMN "revoked_role" "portal_role";--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD COLUMN "revoked_channel" text;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD COLUMN "revoked_mcp_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_revoker_fk" FOREIGN KEY ("tenant_id","revoked_by_membership_id","revoked_by_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_revoker_grant_fk" FOREIGN KEY ("tenant_id","revoked_role_grant_id","revoked_by_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_revoker_role_fk" FOREIGN KEY ("tenant_id","revoked_role_grant_id","revoked_role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_revoker_connection_fk" FOREIGN KEY ("tenant_id","revoked_mcp_connection_id") REFERENCES "public"."mcp_connection"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_source_identity_record_current" ON "student_source_identity" USING btree ("tenant_id","source_namespace","source_record_id") WHERE "student_source_identity"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "student_source_identity_student_current" ON "student_source_identity" USING btree ("tenant_id","source_namespace","student_id") WHERE "student_source_identity"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_revoked" CHECK (("student_source_identity"."revoked_at" is null and "student_source_identity"."revoked_by_user_id" is null and "student_source_identity"."revoked_by_membership_id" is null and "student_source_identity"."revoked_role_grant_id" is null and "student_source_identity"."revoked_role" is null and "student_source_identity"."revoked_channel" is null and "student_source_identity"."revoked_mcp_connection_id" is null)
    or ("student_source_identity"."revoked_at" is not null and isfinite("student_source_identity"."revoked_at") and "student_source_identity"."revoked_at" >= "student_source_identity"."created_at" and "student_source_identity"."revoked_by_user_id" is not null and "student_source_identity"."revoked_by_membership_id" is not null and "student_source_identity"."revoked_role_grant_id" is not null
      and "student_source_identity"."revoked_role" = 'admin' and (("student_source_identity"."revoked_channel" = 'web' and "student_source_identity"."revoked_mcp_connection_id" is null) or ("student_source_identity"."revoked_channel" = 'mcp' and "student_source_identity"."revoked_mcp_connection_id" is not null))));--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe','mcp-connection.revoke','source-identity.revoke'));--> statement-breakpoint
-- Only the revocation columns may change, only from current to revoked, and only once; every other column is fixed.
CREATE FUNCTION public.portal_source_identity_revoke_once() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE revocation text[] := ARRAY['revoked_at','revoked_by_user_id','revoked_by_membership_id','revoked_role_grant_id','revoked_role','revoked_channel','revoked_mcp_connection_id'];
BEGIN
 IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR (to_jsonb(NEW) - revocation) IS DISTINCT FROM (to_jsonb(OLD) - revocation) THEN
  RAISE EXCEPTION 'source identity is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_source_identity_revoke_once() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER student_source_identity_revoke_once BEFORE UPDATE ON student_source_identity FOR EACH ROW EXECUTE FUNCTION public.portal_source_identity_revoke_once();
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by_user_id, revoked_by_membership_id, revoked_role_grant_id, revoked_role, revoked_channel, revoked_mcp_connection_id) ON student_source_identity TO portal_runtime;
