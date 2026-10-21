-- Study guides (spec 2026-10-21). The rabbi's display name for guide labels is read from
-- tenant.customs.credits.rabbiDisplayName (fallback "the rabbi"); no column is added for it.
-- Markdown-lite prose: newlines allowed, no other control, hidden bidi mark or angle bracket.
CREATE FUNCTION public.portal_study_markdown(v text, bound integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(v IS NOT NULL AND octet_length(v) BETWEEN 1 AND bound AND v ~ '[^[:space:]]' AND normalize(v,NFC)=v
  AND v !~ '[<>]' AND translate(v,chr(10),'') !~ '[[:cntrl:]]' AND translate(v,chr(8206)||chr(8207)||chr(8234)||chr(8235)||chr(8236)||chr(8237)||chr(8238)||chr(8294)||chr(8295)||chr(8296)||chr(8297)||chr(65279),'')=v,false)
$$;
--> statement-breakpoint
-- Structure and per-field limits of a guide body. The whole-body bound is a backstop on jsonb's
-- spaced text form; the service enforces the exact 131072-byte compact-JSON limit first.
CREATE FUNCTION public.portal_study_guide_body_valid(v jsonb, allow_overview boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE theme jsonb; note jsonb; src jsonb; labels jsonb; theme_ids text[] := ARRAY[]::text[]; source_ids text[];
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>262144 THEN RETURN false; END IF;
 IF allow_overview THEN
  IF (SELECT count(*) FROM jsonb_object_keys(v))<>2 OR NOT (v ?& ARRAY['overview','themes']) THEN RETURN false; END IF;
  IF jsonb_typeof(v->'overview') IS DISTINCT FROM 'string' OR NOT public.portal_study_markdown(v->>'overview',8192) THEN RETURN false; END IF;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(v))<>1 OR NOT (v ? 'themes') THEN RETURN false; END IF;
 END IF;
 IF jsonb_typeof(v->'themes') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'themes')>8 OR (NOT allow_overview AND jsonb_array_length(v->'themes')<1) THEN RETURN false; END IF;
 FOR theme IN SELECT value FROM jsonb_array_elements(v->'themes') LOOP
  IF jsonb_typeof(theme) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(theme))<>4 OR NOT (theme ?& ARRAY['id','title','intro','notes']) THEN RETURN false; END IF;
  IF jsonb_typeof(theme->'id') IS DISTINCT FROM 'string' OR octet_length(theme->>'id')>64 OR (theme->>'id') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR (theme->>'id')=ANY(theme_ids) THEN RETURN false; END IF;
  theme_ids := theme_ids || (theme->>'id');
  IF jsonb_typeof(theme->'title') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(theme->>'title',480) OR char_length(theme->>'title')>120 THEN RETURN false; END IF;
  IF jsonb_typeof(theme->'intro') IS DISTINCT FROM 'string' OR NOT public.portal_study_markdown(theme->>'intro',4096) THEN RETURN false; END IF;
  IF jsonb_typeof(theme->'notes') IS DISTINCT FROM 'array' OR jsonb_array_length(theme->'notes')>12 THEN RETURN false; END IF;
  FOR note IN SELECT value FROM jsonb_array_elements(theme->'notes') LOOP
   IF jsonb_typeof(note) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(note))<>3 OR NOT (note ?& ARRAY['verseRef','body','sources']) THEN RETURN false; END IF;
   IF jsonb_typeof(note->'verseRef') IS DISTINCT FROM 'string' OR octet_length(note->>'verseRef')>100 OR (note->>'verseRef') !~ '^[A-Za-z ]+ [1-9][0-9]*:[1-9][0-9]*$' THEN RETURN false; END IF;
   IF jsonb_typeof(note->'body') IS DISTINCT FROM 'string' OR NOT public.portal_study_markdown(note->>'body',4096) THEN RETURN false; END IF;
   IF jsonb_typeof(note->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(note->'sources')>3 THEN RETURN false; END IF;
   source_ids := ARRAY[]::text[];
   FOR src IN SELECT value FROM jsonb_array_elements(note->'sources') LOOP
    IF jsonb_typeof(src) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(src))<>6 OR NOT (src ?& ARRAY['id','ref','indexTitle','category','labels','readable']) THEN RETURN false; END IF;
    IF jsonb_typeof(src->'id') IS DISTINCT FROM 'string' OR (src->>'id') !~ '^[A-Za-z0-9_-]{1,128}$' OR (src->>'id')=ANY(source_ids) THEN RETURN false; END IF;
    source_ids := source_ids || (src->>'id');
    IF jsonb_typeof(src->'ref') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(src->>'ref',512)
      OR jsonb_typeof(src->'indexTitle') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(src->>'indexTitle',512)
      OR jsonb_typeof(src->'category') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(src->>'category',128)
      OR jsonb_typeof(src->'readable') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    labels := src->'labels';
    IF jsonb_typeof(labels) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(labels))<>2 OR NOT (labels ?& ARRAY['en','he']) THEN RETURN false; END IF;
    IF (labels->'en')<>'null'::jsonb AND (jsonb_typeof(labels->'en') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(labels->>'en',256)) THEN RETURN false; END IF;
    IF (labels->'he')<>'null'::jsonb AND (jsonb_typeof(labels->'he') IS DISTINCT FROM 'string' OR NOT public.portal_source_plain(labels->>'he',256)) THEN RETURN false; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE TABLE "study_guide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "reading_kind" NOT NULL,
	"reading_key" text NOT NULL,
	"version" integer NOT NULL,
	"base_version" integer NOT NULL,
	"previous_version" integer,
	"origin" text NOT NULL,
	"reviewed" boolean NOT NULL,
	"hold" boolean NOT NULL,
	"body" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"channel" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_guide_stream_key" UNIQUE("tenant_id","kind","reading_key","version"),
	CONSTRAINT "study_guide_receipt_key" UNIQUE("tenant_id","actor_user_id","mutation_id"),
	CONSTRAINT "study_guide_versions" CHECK ("study_guide"."version" > 0 and "study_guide"."base_version" >= 0 and "study_guide"."version"::bigint = "study_guide"."base_version"::bigint + 1 and (("study_guide"."base_version"=0 and "study_guide"."previous_version" is null) or ("study_guide"."base_version">0 and "study_guide"."previous_version" is not null and "study_guide"."previous_version"="study_guide"."base_version"))),
	CONSTRAINT "study_guide_kind" CHECK ("study_guide"."kind" in ('torah','haftarah')),
	CONSTRAINT "study_guide_reading_key" CHECK (octet_length("study_guide"."reading_key") <= 160 and "study_guide"."reading_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "study_guide_origin" CHECK ("study_guide"."origin" in ('claude','rabbi')),
	CONSTRAINT "study_guide_body" CHECK (public.portal_study_guide_body_valid("study_guide"."body", true)),
	CONSTRAINT "study_guide_rabbi" CHECK ("study_guide"."role"='admin' and "study_guide"."mode"='admin'),
	CONSTRAINT "study_guide_channel" CHECK ("study_guide"."channel" in ('mcp','operator')),
	CONSTRAINT "study_guide_digest" CHECK ("study_guide"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "study_guide_instant" CHECK (isfinite("study_guide"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "study_guide_student" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"assignment_revision" integer NOT NULL,
	"kind" "reading_kind" NOT NULL,
	"version" integer NOT NULL,
	"base_version" integer NOT NULL,
	"previous_version" integer,
	"origin" text NOT NULL,
	"reviewed" boolean NOT NULL,
	"body" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"channel" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_guide_student_stream_key" UNIQUE("tenant_id","student_id","assignment_id","assignment_revision","kind","version"),
	CONSTRAINT "study_guide_student_receipt_key" UNIQUE("tenant_id","actor_user_id","mutation_id"),
	CONSTRAINT "study_guide_student_versions" CHECK ("study_guide_student"."version" > 0 and "study_guide_student"."base_version" >= 0 and "study_guide_student"."version"::bigint = "study_guide_student"."base_version"::bigint + 1 and (("study_guide_student"."base_version"=0 and "study_guide_student"."previous_version" is null) or ("study_guide_student"."base_version">0 and "study_guide_student"."previous_version" is not null and "study_guide_student"."previous_version"="study_guide_student"."base_version")) and "study_guide_student"."assignment_revision" > 0),
	CONSTRAINT "study_guide_student_kind" CHECK ("study_guide_student"."kind" in ('torah','haftarah')),
	CONSTRAINT "study_guide_student_origin" CHECK ("study_guide_student"."origin" in ('claude','rabbi')),
	CONSTRAINT "study_guide_student_body" CHECK (public.portal_study_guide_body_valid("study_guide_student"."body", false)),
	CONSTRAINT "study_guide_student_rabbi" CHECK ("study_guide_student"."role"='admin' and "study_guide_student"."mode"='admin'),
	CONSTRAINT "study_guide_student_channel" CHECK ("study_guide_student"."channel" in ('mcp','operator')),
	CONSTRAINT "study_guide_student_digest" CHECK ("study_guide_student"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "study_guide_student_instant" CHECK (isfinite("study_guide_student"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "study_theme_read" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" "reading_kind" NOT NULL,
	"reading_key" text NOT NULL,
	"theme_id" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_theme_read_head_key" UNIQUE("tenant_id","student_id","kind","reading_key","theme_id"),
	CONSTRAINT "study_theme_read_version_positive" CHECK ("study_theme_read"."version" > 0),
	CONSTRAINT "study_theme_read_kind" CHECK ("study_theme_read"."kind" in ('torah','haftarah')),
	CONSTRAINT "study_theme_read_reading_key" CHECK (octet_length("study_theme_read"."reading_key") <= 160 and "study_theme_read"."reading_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "study_theme_read_theme" CHECK (octet_length("study_theme_read"."theme_id") <= 64 and "study_theme_read"."theme_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "study_theme_read_state" CHECK ("study_theme_read"."state" in ('read','unread')),
	CONSTRAINT "study_theme_read_instant" CHECK (isfinite("study_theme_read"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "study_voice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer NOT NULL,
	"base_version" integer NOT NULL,
	"previous_version" integer,
	"body" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mode" "context_mode" NOT NULL,
	"channel" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_voice_stream_key" UNIQUE("tenant_id","version"),
	CONSTRAINT "study_voice_receipt_key" UNIQUE("tenant_id","actor_user_id","mutation_id"),
	CONSTRAINT "study_voice_versions" CHECK ("study_voice"."version" > 0 and "study_voice"."base_version" >= 0 and "study_voice"."version"::bigint = "study_voice"."base_version"::bigint + 1 and (("study_voice"."base_version"=0 and "study_voice"."previous_version" is null) or ("study_voice"."base_version">0 and "study_voice"."previous_version" is not null and "study_voice"."previous_version"="study_voice"."base_version"))),
	CONSTRAINT "study_voice_body" CHECK (public.portal_study_markdown("study_voice"."body", 32768)),
	CONSTRAINT "study_voice_rabbi" CHECK ("study_voice"."role"='admin' and "study_voice"."mode"='admin'),
	CONSTRAINT "study_voice_channel" CHECK ("study_voice"."channel" in ('mcp','operator')),
	CONSTRAINT "study_voice_digest" CHECK ("study_voice"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "study_voice_instant" CHECK (isfinite("study_voice"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_previous_fk" FOREIGN KEY ("tenant_id","kind","reading_key","previous_version") REFERENCES "public"."study_guide"("tenant_id","kind","reading_key","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide_student" ADD CONSTRAINT "study_guide_student_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide_student" ADD CONSTRAINT "study_guide_student_previous_fk" FOREIGN KEY ("tenant_id","student_id","assignment_id","assignment_revision","kind","previous_version") REFERENCES "public"."study_guide_student"("tenant_id","student_id","assignment_id","assignment_revision","kind","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide_student" ADD CONSTRAINT "study_guide_student_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide_student" ADD CONSTRAINT "study_guide_student_reading_fk" FOREIGN KEY ("tenant_id","assignment_id","student_id") REFERENCES "public"."assignment"("tenant_id","id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide_student" ADD CONSTRAINT "study_guide_student_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide_student" ADD CONSTRAINT "study_guide_student_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_guide_student" ADD CONSTRAINT "study_guide_student_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_theme_read" ADD CONSTRAINT "study_theme_read_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_theme_read" ADD CONSTRAINT "study_theme_read_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_voice" ADD CONSTRAINT "study_voice_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_voice" ADD CONSTRAINT "study_voice_previous_fk" FOREIGN KEY ("tenant_id","previous_version") REFERENCES "public"."study_voice"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_voice" ADD CONSTRAINT "study_voice_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_voice" ADD CONSTRAINT "study_voice_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_voice" ADD CONSTRAINT "study_voice_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read'));
--> statement-breakpoint
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['study_voice','study_guide','study_guide_student'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM portal_runtime', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO portal_runtime', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
    EXECUTE format('CREATE TRIGGER immutable_study_version BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit()', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE study_theme_read ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE study_theme_read FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON study_theme_read FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON study_theme_read FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON study_theme_read TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (state, version, updated_at) ON study_theme_read TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON study_theme_read TO portal_runtime
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE TRIGGER immutable_theme_read_identity BEFORE UPDATE ON study_theme_read FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','student_id','kind','reading_key','theme_id');
--> statement-breakpoint
CREATE TRIGGER theme_read_version BEFORE UPDATE ON study_theme_read FOR EACH ROW EXECUTE FUNCTION portal_progress_version();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_study_markdown(text,integer),public.portal_study_guide_body_valid(jsonb,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.portal_study_markdown(text,integer),public.portal_study_guide_body_valid(jsonb,boolean) TO portal_runtime;
