-- Congregation settings (MISSION rulings 9, 21/52). Append-only versions; readers take the head over
-- the legacy tenant.customs keys (calendar rules, credits.rabbiDisplayName), which stay untouched.
-- Text fields: trimmed NFC text, no control character (line breaks only where multiline), angle
-- bracket or hidden/bidi mark. The service validator applies the same rules and is never looser.
CREATE FUNCTION public.portal_settings_text(v text, chars integer, multiline boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(v IS NOT NULL AND char_length(v) BETWEEN 1 AND chars AND octet_length(v) <= chars*4 AND btrim(v)=v AND v !~ '^[[:space:]]|[[:space:]]$'
  AND normalize(v,NFC)=v AND v !~ '[<>]' AND (CASE WHEN multiline THEN translate(v,chr(10),'') ELSE v END) !~ '[[:cntrl:]\u0080-\u009F]' AND v !~ '[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0001\U000E0020-\U000E007F\U000E0100-\U000E01EF]',false)
$$;
--> statement-breakpoint
-- A closed set of optional fields; an absent field keeps the portal's current behaviour.
CREATE FUNCTION public.portal_tenant_settings_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE svc jsonb; title jsonb; titles text[] := ARRAY[]::text[]; link text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>32768 THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE k <> ALL (ARRAY['rabbiDisplayName','services','preferredSources','siddurUrl','musicUrl','rosterSheetId','consentNotice'])) THEN RETURN false; END IF;
 IF v ? 'rabbiDisplayName' AND (jsonb_typeof(v->'rabbiDisplayName') IS DISTINCT FROM 'string' OR NOT public.portal_settings_text(v->>'rabbiDisplayName',80,false)) THEN RETURN false; END IF;
 IF v ? 'services' THEN
  IF jsonb_typeof(v->'services') IS DISTINCT FROM 'object' OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v->'services'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(v->'services') k WHERE k <> ALL (ARRAY['morning','havdalah'])) THEN RETURN false; END IF;
  FOR svc IN SELECT value FROM jsonb_each(v->'services') LOOP
   IF jsonb_typeof(svc) IS DISTINCT FROM 'object' OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(svc))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(svc) k WHERE k <> ALL (ARRAY['label','start'])) THEN RETURN false; END IF;
   IF svc ? 'label' AND (jsonb_typeof(svc->'label') IS DISTINCT FROM 'string' OR NOT public.portal_settings_text(svc->>'label',40,false)) THEN RETURN false; END IF;
   IF svc ? 'start' AND (jsonb_typeof(svc->'start') IS DISTINCT FROM 'string' OR (svc->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RETURN false; END IF;
  END LOOP;
 END IF;
 IF v ? 'preferredSources' THEN
  IF jsonb_typeof(v->'preferredSources') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'preferredSources') NOT BETWEEN 1 AND 12 THEN RETURN false; END IF;
  FOR title IN SELECT value FROM jsonb_array_elements(v->'preferredSources') LOOP
   IF jsonb_typeof(title) IS DISTINCT FROM 'string' OR NOT public.portal_settings_text(title #>> '{}',160,false) OR (title #>> '{}')=ANY(titles) THEN RETURN false; END IF;
   titles := titles || (title #>> '{}');
  END LOOP;
 END IF;
 -- https only, CRC's own hosts (centralreform.live, any subdomain of centralreform.org), no port, credentials or fragment.
 FOREACH link IN ARRAY ARRAY['siddurUrl','musicUrl'] LOOP
  IF v ? link AND (jsonb_typeof(v->link) IS DISTINCT FROM 'string' OR octet_length(v->>link)>512
    OR (v->>link) !~ '^https://(centralreform\.live|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+centralreform\.org)/[A-Za-z0-9._~!$&()*+,;=:@%/?-]*$') THEN RETURN false; END IF;
 END LOOP;
 IF v ? 'rosterSheetId' AND (jsonb_typeof(v->'rosterSheetId') IS DISTINCT FROM 'string' OR (v->>'rosterSheetId') !~ '^[A-Za-z0-9_-]{25,100}$') THEN RETURN false; END IF;
 IF v ? 'consentNotice' AND (jsonb_typeof(v->'consentNotice') IS DISTINCT FROM 'string' OR NOT public.portal_settings_text(v->>'consentNotice',600,true)) THEN RETURN false; END IF;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer NOT NULL,
	"base_version" integer NOT NULL,
	"previous_version" integer,
	"body" jsonb NOT NULL,
	"actor_user_id" text,
	"actor_membership_id" uuid,
	"role_grant_id" uuid,
	"role" "portal_role",
	"mode" "context_mode",
	"channel" text NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_stream_key" UNIQUE("tenant_id","version"),
	CONSTRAINT "tenant_settings_receipt_key" UNIQUE("tenant_id","actor_user_id","mutation_id"),
	CONSTRAINT "tenant_settings_versions" CHECK ("tenant_settings"."version" > 0 and "tenant_settings"."base_version" >= 0 and "tenant_settings"."version"::bigint = "tenant_settings"."base_version"::bigint + 1 and (("tenant_settings"."base_version"=0 and "tenant_settings"."previous_version" is null) or ("tenant_settings"."base_version">0 and "tenant_settings"."previous_version" is not null and "tenant_settings"."previous_version"="tenant_settings"."base_version"))),
	CONSTRAINT "tenant_settings_body" CHECK (public.portal_tenant_settings_valid("tenant_settings"."body")),
	CONSTRAINT "tenant_settings_channel" CHECK ("tenant_settings"."channel" in ('web','operator')),
	CONSTRAINT "tenant_settings_actor" CHECK (("tenant_settings"."channel"='web' and "tenant_settings"."actor_user_id" is not null and "tenant_settings"."actor_membership_id" is not null and "tenant_settings"."role_grant_id" is not null and "tenant_settings"."role"='admin' and "tenant_settings"."mode"='admin')
    or ("tenant_settings"."channel"='operator' and "tenant_settings"."version"=1 and "tenant_settings"."body"='{}'::jsonb and "tenant_settings"."actor_user_id" is null and "tenant_settings"."actor_membership_id" is null and "tenant_settings"."role_grant_id" is null and "tenant_settings"."role" is null and "tenant_settings"."mode" is null)),
	CONSTRAINT "tenant_settings_digest" CHECK ("tenant_settings"."request_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "tenant_settings_instant" CHECK (isfinite("tenant_settings"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_previous_fk" FOREIGN KEY ("tenant_id","previous_version") REFERENCES "public"."tenant_settings"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set'));
--> statement-breakpoint
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON tenant_settings FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON tenant_settings FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON tenant_settings TO portal_runtime;
--> statement-breakpoint
-- The runtime writes only admin web versions; the actorless first version is the owner's alone.
CREATE POLICY tenant_isolation ON tenant_settings TO portal_runtime
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'') AND channel='web');
--> statement-breakpoint
CREATE TRIGGER immutable_settings_version BEFORE UPDATE OR DELETE ON tenant_settings FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_settings_text(text,integer,boolean),public.portal_tenant_settings_valid(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.portal_settings_text(text,integer,boolean),public.portal_tenant_settings_valid(jsonb) TO portal_runtime;
