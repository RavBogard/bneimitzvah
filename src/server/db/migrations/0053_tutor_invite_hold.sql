CREATE TABLE "tutor_invite_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"invite_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"held_by_grant_id" uuid NOT NULL,
	"held_by_role" "portal_role" DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_invite_hold_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tutor_invite_hold_invite_student_key" UNIQUE("tenant_id","invite_id","student_id","held_by_grant_id"),
	CONSTRAINT "tutor_invite_hold_by_admin" CHECK ("tutor_invite_hold"."held_by_role" = 'admin'),
	CONSTRAINT "tutor_invite_hold_instant" CHECK (isfinite("tutor_invite_hold"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "tutor_invite_hold" ADD CONSTRAINT "tutor_invite_hold_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_invite_hold" ADD CONSTRAINT "tutor_invite_hold_invite_fk" FOREIGN KEY ("tenant_id","invite_id") REFERENCES "public"."invite"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_invite_hold" ADD CONSTRAINT "tutor_invite_hold_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_invite_hold" ADD CONSTRAINT "tutor_invite_hold_held_by_fk" FOREIGN KEY ("tenant_id","held_by_grant_id","held_by_role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Daniel, 2026-10-26: students held for a tutor invitation, so the tutor has them as soon as the invitation is accepted. A hold
-- grants nothing by itself; only accepting a live tutor invitation turns its holds into tutor_student links, through the portal's
-- own tutor write. Forced row security, a RESTRICTIVE tenant_isolation ANDed with the permissive policies below, as on 0049.
-- SELECT and INSERT only: no UPDATE, DELETE or TRUNCATE, so a hold is history once written; one on an invitation that is
-- accepted, revoked or expired never applies again.
ALTER TABLE tutor_invite_hold ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tutor_invite_hold FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON tutor_invite_hold FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON tutor_invite_hold FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT ON tutor_invite_hold TO portal_runtime;
--> statement-breakpoint
GRANT INSERT (tenant_id, invite_id, student_id, held_by_grant_id) ON tutor_invite_hold TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tutor_invite_hold AS RESTRICTIVE TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY tenant_readers ON tutor_invite_hold FOR SELECT TO portal_runtime USING (true);
--> statement-breakpoint
-- A hold is written by a live admin grant of an enabled membership, on a live (unaccepted, unrevoked, unexpired) tutor invitation,
-- for an enabled student, all in the writer's own tenant. held_by_grant_id must be app.tutor_hold_actor, a role grant id that only
-- src/server/data/tutor-invite-holds.ts sets, transaction-locally, to the writing admin's own grant. The app checks the same first.
CREATE POLICY admin_holder ON tutor_invite_hold FOR INSERT TO portal_runtime WITH CHECK (
  held_by_grant_id = nullif(current_setting('app.tutor_hold_actor', true), '')::uuid
  AND EXISTS (SELECT 1 FROM role_grant g
    JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id AND m.disabled_at IS NULL
    WHERE g.tenant_id = tutor_invite_hold.tenant_id AND g.id = tutor_invite_hold.held_by_grant_id AND g.role = 'admin' AND g.revoked_at IS NULL)
  AND EXISTS (SELECT 1 FROM invite i WHERE i.tenant_id = tutor_invite_hold.tenant_id AND i.id = tutor_invite_hold.invite_id
    AND i.role = 'tutor' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())
  AND EXISTS (SELECT 1 FROM student s WHERE s.tenant_id = tutor_invite_hold.tenant_id AND s.id = tutor_invite_hold.student_id AND s.disabled_at IS NULL));
