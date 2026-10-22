-- Daniel's reference-audio listening review (2026-10-22). Numbered 0034: 0032 and 0033 are reserved for open PRs #17 and #21.
-- The audit list keeps every earlier action and also carries 0032_notifications' and 0033_source_identity_unlink's, so
-- it is right whichever lands first. Append-only; an admin's latest row per item is that admin's verdict.
CREATE TABLE "listening_review_verdict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"sample_version" text NOT NULL,
	"item_id" text NOT NULL,
	"verse_ref" text NOT NULL,
	"source" text NOT NULL,
	"source_pin" text NOT NULL,
	"asset" text NOT NULL,
	"verdict" text NOT NULL,
	"reasons" text[] NOT NULL,
	"note" text,
	"latency_ms" integer,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"mutation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listening_review_receipt_key" UNIQUE("tenant_id","actor_user_id","mutation_id"),
	CONSTRAINT "listening_review_admin" CHECK ("listening_review_verdict"."role" = 'admin' and "listening_review_verdict"."mode" = 'admin'),
	CONSTRAINT "listening_review_item" CHECK ("listening_review_verdict"."sample_version" ~ '^listening-sample/v[1-9][0-9]{0,3}$' and "listening_review_verdict"."item_id" ~ '^[a-z]{2}-[a-z0-9-]{1,60}$' and char_length("listening_review_verdict"."verse_ref") between 3 and 64 and "listening_review_verdict"."verse_ref" ~ '^[A-Za-z ]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "listening_review_source" CHECK ("listening_review_verdict"."source" in ('pocket-torah','finkel') and "listening_review_verdict"."source_pin" ~ '^[a-f0-9]{64}$' and "listening_review_verdict"."asset" ~ '^[a-z]{2}_[a-f0-9]{20,64}$'),
	CONSTRAINT "listening_review_verdict_value" CHECK ("listening_review_verdict"."verdict" in ('pass','needs-work') and cardinality("listening_review_verdict"."reasons") <= 6
    and "listening_review_verdict"."reasons" <@ array['slow-start','verse-cut','highlight-off','word-drill-off','sound','would-teach-wrong']::text[]
    and ("listening_review_verdict"."verdict" = 'needs-work' or cardinality("listening_review_verdict"."reasons") = 0) and array_position("listening_review_verdict"."reasons", null) is null),
	CONSTRAINT "listening_review_note" CHECK ("listening_review_verdict"."note" is null or public.portal_settings_text("listening_review_verdict"."note", 1000, true)),
	CONSTRAINT "listening_review_latency" CHECK ("listening_review_verdict"."latency_ms" is null or "listening_review_verdict"."latency_ms" between 0 and 60000),
	CONSTRAINT "listening_review_instant" CHECK (isfinite("listening_review_verdict"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "listening_review_verdict" ADD CONSTRAINT "listening_review_verdict_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_review_verdict" ADD CONSTRAINT "listening_review_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_review_verdict" ADD CONSTRAINT "listening_review_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_review_verdict" ADD CONSTRAINT "listening_review_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe','mcp-connection.revoke','source-identity.revoke','listening-review.set'));--> statement-breakpoint
ALTER TABLE listening_review_verdict ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE listening_review_verdict FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON listening_review_verdict FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON listening_review_verdict FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON listening_review_verdict TO portal_runtime;
--> statement-breakpoint
-- Only admin web verdicts in the request's own congregation; the service additionally requires the live admin grant.
CREATE POLICY tenant_isolation ON listening_review_verdict TO portal_runtime
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'') AND role='admin' AND mode='admin');
--> statement-breakpoint
CREATE TRIGGER immutable_listening_verdict BEFORE UPDATE OR DELETE ON listening_review_verdict FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
