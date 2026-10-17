ALTER TABLE "student" ADD COLUMN "hebrew_name" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "second_parent_email" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "import_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_hebrew_name_bounded" CHECK ("student"."hebrew_name" is null or (length(trim("student"."hebrew_name")) > 0 and octet_length("student"."hebrew_name") <= 400));--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_second_parent_bounded" CHECK ("student"."second_parent_email" is null or (length(trim("student"."second_parent_email")) > 0 and octet_length("student"."second_parent_email") <= 254));--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_import_metadata_closed" CHECK ("student"."import_metadata" is null or coalesce(
    jsonb_typeof("student"."import_metadata") = 'object' and "student"."import_metadata"->'version' = '1'::jsonb
    and "student"."import_metadata" ?& array['version','parent1Name','householdPhone','parent2Name','parashahLabel','tutorName','tutorMatch','adminNotes']
    and "student"."import_metadata" - array['version','parent1Name','householdPhone','parent2Name','parashahLabel','tutorName','tutorMatch','adminNotes']::text[] = '{}'::jsonb
    and ("student"."import_metadata"->'parent1Name' = 'null'::jsonb or (jsonb_typeof("student"."import_metadata"->'parent1Name') = 'string' and octet_length("student"."import_metadata"->>'parent1Name') <= 400))
    and ("student"."import_metadata"->'householdPhone' = 'null'::jsonb or (jsonb_typeof("student"."import_metadata"->'householdPhone') = 'string' and octet_length("student"."import_metadata"->>'householdPhone') <= 100))
    and ("student"."import_metadata"->'parent2Name' = 'null'::jsonb or (jsonb_typeof("student"."import_metadata"->'parent2Name') = 'string' and octet_length("student"."import_metadata"->>'parent2Name') <= 400))
    and ("student"."import_metadata"->'parashahLabel' = 'null'::jsonb or (jsonb_typeof("student"."import_metadata"->'parashahLabel') = 'string' and octet_length("student"."import_metadata"->>'parashahLabel') <= 400))
    and ("student"."import_metadata"->'tutorName' = 'null'::jsonb or (jsonb_typeof("student"."import_metadata"->'tutorName') = 'string' and octet_length("student"."import_metadata"->>'tutorName') <= 400))
    and ("student"."import_metadata"->'adminNotes' = 'null'::jsonb or (jsonb_typeof("student"."import_metadata"->'adminNotes') = 'string' and octet_length("student"."import_metadata"->>'adminNotes') <= 4096))
    and ("student"."import_metadata"->'tutorMatch' = 'null'::jsonb or (jsonb_typeof("student"."import_metadata"->'tutorMatch') = 'object' and (
      ("student"."import_metadata"->'tutorMatch'->>'status' = 'matched' and "student"."import_metadata"->'tutorMatch' ? 'grantId'
        and ("student"."import_metadata"->'tutorMatch') - array['status','grantId']::text[] = '{}'::jsonb
        and "student"."import_metadata"->'tutorMatch'->>'grantId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or ("student"."import_metadata"->'tutorMatch'->>'status' in ('unmatched','ambiguous') and ("student"."import_metadata"->'tutorMatch') - 'status' = '{}'::jsonb)
    ))), false));
