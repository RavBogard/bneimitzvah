CREATE TABLE "tutor_spoken" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"start_verse" text NOT NULL,
	"end_verse" text NOT NULL,
	"verse_digest" text NOT NULL,
	"creator_membership_id" uuid NOT NULL,
	"blob_path" text,
	"media_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_spoken_tenant_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tutor_spoken_aliyah_key" UNIQUE("tenant_id","assignment_id","start_verse"),
	CONSTRAINT "tutor_spoken_shape" CHECK ("tutor_spoken"."revision" > 0 and "tutor_spoken"."byte_length" between 16 and 3145728 and "tutor_spoken"."verse_digest" ~ '^[a-f0-9]{64}$' and "tutor_spoken"."media_type" in ('audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav') and ("tutor_spoken"."blob_path" is null or "tutor_spoken"."blob_path" ~ '^tutor-spoken/[a-f0-9-]{36}$'))
);
--> statement-breakpoint
CREATE TABLE "tutor_spoken_cleanup" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"blob_path" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_spoken_cleanup_path" CHECK ("tutor_spoken_cleanup"."blob_path" ~ '^tutor-spoken/[a-f0-9-]{36}$')
);
--> statement-breakpoint
ALTER TABLE "tutor_spoken" ADD CONSTRAINT "tutor_spoken_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_spoken" ADD CONSTRAINT "tutor_spoken_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_spoken" ADD CONSTRAINT "tutor_spoken_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_spoken" ADD CONSTRAINT "tutor_spoken_creator_fk" FOREIGN KEY ("tenant_id","creator_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_spoken_cleanup" ADD CONSTRAINT "tutor_spoken_cleanup_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_spoken_cleanup" ADD CONSTRAINT "tutor_spoken_cleanup_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE tutor_spoken ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tutor_spoken FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tutor_spoken_cleanup ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tutor_spoken_cleanup FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON tutor_spoken, tutor_spoken_cleanup FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON tutor_spoken, tutor_spoken_cleanup FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON tutor_spoken TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (creator_membership_id, end_verse, verse_digest, blob_path, media_type, byte_length, revision, updated_at) ON tutor_spoken TO portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON tutor_spoken_cleanup TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tutor_spoken TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tutor_spoken_cleanup TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE TRIGGER immutable_tutor_spoken BEFORE UPDATE ON tutor_spoken FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('id', 'tenant_id', 'student_id', 'assignment_id', 'start_verse');
--> statement-breakpoint
