-- PostgreSQL FOR SHARE needs an UPDATE privilege. Carry it only on immutable
-- link identity; no provider policy, pair, metadata or timestamp is writable.
CREATE FUNCTION public.portal_immutable_oauth_link_id() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Immutable OAuth link identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_oauth_link_id BEFORE UPDATE ON public.oauth_client_resource
  FOR EACH ROW EXECUTE FUNCTION public.portal_immutable_oauth_link_id();
--> statement-breakpoint
GRANT UPDATE (id) ON public.oauth_client_resource TO portal_runtime;
