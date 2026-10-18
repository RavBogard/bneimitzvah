CREATE TABLE mcp_delegation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL REFERENCES tenant(id),
 user_id text NOT NULL, session_id text NOT NULL,
 membership_id uuid NOT NULL, role_grant_id uuid NOT NULL, role portal_role NOT NULL,
 membership_revision integer NOT NULL, grant_revision integer NOT NULL,
 pending_cookie_hash text NOT NULL, request_fingerprint text NOT NULL,
 scope text NOT NULL, resource text NOT NULL, client_id text NOT NULL,
 created_at timestamptz NOT NULL, selection_deadline timestamptz NOT NULL, hard_deadline timestamptz NOT NULL,
 authorized_at timestamptz, consent_id text, revoked_at timestamptz,
 CONSTRAINT mcp_delegation_tenant_key UNIQUE(tenant_id,id),
 CONSTRAINT mcp_delegation_pending_hash_key UNIQUE(pending_cookie_hash),
 CONSTRAINT mcp_delegation_session_actor_fk FOREIGN KEY(session_id,user_id) REFERENCES session(id,user_id) ON DELETE CASCADE,
 CONSTRAINT mcp_delegation_membership_actor_fk FOREIGN KEY(tenant_id,membership_id,user_id) REFERENCES membership(tenant_id,id,user_id),
 CONSTRAINT mcp_delegation_grant_actor_fk FOREIGN KEY(tenant_id,role_grant_id,membership_id) REFERENCES role_grant(tenant_id,id,membership_id),
 CONSTRAINT mcp_delegation_grant_role_fk FOREIGN KEY(tenant_id,role_grant_id,role) REFERENCES role_grant(tenant_id,id,role),
 CONSTRAINT mcp_delegation_policy CHECK(role in ('admin','tutor') AND membership_revision>0 AND grant_revision>0 AND scope='portal:read' AND resource='https://beitmitzvah.centralreform.org/api/mcp'),
 CONSTRAINT mcp_delegation_hashes CHECK(pending_cookie_hash ~ '^[a-f0-9]{64}$' AND request_fingerprint ~ '^[a-f0-9]{64}$'),
 CONSTRAINT mcp_delegation_client CHECK(octet_length(client_id) BETWEEN 1 AND 255 AND length(trim(client_id))>0 AND client_id=btrim(client_id) AND client_id !~ '[\x01-\x1f\x7f]'),
 CONSTRAINT mcp_delegation_consent CHECK((authorized_at IS NULL)=(consent_id IS NULL) AND (consent_id IS NULL OR (octet_length(consent_id) BETWEEN 1 AND 255 AND length(trim(consent_id))>0 AND consent_id=btrim(consent_id) AND consent_id !~ '[\x01-\x1f\x7f]'))),
 CONSTRAINT mcp_delegation_instants CHECK(isfinite(created_at) AND isfinite(selection_deadline) AND isfinite(hard_deadline) AND selection_deadline>created_at AND selection_deadline<=created_at+interval '10 minutes' AND selection_deadline<=hard_deadline AND (authorized_at IS NULL OR (isfinite(authorized_at) AND authorized_at>=created_at)) AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=created_at)))
);
--> statement-breakpoint
ALTER TABLE mcp_delegation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mcp_delegation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mcp_delegation TO portal_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
GRANT SELECT,INSERT ON mcp_delegation TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE(id,authorized_at,consent_id,revoked_at) ON mcp_delegation TO portal_runtime;
--> statement-breakpoint
CREATE FUNCTION public.portal_mcp_delegation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE instant timestamptz := clock_timestamp(); origin_expiry timestamp;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.authorized_at IS NOT NULL OR NEW.consent_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.created_at>instant THEN
   RAISE EXCEPTION 'Invalid MCP delegation' USING ERRCODE='23514';
  END IF;
  SELECT expires_at INTO origin_expiry FROM public.session WHERE id=NEW.session_id AND user_id=NEW.user_id;
  IF NOT FOUND OR NOT isfinite(origin_expiry) OR origin_expiry AT TIME ZONE 'UTC'<=instant OR NEW.hard_deadline>origin_expiry AT TIME ZONE 'UTC' THEN
   RAISE EXCEPTION 'Invalid MCP delegation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['authorized_at','consent_id','revoked_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['authorized_at','consent_id','revoked_at']) THEN
  RAISE EXCEPTION 'Immutable MCP delegation' USING ERRCODE='23514';
 END IF;
 IF NEW.authorized_at IS DISTINCT FROM OLD.authorized_at OR NEW.consent_id IS DISTINCT FROM OLD.consent_id THEN
  IF OLD.authorized_at IS NOT NULL OR OLD.consent_id IS NOT NULL OR OLD.revoked_at IS NOT NULL
   OR NEW.authorized_at IS NULL OR NEW.consent_id IS NULL OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
   OR instant>=OLD.selection_deadline OR instant>=OLD.hard_deadline
   OR NEW.authorized_at<OLD.created_at OR NEW.authorized_at>instant THEN
   RAISE EXCEPTION 'Invalid MCP authorization transition' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at<OLD.created_at OR NEW.revoked_at>instant THEN
   RAISE EXCEPTION 'Invalid MCP revocation transition' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mcp_delegation_guard BEFORE INSERT OR UPDATE ON mcp_delegation FOR EACH ROW EXECUTE FUNCTION portal_mcp_delegation_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION portal_mcp_delegation_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION portal_mcp_delegation_guard() TO portal_runtime;
