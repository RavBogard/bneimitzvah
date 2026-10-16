ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "delivery_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "delivery_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke'));--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_delivery_shape" CHECK (("invite"."delivery_status" = 'pending' and "invite"."delivery_attempted_at" is null) or ("invite"."delivery_status" in ('sent','failed') and "invite"."delivery_attempted_at" is not null));
--> statement-breakpoint
-- A delivery receipt is final. Later acceptance/revocation may change only
-- their own fields; retries must issue a fresh invitation/token instead.
CREATE TRIGGER immutable_delivery_outcome BEFORE UPDATE ON invite
FOR EACH ROW WHEN (OLD.delivery_status <> 'pending')
EXECUTE FUNCTION portal_immutable_columns('delivery_status', 'delivery_attempted_at');
