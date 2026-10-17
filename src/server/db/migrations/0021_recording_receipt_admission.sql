CREATE TABLE "recording_admission" (
	"tenant_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"original_recording_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"store_generation" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"auth_session_id" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"membership_authority_revision" integer NOT NULL,
	"role_grant_id" uuid NOT NULL,
	"role_grant_revision" integer NOT NULL,
	"mode" text NOT NULL,
	"relationship_id" uuid NOT NULL,
	"relationship_revision" integer,
	"context_id" uuid,
	"context_authority_revision" integer,
	"context_student_revision" integer,
	"student_revision" integer NOT NULL,
	"session_expires_at" timestamp with time zone NOT NULL,
	"context_expires_at" timestamp with time zone,
	"declared_bytes" integer NOT NULL,
	"slot_count" integer NOT NULL,
	"admitted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"state" text NOT NULL,
	"revision" bigint NOT NULL,
	"retiring_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"terminal_reason" text,
	"retention_ceremony_date" date NOT NULL,
	"retention_latched_at" timestamp with time zone,
	"logical_take_released" boolean DEFAULT false NOT NULL,
	CONSTRAINT "recording_receipt_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "recording_receipt_request_key" UNIQUE("tenant_id","student_id","request_id"),
	CONSTRAINT "recording_receipt_original_key" UNIQUE("original_recording_id"),
	CONSTRAINT "recording_receipt_asset_key" UNIQUE("asset_id"),
	CONSTRAINT "recording_receipt_text" CHECK (length(store_generation) BETWEEN 1 AND 64 AND store_generation !~ '[[:cntrl:]]' AND length(actor_user_id) BETWEEN 1 AND 256 AND actor_user_id !~ '[[:cntrl:]]' AND length(auth_session_id) BETWEEN 1 AND 256 AND auth_session_id !~ '[[:cntrl:]]'),
	CONSTRAINT "recording_receipt_declaration" CHECK (declared_bytes BETWEEN 46 AND 28800044 AND declared_bytes % 2 = 0 AND slot_count BETWEEN 1 AND 28 AND slot_count = (declared_bytes + 1048575) / 1048576),
	CONSTRAINT "recording_receipt_revisions" CHECK (revision > 0 AND membership_authority_revision > 0 AND role_grant_revision > 0 AND student_revision > 0 AND (relationship_revision IS NULL OR relationship_revision > 0) AND (context_authority_revision IS NULL OR context_authority_revision > 0) AND (context_student_revision IS NULL OR context_student_revision > 0)),
	CONSTRAINT "recording_receipt_binding" CHECK ((mode = 'student' AND relationship_revision IS NULL AND context_id IS NULL AND context_authority_revision IS NULL AND context_student_revision IS NULL AND context_expires_at IS NULL) OR (mode = 'child-practice' AND relationship_revision IS NOT NULL AND context_id IS NOT NULL AND context_authority_revision IS NOT NULL AND context_student_revision IS NOT NULL AND context_student_revision = student_revision AND context_expires_at IS NOT NULL)),
	CONSTRAINT "recording_receipt_instants" CHECK (isfinite(admitted_at) AND isfinite(session_expires_at) AND session_expires_at > admitted_at AND (context_expires_at IS NULL OR (isfinite(context_expires_at) AND context_expires_at > admitted_at AND context_expires_at <= session_expires_at)) AND (retiring_at IS NULL OR (isfinite(retiring_at) AND retiring_at >= admitted_at)) AND (terminal_at IS NULL OR (isfinite(terminal_at) AND retiring_at IS NOT NULL AND terminal_at >= retiring_at)) AND (retention_latched_at IS NULL OR (isfinite(retention_latched_at) AND retention_latched_at >= admitted_at)) AND isfinite(retention_ceremony_date)),
	CONSTRAINT "recording_receipt_lifecycle" CHECK ((state = 'receiving' AND retiring_at IS NULL AND terminal_at IS NULL AND terminal_reason IS NULL AND retention_latched_at IS NULL AND NOT logical_take_released) OR (state = 'retiring' AND retiring_at IS NOT NULL AND terminal_at IS NULL AND terminal_reason IS NULL AND NOT logical_take_released) OR (state = 'terminal' AND retiring_at IS NOT NULL AND terminal_at IS NOT NULL AND terminal_reason IS NOT NULL AND terminal_reason = 'never-opened' AND logical_take_released))
);
--> statement-breakpoint
CREATE TABLE "recording_receipt_slot" (
	"tenant_id" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"slot_index" integer NOT NULL,
	"object_key" text NOT NULL,
	"expected_bytes" integer NOT NULL,
	"revision" bigint NOT NULL,
	"state" text NOT NULL,
	"ever_upload_opened" boolean DEFAULT false NOT NULL,
	"audio_liability_released" boolean DEFAULT false NOT NULL,
	"body_sha256" text,
	"permit_etag" text,
	"open_operation_id" uuid,
	"opened_at" timestamp with time zone,
	CONSTRAINT "recording_receipt_slot_pk" PRIMARY KEY("tenant_id","receipt_id","slot_index"),
	CONSTRAINT "recording_receipt_slot_object_key" UNIQUE("object_key"),
	CONSTRAINT "recording_receipt_slot_operation_key" UNIQUE("open_operation_id"),
	CONSTRAINT "recording_receipt_slot_length" CHECK (slot_index BETWEEN 0 AND 27 AND expected_bytes BETWEEN 2 AND 1048576 AND expected_bytes % 2 = 0 AND revision > 0),
	CONSTRAINT "recording_receipt_slot_preparation" CHECK ((body_sha256 IS NULL AND permit_etag IS NULL) OR (body_sha256 IS NOT NULL AND body_sha256 ~ '^[a-f0-9]{64}$' AND permit_etag IS NOT NULL AND length(permit_etag) BETWEEN 3 AND 256 AND permit_etag ~ '^"[!-!#-~]+"$')),
	CONSTRAINT "recording_receipt_slot_opening" CHECK ((NOT ever_upload_opened AND open_operation_id IS NULL AND opened_at IS NULL) OR (ever_upload_opened AND body_sha256 IS NOT NULL AND permit_etag IS NOT NULL AND open_operation_id IS NOT NULL AND opened_at IS NOT NULL AND isfinite(opened_at))),
	CONSTRAINT "recording_receipt_slot_lifecycle" CHECK ((state = 'reserved' AND body_sha256 IS NULL AND NOT ever_upload_opened AND NOT audio_liability_released) OR (state = 'prepared' AND body_sha256 IS NOT NULL AND NOT ever_upload_opened AND NOT audio_liability_released) OR (state = 'opened' AND ever_upload_opened AND NOT audio_liability_released) OR (state = 'retiring' AND NOT audio_liability_released) OR (state = 'never-opened' AND NOT ever_upload_opened AND audio_liability_released))
);
--> statement-breakpoint
ALTER TABLE "recording_admission" ADD CONSTRAINT "recording_admission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_receipt" ADD CONSTRAINT "recording_receipt_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_receipt" ADD CONSTRAINT "recording_receipt_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_receipt_slot" ADD CONSTRAINT "recording_receipt_slot_head_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."recording_receipt"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_receipt_student_idx" ON "recording_receipt" USING btree ("tenant_id","student_id","admitted_at");--> statement-breakpoint
CREATE INDEX "recording_receipt_actor_idx" ON "recording_receipt" USING btree ("tenant_id","actor_user_id","admitted_at");
--> statement-breakpoint
-- No production cleanup role, sender, lease, provider operation or quota API.
CREATE FUNCTION portal_recording_receipt_no_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Recording receipt identity is permanent' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_recording_admission BEFORE UPDATE ON recording_admission FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('tenant_id');
--> statement-breakpoint
CREATE TRIGGER permanent_recording_admission BEFORE DELETE ON recording_admission FOR EACH ROW EXECUTE FUNCTION portal_recording_receipt_no_delete();
--> statement-breakpoint
CREATE TRIGGER immutable_recording_receipt BEFORE UPDATE ON recording_receipt FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('id','tenant_id','student_id','request_id','original_recording_id','asset_id','store_generation','actor_user_id','auth_session_id','membership_id','membership_authority_revision','role_grant_id','role_grant_revision','mode','relationship_id','relationship_revision','context_id','context_authority_revision','context_student_revision','student_revision','session_expires_at','context_expires_at','declared_bytes','slot_count','admitted_at');
--> statement-breakpoint
CREATE TRIGGER permanent_recording_receipt BEFORE DELETE ON recording_receipt FOR EACH ROW EXECUTE FUNCTION portal_recording_receipt_no_delete();
--> statement-breakpoint
CREATE TRIGGER immutable_recording_receipt_slot BEFORE UPDATE ON recording_receipt_slot FOR EACH ROW
  EXECUTE FUNCTION portal_immutable_columns('tenant_id','receipt_id','slot_index','object_key','expected_bytes');
