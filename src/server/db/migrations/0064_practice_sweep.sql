CREATE TABLE "practice_sweep" (
	"id" text PRIMARY KEY NOT NULL,
	"after_tenant" text,
	"after_student" uuid,
	CONSTRAINT "practice_sweep_singleton" CHECK ("practice_sweep"."id" = 'retention'),
	CONSTRAINT "practice_sweep_cursor" CHECK ("practice_sweep"."after_student" is null or "practice_sweep"."after_tenant" is not null)
);

--> statement-breakpoint
INSERT INTO practice_sweep (id) VALUES ('retention');
--> statement-breakpoint
ALTER TABLE practice_sweep ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE practice_sweep FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON practice_sweep FROM PUBLIC, portal_runtime;
--> statement-breakpoint
GRANT SELECT ON practice_sweep TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (after_tenant, after_student) ON practice_sweep TO portal_runtime;
--> statement-breakpoint
CREATE POLICY scheduler_only ON practice_sweep TO portal_runtime
  USING (current_setting('app.practice_sweep', true) = 'retention')
  WITH CHECK (current_setting('app.practice_sweep', true) = 'retention');

--> statement-breakpoint
-- Tenant discovery stays unavailable outside the authenticated retention sweep.
CREATE POLICY practice_sweep_directory ON tenant FOR SELECT TO portal_runtime
  USING (current_setting('app.practice_sweep', true) = 'retention');
