CREATE TABLE "invitation_throttle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"bucket_start" bigint NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "invitation_throttle_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invitation_throttle_bucket_key" UNIQUE("tenant_id","scope","key","bucket_start"),
	CONSTRAINT "invitation_throttle_scope" CHECK ("invitation_throttle"."scope" in ('actor','recipient')),
	CONSTRAINT "invitation_throttle_hash" CHECK ("invitation_throttle"."key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "invitation_throttle_positive" CHECK ("invitation_throttle"."count" > 0 and "invitation_throttle"."bucket_start" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invitation_throttle" ADD CONSTRAINT "invitation_throttle_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE invitation_throttle ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitation_throttle FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invitation_throttle TO portal_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
GRANT SELECT, INSERT ON invitation_throttle TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (count) ON invitation_throttle TO portal_runtime;
--> statement-breakpoint
CREATE TRIGGER immutable_throttle_identity BEFORE UPDATE ON invitation_throttle
  FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('tenant_id','id','scope','key','bucket_start');