--> statement-breakpoint
CREATE TRIGGER permanent_recording_receipt_slot BEFORE DELETE ON recording_receipt_slot FOR EACH ROW EXECUTE FUNCTION portal_recording_receipt_no_delete();
--> statement-breakpoint
CREATE FUNCTION portal_recording_receipt_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE actual_now timestamptz; due boolean;
BEGIN
  actual_now := clock_timestamp();
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'receiving' OR NEW.revision <> 1 OR NEW.retiring_at IS NOT NULL
        OR NEW.terminal_at IS NOT NULL OR NEW.terminal_reason IS NOT NULL
        OR NEW.retention_latched_at IS NOT NULL OR NEW.logical_take_released IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Initial receiving receipt required' USING ERRCODE = '23514';
    END IF;
    due := public.portal_practice_anniversary_due(NEW.retention_ceremony_date, actual_now);
  ELSE
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    IF NEW.revision <> OLD.revision + 1 OR NEW.revision IS NULL THEN
      RAISE EXCEPTION 'Consecutive receipt revision required' USING ERRCODE = '23514';
    END IF;
    due := public.portal_practice_anniversary_due(OLD.retention_ceremony_date, actual_now)
      OR public.portal_practice_anniversary_due(NEW.retention_ceremony_date, actual_now);
    IF OLD.retention_latched_at IS NOT NULL AND NEW.retention_latched_at IS DISTINCT FROM OLD.retention_latched_at
        OR OLD.retention_latched_at IS NULL AND NEW.retention_latched_at IS NOT NULL AND NOT due THEN
      RAISE EXCEPTION 'Irreversible due latch required' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = OLD.state THEN
      IF (NEW.retention_ceremony_date,NEW.retention_latched_at) IS NOT DISTINCT FROM (OLD.retention_ceremony_date,OLD.retention_latched_at)
          OR (NEW.retiring_at,NEW.terminal_at,NEW.terminal_reason,NEW.logical_take_released)
            IS DISTINCT FROM (OLD.retiring_at,OLD.terminal_at,OLD.terminal_reason,OLD.logical_take_released) THEN
        RAISE EXCEPTION 'Date-only same-state receipt projection required' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.state = 'receiving' AND NEW.state = 'retiring' THEN
      IF NEW.retiring_at IS NULL OR NEW.terminal_at IS NOT NULL OR NEW.terminal_reason IS NOT NULL
          OR NEW.logical_take_released IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Unreleased receipt retirement required' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.state = 'retiring' AND NEW.state = 'terminal' THEN
      IF NEW.retiring_at IS DISTINCT FROM OLD.retiring_at
          OR NEW.retention_ceremony_date IS DISTINCT FROM OLD.retention_ceremony_date
          OR NEW.retention_latched_at IS DISTINCT FROM OLD.retention_latched_at
          OR NEW.terminal_at IS NULL OR NEW.terminal_reason IS DISTINCT FROM 'never-opened'
          OR NEW.logical_take_released IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Complete never-opened receipt closure required' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Forward receipt transition required' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF due AND NEW.retention_latched_at IS NULL AND NEW.state <> 'receiving' THEN
    RAISE EXCEPTION 'Due receipt latch required' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'receiving' AND due THEN
    RAISE EXCEPTION 'Due receipt cannot receive' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recording_receipt_transition BEFORE INSERT OR UPDATE ON recording_receipt FOR EACH ROW EXECUTE FUNCTION portal_recording_receipt_transition();
