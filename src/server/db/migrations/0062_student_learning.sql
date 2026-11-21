CREATE TABLE "student_learning" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"document" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_learning_key" PRIMARY KEY("tenant_id","student_id","kind"),
	CONSTRAINT "student_learning_document" CHECK (jsonb_typeof("student_learning"."document") = 'object' and coalesce(
    jsonb_typeof("student_learning"."document"->'cards') = 'object' and case "student_learning"."kind"
      when 'learn' then "student_learning"."document"->>'schema' = 'learn-progress/v1' and jsonb_typeof("student_learning"."document"->'lessons') = 'object'
      when 'service' then "student_learning"."document"->>'schema' = 'service-course-progress/v1' and jsonb_typeof("student_learning"."document"->'lessons') = 'object'
      when 'verses' then "student_learning"."document"->>'schema' = 'learn-verses/v1'
      else false end, false) and octet_length("student_learning"."document"::text) <= case when "student_learning"."kind" = 'verses' then 49152 else 98304 end),
	CONSTRAINT "student_learning_version" CHECK ("student_learning"."version" > 0),
	CONSTRAINT "student_learning_instants" CHECK (isfinite("student_learning"."created_at") and isfinite("student_learning"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "student_learning_legacy" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "student_learning_legacy_key" PRIMARY KEY("tenant_id","student_id"),
	CONSTRAINT "student_learning_legacy_member_key" UNIQUE("tenant_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "student_learning" ADD CONSTRAINT "student_learning_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_learning" ADD CONSTRAINT "student_learning_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_learning_legacy" ADD CONSTRAINT "student_learning_legacy_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_learning_legacy" ADD CONSTRAINT "student_learning_legacy_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_learning_legacy" ADD CONSTRAINT "student_learning_legacy_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Keep the original rows and versions for already-linked students so older deployed instances
-- and their pending writes continue to use the same data during rollout.
INSERT INTO student_learning_legacy (tenant_id, student_id, membership_id, user_id)
SELECT i.tenant_id, i.student_id, m.id, m.user_id
FROM student_identity i
JOIN role_grant g ON g.tenant_id = i.tenant_id AND g.id = i.role_grant_id AND g.role = 'student' AND g.revoked_at IS NULL
JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id AND m.disabled_at IS NULL
JOIN student s ON s.tenant_id = i.tenant_id AND s.id = i.student_id AND s.disabled_at IS NULL
WHERE i.revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE student_learning_legacy ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE student_learning_legacy FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON student_learning_legacy FROM PUBLIC, portal_runtime;
--> statement-breakpoint
GRANT SELECT ON student_learning_legacy TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON student_learning_legacy FOR SELECT TO portal_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')
    AND (student_id = nullif(current_setting('app.learning_student', true), '')::uuid
      OR membership_id = nullif(current_setting('app.learning_member', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE student_learning ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE student_learning FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON student_learning FROM PUBLIC, portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON student_learning TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (document, version, updated_at) ON student_learning TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON student_learning TO portal_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')
    AND student_id = nullif(current_setting('app.learning_student', true), '')::uuid
    AND kind = nullif(current_setting('app.learning_kind', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')
    AND student_id = nullif(current_setting('app.learning_student', true), '')::uuid
    AND kind = nullif(current_setting('app.learning_kind', true), ''));
--> statement-breakpoint
CREATE POLICY child_practice_writer ON service_part_finished FOR INSERT TO portal_runtime WITH CHECK (EXISTS (
  SELECT 1 FROM practice_context c
    JOIN guardian d ON d.tenant_id = c.tenant_id AND d.id = c.guardian_id AND d.student_id = c.acting_student_id
      AND d.parent_grant_id = c.role_grant_id AND d.revoked_at IS NULL AND d.practice_enabled
    JOIN role_grant g ON g.tenant_id = c.tenant_id AND g.id = c.role_grant_id AND g.role = 'parent' AND g.revoked_at IS NULL
    JOIN membership m ON m.tenant_id = c.tenant_id AND m.id = c.actor_membership_id AND m.id = g.membership_id
      AND m.disabled_at IS NULL AND m.authority_revision = c.authority_revision
    JOIN student s ON s.tenant_id = c.tenant_id AND s.id = c.acting_student_id AND s.disabled_at IS NULL
  WHERE c.tenant_id = service_part_finished.tenant_id AND c.acting_student_id = service_part_finished.student_id
    AND c.role_grant_id = nullif(current_setting('app.service_part_reader', true), '')::uuid
    AND c.id = nullif(current_setting('app.service_part_context', true), '')::uuid
    AND c.mode = 'child-practice' AND c.revoked_at IS NULL AND c.expires_at > clock_timestamp()));

--> statement-breakpoint
-- Keep the tutor's existing Learn projection for both storage paths. Unlinked personal
-- documents do not become visible to a tutor when the account is later linked to a student.
CREATE POLICY assigned_tutor_reader ON student_learning_legacy FOR SELECT TO portal_runtime
  USING (portal_practice_reader_sees(tenant_id, student_id));
--> statement-breakpoint
ALTER POLICY assigned_tutor_reader ON course_progress TO portal_runtime USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '') AND EXISTS (
    SELECT 1 FROM student_learning_legacy l
    WHERE l.tenant_id = course_progress.tenant_id AND l.membership_id = course_progress.membership_id
      AND portal_practice_reader_sees(l.tenant_id, l.student_id)));
--> statement-breakpoint
CREATE POLICY assigned_tutor_reader ON student_learning FOR SELECT TO portal_runtime
  USING (kind = 'learn' AND portal_practice_reader_sees(tenant_id, student_id));
--> statement-breakpoint
CREATE OR REPLACE VIEW practice_visibility_learn WITH (security_invoker = true, security_barrier = true) AS
  SELECT l.tenant_id, l.student_id,
    ARRAY(SELECT k FROM jsonb_object_keys(c.progress->'lessons') AS k ORDER BY k) AS lessons,
    (SELECT coalesce(jsonb_object_agg(card.key, card.value->'box'), '{}'::jsonb) FROM jsonb_each(c.progress->'cards') AS card) AS boxes
  FROM student_learning_legacy l
  JOIN course_progress c ON c.tenant_id = l.tenant_id AND c.membership_id = l.membership_id
  WHERE portal_practice_reader_sees(l.tenant_id, l.student_id)
  UNION ALL
  SELECT l.tenant_id, l.student_id,
    ARRAY(SELECT k FROM jsonb_object_keys(l.document->'lessons') AS k ORDER BY k),
    (SELECT coalesce(jsonb_object_agg(card.key, card.value->'box'), '{}'::jsonb) FROM jsonb_each(l.document->'cards') AS card)
  FROM student_learning l
  WHERE l.kind = 'learn' AND portal_practice_reader_sees(l.tenant_id, l.student_id)
    AND NOT EXISTS (SELECT 1 FROM student_learning_legacy b WHERE b.tenant_id = l.tenant_id AND b.student_id = l.student_id);
