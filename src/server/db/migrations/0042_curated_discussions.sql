CREATE TABLE "curated_discussion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"selected_by" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curated_discussion_slug_key" UNIQUE("tenant_id","slug"),
	CONSTRAINT "curated_discussion_receipt_key" UNIQUE("tenant_id","mutation_id"),
	CONSTRAINT "curated_discussion_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "curated_discussion_slug" CHECK (octet_length("curated_discussion"."slug") <= 80 and "curated_discussion"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "curated_discussion_title" CHECK (public.portal_source_plain("curated_discussion"."title", 160)),
	CONSTRAINT "curated_discussion_kind" CHECK ("curated_discussion"."kind" in ('torah','haftarah')),
	CONSTRAINT "curated_discussion_status" CHECK ("curated_discussion"."status" in ('published','withdrawn')),
	CONSTRAINT "curated_discussion_revision" CHECK ("curated_discussion"."revision" > 0),
	CONSTRAINT "curated_discussion_digest" CHECK ("curated_discussion"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "curated_discussion_instants" CHECK (isfinite("curated_discussion"."created_at") and isfinite("curated_discussion"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "curated_discussion_source" (
	"tenant_id" text NOT NULL,
	"discussion_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"position" integer NOT NULL,
	"ref" text NOT NULL,
	"anchor_ref" text NOT NULL,
	"edition" text,
	"translation_id" uuid,
	"selected_by" uuid NOT NULL,
	"selected_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curated_discussion_source_key" PRIMARY KEY("tenant_id","discussion_id","revision","position"),
	CONSTRAINT "curated_discussion_source_selector_name" CHECK (public.portal_source_plain("curated_discussion_source"."selected_by_name", 480) and char_length("curated_discussion_source"."selected_by_name") <= 120 and strpos("curated_discussion_source"."selected_by_name", '@') = 0),
	CONSTRAINT "curated_discussion_source_position" CHECK ("curated_discussion_source"."position" between 1 and 24),
	CONSTRAINT "curated_discussion_source_revision" CHECK ("curated_discussion_source"."revision" > 0),
	CONSTRAINT "curated_discussion_source_ref" CHECK (public.portal_source_plain("curated_discussion_source"."ref", 256)),
	CONSTRAINT "curated_discussion_source_anchor" CHECK (octet_length("curated_discussion_source"."anchor_ref") <= 100 and "curated_discussion_source"."anchor_ref" ~ '^[A-Za-z ]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "curated_discussion_source_one" CHECK (num_nonnulls("curated_discussion_source"."edition", "curated_discussion_source"."translation_id") = 1),
	CONSTRAINT "curated_discussion_source_edition" CHECK ("curated_discussion_source"."edition" is null or public.portal_source_plain("curated_discussion_source"."edition", 300)),
	CONSTRAINT "curated_discussion_source_instant" CHECK (isfinite("curated_discussion_source"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "source_translation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"original_ref" text NOT NULL,
	"original_edition" text NOT NULL,
	"body" text NOT NULL,
	"selected_by" uuid NOT NULL,
	"selected_by_name" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_translation_receipt_key" UNIQUE("tenant_id","mutation_id"),
	CONSTRAINT "source_translation_ref_key" UNIQUE("tenant_id","id","original_ref"),
	CONSTRAINT "source_translation_selector_name" CHECK (public.portal_source_plain("source_translation"."selected_by_name", 480) and char_length("source_translation"."selected_by_name") <= 120 and strpos("source_translation"."selected_by_name", '@') = 0),
	CONSTRAINT "source_translation_ref" CHECK (public.portal_source_plain("source_translation"."original_ref", 256)),
	CONSTRAINT "source_translation_edition" CHECK (public.portal_source_plain("source_translation"."original_edition", 300)),
	CONSTRAINT "source_translation_body" CHECK (public.portal_study_markdown("source_translation"."body", 16384)),
	CONSTRAINT "source_translation_digest" CHECK ("source_translation"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "source_translation_instant" CHECK (isfinite("source_translation"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "curated_discussion" ADD CONSTRAINT "curated_discussion_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_discussion" ADD CONSTRAINT "curated_discussion_selector_fk" FOREIGN KEY ("tenant_id","selected_by") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_discussion_source" ADD CONSTRAINT "curated_discussion_source_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_discussion_source" ADD CONSTRAINT "curated_discussion_source_discussion_fk" FOREIGN KEY ("tenant_id","discussion_id") REFERENCES "public"."curated_discussion"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_discussion_source" ADD CONSTRAINT "curated_discussion_source_translation_fk" FOREIGN KEY ("tenant_id","translation_id","ref") REFERENCES "public"."source_translation"("tenant_id","id","original_ref") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_discussion_source" ADD CONSTRAINT "curated_discussion_source_selector_fk" FOREIGN KEY ("tenant_id","selected_by") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_translation" ADD CONSTRAINT "source_translation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_translation" ADD CONSTRAINT "source_translation_selector_fk" FOREIGN KEY ("tenant_id","selected_by") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "curated_discussion_source_anchor_idx" ON "curated_discussion_source" USING btree ("tenant_id","anchor_ref");--> statement-breakpoint
-- Release 1.7 M6 (spec 2026-10-24-curated-discussions-design). Written only by the admin, attended MCP tools; read publicly
-- through curated_discussion_public below. Every table is forced under the tenant_isolation policy. The runtime may INSERT,
-- may SELECT every column except selected_by (so no read path can return a curator's membership id), may UPDATE only a
-- discussion's title, status, revision and updated_at, and may never DELETE or TRUNCATE. Sources and translations are
-- insert-only; a discussion starts published at revision 1, each change adds exactly one revision, and withdrawn is final.
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['curated_discussion','curated_discussion_source','source_translation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM portal_runtime', table_name);
    EXECUTE format('GRANT INSERT ON %I TO portal_runtime', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, slug, title, kind, status, revision, mutation_id, request_digest, created_at, updated_at) ON curated_discussion TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (title, status, revision, updated_at) ON curated_discussion TO portal_runtime;
--> statement-breakpoint
GRANT SELECT (tenant_id, discussion_id, revision, position, ref, anchor_ref, edition, translation_id, selected_by_name, created_at) ON curated_discussion_source TO portal_runtime;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, original_ref, original_edition, body, selected_by_name, mutation_id, request_digest, created_at) ON source_translation TO portal_runtime;
--> statement-breakpoint
CREATE FUNCTION portal_curated_discussion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Discussions are withdrawn, never deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.status <> 'published' THEN
      RAISE EXCEPTION 'A discussion starts published at revision 1' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'A withdrawn discussion is final' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision::bigint <> OLD.revision::bigint + 1 THEN
    RAISE EXCEPTION 'Each change adds exactly one revision' USING ERRCODE = '23514';
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.slug, NEW.kind, NEW.selected_by, NEW.mutation_id, NEW.request_digest, NEW.created_at)
     IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.slug, OLD.kind, OLD.selected_by, OLD.mutation_id, OLD.request_digest, OLD.created_at) THEN
    RAISE EXCEPTION 'Immutable discussion identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER curated_discussion_guard BEFORE INSERT OR UPDATE OR DELETE ON curated_discussion FOR EACH ROW EXECUTE FUNCTION portal_curated_discussion_guard();
--> statement-breakpoint
-- A source set is written only for a published discussion's current revision, and only in the transaction that created
-- or bumped that revision (updated_at is the transaction's now()): a later transaction can never add to a published set.
-- The discussion row is locked so a withdrawal cannot race the insert.
CREATE FUNCTION portal_curated_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM curated_discussion d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.discussion_id AND d.revision = NEW.revision
    AND d.status = 'published' AND d.updated_at = now() FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sources belong to a published discussion''s current revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER curated_source_guard BEFORE INSERT ON curated_discussion_source FOR EACH ROW EXECUTE FUNCTION portal_curated_source_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION portal_curated_discussion_guard(), portal_curated_source_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER immutable_curated_source BEFORE UPDATE OR DELETE ON curated_discussion_source FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
--> statement-breakpoint
CREATE TRIGGER immutable_source_translation BEFORE UPDATE OR DELETE ON source_translation FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
--> statement-breakpoint
-- The one public read: published discussions with their current source set, in order, and the translations they use.
-- Security invoker, so the forced tenant_isolation policy and the column grants still apply to the caller; it names no
-- curator id and no receipt (only the selector's display name), and a withdrawn discussion is not in it.
CREATE VIEW curated_discussion_public WITH (security_invoker = true, security_barrier = true) AS
  SELECT d.tenant_id, d.slug, d.title, d.kind, d.revision, d.updated_at, s.position, s.ref, s.anchor_ref, s.edition, s.translation_id,
    s.selected_by_name, t.original_edition AS translation_edition, t.body AS translation_body
  FROM curated_discussion d
  JOIN curated_discussion_source s ON s.tenant_id = d.tenant_id AND s.discussion_id = d.id
    AND s.revision = (SELECT max(x.revision) FROM curated_discussion_source x WHERE x.tenant_id = d.tenant_id AND x.discussion_id = d.id)
  LEFT JOIN source_translation t ON t.tenant_id = s.tenant_id AND t.id = s.translation_id
  WHERE d.status = 'published';
--> statement-breakpoint
REVOKE ALL ON curated_discussion_public FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON curated_discussion_public TO portal_runtime;