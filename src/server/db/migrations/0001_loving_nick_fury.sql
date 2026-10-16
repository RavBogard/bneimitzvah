-- Drizzle emitted this existing-table unique after its new-table dependent FK.
-- Apply the referenced key first so a fresh database can create that FK.
ALTER TABLE "session" ADD CONSTRAINT "session_id_user_key" UNIQUE("id","user_id");--> statement-breakpoint
CREATE TYPE "public"."context_mode" AS ENUM('student', 'parent', 'tutor', 'admin', 'child-practice');--> statement-breakpoint
CREATE TYPE "public"."reading_basis" AS ENUM('triennial', 'selection', 'full', 'custom');--> statement-breakpoint
CREATE TYPE "public"."reading_kind" AS ENUM('torah', 'haftarah', 'blessing-before', 'blessing-after');--> statement-breakpoint
CREATE TYPE "public"."portal_role" AS ENUM('student', 'parent', 'tutor', 'admin');--> statement-breakpoint
CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" "reading_kind" NOT NULL,
	"basis" "reading_basis" NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"set_by_membership_id" uuid NOT NULL,
	"proposal_cache_id" uuid,
	"proposal_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "assignment_student_key" UNIQUE("tenant_id","id","student_id"),
	CONSTRAINT "assignment_status" CHECK ("assignment"."status" in ('proposed', 'confirmed')),
	CONSTRAINT "assignment_revision_positive" CHECK ("assignment"."revision" > 0),
	CONSTRAINT "assignment_ref_required" CHECK (length(trim("assignment"."ref")) > 0)
);
--> statement-breakpoint
CREATE TABLE "assignment_verse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"verse_ref" text NOT NULL,
	CONSTRAINT "assignment_verse_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "assignment_verse_ordinal_key" UNIQUE("tenant_id","assignment_id","ordinal"),
	CONSTRAINT "assignment_verse_ref_key" UNIQUE("tenant_id","assignment_id","verse_ref"),
	CONSTRAINT "assignment_verse_positive_ordinal" CHECK ("assignment_verse"."ordinal" > 0),
	CONSTRAINT "assignment_verse_full_ref" CHECK ("assignment_verse"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$')
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"mode" "context_mode" NOT NULL,
	"acting_student_id" uuid,
	"role_grant_id" uuid NOT NULL,
	"guardian_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','context.enter','context.exit','reading.set','identity.link','identity.revoke'))
);
--> statement-breakpoint
CREATE TABLE "guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"parent_grant_id" uuid NOT NULL,
	"role" "portal_role" DEFAULT 'parent' NOT NULL,
	"practice_enabled" boolean DEFAULT true NOT NULL,
	"link_provenance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "guardian_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "guardian_context_key" UNIQUE("tenant_id","id","student_id","parent_grant_id"),
	CONSTRAINT "guardian_parent_role" CHECK ("guardian"."role" = 'parent')
);
--> statement-breakpoint
CREATE TABLE "hebcal_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" text NOT NULL,
	"request_date" date NOT NULL,
	"parameters" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hebcal_cache_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"role" "portal_role" NOT NULL,
	"student_id" uuid,
	"inviter_membership_id" uuid NOT NULL,
	"accepted_membership_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invite_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invite_role_target" CHECK (("invite"."role" in ('parent', 'student') and "invite"."student_id" is not null) or ("invite"."role" = 'tutor' and "invite"."student_id" is null)),
	CONSTRAINT "invite_acceptance_pair" CHECK (("invite"."accepted_at" is null) = ("invite"."accepted_membership_id" is null)),
	CONSTRAINT "invite_not_accepted_revoked" CHECK (not ("invite"."accepted_at" is not null and "invite"."revoked_at" is not null)),
	CONSTRAINT "invite_email_normalized" CHECK ("invite"."email" = lower(trim("invite"."email")) and length("invite"."email") > 0),
	CONSTRAINT "invite_expiry" CHECK ("invite"."expires_at" > "invite"."created_at"),
	CONSTRAINT "invite_hash" CHECK ("invite"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"authority_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "membership_tenant_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "membership_actor_key" UNIQUE("tenant_id","id","user_id"),
	CONSTRAINT "membership_revision_positive" CHECK ("membership"."authority_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "practice_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"auth_session_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"acting_student_id" uuid,
	"guardian_id" uuid,
	"student_identity_id" uuid,
	"authority_revision" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_context_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "practice_context_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "context_mode_shape" CHECK ((
    ("practice_context"."mode" = 'child-practice' and "practice_context"."role" = 'parent' and "practice_context"."acting_student_id" is not null and "practice_context"."guardian_id" is not null and "practice_context"."student_identity_id" is null)
    or ("practice_context"."mode" = 'student' and "practice_context"."role" = 'student' and "practice_context"."acting_student_id" is not null and "practice_context"."guardian_id" is null and "practice_context"."student_identity_id" is not null)
    or ("practice_context"."mode"::text = "practice_context"."role"::text and "practice_context"."mode" in ('admin', 'tutor', 'parent') and "practice_context"."acting_student_id" is null and "practice_context"."guardian_id" is null and "practice_context"."student_identity_id" is null)
  )),
	CONSTRAINT "context_expiry" CHECK ("practice_context"."expires_at" > "practice_context"."created_at"),
	CONSTRAINT "context_revision_positive" CHECK ("practice_context"."authority_revision" > 0),
	CONSTRAINT "context_hash" CHECK ("practice_context"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "role_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"is_cantor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "role_grant_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "role_grant_typed_key" UNIQUE("tenant_id","id","role"),
	CONSTRAINT "role_grant_actor_key" UNIQUE("tenant_id","id","membership_id"),
	CONSTRAINT "role_grant_cantor_tutor" CHECK (not "role_grant"."is_cantor" or "role_grant"."role" = 'tutor')
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"ceremony_date" date NOT NULL,
	"parent_email" text NOT NULL,
	"own_email" text,
	"disabled_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_parent_contact_required" CHECK (length(trim("student"."parent_email")) > 0),
	CONSTRAINT "student_names_required" CHECK (length(trim("student"."first_name")) > 0 and length(trim("student"."last_name")) > 0),
	CONSTRAINT "student_revision_positive" CHECK ("student"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "student_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "student_identity_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "student_identity_context_key" UNIQUE("tenant_id","id","student_id","role_grant_id"),
	CONSTRAINT "student_identity_role" CHECK ("student_identity"."role" = 'student')
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"product_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"customs" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_host" (
	"host" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"environment" text NOT NULL,
	"deployment" text NOT NULL,
	"origin" text NOT NULL,
	CONSTRAINT "tenant_host_tenant_key" UNIQUE("tenant_id","host"),
	CONSTRAINT "tenant_host_environment" CHECK ("tenant_host"."environment" in ('production', 'preview', 'local', 'test')),
	CONSTRAINT "tenant_host_normalized" CHECK ("tenant_host"."host" = lower("tenant_host"."host") and length("tenant_host"."host") > 0)
);
--> statement-breakpoint
CREATE TABLE "tutor_student" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_grant_id" uuid NOT NULL,
	"role" "portal_role" DEFAULT 'tutor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tutor_student_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tutor_student_role" CHECK ("tutor_student"."role" = 'tutor')
);
--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_proposal_cache_id_hebcal_cache_id_fk" FOREIGN KEY ("proposal_cache_id") REFERENCES "public"."hebcal_cache"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_author_fk" FOREIGN KEY ("tenant_id","set_by_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_verse" ADD CONSTRAINT "assignment_verse_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_verse" ADD CONSTRAINT "assignment_verse_parent_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_verse" ADD CONSTRAINT "assignment_verse_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_student_fk" FOREIGN KEY ("tenant_id","acting_student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id") REFERENCES "public"."guardian"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_grant_fk" FOREIGN KEY ("tenant_id","parent_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_inviter_fk" FOREIGN KEY ("tenant_id","inviter_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_acceptor_fk" FOREIGN KEY ("tenant_id","accepted_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "practice_context_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "context_session_actor_fk" FOREIGN KEY ("auth_session_id","actor_user_id") REFERENCES "public"."session"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "context_membership_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "context_grant_actor_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "context_grant_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "context_student_fk" FOREIGN KEY ("tenant_id","acting_student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "context_guardian_pair_fk" FOREIGN KEY ("tenant_id","guardian_id","acting_student_id","role_grant_id") REFERENCES "public"."guardian"("tenant_id","id","student_id","parent_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_context" ADD CONSTRAINT "context_student_identity_fk" FOREIGN KEY ("tenant_id","student_identity_id","acting_student_id","role_grant_id") REFERENCES "public"."student_identity"("tenant_id","id","student_id","role_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_identity" ADD CONSTRAINT "student_identity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_identity" ADD CONSTRAINT "student_identity_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_identity" ADD CONSTRAINT "student_identity_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_host" ADD CONSTRAINT "tenant_host_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_student" ADD CONSTRAINT "tutor_student_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_student" ADD CONSTRAINT "tutor_student_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_student" ADD CONSTRAINT "tutor_student_grant_fk" FOREIGN KEY ("tenant_id","tutor_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_active_key" ON "guardian" USING btree ("tenant_id","student_id","parent_grant_id") WHERE "guardian"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "role_grant_active_key" ON "role_grant" USING btree ("tenant_id","membership_id","role") WHERE "role_grant"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "student_identity_active_student_key" ON "student_identity" USING btree ("tenant_id","student_id") WHERE "student_identity"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "student_identity_active_grant_key" ON "student_identity" USING btree ("tenant_id","role_grant_id") WHERE "student_identity"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_student_active_key" ON "tutor_student" USING btree ("tenant_id","student_id","tutor_grant_id") WHERE "tutor_student"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_normalized_email_key" ON "user" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_provider_identity_key" UNIQUE("provider_id","account_id");--> statement-breakpoint
