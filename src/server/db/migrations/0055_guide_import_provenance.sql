-- Guide sharing (Daniel 2026-10-30, plan ruling 11): a rabbi can import another congregation's reviewed guides. An imported guide
-- arrives held and unreviewed, written from the web by an admin (channel 'web', version one only), with the original author's
-- display name and a content key; a summary import keeps its author in portion_summary.import_credit. Additive: nullable columns, one channel value and one audit action.
ALTER TABLE "study_guide" DROP CONSTRAINT "study_guide_operator_draft";--> statement-breakpoint
ALTER TABLE "study_guide" DROP CONSTRAINT "study_guide_channel";--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_action_known";--> statement-breakpoint
ALTER TABLE "portion_summary" ADD COLUMN "import_credit" text;--> statement-breakpoint
ALTER TABLE "study_guide" ADD COLUMN "import_credit" text;--> statement-breakpoint
ALTER TABLE "study_guide" ADD COLUMN "import_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "study_guide_import_once" ON "study_guide" USING btree ("tenant_id","kind","reading_key","import_key") WHERE "study_guide"."channel" = 'web';--> statement-breakpoint
ALTER TABLE "portion_summary" ADD CONSTRAINT "portion_summary_import_credit" CHECK ("portion_summary"."import_credit" is null or (public.portal_source_plain("portion_summary"."import_credit", 240) and strpos("portion_summary"."import_credit", '@') = 0));--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_web_import" CHECK ("study_guide"."channel" <> 'web' or ("study_guide"."version" = 1 and "study_guide"."hold" and not "study_guide"."reviewed" and "study_guide"."import_credit" is not null and "study_guide"."import_key" is not null));--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_import_whole" CHECK (("study_guide"."import_credit" is null) = ("study_guide"."import_key" is null));--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_import_credit" CHECK ("study_guide"."import_credit" is null or (public.portal_source_plain("study_guide"."import_credit", 240) and strpos("study_guide"."import_credit", '@') = 0));--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_import_key" CHECK ("study_guide"."import_key" is null or "study_guide"."import_key" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_operator_draft" CHECK ("study_guide"."channel" in ('mcp','web') or ("study_guide"."origin" = 'claude' and not "study_guide"."reviewed"));--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_channel" CHECK ("study_guide"."channel" in ('mcp','operator','web'));--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_action_known" CHECK ("audit_event"."action" in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete','recording.create','recording.submit','recording.delete-request','source-assignment.set','honors.set','honoree.issue','honoree.revoke','honoree.reissue','study-voice.set','study-guide.set','study-guide.publish','study-guide.import','study-guide-student.set','study-theme.read','tenant-settings.set','notification-preference.set','notification.unsubscribe','mcp-connection.revoke','source-identity.revoke','account-request.approve','account-request.decline','member.revoke','approver.designate','approver.revoke','service-part.finish','ceremony-done.set','ceremony-done.reverse','invite.copy','learner.claim','learner.unclaim'));--> statement-breakpoint
-- Guide sharing: an imported summary keeps its original author. The runtime may read the column (insert is already granted whole);
-- the guard makes it immutable, and an approval of an imported revision carries exactly that credit instead of the congregation's.
GRANT SELECT (import_credit) ON portion_summary TO portal_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION portal_portion_summary_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Portion summaries are withdrawn, never deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_grant_id IS NOT NULL OR NEW.approved_role IS NOT NULL
       OR NEW.approved_at IS NOT NULL OR NEW.credit IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'A portion summary starts as a draft' USING ERRCODE = '23514';
    END IF;
    IF NEW.revision::bigint <> coalesce((SELECT max(p.revision) FROM portion_summary p WHERE p.tenant_id = NEW.tenant_id AND p.reading_key = NEW.reading_key), 0)::bigint + 1 THEN
      RAISE EXCEPTION 'Each draft is the next revision of its parashah' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM role_grant g JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id
      WHERE g.tenant_id = NEW.tenant_id AND g.membership_id = NEW.drafted_by AND g.role = 'admin' AND g.revoked_at IS NULL AND m.disabled_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the rabbi or an administrator, under a live admin grant, drafts' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.reading_key, NEW.revision, NEW.summary, NEW.outline, NEW.drafted_by, NEW.mutation_id, NEW.request_digest, NEW.created_at, NEW.import_credit)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.reading_key, OLD.revision, OLD.summary, OLD.outline, OLD.drafted_by, OLD.mutation_id, OLD.request_digest, OLD.created_at, OLD.import_credit) THEN
    RAISE EXCEPTION 'A portion summary''s words and identity never change; draft a new revision' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    IF NEW.approved_at IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'An approval is stamped when it is made' USING ERRCODE = '23514';
    END IF;
    IF NEW.credit IS DISTINCT FROM coalesce(OLD.import_credit, public.portal_portion_summary_credit(NEW.tenant_id)) THEN
      RAISE EXCEPTION 'An approval carries exactly the congregation''s credit, or the original author''s for an import' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM role_grant g JOIN membership m ON m.tenant_id = g.tenant_id AND m.id = g.membership_id
      WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.approved_grant_id AND g.membership_id = NEW.approved_by AND g.role = 'admin'
        AND g.revoked_at IS NULL AND m.disabled_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the rabbi or an administrator, under a live admin grant, approves' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status IN ('draft', 'approved') AND NEW.status = 'withdrawn' THEN
    IF (NEW.approved_by, NEW.approved_grant_id, NEW.approved_role, NEW.approved_at, NEW.credit)
       IS DISTINCT FROM (OLD.approved_by, OLD.approved_grant_id, OLD.approved_role, OLD.approved_at, OLD.credit) THEN
      RAISE EXCEPTION 'A withdrawal keeps the approval as it was' USING ERRCODE = '23514';
    END IF;
    IF NEW.withdrawn_at IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'A withdrawal is stamped when it is made' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'A portion summary moves draft to approved to withdrawn, and withdrawn is final' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
