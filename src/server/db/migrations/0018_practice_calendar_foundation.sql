CREATE TABLE "practice_day" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"practice_day" date NOT NULL,
	CONSTRAINT "practice_day_key" PRIMARY KEY("tenant_id","student_id","practice_day")
);
--> statement-breakpoint
CREATE TABLE "practice_event" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"practice_day" date NOT NULL,
	"event_id" uuid NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT date_trunc('milliseconds', clock_timestamp()) NOT NULL,
	"action" text NOT NULL,
	"source_mode" text NOT NULL,
	"target" jsonb NOT NULL,
	CONSTRAINT "practice_event_key" PRIMARY KEY("tenant_id","student_id","practice_day","event_id"),
	CONSTRAINT "practice_event_received_day" CHECK ("practice_event"."practice_day" = ("practice_event"."received_at" at time zone 'America/Chicago')::date),
	CONSTRAINT "practice_event_action" CHECK ("practice_event"."action" in ('visit','play','record')),
	CONSTRAINT "practice_event_source_mode" CHECK ("practice_event"."source_mode" in ('student','child-practice')),
	CONSTRAINT "practice_event_target" CHECK (coalesce(jsonb_typeof("practice_event"."target") = 'object' and (
    ("practice_event"."target"->>'type' = 'verse'
      and "practice_event"."target" ?& array['type','kind','assignmentId','assignmentRevision','verseRef']
      and "practice_event"."target" - array['type','kind','assignmentId','assignmentRevision','verseRef']::text[] = '{}'::jsonb
      and "practice_event"."target"->>'kind' in ('torah','haftarah')
      and "practice_event"."target"->>'assignmentId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and jsonb_typeof("practice_event"."target"->'assignmentRevision') = 'number' and "practice_event"."target"->>'assignmentRevision' ~ '^[1-9][0-9]{0,9}$' and "practice_event"."target"->'assignmentRevision' <= '2147483647'::jsonb
      and length("practice_event"."target"->>'verseRef') <= 100 and "practice_event"."target"->>'verseRef' ~ '^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$')
    or ("practice_event"."target"->>'type' = 'service-unit'
      and "practice_event"."target" ?& array['type','catalogId','catalogIdentity','planId','planRevision','unitId']
      and "practice_event"."target" - array['type','catalogId','catalogIdentity','planId','planRevision','unitId']::text[] = '{}'::jsonb
      and "practice_event"."target"->>'catalogId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and "practice_event"."target"->>'planId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and jsonb_typeof("practice_event"."target"->'catalogIdentity') = 'string' and "practice_event"."target"->>'catalogIdentity' ~ '^[a-f0-9]{64}$'
      and jsonb_typeof("practice_event"."target"->'planRevision') = 'number' and "practice_event"."target"->>'planRevision' ~ '^[1-9][0-9]{0,9}$' and "practice_event"."target"->'planRevision' <= '2147483646'::jsonb
      and jsonb_typeof("practice_event"."target"->'unitId') = 'string' and length("practice_event"."target"->>'unitId') between 1 and 128)
  ), false))
);
--> statement-breakpoint
ALTER TABLE "practice_day" ADD CONSTRAINT "practice_day_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_day" ADD CONSTRAINT "practice_day_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_event" ADD CONSTRAINT "practice_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_event" ADD CONSTRAINT "practice_event_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_event" ADD CONSTRAINT "practice_event_day_fk" FOREIGN KEY ("tenant_id","student_id","practice_day") REFERENCES "public"."practice_day"("tenant_id","student_id","practice_day") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['practice_day','practice_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM portal_runtime', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I TO portal_runtime', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
-- FOR UPDATE needs a column UPDATE privilege; the trigger forbids date changes.
GRANT UPDATE (practice_day) ON practice_day TO portal_runtime;
--> statement-breakpoint
CREATE TRIGGER immutable_practice_day BEFORE UPDATE ON practice_day FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('tenant_id','student_id','practice_day');
--> statement-breakpoint
CREATE TRIGGER immutable_practice_event BEFORE UPDATE ON practice_event FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('tenant_id','student_id','practice_day','event_id','received_at','action','source_mode','target');
--> statement-breakpoint
CREATE FUNCTION portal_practice_anniversary_due(ceremony date, instant timestamptz) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF ceremony IS NULL OR instant IS NULL OR NOT isfinite(ceremony) OR NOT isfinite(instant)
      OR extract(year from ceremony) < 1 OR extract(year from ceremony) > 9999 THEN
    RAISE EXCEPTION 'Practice date unavailable' USING ERRCODE = '23514';
  END IF;
  -- PostgreSQL calendar arithmetic clamps leap day and represents year 10000.
  RETURN (instant AT TIME ZONE 'America/Chicago')::date >= (ceremony + interval '1 year')::date;
END $$;
--> statement-breakpoint
CREATE FUNCTION portal_practice_ceremony_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE actual_now timestamptz;
BEGIN
  -- UPDATE has acquired the student row lock before this trigger runs. A
  -- transaction-start timestamp could be stale after that acquisition waited.
  actual_now := clock_timestamp();
  IF public.portal_practice_anniversary_due(OLD.ceremony_date, actual_now)
      OR public.portal_practice_anniversary_due(NEW.ceremony_date, actual_now) THEN
    DELETE FROM public.practice_event WHERE tenant_id = OLD.tenant_id AND student_id = OLD.id;
    DELETE FROM public.practice_day WHERE tenant_id = OLD.tenant_id AND student_id = OLD.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER practice_ceremony_retention BEFORE UPDATE OF ceremony_date ON student
  FOR EACH ROW WHEN (OLD.ceremony_date IS DISTINCT FROM NEW.ceremony_date)
  EXECUTE FUNCTION portal_practice_ceremony_change();
