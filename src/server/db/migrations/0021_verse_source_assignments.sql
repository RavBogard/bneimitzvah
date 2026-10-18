-- Closed immutable citation snapshots; no source bodies or arbitrary metadata.
CREATE FUNCTION public.portal_source_plain(v text, bound integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(v IS NOT NULL AND octet_length(v) BETWEEN 1 AND bound AND btrim(v)=v AND normalize(v,NFC)=v
  AND v !~ '[[:cntrl:]<>]' AND translate(v,chr(8206)||chr(8207)||chr(8234)||chr(8235)||chr(8236)||chr(8237)||chr(8238)||chr(8294)||chr(8295)||chr(8296)||chr(8297)||chr(65279),'')=v,false)
$$;
--> statement-breakpoint
CREATE FUNCTION public.portal_source_citations_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e jsonb; labels jsonb; previous_id text; actual_id text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR octet_length(v::text)>131072 THEN RETURN false; END IF;
 IF jsonb_array_length(v)>32 THEN RETURN false; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(e))<>5 OR NOT (e ?& ARRAY['id','ref','indexTitle','category','labels']) THEN RETURN false; END IF;
  IF jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR (e->>'id') !~ '^[A-Za-z0-9_-]{1,128}$' THEN RETURN false; END IF;
  actual_id:=e->>'id';
  IF previous_id IS NOT NULL AND (previous_id COLLATE "C") >= (actual_id COLLATE "C") THEN RETURN false; END IF;
  previous_id:=actual_id;
  IF jsonb_typeof(e->'ref') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(e->>'ref',512)
    OR jsonb_typeof(e->'indexTitle') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(e->>'indexTitle',512)
    OR jsonb_typeof(e->'category') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(e->>'category',128) THEN RETURN false; END IF;
  labels:=e->'labels';
  IF jsonb_typeof(labels) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(labels))<>2 OR NOT (labels ?& ARRAY['en','he']) THEN RETURN false; END IF;
  IF (labels->'en')<>'null'::jsonb AND (jsonb_typeof(labels->'en') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(labels->>'en',256)) THEN RETURN false; END IF;
  IF (labels->'he')<>'null'::jsonb AND (jsonb_typeof(labels->'he') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(labels->>'he',256)) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE TABLE "verse_source_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"assignment_revision" integer NOT NULL,
	"verse_ref" text NOT NULL,
	"version" integer NOT NULL,
	"base_version" integer NOT NULL,
	"previous_version" integer,
	"citations" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verse_source_assignment_stream_key" UNIQUE("tenant_id","student_id","assignment_id","assignment_revision","verse_ref","version"),
	CONSTRAINT "verse_source_assignment_receipt_key" UNIQUE("tenant_id","student_id","actor_user_id","mutation_id"),
	CONSTRAINT "verse_source_assignment_versions" CHECK ("verse_source_assignment"."version" > 0 and "verse_source_assignment"."base_version" >= 0 and "verse_source_assignment"."version"::bigint = "verse_source_assignment"."base_version"::bigint + 1 and "verse_source_assignment"."assignment_revision" > 0 and (("verse_source_assignment"."base_version"=0 and "verse_source_assignment"."previous_version" is null) or ("verse_source_assignment"."base_version">0 and "verse_source_assignment"."previous_version" is not null and "verse_source_assignment"."previous_version"="verse_source_assignment"."base_version"))),
	CONSTRAINT "verse_source_assignment_citations" CHECK (public.portal_source_citations_valid("verse_source_assignment"."citations")),
	CONSTRAINT "verse_source_assignment_digest" CHECK ("verse_source_assignment"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "verse_source_assignment_ref" CHECK (octet_length("verse_source_assignment"."verse_ref") <= 100 and "verse_source_assignment"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "verse_source_assignment_staff" CHECK ("verse_source_assignment"."mode"::text="verse_source_assignment"."role"::text and "verse_source_assignment"."mode" in ('admin','tutor')),
	CONSTRAINT "verse_source_assignment_instant" CHECK (isfinite("verse_source_assignment"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "verse_source_assignment" ADD CONSTRAINT "verse_source_assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_source_assignment" ADD CONSTRAINT "verse_source_assignment_previous_fk" FOREIGN KEY ("tenant_id","student_id","assignment_id","assignment_revision","verse_ref","previous_version") REFERENCES "public"."verse_source_assignment"("tenant_id","student_id","assignment_id","assignment_revision","verse_ref","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_source_assignment" ADD CONSTRAINT "verse_source_assignment_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_source_assignment" ADD CONSTRAINT "verse_source_assignment_reading_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_source_assignment" ADD CONSTRAINT "verse_source_assignment_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_source_assignment" ADD CONSTRAINT "verse_source_assignment_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verse_source_assignment" ADD CONSTRAINT "verse_source_assignment_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set'));
--> statement-breakpoint
ALTER TABLE verse_source_assignment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE verse_source_assignment FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON verse_source_assignment FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON verse_source_assignment FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON verse_source_assignment TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON verse_source_assignment TO portal_runtime
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE TRIGGER immutable_source_assignment BEFORE UPDATE OR DELETE ON verse_source_assignment
 FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_source_plain(text,integer),public.portal_source_citations_valid(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.portal_source_plain(text,integer),public.portal_source_citations_valid(jsonb) TO portal_runtime;