--> statement-breakpoint
CREATE FUNCTION portal_recording_receipt_slot_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE head public.recording_receipt%ROWTYPE;
BEGIN
  SELECT * INTO head FROM public.recording_receipt WHERE tenant_id=NEW.tenant_id AND id=NEW.receipt_id;
  IF NOT FOUND OR NEW.slot_index < 0 OR NEW.slot_index >= head.slot_count
      OR NEW.expected_bytes IS DISTINCT FROM least(1048576,head.declared_bytes-NEW.slot_index*1048576)
      OR NEW.object_key IS DISTINCT FROM 'recordings/v1/'||head.asset_id::text||'/chunk-'||lpad(NEW.slot_index::text,2,'0')
      OR NEW.opened_at IS NOT NULL AND NEW.opened_at < head.admitted_at THEN
    RAISE EXCEPTION 'Exact receipt slot identity required' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'reserved' OR NEW.revision <> 1 OR NEW.ever_upload_opened IS DISTINCT FROM false
        OR NEW.audio_liability_released IS DISTINCT FROM false OR NEW.body_sha256 IS NOT NULL OR NEW.permit_etag IS NOT NULL
        OR NEW.open_operation_id IS NOT NULL OR NEW.opened_at IS NOT NULL THEN
      RAISE EXCEPTION 'Initial reserved slot required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.revision IS NULL OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Consecutive slot revision required' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'reserved' AND NEW.state = 'prepared' THEN
    IF NEW.body_sha256 IS NULL OR NEW.permit_etag IS NULL
        OR (NEW.ever_upload_opened,NEW.audio_liability_released,NEW.open_operation_id,NEW.opened_at)
          IS DISTINCT FROM (OLD.ever_upload_opened,OLD.audio_liability_released,OLD.open_operation_id,OLD.opened_at) THEN
      RAISE EXCEPTION 'Write-once slot preparation required' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.state = 'prepared' AND NEW.state = 'opened' THEN
    IF NEW.ever_upload_opened IS DISTINCT FROM true OR NEW.open_operation_id IS NULL OR NEW.opened_at IS NULL
        OR NEW.audio_liability_released IS DISTINCT FROM false
        OR (NEW.body_sha256,NEW.permit_etag) IS DISTINCT FROM (OLD.body_sha256,OLD.permit_etag) THEN
      RAISE EXCEPTION 'Monotone slot opening required' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.state IN ('reserved','prepared','opened') AND NEW.state = 'retiring' THEN
    IF (NEW.body_sha256,NEW.permit_etag,NEW.ever_upload_opened,NEW.open_operation_id,NEW.opened_at,NEW.audio_liability_released)
        IS DISTINCT FROM (OLD.body_sha256,OLD.permit_etag,OLD.ever_upload_opened,OLD.open_operation_id,OLD.opened_at,OLD.audio_liability_released) THEN
      RAISE EXCEPTION 'Unreleased immutable slot retirement required' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.state = 'retiring' AND NEW.state = 'never-opened' THEN
    IF OLD.ever_upload_opened IS DISTINCT FROM false OR NEW.ever_upload_opened IS DISTINCT FROM false
        OR NEW.audio_liability_released IS DISTINCT FROM true
        OR (NEW.body_sha256,NEW.permit_etag,NEW.open_operation_id,NEW.opened_at)
          IS DISTINCT FROM (OLD.body_sha256,OLD.permit_etag,OLD.open_operation_id,OLD.opened_at) THEN
      RAISE EXCEPTION 'Proven never-opened slot closure required' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forward slot transition required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recording_receipt_slot_transition BEFORE INSERT OR UPDATE ON recording_receipt_slot FOR EACH ROW EXECUTE FUNCTION portal_recording_receipt_slot_transition();
