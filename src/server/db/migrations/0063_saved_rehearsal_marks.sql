CREATE TABLE "saved_rehearsal_mark" (
	"tenant_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"saved_reading_id" uuid NOT NULL,
	"verse_ref" text NOT NULL,
	"retry" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "saved_rehearsal_mark_key" PRIMARY KEY("tenant_id","membership_id","saved_reading_id","verse_ref"),
	CONSTRAINT "saved_rehearsal_mark_verse" CHECK (char_length("saved_rehearsal_mark"."verse_ref") <= 100 and "saved_rehearsal_mark"."verse_ref" ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'),
	CONSTRAINT "saved_rehearsal_mark_version" CHECK ("saved_rehearsal_mark"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "saved_rehearsal_mark" ADD CONSTRAINT "saved_rehearsal_mark_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_rehearsal_mark" ADD CONSTRAINT "saved_rehearsal_mark_reading_fk" FOREIGN KEY ("tenant_id","saved_reading_id","membership_id") REFERENCES "public"."saved_reading"("tenant_id","id","membership_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A staff viewer may see the reading and ordinary marks, but never Run-through results.
ALTER TABLE saved_rehearsal_mark ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE saved_rehearsal_mark FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON saved_rehearsal_mark FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON saved_rehearsal_mark FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON saved_rehearsal_mark TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (retry, version) ON saved_rehearsal_mark TO portal_runtime;
--> statement-breakpoint
CREATE POLICY owner_only ON saved_rehearsal_mark TO portal_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '') AND membership_id = nullif(current_setting('app.saved_owner', true), '')::uuid);
