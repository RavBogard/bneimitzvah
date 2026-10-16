CREATE TABLE "service_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"identity" text NOT NULL,
	"feed_bytes" "bytea" NOT NULL,
	"provenance_bytes" "bytea" NOT NULL,
	"pins" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_catalog_tenant_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_catalog_identity_key" UNIQUE("tenant_id","id","identity"),
	CONSTRAINT "service_catalog_generation_key" UNIQUE("tenant_id","identity"),
	CONSTRAINT "service_catalog_identity_hash" CHECK ("service_catalog"."identity" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "service_catalog_bytes_bound" CHECK (octet_length("service_catalog"."feed_bytes") between 1 and 2097152 and octet_length("service_catalog"."provenance_bytes") between 1 and 32768),
	CONSTRAINT "service_catalog_pins_bound" CHECK (jsonb_typeof("service_catalog"."pins") = 'object' and octet_length("service_catalog"."pins"::text) <= 2048
    and "service_catalog"."pins" ?& array['feedSha256','provenanceSha256','artifactRepo','artifactCommit','artifactRunId','sourceGitSha']
    and ("service_catalog"."pins" - 'feedSha256' - 'provenanceSha256' - 'artifactRepo' - 'artifactCommit' - 'artifactRunId' - 'sourceGitSha') = '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "service_catalog_lifecycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"catalog_id" uuid NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_lifecycle_catalog_key" UNIQUE("tenant_id","catalog_id"),
	CONSTRAINT "service_lifecycle_state" CHECK ("service_catalog_lifecycle"."state" in ('active','superseded','withdrawn')),
	CONSTRAINT "service_lifecycle_revision" CHECK ("service_catalog_lifecycle"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "student_service_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"catalog_id" uuid NOT NULL,
	"catalog_identity" text NOT NULL,
	"selected_ids" text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"reviewed_date" date NOT NULL,
	"reviewed_slot" text NOT NULL,
	"set_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_service_plan_current_key" UNIQUE("tenant_id","student_id"),
	CONSTRAINT "student_service_plan_revision" CHECK ("student_service_plan"."revision" > 0),
	CONSTRAINT "student_service_plan_slot" CHECK ("student_service_plan"."reviewed_slot" in ('morning','havdalah')),
	CONSTRAINT "student_service_plan_selection" CHECK (cardinality("student_service_plan"."selected_ids") <= 256 and
    (cardinality("student_service_plan"."selected_ids") = 0 or (array_ndims("student_service_plan"."selected_ids") = 1 and array_lower("student_service_plan"."selected_ids",1) = 1))
    and array_position("student_service_plan"."selected_ids", null) is null and octet_length(array_to_string("student_service_plan"."selected_ids", '|')) <= 16384)
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog_lifecycle" ADD CONSTRAINT "service_catalog_lifecycle_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog_lifecycle" ADD CONSTRAINT "service_lifecycle_catalog_fk" FOREIGN KEY ("tenant_id","catalog_id") REFERENCES "public"."service_catalog"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_plan" ADD CONSTRAINT "student_service_plan_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_plan" ADD CONSTRAINT "student_service_plan_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_plan" ADD CONSTRAINT "student_service_plan_catalog_fk" FOREIGN KEY ("tenant_id","catalog_id","catalog_identity") REFERENCES "public"."service_catalog"("tenant_id","id","identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service_plan" ADD CONSTRAINT "student_service_plan_author_fk" FOREIGN KEY ("tenant_id","set_by_membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_lifecycle_one_active" ON "service_catalog_lifecycle" USING btree ("tenant_id") WHERE "service_catalog_lifecycle"."state" = 'active';--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set'));--> statement-breakpoint
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['service_catalog','service_catalog_lifecycle','student_service_plan'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM portal_runtime', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT ON service_catalog, service_catalog_lifecycle TO portal_runtime;
--> statement-breakpoint
-- PostgreSQL SHARE locks require one UPDATE privilege. This identity cannot change.
GRANT UPDATE (id) ON service_catalog_lifecycle TO portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON student_service_plan TO portal_runtime;
--> statement-breakpoint
CREATE FUNCTION portal_immutable_service_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable service catalog' USING ERRCODE = '23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_service_catalog BEFORE UPDATE OR DELETE ON service_catalog FOR EACH ROW EXECUTE FUNCTION portal_immutable_service_catalog();
--> statement-breakpoint
CREATE TRIGGER immutable_service_lifecycle_identity BEFORE UPDATE ON service_catalog_lifecycle FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','catalog_id');
--> statement-breakpoint
CREATE TRIGGER immutable_service_plan_identity BEFORE UPDATE ON student_service_plan FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','student_id');
--> statement-breakpoint
CREATE FUNCTION portal_service_lifecycle_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.state IS DISTINCT FROM OLD.state OR NEW.revision IS DISTINCT FROM OLD.revision)
      AND NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Service lifecycle revision required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER service_lifecycle_revision BEFORE UPDATE ON service_catalog_lifecycle FOR EACH ROW EXECUTE FUNCTION portal_service_lifecycle_revision();
