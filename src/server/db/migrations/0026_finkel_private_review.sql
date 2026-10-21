CREATE TABLE "reference_review_batch" (
	"tenant_id" text NOT NULL,
	"id" uuid NOT NULL,
	"manifest_sha256" text NOT NULL,
	"catalog_sha256" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"entry_count" integer NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_review_batch_key" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "reference_review_batch_manifest_key" UNIQUE("tenant_id","id","manifest_sha256"),
	CONSTRAINT "reference_review_batch_hashes" CHECK ("reference_review_batch"."manifest_sha256" ~ '^[a-f0-9]{64}$' and "reference_review_batch"."catalog_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "reference_review_batch_bound" CHECK ("reference_review_batch"."entry_count" between 1 and 8 and "reference_review_batch"."generation" > 0 and "reference_review_batch"."expires_at" > "reference_review_batch"."created_at" and "reference_review_batch"."reviewer_user_id" ~ '^[A-Za-z0-9_-]{1,128}$')
);
--> statement-breakpoint
CREATE TABLE "reference_review_decision" (
	"tenant_id" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"asset_key" text NOT NULL,
	"generation" integer NOT NULL,
	"revision" integer NOT NULL,
	"manifest_sha256" text NOT NULL,
	"catalog_sha256" text NOT NULL,
	"identity_sha256" text NOT NULL,
	"target_sha256" text NOT NULL,
	"text_sha256" text NOT NULL,
	"playback_sha256" text NOT NULL,
	"playback_bytes" integer NOT NULL,
	"request_sha256" text NOT NULL,
	"checks" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"actor_session_id" text NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"authority_revision" integer NOT NULL,
	"role_grant_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_review_decision_key" PRIMARY KEY("tenant_id","batch_id","request_id"),
	CONSTRAINT "reference_review_decision_revision_key" UNIQUE("tenant_id","batch_id","generation","asset_key","revision"),
	CONSTRAINT "reference_review_decision_bound" CHECK ("reference_review_decision"."generation" > 0 and "reference_review_decision"."revision" > 0 and "reference_review_decision"."playback_bytes" between 1 and 4194304 and "reference_review_decision"."asset_key" ~ '^fj_[a-f0-9]{20}$' and "reference_review_decision"."authority_revision" > 0 and "reference_review_decision"."role_grant_revision" > 0),
	CONSTRAINT "reference_review_decision_hashes" CHECK ("reference_review_decision"."manifest_sha256" ~ '^[a-f0-9]{64}$' and "reference_review_decision"."catalog_sha256" ~ '^[a-f0-9]{64}$' and "reference_review_decision"."identity_sha256" ~ '^[a-f0-9]{64}$' and "reference_review_decision"."target_sha256" ~ '^[a-f0-9]{64}$' and "reference_review_decision"."text_sha256" ~ '^[a-f0-9]{64}$' and "reference_review_decision"."playback_sha256" ~ '^[a-f0-9]{64}$' and "reference_review_decision"."request_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "reference_review_decision_checks" CHECK ((jsonb_typeof("reference_review_decision"."checks") = 'object' and "reference_review_decision"."checks" ?& array['privacy','listening','exactText','musicalAccuracy','rights'] and "reference_review_decision"."checks" - array['privacy','listening','exactText','musicalAccuracy','rights'] = '{}'::jsonb and "reference_review_decision"."checks"->>'privacy' in ('pass','hold') and "reference_review_decision"."checks"->>'listening' in ('pass','hold') and "reference_review_decision"."checks"->>'exactText' in ('pass','hold') and "reference_review_decision"."checks"->>'musicalAccuracy' in ('pass','hold') and "reference_review_decision"."checks"->>'rights' in ('pass','hold')) is true)
);
--> statement-breakpoint
ALTER TABLE "reference_review_batch" ADD CONSTRAINT "reference_review_batch_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_review_decision" ADD CONSTRAINT "reference_review_decision_batch_fk" FOREIGN KEY ("tenant_id","batch_id","manifest_sha256") REFERENCES "public"."reference_review_batch"("tenant_id","id","manifest_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_review_decision" ADD CONSTRAINT "reference_review_decision_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Admission is an explicit operator operation. Runtime may read controls, revoke
-- an existing generation and append decisions; it cannot admit or rewrite them.
ALTER TABLE reference_review_batch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reference_review_batch FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reference_review_decision ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reference_review_decision FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON reference_review_batch, reference_review_decision FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON reference_review_batch, reference_review_decision FROM portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON reference_review_batch TO portal_runtime
 USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
 WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON reference_review_decision TO portal_runtime
 USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
 WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT ON reference_review_batch TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (generation, revoked_at) ON reference_review_batch TO portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON reference_review_decision TO portal_runtime;
--> statement-breakpoint
CREATE FUNCTION reference_review_batch_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Immutable reference review batch'; END IF;
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
 OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256 OR NEW.catalog_sha256 IS DISTINCT FROM OLD.catalog_sha256
 OR NEW.reviewer_user_id IS DISTINCT FROM OLD.reviewer_user_id OR NEW.entry_count IS DISTINCT FROM OLD.entry_count
 OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.generation <> OLD.generation + 1 THEN
  RAISE EXCEPTION 'Immutable reference review batch';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reference_review_batch_immutable BEFORE UPDATE OR DELETE ON reference_review_batch
 FOR EACH ROW EXECUTE FUNCTION reference_review_batch_immutable();
--> statement-breakpoint
REVOKE ALL ON FUNCTION reference_review_batch_immutable() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION reference_review_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE control reference_review_batch%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Immutable reference review decision'; END IF;
 SELECT * INTO control FROM reference_review_batch WHERE tenant_id = NEW.tenant_id AND id = NEW.batch_id FOR UPDATE;
 IF NOT FOUND OR control.revoked_at IS NOT NULL OR control.expires_at <= clock_timestamp()
 OR NEW.generation <> control.generation OR NEW.manifest_sha256 <> control.manifest_sha256
 OR NEW.catalog_sha256 <> control.catalog_sha256 OR NEW.actor_user_id <> control.reviewer_user_id THEN
  RAISE EXCEPTION 'Inactive reference review batch';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reference_review_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON reference_review_decision
 FOR EACH ROW EXECUTE FUNCTION reference_review_decision_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION reference_review_decision_guard() FROM PUBLIC;
