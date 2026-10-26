-- Release 1.9 N23 (decision 7, widens ruling 45): practice visibility for the student's ASSIGNED tutor, and the mark column.
-- The generated part adds two columns to verse_self_check: source_mode (student or child-practice: whether a parent was
-- practising with the student, as practice_event already records) and marked_at (the server's instant of the change, stamped by
-- the trigger below, never a value the caller chose). Both are null on marks made before 0052.
ALTER TABLE "verse_self_check" ADD COLUMN "source_mode" text;--> statement-breakpoint
ALTER TABLE "verse_self_check" ADD COLUMN "marked_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "verse_self_check" ADD CONSTRAINT "verse_self_check_source_mode" CHECK ("verse_self_check"."source_mode" is null or "verse_self_check"."source_mode" in ('student','child-practice'));--> statement-breakpoint
ALTER TABLE "verse_self_check" ADD CONSTRAINT "verse_self_check_marked" CHECK (("verse_self_check"."source_mode" is null) = ("verse_self_check"."marked_at" is null) and ("verse_self_check"."marked_at" is null or isfinite("verse_self_check"."marked_at")));
--> statement-breakpoint
-- Every write that changes a mark (an insert, or an update that changes state) is stamped with the server's instant when it names
-- its source; a write that changes no state keeps the mark's source and instant as they were. The app always names the source.
CREATE FUNCTION portal_self_check_marked() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.marked_at := CASE WHEN NEW.source_mode IS NULL THEN NULL ELSE date_trunc('milliseconds', clock_timestamp()) END;
  ELSE
    NEW.source_mode := OLD.source_mode;
    NEW.marked_at := OLD.marked_at;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION portal_self_check_marked() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER self_check_marked BEFORE INSERT OR UPDATE ON verse_self_check FOR EACH ROW EXECUTE FUNCTION portal_self_check_marked();
--> statement-breakpoint
-- The source is written with the state; marked_at is the trigger's alone, so it gets no column grant.
GRANT UPDATE (source_mode) ON verse_self_check TO portal_runtime;
--> statement-breakpoint
-- The reader. app.practice_reader is a tutor role grant id that only src/server/data/practice-visibility.ts sets, transaction-locally,
-- after src/server/practice-visibility/service.ts has checked the live grant and the live tutor_student row (a structural test holds
-- this). It sees a student only when, in the caller's own tenant: the grant is a live tutor grant, its membership is enabled, the
-- student is enabled, a live tutor_student row links that grant to that student, and the student is not ceremony-done (N21).
-- Unset or empty matches nothing; a malformed value fails the uuid cast. No admin, parent, student, MCP, cron, Sheet, export or
-- notification path sets it, so every one of them reads no row of the views below and no other member's course progress.
CREATE FUNCTION portal_practice_reader_sees(reader_tenant text, reader_student uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_grant g
      JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id AND m.disabled_at IS NULL
      JOIN student s ON s.tenant_id = g.tenant_id AND s.id = reader_student AND s.disabled_at IS NULL
      JOIN tutor_student t ON t.tenant_id = g.tenant_id AND t.tutor_grant_id = g.id AND t.student_id = s.id AND t.revoked_at IS NULL
    WHERE g.tenant_id = reader_tenant
      AND g.tenant_id = nullif(current_setting('app.tenant_id', true), '')
      AND g.id = nullif(current_setting('app.practice_reader', true), '')::uuid
      AND g.role = 'tutor' AND g.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM student_ceremony_done c WHERE c.tenant_id = s.tenant_id AND c.student_id = s.id AND c.reversed_at IS NULL))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION portal_practice_reader_sees(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION portal_practice_reader_sees(text, uuid) TO portal_runtime;
--> statement-breakpoint
-- Which verses were opened on which day: one row per day and verse, never a time of day, an action, a count or a duration.
-- Security invoker, so practice_event's forced tenant_isolation policy still applies to the caller.
CREATE VIEW practice_visibility_opened WITH (security_invoker = true, security_barrier = true) AS
  SELECT DISTINCT e.tenant_id, e.student_id, e.practice_day, e.target->>'kind' AS kind, (e.target->>'assignmentId')::uuid AS assignment_id, e.target->>'verseRef' AS verse_ref
  FROM practice_event e
  WHERE e.action = 'visit' AND e.target->>'type' = 'verse' AND portal_practice_reader_sees(e.tenant_id, e.student_id);
--> statement-breakpoint
-- The student's current Still working and Got it marks, with whether a parent was there and the day (never the time) each was made.
CREATE VIEW practice_visibility_marks WITH (security_invoker = true, security_barrier = true) AS
  SELECT v.tenant_id, v.student_id, v.assignment_id, v.verse_ref, v.state, v.source_mode, (v.marked_at AT TIME ZONE 'America/Chicago')::date AS marked_day
  FROM verse_self_check v
  WHERE v.state IN ('working', 'got-it') AND portal_practice_reader_sees(v.tenant_id, v.student_id);
--> statement-breakpoint
-- Learn to lein, for the "Can hear" line and the pair most often mixed up: the lesson ids done and each card's Leitner box. Never
-- the done instants or the due dates. course_progress stays owner-only for everyone else: its one new policy admits the reader alone.
CREATE POLICY assigned_tutor_reader ON course_progress FOR SELECT TO portal_runtime USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '') AND EXISTS (
    SELECT 1 FROM role_grant g
      JOIN student_identity i ON i.tenant_id = g.tenant_id AND i.role_grant_id = g.id AND i.revoked_at IS NULL
    WHERE g.tenant_id = course_progress.tenant_id AND g.membership_id = course_progress.membership_id AND g.role = 'student' AND g.revoked_at IS NULL
      AND portal_practice_reader_sees(g.tenant_id, i.student_id)));
--> statement-breakpoint
CREATE VIEW practice_visibility_learn WITH (security_invoker = true, security_barrier = true) AS
  SELECT c.tenant_id, i.student_id,
    ARRAY(SELECT k FROM jsonb_object_keys(c.progress->'lessons') AS k ORDER BY k) AS lessons,
    (SELECT coalesce(jsonb_object_agg(card.key, card.value->'box'), '{}'::jsonb) FROM jsonb_each(c.progress->'cards') AS card) AS boxes
  FROM course_progress c
    JOIN role_grant g ON g.tenant_id = c.tenant_id AND g.membership_id = c.membership_id AND g.role = 'student' AND g.revoked_at IS NULL
    JOIN student_identity i ON i.tenant_id = g.tenant_id AND i.role_grant_id = g.id AND i.revoked_at IS NULL
  WHERE portal_practice_reader_sees(c.tenant_id, i.student_id);
--> statement-breakpoint
REVOKE ALL ON practice_visibility_opened, practice_visibility_marks, practice_visibility_learn FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON practice_visibility_opened, practice_visibility_marks, practice_visibility_learn TO portal_runtime;
