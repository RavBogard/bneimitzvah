-- Release and hold on the web Guides page (Daniel 2026-11-17). The rabbi may release a held study guide, or hold a published one, from the
-- web as well as through Claude. Neither writes guide text: the web row is a copy of the version just before it (copy_of_version), and the
-- trigger below refuses any copy whose text, origin, review state or provenance differs from that version, or that neither releases nor holds it.
-- Authoring stays with Claude; an import is unchanged. Additive: one nullable column, the web-channel check widened only for copies, the import
-- index narrowed to imports, one trigger. Code already deployed never sets the column, so every row it writes is checked exactly as before.
ALTER TABLE "study_guide" DROP CONSTRAINT "study_guide_web_import";--> statement-breakpoint
DROP INDEX "study_guide_import_once";--> statement-breakpoint
ALTER TABLE "study_guide" ADD COLUMN "copy_of_version" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "study_guide_import_once" ON "study_guide" USING btree ("tenant_id","kind","reading_key","import_key") WHERE "study_guide"."channel" = 'web' and "study_guide"."copy_of_version" is null;--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_web_channel" CHECK ("study_guide"."channel" <> 'web' or "study_guide"."copy_of_version" is not null or ("study_guide"."version" = 1 and "study_guide"."hold" and not "study_guide"."reviewed" and "study_guide"."import_credit" is not null and "study_guide"."import_key" is not null));--> statement-breakpoint
ALTER TABLE "study_guide" ADD CONSTRAINT "study_guide_copy" CHECK ("study_guide"."copy_of_version" is null or ("study_guide"."channel" = 'web' and "study_guide"."previous_version" is not null and "study_guide"."copy_of_version" = "study_guide"."previous_version"));--> statement-breakpoint
-- A web copy repeats the version it names, exactly. jsonb compares by value, so the stored text is the same text. The table is named
-- with its schema and pg_temp is searched last, so a caller's temporary table called study_guide can never stand in for the real one.
CREATE FUNCTION portal_study_guide_copy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source record;
BEGIN
  SELECT g.body, g.origin, g.reviewed, g.hold, g.import_credit, g.import_key INTO source FROM public.study_guide g
    WHERE g.tenant_id = NEW.tenant_id AND g.kind = NEW.kind AND g.reading_key = NEW.reading_key AND g.version = NEW.copy_of_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A release or hold names a version of the same guide' USING ERRCODE = '23514';
  END IF;
  IF (NEW.body, NEW.origin, NEW.reviewed, NEW.import_credit, NEW.import_key)
     IS DISTINCT FROM (source.body, source.origin, source.reviewed, source.import_credit, source.import_key) THEN
    RAISE EXCEPTION 'A release or hold from the web repeats that version''s text and labels exactly; it never writes new text' USING ERRCODE = '23514';
  END IF;
  IF NEW.hold = source.hold THEN
    RAISE EXCEPTION 'A copy releases a held version or holds a released one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER study_guide_copy BEFORE INSERT ON study_guide FOR EACH ROW WHEN (NEW.copy_of_version IS NOT NULL) EXECUTE FUNCTION portal_study_guide_copy();
--> statement-breakpoint
REVOKE ALL ON FUNCTION portal_study_guide_copy() FROM PUBLIC;
