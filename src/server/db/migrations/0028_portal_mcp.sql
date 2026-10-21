-- Portal MCP (Decided here, 2026-10-21): Claude connects with OAuth 2.1 + PKCE; a staff member
-- consents on the portal after a Google sign-in. Only SHA-256 hashes of codes and tokens are stored.
CREATE TABLE "mcp_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role" "portal_role" NOT NULL,
	"role_grant_revision" integer NOT NULL,
	"authority_revision" integer NOT NULL,
	"scope" text NOT NULL,
	"unattended" boolean NOT NULL,
	"client_name" text NOT NULL,
	"client_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_connection_tenant_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "mcp_connection_scope" CHECK (("mcp_connection"."role"='admin' and "mcp_connection"."scope" in ('portal:read','portal:read portal:study')) or ("mcp_connection"."role"='tutor' and "mcp_connection"."scope"='portal:read')),
	CONSTRAINT "mcp_connection_revisions" CHECK ("mcp_connection"."role_grant_revision" > 0 and "mcp_connection"."authority_revision" > 0),
	CONSTRAINT "mcp_connection_client" CHECK (char_length("mcp_connection"."client_name") between 1 and 120 and "mcp_connection"."client_name" !~ '[[:cntrl:]<>]' and "mcp_connection"."client_hash" ~ '^[a-f0-9]{64}$' and octet_length("mcp_connection"."redirect_uri") between 1 and 2048),
	CONSTRAINT "mcp_connection_lifetime" CHECK (isfinite("mcp_connection"."created_at") and "mcp_connection"."expires_at" > "mcp_connection"."created_at" and "mcp_connection"."expires_at" <= "mcp_connection"."created_at" + interval '31 days' and ("mcp_connection"."revoked_at" is null or (isfinite("mcp_connection"."revoked_at") and "mcp_connection"."revoked_at" >= "mcp_connection"."created_at")))
);
--> statement-breakpoint
CREATE TABLE "mcp_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code_challenge" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "mcp_token_hash" CHECK ("mcp_token"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mcp_token_kind" CHECK ("mcp_token"."kind" in ('code','access','refresh')),
	CONSTRAINT "mcp_token_shape" CHECK (("mcp_token"."kind"='code') = ("mcp_token"."code_challenge" is not null) and ("mcp_token"."code_challenge" is null or "mcp_token"."code_challenge" ~ '^[A-Za-z0-9_-]{43}$') and ("mcp_token"."kind"<>'access' or "mcp_token"."used_at" is null)),
	CONSTRAINT "mcp_token_lifetime" CHECK (isfinite("mcp_token"."created_at") and "mcp_token"."expires_at" > "mcp_token"."created_at" and "mcp_token"."expires_at" <= "mcp_token"."created_at" + interval '31 days' and ("mcp_token"."used_at" is null or isfinite("mcp_token"."used_at")))
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "google_authenticated_at" timestamp;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_member_fk" FOREIGN KEY ("tenant_id","membership_id","user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_token" ADD CONSTRAINT "mcp_token_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_token" ADD CONSTRAINT "mcp_token_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."mcp_connection"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_connection_member_idx" ON "mcp_connection" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "mcp_token_connection_idx" ON "mcp_token" USING btree ("tenant_id","connection_id");
--> statement-breakpoint
-- Set only by the Better Auth session-create hook from a verified Google ID token; never rewritten.
CREATE TRIGGER immutable_session_google_authenticated_at BEFORE UPDATE ON "session" FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('google_authenticated_at');
--> statement-breakpoint
-- Every column is fixed at insert except one that may be set once (revoked_at, used_at).
CREATE FUNCTION public.portal_mcp_set_once() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE col text := TG_ARGV[0];
BEGIN
 IF (to_jsonb(NEW) - col) IS DISTINCT FROM (to_jsonb(OLD) - col)
   OR (to_jsonb(OLD)->col <> 'null'::jsonb AND to_jsonb(NEW)->col IS DISTINCT FROM to_jsonb(OLD)->col)
   OR (to_jsonb(NEW)->col = 'null'::jsonb AND to_jsonb(OLD)->col <> 'null'::jsonb) THEN
  RAISE EXCEPTION 'mcp row is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mcp_connection_set_once BEFORE UPDATE ON mcp_connection FOR EACH ROW EXECUTE FUNCTION public.portal_mcp_set_once('revoked_at');
--> statement-breakpoint
CREATE TRIGGER mcp_token_set_once BEFORE UPDATE ON mcp_token FOR EACH ROW EXECUTE FUNCTION public.portal_mcp_set_once('used_at');
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.portal_mcp_set_once() FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE mcp_connection ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mcp_connection FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mcp_token ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mcp_token FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON mcp_connection, mcp_token FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON mcp_connection, mcp_token FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON mcp_connection, mcp_token TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON mcp_connection TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (used_at) ON mcp_token TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mcp_connection TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mcp_token TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
