CREATE FUNCTION public.portal_honoree_notices_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; notice text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 32 OR octet_length(v::text)>65536 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
  notice:=item#>>'{}';
  IF jsonb_typeof(item)<>'string' OR length(notice) NOT BETWEEN 1 AND 4096
   OR EXISTS(SELECT 1 FROM generate_series(1,length(notice)) i WHERE ascii(substr(notice,i,1)) BETWEEN 0 AND 8 OR ascii(substr(notice,i,1)) IN(11,12,127) OR ascii(substr(notice,i,1)) BETWEEN 14 AND 31)
  THEN RETURN false; END IF;
 END LOOP; RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE "honoree_group_epoch" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"start_verse" text NOT NULL,
	"epoch" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "honoree_group_epoch_key" UNIQUE("tenant_id","student_id","start_verse"),
	CONSTRAINT "honoree_group_epoch_positive" CHECK ("honoree_group_epoch"."epoch" >= 0),
	CONSTRAINT "honoree_group_start" CHECK (length("honoree_group_epoch"."start_verse") between 1 and 80 and "honoree_group_epoch"."start_verse" ~ '^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$')
);
--> statement-breakpoint
CREATE TABLE "honoree_link" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"start_verse" text NOT NULL,
	"reading_epoch" bigint NOT NULL,
	"group_epoch" bigint NOT NULL,
	"honors_version" integer NOT NULL,
	"context_hash" text NOT NULL,
	"material_release_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"guardian_id" uuid,
	"role" "portal_role" NOT NULL,
	"token_hash" text NOT NULL,
	"key_id" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "honoree_link_tenant_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "honoree_link_student_key" UNIQUE("tenant_id","student_id","id"),
	CONSTRAINT "honoree_link_shape" CHECK ("honoree_link"."id" ~ '^[A-Za-z0-9_-]{22}$' and "honoree_link"."context_hash" ~ '^[a-f0-9]{64}$' and "honoree_link"."token_hash" ~ '^[a-f0-9]{64}$' and "honoree_link"."key_id"='k1' and "honoree_link"."reading_epoch">=0 and "honoree_link"."group_epoch">=0 and "honoree_link"."honors_version">0 and (("honoree_link"."role"='parent' and "honoree_link"."guardian_id" is not null) or ("honoree_link"."role"='admin' and "honoree_link"."guardian_id" is null))),
	CONSTRAINT "honoree_link_instants" CHECK (isfinite("honoree_link"."issued_at") and isfinite("honoree_link"."expires_at") and "honoree_link"."expires_at">"honoree_link"."issued_at" and "honoree_link"."expires_at"<="honoree_link"."issued_at"+interval '2160 hours' and ("honoree_link"."revoked_at" is null or isfinite("honoree_link"."revoked_at") and "honoree_link"."revoked_at">="honoree_link"."issued_at"))
);
--> statement-breakpoint
CREATE TABLE "honoree_material_release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"catalog_id" uuid NOT NULL,
	"catalog_identity" text NOT NULL,
	"slot" text NOT NULL,
	"before_id" text NOT NULL,
	"after_id" text NOT NULL,
	"material_version" text NOT NULL,
	"projection_digest" text NOT NULL,
	"approval_basis" text NOT NULL,
	"notices" jsonb NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "honoree_material_tenant_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "honoree_material_shape" CHECK ("honoree_material_release"."state" in ('active','withdrawn') and "honoree_material_release"."slot" in ('morning','havdalah') and "honoree_material_release"."projection_digest" ~ '^[a-f0-9]{64}$' and "honoree_material_release"."catalog_identity" ~ '^[a-f0-9]{64}$' and length("honoree_material_release"."material_version") between 1 and 128 and octet_length("honoree_material_release"."approval_basis") between 1 and 4096 and isfinite("honoree_material_release"."created_at")),
	CONSTRAINT "honoree_material_units" CHECK ("honoree_material_release"."before_id"='torah.blessing-before-the-torah-reading@'||case when "honoree_material_release"."slot"='morning' then 'bm-shacharit' else 'bm-maariv' end and "honoree_material_release"."after_id"='torah.blessing-following-the-torah-reading@'||case when "honoree_material_release"."slot"='morning' then 'bm-shacharit' else 'bm-maariv' end),
	CONSTRAINT "honoree_material_notices" CHECK (public.portal_honoree_notices_valid("honoree_material_release"."notices"))
);
--> statement-breakpoint
CREATE TABLE "honoree_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"operation" text NOT NULL,
	"link_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"guardian_id" uuid,
	"role" "portal_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "honoree_operation_uuid" UNIQUE("tenant_id","student_id","mutation_id"),
	CONSTRAINT "honoree_operation_shape" CHECK ("honoree_operation"."request_digest" ~ '^[a-f0-9]{64}$' and "honoree_operation"."operation" in ('issue','revoke','reissue') and (("honoree_operation"."role"='parent' and "honoree_operation"."guardian_id" is not null) or ("honoree_operation"."role"='admin' and "honoree_operation"."guardian_id" is null)) and isfinite("honoree_operation"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "honoree_reading_epoch" (
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"epoch" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "honoree_reading_epoch_key" UNIQUE("tenant_id","student_id"),
	CONSTRAINT "honoree_reading_epoch_positive" CHECK ("honoree_reading_epoch"."epoch" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "honoree_group_epoch" ADD CONSTRAINT "honoree_group_epoch_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_group_epoch" ADD CONSTRAINT "honoree_group_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_group_fk" FOREIGN KEY ("tenant_id","student_id","start_verse") REFERENCES "public"."honoree_group_epoch"("tenant_id","student_id","start_verse") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_reading_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."honoree_reading_epoch"("tenant_id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_honors_fk" FOREIGN KEY ("tenant_id","student_id","honors_version") REFERENCES "public"."honors_version"("tenant_id","student_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_material_fk" FOREIGN KEY ("tenant_id","material_release_id") REFERENCES "public"."honoree_material_release"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id","student_id","role_grant_id") REFERENCES "public"."guardian"("tenant_id","id","student_id","parent_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_material_release" ADD CONSTRAINT "honoree_material_release_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_material_release" ADD CONSTRAINT "honoree_material_catalog_fk" FOREIGN KEY ("tenant_id","catalog_id","catalog_identity") REFERENCES "public"."service_catalog"("tenant_id","id","identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_link_fk" FOREIGN KEY ("tenant_id","student_id","link_id") REFERENCES "public"."honoree_link"("tenant_id","student_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id","actor_user_id") REFERENCES "public"."membership"("tenant_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_grant_fk" FOREIGN KEY ("tenant_id","role_grant_id","actor_membership_id") REFERENCES "public"."role_grant"("tenant_id","id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_role_fk" FOREIGN KEY ("tenant_id","role_grant_id","role") REFERENCES "public"."role_grant"("tenant_id","id","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_guardian_fk" FOREIGN KEY ("tenant_id","guardian_id","student_id","role_grant_id") REFERENCES "public"."guardian"("tenant_id","id","student_id","parent_grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_reading_epoch" ADD CONSTRAINT "honoree_reading_epoch_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honoree_reading_epoch" ADD CONSTRAINT "honoree_reading_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "honoree_link_one_current" ON "honoree_link" USING btree ("tenant_id","student_id","start_verse") WHERE "honoree_link"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "honoree_material_active_slot" ON "honoree_material_release" USING btree ("tenant_id","slot") WHERE "honoree_material_release"."state"='active';--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue'));
--> statement-breakpoint
ALTER TABLE honoree_reading_epoch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_reading_epoch FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_group_epoch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_group_epoch FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_material_release ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_material_release FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_link ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_link FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_operation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE honoree_operation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON honoree_reading_epoch,honoree_group_epoch,honoree_material_release,honoree_link,honoree_operation FROM PUBLIC,portal_runtime;
--> statement-breakpoint
GRANT SELECT,INSERT ON honoree_reading_epoch,honoree_group_epoch,honoree_link,honoree_operation TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE(epoch) ON honoree_reading_epoch,honoree_group_epoch TO portal_runtime;
--> statement-breakpoint
GRANT SELECT,UPDATE(id) ON honoree_material_release TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE(revoked_at) ON honoree_link TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON honoree_reading_epoch TO portal_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON honoree_group_epoch TO portal_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON honoree_material_release TO portal_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON honoree_link TO portal_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON honoree_operation TO portal_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_epoch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.epoch IN (0,1) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'epoch')=(to_jsonb(OLD)-'epoch') AND NEW.epoch=OLD.epoch+1 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Immutable honoree epoch';
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_reading_guard BEFORE INSERT OR UPDATE OR DELETE ON honoree_reading_epoch FOR EACH ROW EXECUTE FUNCTION portal_honoree_epoch_guard();
--> statement-breakpoint
CREATE TRIGGER honoree_group_guard BEFORE INSERT OR UPDATE OR DELETE ON honoree_group_epoch FOR EACH ROW EXECUTE FUNCTION portal_honoree_epoch_guard();
--> statement-breakpoint
INSERT INTO honoree_reading_epoch(tenant_id,student_id) SELECT tenant_id,id FROM student;
--> statement-breakpoint
INSERT INTO honoree_group_epoch(tenant_id,student_id,start_verse)
 SELECT h.tenant_id,h.student_id,a->>'startVerse' FROM honors_version h CROSS JOIN LATERAL jsonb_array_elements(h.form->'aliyot') a
 WHERE jsonb_array_length(a->'participants')>0 AND NOT EXISTS(SELECT 1 FROM honors_version newer WHERE newer.tenant_id=h.tenant_id AND newer.student_id=h.student_id AND newer.version>h.version);
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_student_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO honoree_reading_epoch(tenant_id,student_id) VALUES(NEW.tenant_id,NEW.id); 
 ELSIF ROW(NEW.ceremony_date,NEW.service_slot,NEW.disabled_at) IS DISTINCT FROM ROW(OLD.ceremony_date,OLD.service_slot,OLD.disabled_at) THEN
  UPDATE honoree_reading_epoch SET epoch=epoch+1 WHERE tenant_id=NEW.tenant_id AND student_id=NEW.id;
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_student_epoch AFTER INSERT OR UPDATE ON student FOR EACH ROW EXECUTE FUNCTION portal_honoree_student_epoch();
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_assignment_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE before_row jsonb; after_row jsonb; target record;
BEGIN
 IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' AND (before_row-ARRAY['created_at','set_by_membership_id','proposal_cache_id'])=(after_row-ARRAY['created_at','set_by_membership_id','proposal_cache_id']) THEN RETURN NEW; END IF;
 FOR target IN SELECT DISTINCT x->>'tenant_id' t,(x->>'student_id')::uuid s FROM (VALUES(before_row),(after_row)) v(x) WHERE x->>'kind'='torah' ORDER BY t,s LOOP
  UPDATE honoree_reading_epoch SET epoch=epoch+1 WHERE tenant_id=target.t AND student_id=target.s;
 END LOOP; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_assignment_epoch AFTER INSERT OR UPDATE OR DELETE ON assignment FOR EACH ROW EXECUTE FUNCTION portal_honoree_assignment_epoch();
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_verse_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE before_row jsonb; after_row jsonb; target record;
BEGIN
 IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' AND before_row=after_row THEN RETURN NEW; END IF;
 FOR target IN SELECT DISTINCT a.tenant_id t,a.student_id s FROM (VALUES(before_row),(after_row)) v(x)
 JOIN assignment a ON a.tenant_id=x->>'tenant_id' AND a.id=(x->>'assignment_id')::uuid AND a.kind='torah' ORDER BY t,s LOOP
  UPDATE honoree_reading_epoch SET epoch=epoch+1 WHERE tenant_id=target.t AND student_id=target.s;
 END LOOP; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_verse_epoch AFTER INSERT OR UPDATE OR DELETE ON assignment_verse FOR EACH ROW EXECUTE FUNCTION portal_honoree_verse_epoch();
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_group_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE predecessor jsonb; changed record;
BEGIN
 IF NEW.previous_version IS NOT NULL THEN SELECT form INTO STRICT predecessor FROM honors_version WHERE tenant_id=NEW.tenant_id AND student_id=NEW.student_id AND version=NEW.previous_version; END IF;
 FOR changed IN
  SELECT coalesce(p->>'startVerse',n->>'startVerse') start FROM jsonb_array_elements(coalesce(predecessor->'aliyot','[]')) p
   FULL JOIN jsonb_array_elements(NEW.form->'aliyot') n ON p->>'startVerse'=n->>'startVerse'
  WHERE p IS DISTINCT FROM n AND (coalesce(jsonb_array_length(p->'participants'),0)>0 OR coalesce(jsonb_array_length(n->'participants'),0)>0)
  ORDER BY start
 LOOP
  INSERT INTO honoree_group_epoch(tenant_id,student_id,start_verse,epoch) VALUES(NEW.tenant_id,NEW.student_id,changed.start,1)
   ON CONFLICT(tenant_id,student_id,start_verse) DO UPDATE SET epoch=honoree_group_epoch.epoch+1;
 END LOOP; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_group_epoch AFTER INSERT ON honors_version FOR EACH ROW EXECUTE FUNCTION portal_honoree_group_epoch();
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'revoked_at')=(to_jsonb(OLD)-'revoked_at') AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Immutable honoree link';
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_link_guard BEFORE UPDATE OR DELETE ON honoree_link FOR EACH ROW EXECUTE FUNCTION portal_honoree_link_guard();
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_link_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE reviewed jsonb; saved_form jsonb; saved_hash text; cutoff timestamptz;
BEGIN
 SELECT reviewed_context,form,context_hash INTO STRICT reviewed,saved_form,saved_hash FROM honors_version WHERE tenant_id=NEW.tenant_id AND student_id=NEW.student_id AND version=NEW.honors_version;
 cutoff:=least(NEW.issued_at+interval '2160 hours',((reviewed->>'ceremonyDate')::date+7)::timestamp AT TIME ZONE 'America/Chicago');
 IF NEW.context_hash<>saved_hash OR NEW.issued_at>clock_timestamp() OR NEW.expires_at<>cutoff
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(saved_form->'aliyot') a WHERE a->>'startVerse'=NEW.start_verse AND jsonb_array_length(a->'participants')>0)
  OR NOT EXISTS(SELECT 1 FROM honoree_reading_epoch WHERE tenant_id=NEW.tenant_id AND student_id=NEW.student_id AND epoch=NEW.reading_epoch)
  OR NOT EXISTS(SELECT 1 FROM honoree_group_epoch WHERE tenant_id=NEW.tenant_id AND student_id=NEW.student_id AND start_verse=NEW.start_verse AND epoch=NEW.group_epoch)
 THEN RAISE EXCEPTION 'Honoree unavailable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_link_insert_guard BEFORE INSERT ON honoree_link FOR EACH ROW EXECUTE FUNCTION portal_honoree_link_insert_guard();
--> statement-breakpoint
CREATE TRIGGER honoree_operation_guard BEFORE UPDATE OR DELETE ON honoree_operation FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit();
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_material_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM service_catalog_lifecycle WHERE tenant_id=NEW.tenant_id AND catalog_id=NEW.catalog_id AND state<>'withdrawn' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material unavailable'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW=OLD THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.state='active' AND NEW.state='withdrawn' AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Immutable honoree material';
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_material_guard BEFORE INSERT OR UPDATE OR DELETE ON honoree_material_release FOR EACH ROW EXECUTE FUNCTION portal_honoree_material_guard();
--> statement-breakpoint
CREATE FUNCTION public.portal_honoree_catalog_withdraw() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.state='withdrawn' THEN UPDATE honoree_material_release SET state='withdrawn' WHERE tenant_id=NEW.tenant_id AND catalog_id=NEW.catalog_id AND state='active'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER honoree_catalog_withdraw AFTER UPDATE ON service_catalog_lifecycle FOR EACH ROW EXECUTE FUNCTION portal_honoree_catalog_withdraw();
--> statement-breakpoint
REVOKE ALL ON FUNCTION portal_honoree_notices_valid(jsonb),portal_honoree_epoch_guard(),portal_honoree_student_epoch(),portal_honoree_assignment_epoch(),portal_honoree_verse_epoch(),portal_honoree_group_epoch(),portal_honoree_link_guard(),portal_honoree_link_insert_guard(),portal_honoree_material_guard(),portal_honoree_catalog_withdraw() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION portal_honoree_notices_valid(jsonb),portal_honoree_epoch_guard(),portal_honoree_student_epoch(),portal_honoree_assignment_epoch(),portal_honoree_verse_epoch(),portal_honoree_group_epoch(),portal_honoree_link_guard(),portal_honoree_link_insert_guard(),portal_honoree_material_guard(),portal_honoree_catalog_withdraw() TO portal_runtime;
