-- Release 1.9 N6 (decision 4): a parashah's outline is exactly seven plain lines, one per aliyah, each at most 240 bytes.
CREATE FUNCTION public.portal_portion_outline(v text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(array_ndims(v) = 1 AND array_lower(v, 1) = 1 AND cardinality(v) = 7
  AND (SELECT bool_and(public.portal_source_plain(x, 240)) FROM unnest(v) AS x), false)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_portion_outline(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.portal_portion_outline(text[]) TO portal_runtime;
--> statement-breakpoint
CREATE TABLE "portion_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"reading_key" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"outline" text[] NOT NULL,
	"drafted_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_grant_id" uuid,
	"approved_role" "portal_role",
	"approved_at" timestamp with time zone,
	"credit" text,
	"withdrawn_at" timestamp with time zone,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portion_summary_revision_key" UNIQUE("tenant_id","reading_key","revision"),
	CONSTRAINT "portion_summary_receipt_key" UNIQUE("tenant_id","mutation_id"),
	CONSTRAINT "portion_summary_reading_key" CHECK (octet_length("portion_summary"."reading_key") <= 80 and "portion_summary"."reading_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "portion_summary_revision" CHECK ("portion_summary"."revision" > 0),
	CONSTRAINT "portion_summary_status" CHECK ("portion_summary"."status" in ('draft','approved','withdrawn')),
	CONSTRAINT "portion_summary_summary" CHECK (public.portal_study_markdown("portion_summary"."summary", 4096)),
	CONSTRAINT "portion_summary_outline" CHECK (public.portal_portion_outline("portion_summary"."outline")),
	CONSTRAINT "portion_summary_approval" CHECK (("portion_summary"."approved_by" is null and "portion_summary"."approved_grant_id" is null and "portion_summary"."approved_role" is null and "portion_summary"."approved_at" is null and "portion_summary"."credit" is null)
    or ("portion_summary"."approved_by" is not null and "portion_summary"."approved_grant_id" is not null and "portion_summary"."approved_role" = 'admin' and "portion_summary"."approved_at" is not null and "portion_summary"."credit" is not null)),
	CONSTRAINT "portion_summary_approved_state" CHECK (("portion_summary"."status" = 'draft' and "portion_summary"."approved_by" is null) or ("portion_summary"."status" = 'approved' and "portion_summary"."approved_by" is not null) or "portion_summary"."status" = 'withdrawn'),
	CONSTRAINT "portion_summary_withdrawn_state" CHECK (("portion_summary"."status" = 'withdrawn') = ("portion_summary"."withdrawn_at" is not null)),
	CONSTRAINT "portion_summary_credit" CHECK ("portion_summary"."credit" is null or (public.portal_source_plain("portion_summary"."credit", 240) and strpos("portion_summary"."credit", '@') = 0)),
	CONSTRAINT "portion_summary_digest" CHECK ("portion_summary"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "portion_summary_instants" CHECK (isfinite("portion_summary"."created_at") and isfinite("portion_summary"."updated_at") and ("portion_summary"."approved_at" is null or isfinite("portion_summary"."approved_at")) and ("portion_summary"."withdrawn_at" is null or isfinite("portion_summary"."withdrawn_at")))
);
--> statement-breakpoint
ALTER TABLE "portion_summary" ADD CONSTRAINT "portion_summary_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_summary" ADD CONSTRAINT "portion_summary_drafter_fk" FOREIGN KEY ("tenant_id","drafted_by") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_summary" ADD CONSTRAINT "portion_summary_approver_fk" FOREIGN KEY ("tenant_id","approved_grant_id","approved_by") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_summary" ADD CONSTRAINT "portion_summary_approver_role_fk" FOREIGN KEY ("tenant_id","approved_grant_id","approved_role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portion_summary_approved_key" ON "portion_summary" USING btree ("tenant_id","reading_key") WHERE "portion_summary"."status" = 'approved';
--> statement-breakpoint
-- Release 1.9 N6 (decision 4, "Claude drafts, you approve"). Written only by the admin MCP tools; read publicly through
-- portion_summary_public below, which holds approved revisions only. Forced under the tenant_isolation policy. The runtime
-- may INSERT a draft, may SELECT every column except the membership and grant ids (drafted_by, approved_by,
-- approved_grant_id), may UPDATE only the approval and withdrawal columns, and never removes a row.
ALTER TABLE portion_summary ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portion_summary FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON portion_summary FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON portion_summary FROM portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON portion_summary TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT INSERT ON portion_summary TO portal_runtime;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, reading_key, revision, status, summary, outline, approved_role, approved_at, credit, withdrawn_at, mutation_id, request_digest, created_at, updated_at) ON portion_summary TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (status, approved_by, approved_grant_id, approved_role, approved_at, credit, withdrawn_at, updated_at) ON portion_summary TO portal_runtime;
--> statement-breakpoint
-- The congregation's portion summary credit (decision 4), the only text an approval may stamp. It mirrors
-- src/lib/portion-summary/credit.ts (a test holds them equal); a congregation with none here cannot approve at all.
CREATE FUNCTION public.portal_portion_summary_credit(tenant text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT CASE tenant WHEN 'crc' THEN 'Rabbi Daniel Bogard' END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_portion_summary_credit(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.portal_portion_summary_credit(text) TO portal_runtime;
--> statement-breakpoint
-- A revision starts as a draft and is the next one for its parashah, drafted under a live admin grant of a live membership.
-- Its words, parashah and drafter never change. It moves
-- draft -> approved (only under a live admin grant of a live membership of the same tenant, stamped now, with exactly the
-- congregation's credit), draft -> withdrawn
-- or approved -> withdrawn (stamped now, the approval kept as it was), and withdrawn is final. Nothing is ever deleted.
CREATE FUNCTION portal_portion_summary_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Portion summaries are withdrawn, never deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_grant_id IS NOT NULL OR NEW.approved_role IS NOT NULL
       OR NEW.approved_at IS NOT NULL OR NEW.credit IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'A portion summary starts as a draft' USING ERRCODE = '23514';
    END IF;
    IF NEW.revision::bigint <> coalesce((SELECT max(p.revision) FROM portion_summary p WHERE p.tenant_id = NEW.tenant_id AND p.reading_key = NEW.reading_key), 0)::bigint + 1 THEN
      RAISE EXCEPTION 'Each draft is the next revision of its parashah' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM role_grant g JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id
      WHERE g.tenant_id = NEW.tenant_id AND g.membership_id = NEW.drafted_by AND g.role = 'admin' AND g.revoked_at IS NULL AND m.disabled_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the rabbi or an administrator, under a live admin grant, drafts' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.reading_key, NEW.revision, NEW.summary, NEW.outline, NEW.drafted_by, NEW.mutation_id, NEW.request_digest, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.reading_key, OLD.revision, OLD.summary, OLD.outline, OLD.drafted_by, OLD.mutation_id, OLD.request_digest, OLD.created_at) THEN
    RAISE EXCEPTION 'A portion summary''s words and identity never change; draft a new revision' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    IF NEW.approved_at IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'An approval is stamped when it is made' USING ERRCODE = '23514';
    END IF;
    IF NEW.credit IS DISTINCT FROM public.portal_portion_summary_credit(NEW.tenant_id) THEN
      RAISE EXCEPTION 'An approval carries exactly the congregation''s credit' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM role_grant g JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id
      WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.approved_grant_id AND g.membership_id = NEW.approved_by AND g.role = 'admin'
        AND g.revoked_at IS NULL AND m.disabled_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the rabbi or an administrator, under a live admin grant, approves' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status IN ('draft', 'approved') AND NEW.status = 'withdrawn' THEN
    IF (NEW.approved_by, NEW.approved_grant_id, NEW.approved_role, NEW.approved_at, NEW.credit)
       IS DISTINCT FROM (OLD.approved_by, OLD.approved_grant_id, OLD.approved_role, OLD.approved_at, OLD.credit) THEN
      RAISE EXCEPTION 'A withdrawal keeps the approval as it was' USING ERRCODE = '23514';
    END IF;
    IF NEW.withdrawn_at IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'A withdrawal is stamped when it is made' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'A portion summary moves draft to approved to withdrawn, and withdrawn is final' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER portion_summary_guard BEFORE INSERT OR UPDATE OR DELETE ON portion_summary FOR EACH ROW EXECUTE FUNCTION portal_portion_summary_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION portal_portion_summary_guard() FROM PUBLIC;
--> statement-breakpoint
-- The one public read: approved revisions only, with their credit. Security invoker, so the forced tenant_isolation policy
-- and the column grants still apply to the caller; it names no membership, grant or receipt, and no draft or withdrawn
-- revision is in it.
CREATE VIEW portion_summary_public WITH (security_invoker = true, security_barrier = true) AS
  SELECT p.tenant_id, p.reading_key, p.revision, p.summary, p.outline, p.credit, p.approved_at
  FROM portion_summary p
  WHERE p.status = 'approved';
--> statement-breakpoint
REVOKE ALL ON portion_summary_public FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON portion_summary_public TO portal_runtime;