--> statement-breakpoint
-- Deferred FINAL-state validation permits atomic head-then-slots insertion and
-- closure, but never a zero-slot/vacuous-ALL or partially released commit.
CREATE FUNCTION portal_recording_receipt_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE head public.recording_receipt%ROWTYPE; head_id uuid; head_tenant text; n bigint; total bigint; valid boolean;
BEGIN
  IF TG_TABLE_NAME = 'recording_receipt' THEN head_id:=NEW.id; head_tenant:=NEW.tenant_id;
  ELSIF TG_OP = 'DELETE' THEN head_id:=OLD.receipt_id; head_tenant:=OLD.tenant_id;
  ELSE head_id:=NEW.receipt_id; head_tenant:=NEW.tenant_id; END IF;
  SELECT * INTO head FROM public.recording_receipt WHERE tenant_id=head_tenant AND id=head_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt head required' USING ERRCODE = '23514'; END IF;
  SELECT count(*),sum(expected_bytes),bool_and(
      slot_index BETWEEN 0 AND head.slot_count-1
      AND expected_bytes=least(1048576,head.declared_bytes-slot_index*1048576)
      AND object_key='recordings/v1/'||head.asset_id::text||'/chunk-'||lpad(slot_index::text,2,'0')
      AND CASE head.state
        WHEN 'receiving' THEN state IN ('reserved','prepared','opened') AND NOT audio_liability_released
        WHEN 'retiring' THEN state='retiring' AND NOT audio_liability_released
        WHEN 'terminal' THEN state='never-opened' AND NOT ever_upload_opened AND audio_liability_released
        ELSE false END)
    INTO n,total,valid FROM public.recording_receipt_slot WHERE tenant_id=head_tenant AND receipt_id=head_id;
  IF n IS DISTINCT FROM head.slot_count::bigint OR total IS DISTINCT FROM head.declared_bytes::bigint OR valid IS DISTINCT FROM true
      OR head.logical_take_released IS DISTINCT FROM (head.state='terminal') THEN
    RAISE EXCEPTION 'Complete consistent receipt slots required' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recording_receipt_complete AFTER INSERT OR UPDATE ON recording_receipt
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal_recording_receipt_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recording_receipt_slot_complete AFTER INSERT OR UPDATE OR DELETE ON recording_receipt_slot
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal_recording_receipt_complete();
--> statement-breakpoint
CREATE FUNCTION portal_recording_receipt_ceremony_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE head public.recording_receipt%ROWTYPE; actual_now timestamptz; due boolean;
BEGIN
  -- This trigger is ordered AFTER recording_ceremony_retention: the existing
  -- student -> ALL0020 ledger locks precede every receipt/slot lock. No mutex.
  FOR head IN SELECT * FROM public.recording_receipt WHERE tenant_id=OLD.tenant_id AND student_id=OLD.id ORDER BY id FOR UPDATE LOOP
    actual_now:=clock_timestamp();
    due:=public.portal_practice_anniversary_due(OLD.ceremony_date,actual_now)
      OR public.portal_practice_anniversary_due(NEW.ceremony_date,actual_now);
    UPDATE public.recording_receipt SET retention_ceremony_date=NEW.ceremony_date,
      retention_latched_at=CASE WHEN due THEN coalesce(retention_latched_at,greatest(actual_now,admitted_at)) ELSE retention_latched_at END,
      state=CASE WHEN due AND state='receiving' THEN 'retiring' ELSE state END,
      retiring_at=CASE WHEN due AND state='receiving' THEN greatest(actual_now,admitted_at) ELSE retiring_at END,
      revision=revision+1
      WHERE tenant_id=head.tenant_id AND id=head.id;
    IF due AND head.state='receiving' THEN
      UPDATE public.recording_receipt_slot SET state='retiring',revision=revision+1
        WHERE tenant_id=head.tenant_id AND receipt_id=head.id AND state IN ('reserved','prepared','opened');
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recording_manifest_ceremony_retention BEFORE UPDATE OF ceremony_date ON student
  FOR EACH ROW WHEN (OLD.ceremony_date IS DISTINCT FROM NEW.ceremony_date)
  EXECUTE FUNCTION portal_recording_receipt_ceremony_change();
--> statement-breakpoint
ALTER TABLE recording_admission ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recording_admission FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recording_receipt ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recording_receipt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recording_receipt_slot ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recording_receipt_slot FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON recording_admission,recording_receipt,recording_receipt_slot FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON recording_admission,recording_receipt,recording_receipt_slot FROM portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON recording_admission TO portal_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON recording_receipt TO portal_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON recording_receipt_slot TO portal_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
--> statement-breakpoint
GRANT SELECT,INSERT ON recording_admission,recording_receipt,recording_receipt_slot TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE(tenant_id) ON recording_admission TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE(state,revision,retiring_at,retention_ceremony_date,retention_latched_at) ON recording_receipt TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE(state,revision,body_sha256,permit_etag,ever_upload_opened,open_operation_id,opened_at) ON recording_receipt_slot TO portal_runtime;
