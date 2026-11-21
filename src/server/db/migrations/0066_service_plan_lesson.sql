ALTER TABLE "student_service_plan" ADD COLUMN "completed_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "student_service_plan" ADD CONSTRAINT "student_service_plan_completion" CHECK (
  "completed_ids" <@ "selected_ids" AND cardinality("completed_ids") <= 256 AND array_position("completed_ids", null) IS NULL
);--> statement-breakpoint
-- Reassignment during a rolling deploy must clear completion even when the older app writes the new revision.
CREATE FUNCTION clear_service_plan_lesson_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.completed_ids := ARRAY[]::text[];
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER clear_service_plan_lesson_completion BEFORE UPDATE OF revision ON student_service_plan
FOR EACH ROW WHEN (OLD.revision IS DISTINCT FROM NEW.revision) EXECUTE FUNCTION clear_service_plan_lesson_completion();
