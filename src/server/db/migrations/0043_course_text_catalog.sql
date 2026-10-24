CREATE TABLE "course_text_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"volume" text NOT NULL,
	"identity" text NOT NULL,
	"feed_bytes" "bytea" NOT NULL,
	"pins" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_text_catalog_tenant_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "course_text_catalog_volume_key" UNIQUE("tenant_id","id","volume"),
	CONSTRAINT "course_text_catalog_generation_key" UNIQUE("tenant_id","volume","identity"),
	CONSTRAINT "course_text_catalog_identity_hash" CHECK ("course_text_catalog"."identity" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "course_text_catalog_volume" CHECK ("course_text_catalog"."volume" ~ '^[a-z0-9][a-z0-9-]{0,63}$' and "course_text_catalog"."volume" !~ '^(legacy|crc)-'),
	CONSTRAINT "course_text_catalog_bytes_bound" CHECK (octet_length("course_text_catalog"."feed_bytes") between 1 and 2097152),
	CONSTRAINT "course_text_catalog_pins" CHECK (jsonb_typeof("course_text_catalog"."pins") = 'object' and octet_length("course_text_catalog"."pins"::text) <= 2048
    and "course_text_catalog"."pins" ?& array['volume','lane','feedSha256','artifactRepo','artifactCommit','artifactRunId','artifactName','sourceGitSha']
    and ("course_text_catalog"."pins" - 'volume' - 'lane' - 'feedSha256' - 'artifactRepo' - 'artifactCommit' - 'artifactRunId' - 'artifactName' - 'sourceGitSha') = '{}'::jsonb
    and "course_text_catalog"."pins"->>'lane' = 'public' and "course_text_catalog"."pins"->>'volume' = "course_text_catalog"."volume"
    and "course_text_catalog"."pins"->>'feedSha256' ~ '^[a-f0-9]{64}$' and "course_text_catalog"."pins"->>'sourceGitSha' ~ '^[a-f0-9]{7,40}$'
    and "course_text_catalog"."pins"->>'artifactCommit' ~ '^[a-f0-9]{40}$' and "course_text_catalog"."pins"->>'artifactName' = "course_text_catalog"."volume" || '-' || left("course_text_catalog"."pins"->>'artifactCommit', 7))
);
--> statement-breakpoint
CREATE TABLE "course_text_lifecycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"catalog_id" uuid NOT NULL,
	"volume" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_text_lifecycle_catalog_key" UNIQUE("tenant_id","catalog_id"),
	CONSTRAINT "course_text_lifecycle_state" CHECK ("course_text_lifecycle"."state" in ('active','superseded','withdrawn')),
	CONSTRAINT "course_text_lifecycle_revision" CHECK ("course_text_lifecycle"."revision" > 0),
	CONSTRAINT "course_text_lifecycle_volume" CHECK ("course_text_lifecycle"."volume" ~ '^[a-z0-9][a-z0-9-]{0,63}$' and "course_text_lifecycle"."volume" !~ '^(legacy|crc)-')
);
--> statement-breakpoint
ALTER TABLE "course_text_catalog" ADD CONSTRAINT "course_text_catalog_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_text_lifecycle" ADD CONSTRAINT "course_text_lifecycle_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_text_lifecycle" ADD CONSTRAINT "course_text_lifecycle_catalog_fk" FOREIGN KEY ("tenant_id","catalog_id","volume") REFERENCES "public"."course_text_catalog"("tenant_id","id","volume") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_text_lifecycle_one_active" ON "course_text_lifecycle" USING btree ("tenant_id","volume") WHERE "course_text_lifecycle"."state" = 'active';
--> statement-breakpoint
-- 2.0 SC2 (A4 6.2 Migration B): the service course's PUBLIC text. Tenant-isolated, forced row security, and read-only for the
-- runtime: SELECT on both tables and nothing else, so no request can add, change or remove a stored build. Rows come only from
-- the house operator path, as service_catalog's did. The licensed Beit Mitzvah catalog stays in service_catalog; nothing here
-- references it, and the CHECKs above refuse a licensed lane, a legacy or CRC-only volume, and any artifact but the volume's own.
ALTER TABLE course_text_catalog ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE course_text_catalog FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON course_text_catalog FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON course_text_catalog FROM portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON course_text_catalog TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT ON course_text_catalog TO portal_runtime;
--> statement-breakpoint
ALTER TABLE course_text_lifecycle ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE course_text_lifecycle FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON course_text_lifecycle FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON course_text_lifecycle FROM portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON course_text_lifecycle TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT ON course_text_lifecycle TO portal_runtime;
--> statement-breakpoint
CREATE FUNCTION portal_immutable_course_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable course text' USING ERRCODE = '23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_course_text BEFORE UPDATE OR DELETE ON course_text_catalog FOR EACH ROW EXECUTE FUNCTION portal_immutable_course_text();
--> statement-breakpoint
CREATE TRIGGER immutable_course_text_lifecycle_identity BEFORE UPDATE ON course_text_lifecycle FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','catalog_id','volume');
--> statement-breakpoint
CREATE TRIGGER course_text_lifecycle_revision BEFORE UPDATE ON course_text_lifecycle FOR EACH ROW EXECUTE FUNCTION portal_service_lifecycle_revision();