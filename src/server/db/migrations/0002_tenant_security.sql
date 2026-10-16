-- Custom SQL migration file, put your code below! --
-- Runtime is a privilege group, never the migration/table-owning login. A real
-- deployment supplies a separate restricted login inheriting this group.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_runtime') THEN
    CREATE ROLE portal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_runtime'
      AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'Unsafe portal runtime role';
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO portal_runtime;
--> statement-breakpoint
GRANT USAGE ON TYPE portal_role, context_mode, reading_kind, reading_basis TO portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", account, session, verification, rate_limit TO portal_runtime;
--> statement-breakpoint
GRANT SELECT ON tenant, tenant_host TO portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hebcal_cache TO portal_runtime;
--> statement-breakpoint
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['membership','role_grant','student','student_identity',
      'guardian','tutor_student','invite','practice_context','assignment','assignment_verse','audit_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO portal_runtime USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))', table_name);
    IF table_name = 'audit_event' THEN
      EXECUTE format('GRANT SELECT, INSERT ON %I TO portal_runtime', table_name);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO portal_runtime', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_directory_scope ON tenant TO portal_runtime
  USING (id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
CREATE FUNCTION portal_immutable_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF to_jsonb(OLD)->column_name IS DISTINCT FROM to_jsonb(NEW)->column_name THEN
      RAISE EXCEPTION 'Immutable authority identity' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF to_jsonb(OLD)->>'revoked_at' IS NOT NULL AND to_jsonb(NEW)->>'revoked_at' IS NULL THEN
    RAISE EXCEPTION 'Revoked authority cannot be restored' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['membership','role_grant','student','student_identity',
      'guardian','tutor_student','invite','practice_context','assignment','assignment_verse'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_tenant BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns(''tenant_id'', ''id'')', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_grant BEFORE UPDATE ON role_grant FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('membership_id', 'role');
--> statement-breakpoint
CREATE TRIGGER immutable_membership_identity BEFORE UPDATE ON membership FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('user_id');
--> statement-breakpoint
CREATE TRIGGER immutable_guardian_pair BEFORE UPDATE ON guardian FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('student_id', 'parent_grant_id', 'role');
--> statement-breakpoint
CREATE TRIGGER immutable_student_identity BEFORE UPDATE ON student_identity FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('student_id', 'role_grant_id', 'role');
--> statement-breakpoint
CREATE TRIGGER immutable_tutor_pair BEFORE UPDATE ON tutor_student FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('student_id', 'tutor_grant_id', 'role');
--> statement-breakpoint
CREATE TRIGGER immutable_invitation BEFORE UPDATE ON invite FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('email', 'role', 'student_id', 'token_hash', 'inviter_membership_id', 'expires_at');
--> statement-breakpoint
CREATE TRIGGER immutable_context BEFORE UPDATE ON practice_context FOR EACH ROW EXECUTE FUNCTION portal_immutable_columns('token_hash', 'auth_session_id', 'actor_user_id', 'actor_membership_id', 'role_grant_id', 'role', 'mode', 'acting_student_id', 'guardian_id', 'student_identity_id', 'authority_revision', 'expires_at');
--> statement-breakpoint
CREATE FUNCTION portal_immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events are append only' USING ERRCODE = '23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
--> statement-breakpoint
-- Public, nonpersonal congregation settings only. No owner identity or contacts.
INSERT INTO tenant (id, name, product_name, customs) VALUES ('crc', 'Central Reform Congregation', 'CRC B''nei Mitzvah',
  '{"calendar":{"diaspora":true},"haftarahRite":"ashkenazi","torah":{"mode":"selection","rule":"weekly","triennial":null},"nusach":"binder-avery","versions":{"he":"Miqra according to the Masorah","en":"THE JPS TANAKH: Gender-Sensitive Edition"},"translations":["jps2023","jps1985","koren","metsudah"],"divineName":"yy","entryCap":24,"credits":{"issuedBy":"Central Reform Congregation"},"toConfirm":["torah","entryCap","nusach"]}'::jsonb);
--> statement-breakpoint
INSERT INTO tenant_host (host, tenant_id, environment, deployment, origin)
  VALUES ('bneimitzvah.centralreform.org', 'crc', 'production', 'production', 'https://bneimitzvah.centralreform.org');
