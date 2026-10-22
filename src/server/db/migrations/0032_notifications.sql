CREATE TABLE "notification_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"kind" text NOT NULL,
	"period_key" text NOT NULL,
	"student_id" uuid,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "notification_delivery_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "notification_delivery_period_key" UNIQUE("tenant_id","membership_id","kind","period_key"),
	CONSTRAINT "notification_delivery_kind" CHECK (("notification_delivery"."kind" = 'tutor-draft' and "notification_delivery"."role" = 'tutor' and "notification_delivery"."student_id" is not null and "notification_delivery"."period_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    or ("notification_delivery"."kind" = 'weekly-digest' and "notification_delivery"."role" in ('parent','student') and "notification_delivery"."student_id" is null and "notification_delivery"."period_key" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    or ("notification_delivery"."kind" = 'practice-reminder' and "notification_delivery"."role" = 'student' and "notification_delivery"."student_id" is null and "notification_delivery"."period_key" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')),
	CONSTRAINT "notification_delivery_status" CHECK ("notification_delivery"."status" in ('pending','sending','sent','failed','unknown','skipped')),
	CONSTRAINT "notification_delivery_attempts" CHECK ("notification_delivery"."attempts" between 0 and 10),
	CONSTRAINT "notification_delivery_instants" CHECK (isfinite("notification_delivery"."created_at") and ("notification_delivery"."attempted_at" is null or isfinite("notification_delivery"."attempted_at")) and ("notification_delivery"."finished_at" is null or isfinite("notification_delivery"."finished_at")))
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	"weekday" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_via" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_key" PRIMARY KEY("tenant_id","membership_id","kind"),
	CONSTRAINT "notification_preference_kind" CHECK ("notification_preference"."kind" in ('tutor-draft','weekly-digest','practice-reminder')),
	CONSTRAINT "notification_preference_weekday" CHECK (("notification_preference"."kind" = 'practice-reminder' and ("notification_preference"."weekday" is null or "notification_preference"."weekday" between 0 and 6)) or ("notification_preference"."kind" <> 'practice-reminder' and "notification_preference"."weekday" is null)),
	CONSTRAINT "notification_preference_revision" CHECK ("notification_preference"."revision" > 0),
	CONSTRAINT "notification_preference_via" CHECK ("notification_preference"."updated_via" in ('web','unsubscribe')),
	CONSTRAINT "notification_preference_instant" CHECK (isfinite("notification_preference"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe'));
--> statement-breakpoint
-- Congregation settings gain one optional field, notifications: each kind's admin switch (absent or false is off)
-- and the weekly digest's weekday (Sunday 0 to Saturday 6). Every body the 0030 function accepted is still accepted.
CREATE OR REPLACE FUNCTION public.portal_tenant_settings_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE svc jsonb; title jsonb; titles text[] := ARRAY[]::text[]; link text; flag text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>32768 THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE k <> ALL (ARRAY['rabbiDisplayName','services','preferredSources','siddurUrl','musicUrl','rosterSheetId','consentNotice','notifications'])) THEN RETURN false; END IF;
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
 IF v ? 'notifications' THEN
  IF jsonb_typeof(v->'notifications') IS DISTINCT FROM 'object' OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v->'notifications'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(v->'notifications') k WHERE k <> ALL (ARRAY['tutorDraft','weeklyDigest','studentReminder','digestWeekday'])) THEN RETURN false; END IF;
  FOREACH flag IN ARRAY ARRAY['tutorDraft','weeklyDigest','studentReminder'] LOOP
   IF v->'notifications' ? flag AND jsonb_typeof(v->'notifications'->flag) IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  END LOOP;
  IF v->'notifications' ? 'digestWeekday' AND (jsonb_typeof(v->'notifications'->'digestWeekday') IS DISTINCT FROM 'number'
    OR (v->'notifications'->>'digestWeekday') !~ '^[0-6]$') THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;
--> statement-breakpoint
ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_preference FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON notification_preference FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON notification_preference FROM portal_runtime;
--> statement-breakpoint
-- A member's choice is changed in place; its key, member and kind never change, and nothing is deleted.
GRANT SELECT, INSERT ON notification_preference TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (enabled, weekday, revision, updated_via, updated_at) ON notification_preference TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON notification_preference TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_delivery FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON notification_delivery FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON notification_delivery FROM portal_runtime;
--> statement-breakpoint
-- The ledger only moves a row through its states; who, what kind and which period are fixed at insert.
GRANT SELECT, INSERT ON notification_delivery TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (status, attempts, attempted_at, finished_at) ON notification_delivery TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON notification_delivery TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
