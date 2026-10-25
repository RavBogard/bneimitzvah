-- Release 1.9 N12 (REPORT G3): the optional "Before next time" line on a lesson note, at most 1024 bytes of plain text.
-- It lives on lesson_log itself, so it has exactly the note's readers: the same forced tenant_isolation policy and the same
-- table SELECT grant, with no new policy and no new table. The runtime may also UPDATE the new column (as it may summary);
-- a deleted note's tombstone holds no before_next, as it holds no summary.
ALTER TABLE "lesson_log" ADD COLUMN "before_next" text;--> statement-breakpoint
ALTER TABLE "lesson_log" ADD CONSTRAINT "lesson_log_before_next" CHECK (("lesson_log"."deleted" and "lesson_log"."before_next" is null) or (not "lesson_log"."deleted" and ("lesson_log"."before_next" is null or (length(trim("lesson_log"."before_next")) > 0 and octet_length("lesson_log"."before_next") <= 1024))));
--> statement-breakpoint
GRANT UPDATE (before_next) ON lesson_log TO portal_runtime;
