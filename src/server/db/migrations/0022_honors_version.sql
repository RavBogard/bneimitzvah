CREATE FUNCTION public.portal_honors_keys(v jsonb, names text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(v)='object' THEN (SELECT count(*) FROM jsonb_object_keys(v))=cardinality(names) AND v ?& names ELSE false END
$$;
--> statement-breakpoint
CREATE FUNCTION public.portal_honors_compact(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.portal_honors_compact(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(public.portal_honors_compact(value),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY AS e(value,ordinal);
 ELSE result:=v::text;
 END CASE; RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.portal_honors_text(v jsonb, cap integer, nullable boolean) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p text; c text; cp integer;
BEGIN
 IF v='null'::jsonb THEN RETURN nullable; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 p:=v#>>'{}';
 IF octet_length(p) NOT BETWEEN 1 AND cap OR p<>normalize(p,NFC) OR p ~ '^[[:space:]]|[[:space:]]$' THEN RETURN false; END IF;
 -- Match ECMAScript trim's Unicode whitespace rather than the database locale.
 FOREACH cp IN ARRAY ARRAY[ascii(left(p,1)),ascii(right(p,1))] LOOP
  IF cp IN (32,160,5760,8232,8233,8239,8287,12288,65279) OR cp BETWEEN 8192 AND 8202 THEN RETURN false; END IF;
 END LOOP;
 FOR c IN SELECT regexp_split_to_table(p,'') LOOP
  cp:=ascii(c); IF cp<32 OR cp BETWEEN 127 AND 159 OR cp IN (60,62,1564,65279) OR cp BETWEEN 8203 AND 8207 OR cp BETWEEN 8234 AND 8238 OR cp BETWEEN 8288 AND 8303 THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.portal_honors_person(p jsonb, kind text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE keys text[]:=ARRAY['id','englishName']; k text;
BEGIN
 IF kind<>'ordinary' THEN keys:=keys||ARRAY['relationship']; END IF;
 IF kind='aliyah' THEN keys:=keys||ARRAY['hebrewName','parent1HebrewName','parent2HebrewName']; END IF;
 IF NOT public.portal_honors_keys(p,keys) OR jsonb_typeof(p->'id') IS DISTINCT FROM 'string' OR (p->>'id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR NOT public.portal_honors_text(p->'englishName',256,false) THEN RETURN false; END IF;
 IF kind<>'ordinary' AND NOT public.portal_honors_text(p->'relationship',160,true) THEN RETURN false; END IF;
 IF kind='aliyah' THEN FOREACH k IN ARRAY ARRAY['hebrewName','parent1HebrewName','parent2HebrewName'] LOOP IF NOT public.portal_honors_text(p->k,256,true) THEN RETURN false; END IF; END LOOP; END IF;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.portal_honors_form_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; p jsonb; a jsonb; kind text; all_people jsonb:='[]'; seen text[]:='{}'; starts text[]:='{}'; b jsonb;
BEGIN
 IF NOT public.portal_honors_keys(v,ARRAY['schemaVersion','openingArk','generationToGeneration','undressingTorah','redressingTorah','closingArk','aliyot','parentalBlessing']) OR v->'schemaVersion'<>'1'::jsonb OR octet_length(v::text)>131072 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['openingArk','generationToGeneration','undressingTorah','redressingTorah','closingArk'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'array' OR jsonb_array_length(v->k)>32 THEN RETURN false; END IF;
  kind:=CASE WHEN k='generationToGeneration' THEN 'generation' ELSE 'ordinary' END;
  FOR p IN SELECT value FROM jsonb_array_elements(v->k) LOOP IF NOT public.portal_honors_person(p,kind) THEN RETURN false; END IF; END LOOP;
  all_people:=all_people||(v->k);
 END LOOP;
 IF jsonb_typeof(v->'aliyot') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'aliyot')>1000 THEN RETURN false; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(v->'aliyot') LOOP
  IF NOT public.portal_honors_keys(a,ARRAY['startVerse','participants']) OR jsonb_typeof(a->'startVerse') IS DISTINCT FROM 'string' OR octet_length(a->>'startVerse')>100 OR (a->>'startVerse') !~ '^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$' OR (a->>'startVerse')=ANY(starts) OR jsonb_typeof(a->'participants') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'participants')>32 THEN RETURN false; END IF;
  starts:=array_append(starts,a->>'startVerse');
  FOR p IN SELECT value FROM jsonb_array_elements(a->'participants') LOOP IF NOT public.portal_honors_person(p,'aliyah') THEN RETURN false; END IF; END LOOP;
  all_people:=all_people||(a->'participants');
 END LOOP;
 IF jsonb_array_length(all_people)>256 THEN RETURN false; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(all_people) LOOP IF (p->>'id')=ANY(seen) THEN RETURN false; END IF; seen:=array_append(seen,p->>'id'); END LOOP;
 b:=v->'parentalBlessing';
 IF NOT public.portal_honors_keys(b,ARRAY['participation','delivery']) OR b->'participation' NOT IN ('null'::jsonb,'"yes"'::jsonb,'"no"'::jsonb) OR b->'delivery' NOT IN ('null'::jsonb,'"together"'::jsonb,'"separately"'::jsonb) OR (b->'delivery'<>'null'::jsonb AND b->'participation'<>'"yes"'::jsonb) THEN RETURN false; END IF;
 RETURN octet_length(public.portal_honors_compact(v))<=65536;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.portal_honors_context_valid(v jsonb, tenant text, student uuid, assignment uuid) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t jsonb; f jsonb; p jsonb; refs text[]:='{}'; previous integer:=1; current integer;
BEGIN
 IF NOT public.portal_honors_keys(v,ARRAY['schemaVersion','tenantId','studentId','ceremonyDate','serviceSlot','torah']) OR v->'schemaVersion'<>'1'::jsonb OR v->>'tenantId' IS DISTINCT FROM tenant OR v->>'studentId' IS DISTINCT FROM student::text OR jsonb_typeof(v->'ceremonyDate') IS DISTINCT FROM 'string' OR (v->>'ceremonyDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT isfinite((v->>'ceremonyDate')::date) OR v->'serviceSlot' NOT IN ('"morning"'::jsonb,'"havdalah"'::jsonb,'"unknown"'::jsonb) OR octet_length(v::text)>524288 OR octet_length(public.portal_honors_compact(v))>262144 THEN RETURN false; END IF;
 t:=v->'torah'; IF t='null'::jsonb THEN RETURN assignment IS NULL; END IF;
 IF NOT public.portal_honors_keys(t,ARRAY['id','revision','ref','basis','confirmation','verses','cuts']) OR assignment IS NULL OR t->>'id' IS DISTINCT FROM assignment::text OR jsonb_typeof(t->'revision') IS DISTINCT FROM 'number' OR (t->>'revision') !~ '^[1-9][0-9]*$' OR (t->>'revision')::numeric>2147483647 OR NOT public.portal_honors_text(t->'ref',131072,false) OR t->'basis' NOT IN ('"custom"'::jsonb,'"full"'::jsonb,'"selection"'::jsonb,'"triennial"'::jsonb) OR jsonb_typeof(t->'verses') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'verses') NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(t->'verses') LOOP
  IF jsonb_typeof(p) IS DISTINCT FROM 'string' OR octet_length(p#>>'{}')>100 OR (p#>>'{}') !~ '^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$' OR (p#>>'{}')=ANY(refs) THEN RETURN false; END IF;
  refs:=array_append(refs,p#>>'{}');
 END LOOP;
 IF t->'cuts'<>'null'::jsonb THEN
  IF jsonb_typeof(t->'cuts') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'cuts')>=cardinality(refs) THEN RETURN false; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(t->'cuts') LOOP
   IF jsonb_typeof(p) IS DISTINCT FROM 'string' THEN RETURN false; END IF; current:=array_position(refs,p#>>'{}');
   IF current IS NULL OR current<=previous THEN RETURN false; END IF; previous:=current;
  END LOOP;
 END IF;
 f:=t->'confirmation';
 IF NOT public.portal_honors_keys(f,ARRAY['confirmationDate','serviceSlot','slotProvenance','needsReview']) OR jsonb_typeof(f->'needsReview') IS DISTINCT FROM 'boolean' OR (f->'serviceSlot' NOT IN ('null'::jsonb,'"morning"'::jsonb,'"havdalah"'::jsonb,'"unknown"'::jsonb)) OR (f->'slotProvenance'<>'null'::jsonb AND jsonb_typeof(f->'slotProvenance') IS DISTINCT FROM 'number') THEN RETURN false; END IF;
 IF f->'confirmationDate'<>'null'::jsonb AND (jsonb_typeof(f->'confirmationDate') IS DISTINCT FROM 'string' OR (f->>'confirmationDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT isfinite((f->>'confirmationDate')::date)) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.portal_honors_mappings_valid(f jsonb, c jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE starts text[]:='{}'; a jsonb; previous integer:=0; current integer;
BEGIN
 IF c->'torah'='null'::jsonb OR c->'torah'->'cuts'='null'::jsonb THEN RETURN jsonb_array_length(f->'aliyot')=0; END IF;
 starts:=ARRAY[c->'torah'->'verses'->>0];
 FOR a IN SELECT value FROM jsonb_array_elements(c->'torah'->'cuts') LOOP starts:=array_append(starts,a#>>'{}'); END LOOP;
 FOR a IN SELECT value FROM jsonb_array_elements(f->'aliyot') LOOP current:=array_position(starts,a->>'startVerse'); IF current IS NULL OR current<=previous THEN RETURN false; END IF; previous:=current; END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint

CREATE TABLE "honors_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid,
	"version" integer NOT NULL,
	"base_version" integer NOT NULL,
	"previous_version" integer,
	"form" jsonb NOT NULL,
	"reviewed_context" jsonb NOT NULL,
	"context_hash" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"guardian_id" uuid,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "honors_version_stream_key" UNIQUE("tenant_id","student_id","version"),
	CONSTRAINT "honors_version_receipt_key" UNIQUE("tenant_id","student_id","mutation_id"),
	CONSTRAINT "honors_version_versions" CHECK ("honors_version"."version" > 0 and "honors_version"."base_version" >= 0 and "honors_version"."version"::bigint = "honors_version"."base_version"::bigint + 1 and (("honors_version"."base_version"=0 and "honors_version"."previous_version" is null) or ("honors_version"."base_version">0 and "honors_version"."previous_version"="honors_version"."base_version" and "honors_version"."previous_version" is not null))),
	CONSTRAINT "honors_version_author" CHECK ("honors_version"."mode"::text="honors_version"."role"::text and (("honors_version"."mode"='parent' and "honors_version"."guardian_id" is not null) or ("honors_version"."mode"='admin' and "honors_version"."guardian_id" is null))),
	CONSTRAINT "honors_version_hashes" CHECK ("honors_version"."context_hash" ~ '^[a-f0-9]{64}$' and "honors_version"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "honors_version_form" CHECK (public.portal_honors_form_valid("honors_version"."form")),
	CONSTRAINT "honors_version_context" CHECK (public.portal_honors_context_valid("honors_version"."reviewed_context", "honors_version"."tenant_id", "honors_version"."student_id", "honors_version"."assignment_id")),
	CONSTRAINT "honors_version_mappings" CHECK (public.portal_honors_mappings_valid("honors_version"."form", "honors_version"."reviewed_context")),
	CONSTRAINT "honors_version_instant" CHECK (isfinite("honors_version"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_previous_fk" FOREIGN KEY ("tenant_id","student_id","previous_version") REFERENCES "public"."honors_version"("tenant_id","student_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id","student_id","role_grant_id") REFERENCES "public"."guardian"("tenant_id","id","student_id","parent_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set'));
--> statement-breakpoint
ALTER TABLE honors_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honors_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON honors_version FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON honors_version FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON honors_version TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON honors_version TO portal_runtime USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE TRIGGER immutable_honors_version BEFORE UPDATE OR DELETE ON honors_version FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_honors_keys(jsonb,text[]), public.portal_honors_compact(jsonb), public.portal_honors_text(jsonb,integer,boolean), public.portal_honors_person(jsonb,text), public.portal_honors_form_valid(jsonb), public.portal_honors_context_valid(jsonb,text,uuid,uuid), public.portal_honors_mappings_valid(jsonb,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.portal_honors_keys(jsonb,text[]), public.portal_honors_compact(jsonb), public.portal_honors_text(jsonb,integer,boolean), public.portal_honors_person(jsonb,text), public.portal_honors_form_valid(jsonb), public.portal_honors_context_valid(jsonb,text,uuid,uuid), public.portal_honors_mappings_valid(jsonb,jsonb) TO portal_runtime;
