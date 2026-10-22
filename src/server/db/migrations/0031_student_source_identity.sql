-- Maven roster intake (Decided here, 2026-10-21): which Maven Contact a portal student is, keyed by the stable
-- source record id within the tenant. Written only by an admin's explicit apply through the portal MCP. The roster
-- tools need their own consent, portal:roster (Daniel, 2026-10-21): admin only, never a scheduled routine. Existing
-- connections keep exactly their scopes; the widened check accepts every value the 0028 check accepted.
CREATE TABLE "student_source_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"source_namespace" text NOT NULL,
	"source_record_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"mcp_connection_id" uuid NOT NULL,
	"link_kind" text NOT NULL,
	CONSTRAINT "student_source_identity_record_key" UNIQUE("tenant_id","source_namespace","source_record_id"),
	CONSTRAINT "student_source_identity_student_key" UNIQUE("tenant_id","source_namespace","student_id"),
	CONSTRAINT "student_source_identity_source" CHECK ("student_source_identity"."source_namespace" = 'maven' and "student_source_identity"."source_record_id" ~ '^[A-Za-z0-9]{18}$'),
	CONSTRAINT "student_source_identity_admin" CHECK ("student_source_identity"."role" = 'admin'),
	CONSTRAINT "student_source_identity_link_kind" CHECK ("student_source_identity"."link_kind" in ('created', 'linked')),
	CONSTRAINT "student_source_identity_created" CHECK (isfinite("student_source_identity"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "mcp_connection" DROP CONSTRAINT "mcp_connection_scope";--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_member_fk" FOREIGN KEY ("tenant_id","created_by_membership_id","created_by_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","created_by_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_source_identity" ADD CONSTRAINT "student_source_identity_connection_fk" FOREIGN KEY ("tenant_id","mcp_connection_id") REFERENCES "public"."mcp_connection"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_scope" CHECK ((("mcp_connection"."role"='admin' and "mcp_connection"."scope" in ('portal:read','portal:read portal:study','portal:read portal:roster','portal:read portal:study portal:roster')) or ("mcp_connection"."role"='tutor' and "mcp_connection"."scope"='portal:read')) and not ("mcp_connection"."unattended" and "mcp_connection"."scope" like '%portal:roster%'));
--> statement-breakpoint
ALTER TABLE student_source_identity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE student_source_identity FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON student_source_identity FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON student_source_identity FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON student_source_identity TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON student_source_identity TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
