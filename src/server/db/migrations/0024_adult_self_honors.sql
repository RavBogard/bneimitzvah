ALTER TABLE "honors_version" ADD COLUMN "student_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_student_identity_fk" FOREIGN KEY ("tenant_id","student_identity_id","student_id","role_grant_id") REFERENCES "public"."student_identity"("tenant_id","id","student_id","role_grant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "honors_version" DROP CONSTRAINT "honors_version_author";
--> statement-breakpoint
ALTER TABLE "honors_version" ADD CONSTRAINT "honors_version_author" CHECK ("honors_version"."mode"::text="honors_version"."role"::text and (("honors_version"."mode"='parent' and "honors_version"."guardian_id" is not null and "honors_version"."student_identity_id" is null) or ("honors_version"."mode"='admin' and "honors_version"."guardian_id" is null and "honors_version"."student_identity_id" is null) or ("honors_version"."mode"='student' and "honors_version"."guardian_id" is null and "honors_version"."student_identity_id" is not null)));
--> statement-breakpoint
ALTER TABLE "honoree_link" ADD COLUMN "student_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_student_identity_fk" FOREIGN KEY ("tenant_id","student_identity_id","student_id","role_grant_id") REFERENCES "public"."student_identity"("tenant_id","id","student_id","role_grant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "honoree_link" DROP CONSTRAINT "honoree_link_shape";
--> statement-breakpoint
ALTER TABLE "honoree_link" ADD CONSTRAINT "honoree_link_shape" CHECK ("honoree_link"."id" ~ '^[A-Za-z0-9_-]{22}$' and "honoree_link"."context_hash" ~ '^[a-f0-9]{64}$' and "honoree_link"."token_hash" ~ '^[a-f0-9]{64}$' and "honoree_link"."key_id"='k1' and "honoree_link"."reading_epoch">=0 and "honoree_link"."group_epoch">=0 and "honoree_link"."honors_version">0 and (("honoree_link"."role"='parent' and "honoree_link"."guardian_id" is not null and "honoree_link"."student_identity_id" is null) or ("honoree_link"."role"='admin' and "honoree_link"."guardian_id" is null and "honoree_link"."student_identity_id" is null) or ("honoree_link"."role"='student' and "honoree_link"."guardian_id" is null and "honoree_link"."student_identity_id" is not null)));
--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD COLUMN "student_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_student_identity_fk" FOREIGN KEY ("tenant_id","student_identity_id","student_id","role_grant_id") REFERENCES "public"."student_identity"("tenant_id","id","student_id","role_grant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "honoree_operation" DROP CONSTRAINT "honoree_operation_shape";
--> statement-breakpoint
ALTER TABLE "honoree_operation" ADD CONSTRAINT "honoree_operation_shape" CHECK ("honoree_operation"."request_digest" ~ '^[a-f0-9]{64}$' and "honoree_operation"."operation" in ('issue','revoke','reissue') and (("honoree_operation"."role"='parent' and "honoree_operation"."guardian_id" is not null and "honoree_operation"."student_identity_id" is null) or ("honoree_operation"."role"='admin' and "honoree_operation"."guardian_id" is null and "honoree_operation"."student_identity_id" is null) or ("honoree_operation"."role"='student' and "honoree_operation"."guardian_id" is null and "honoree_operation"."student_identity_id" is not null)) and isfinite("honoree_operation"."created_at"));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.portal_honoree_student_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 -- Roster creation remains quiet: only reading mutations establish a counter.
 IF ROW(NEW.ceremony_date,NEW.service_slot,NEW.disabled_at,NEW.student_kind) IS DISTINCT FROM ROW(OLD.ceremony_date,OLD.service_slot,OLD.disabled_at,OLD.student_kind) THEN
  UPDATE honoree_reading_epoch SET epoch=epoch+1 WHERE tenant_id=NEW.tenant_id AND student_id=NEW.id;
 END IF; RETURN NEW;
END $$;
