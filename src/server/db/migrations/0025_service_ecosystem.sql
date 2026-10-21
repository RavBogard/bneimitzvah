CREATE TABLE "service_ceremony" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"local_date" date NOT NULL,
	"ceremony_type" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"setlist_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"projection" jsonb,
	"candidates" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_ceremony_tenant_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_ceremony_schedule_key" UNIQUE("tenant_id","local_date","ceremony_type"),
	CONSTRAINT "service_ceremony_type" CHECK ("service_ceremony"."ceremony_type" in ('morning','havdalah')),
	CONSTRAINT "service_ceremony_state" CHECK ("service_ceremony"."state" in ('pending','linked','ambiguous','unavailable','review_required')),
	CONSTRAINT "service_ceremony_revision" CHECK ("service_ceremony"."revision" > 0),
	CONSTRAINT "service_ceremony_projection_bound" CHECK ("service_ceremony"."projection" is null or octet_length("service_ceremony"."projection"::text) <= 131072),
	CONSTRAINT "service_ceremony_candidate_bound" CHECK (cardinality("service_ceremony"."candidates") <= 100)
);
--> statement-breakpoint
CREATE TABLE "service_part_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"ceremony_id" uuid NOT NULL,
	"row_id" text NOT NULL,
	"message" text NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"source_revision" text NOT NULL,
	"requested_resource_identity" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_bound" CHECK (length("service_part_request"."row_id") between 1 and 128 and length("service_part_request"."message") between 1 and 2000 and length("service_part_request"."response") <= 2000 and "service_part_request"."revision" > 0),
	CONSTRAINT "service_request_state" CHECK ("service_part_request"."state" in ('pending','accepted','declined'))
);
--> statement-breakpoint
CREATE TABLE "student_ceremony" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"ceremony_id" uuid NOT NULL,
	"needs_reconciliation" boolean DEFAULT false NOT NULL,
	CONSTRAINT "student_ceremony_current_key" UNIQUE("tenant_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "student_service_part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"ceremony_id" uuid NOT NULL,
	"row_id" text NOT NULL,
	"leads" boolean DEFAULT true NOT NULL,
	"directions" text DEFAULT '' NOT NULL,
	"private_feedback" text DEFAULT '' NOT NULL,
	"progress" text DEFAULT 'not-started' NOT NULL,
	"resource_identity" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_service_part_key" UNIQUE("tenant_id","student_id","ceremony_id","row_id"),
	CONSTRAINT "service_part_bound" CHECK (length("student_service_part"."row_id") between 1 and 128 and length("student_service_part"."directions") <= 4000 and length("student_service_part"."private_feedback") <= 4000 and "student_service_part"."revision" > 0),
	CONSTRAINT "service_part_progress" CHECK ("student_service_part"."progress" in ('not-started','practicing','ready'))
);
--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD CONSTRAINT "service_ceremony_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_part_request" ADD CONSTRAINT "service_part_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_part_request" ADD CONSTRAINT "service_request_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_part_request" ADD CONSTRAINT "service_request_ceremony_fk" FOREIGN KEY ("tenant_id","ceremony_id") REFERENCES "public"."service_ceremony"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_ceremony" ADD CONSTRAINT "student_ceremony_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_ceremony" ADD CONSTRAINT "student_ceremony_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_ceremony" ADD CONSTRAINT "student_ceremony_source_fk" FOREIGN KEY ("tenant_id","ceremony_id") REFERENCES "public"."service_ceremony"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_part" ADD CONSTRAINT "student_service_part_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_part" ADD CONSTRAINT "service_part_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_part" ADD CONSTRAINT "service_part_ceremony_fk" FOREIGN KEY ("tenant_id","ceremony_id") REFERENCES "public"."service_ceremony"("tenant_id","id") ON DELETE no action ON UPDATE no action;
-- No roster backfill. Scheduling is queued only by new intake or an explicit date/type edit.
--> statement-breakpoint
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['service_ceremony','student_ceremony','student_service_part','service_part_request'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM portal_runtime', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO portal_runtime', table_name);
  END LOOP;
END $$;

--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD CONSTRAINT "service_ceremony_job_shape" CHECK ("service_ceremony"."attempts" >= 0 and (("service_ceremony"."lease_token" is null) = ("service_ceremony"."lease_until" is null)));
--> statement-breakpoint
CREATE TRIGGER immutable_ceremony_identity BEFORE UPDATE ON service_ceremony FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','local_date','ceremony_type');
--> statement-breakpoint
CREATE TRIGGER immutable_student_ceremony_identity BEFORE UPDATE ON student_ceremony FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','student_id');
--> statement-breakpoint
CREATE TRIGGER immutable_service_part_identity BEFORE UPDATE ON student_service_part FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','student_id','ceremony_id','row_id');
--> statement-breakpoint
CREATE TRIGGER immutable_service_request_identity BEFORE UPDATE ON service_part_request FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','student_id','ceremony_id','row_id','message','source_revision','requested_resource_identity');
--> statement-breakpoint
CREATE FUNCTION portal_preserve_ceremony_setlist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.setlist_id IS NOT NULL AND NEW.setlist_id IS DISTINCT FROM OLD.setlist_id THEN
    RAISE EXCEPTION 'Connected ceremony setlist is preserved' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER preserve_ceremony_setlist BEFORE UPDATE ON service_ceremony FOR EACH ROW EXECUTE FUNCTION portal_preserve_ceremony_setlist();

--> statement-breakpoint
ALTER TABLE "student_service_part" ADD COLUMN "catalog_id" uuid;--> statement-breakpoint
ALTER TABLE "student_service_part" ADD COLUMN "catalog_identity" text;--> statement-breakpoint
ALTER TABLE "student_service_part" ADD COLUMN "catalog_unit_id" text;--> statement-breakpoint
ALTER TABLE "student_service_part" ADD CONSTRAINT "service_part_catalog_fk" FOREIGN KEY ("tenant_id","catalog_id","catalog_identity") REFERENCES "public"."service_catalog"("tenant_id","id","identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_part" ADD CONSTRAINT "service_part_material_shape" CHECK (("student_service_part"."catalog_id" is null and "student_service_part"."catalog_identity" is null and "student_service_part"."catalog_unit_id" is null) or ("student_service_part"."catalog_id" is not null and "student_service_part"."catalog_identity" is not null and "student_service_part"."catalog_unit_id" is not null and length("student_service_part"."catalog_unit_id") between 1 and 128));
--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "requested_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "requested_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "schedule_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "schedule_conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD CONSTRAINT "service_ceremony_schedule_shape" CHECK ("service_ceremony"."schedule_revision">0 and "service_ceremony"."requested_type" in ('morning','havdalah'));

--> statement-breakpoint
ALTER TABLE "service_ceremony" DROP CONSTRAINT "service_ceremony_schedule_key";--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "schedule_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD CONSTRAINT "service_ceremony_schedule_key" UNIQUE("tenant_id","schedule_key");