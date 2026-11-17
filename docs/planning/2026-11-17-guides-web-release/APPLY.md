# Migration 0058: release and hold study guides on the web Guides page

Daniel decided on 2026-11-17 that he wants to release and hold study guides on the web Guides page, and that he applies the production migration this needs himself. This page is for that apply.

## What it does

Migration `0058_guide_web_release` adds one nullable column to `study_guide`, `copy_of_version`, so that a row written from the web Guides page can record the rabbi releasing a held version or holding a released one, as an exact copy of the version just before it. A new trigger (`study_guide_copy`, function `portal_study_guide_copy`) refuses any such web row whose text, origin, review state or import credit differs from that version, or that neither releases nor holds it; the web still cannot write guide text, and an import works as before.

The statements, in one transaction: drop the check `study_guide_web_import`; drop and re-create the index `study_guide_import_once` so it covers imports only (`... and copy_of_version is null`); add the column; add the checks `study_guide_web_channel` (a web row is an import, as before, or a copy) and `study_guide_copy` (a copy is web only and names the version just before it); create the trigger function, the trigger, and revoke the function from PUBLIC. No grant changes: `portal_runtime` already has SELECT and INSERT on the whole table. RLS stays forced. No existing row changes.

## Why it is safe to apply before the deploy

- It is additive. The code running in production never names `copy_of_version`, so every row it writes has the column null.
- Every row the running code can write passes the new checks exactly as it passed the old one. With the column null, `study_guide_web_channel` is word for word the old `study_guide_web_import`, `study_guide_copy` holds trivially, and the trigger does not fire (it runs only `WHEN (NEW.copy_of_version IS NOT NULL)`).
- The import index keeps refusing a second import of the same content: imports are still web rows with the column null.
- Every existing row already satisfies the new checks (the old check was stricter), so adding them cannot fail on production data.
- Reads in the running code ignore the column. Until the new code deploys, nothing writes a copy row, so readers see exactly what they see now.
- The table is small; the index rebuild and constraint checks take moments inside one transaction. If any statement fails, nothing is applied.

## Check, apply, verify

Use the owner connection in `.env.operator`, as `DEPLOYING.md` section 3.2 describes, and delete that file after use. Never paste the connection string anywhere.

### 1. Check (Neon SQL editor, as the owner, before applying)

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;
-- expect 57

SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;
-- expect hash 4ee5ed9a5e129192b1bb114ed27a1b8b8ebbef294c06d1170781cf71d689b69f
--        created_at 1793503412937   (0057_music_card_details)

SELECT count(*) FROM study_guide;
-- note this number for step 3

SELECT column_name FROM information_schema.columns WHERE table_name = 'study_guide' AND column_name = 'copy_of_version';
-- expect no rows
```

If the count is not 57 or the last hash differs, stop: production is not where this migration expects it.

### 2. Apply (from a checkout of the commit that adds 0058)

```
node --env-file=.env.operator scripts/db-migrate.mjs
```

Expected output: `Database migrations completed`. Any failure prints one fixed sentence and no detail (`Database migration failed; verify private configuration and database permissions`), and the transaction leaves the database as it was. Running it again is safe and prints the same line.

### 3. Verify (Neon SQL editor, as the owner)

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;
-- expect 58

SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;
-- expect hash 5e4650ea6bc0772e1a6a54dc83b219df55310512e8d26e0ba6f357861c1d8e8b
--        created_at 1794892911813   (0058_guide_web_release)

SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'study_guide';
-- expect true, true

SELECT policyname FROM pg_policies WHERE tablename = 'study_guide';
-- expect one row: tenant_isolation

SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'study_guide' AND grantee <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'study_guide')
 ORDER BY 1, 2;
-- expect exactly: portal_runtime INSERT, portal_runtime SELECT (no PUBLIC)

SELECT conname FROM pg_constraint WHERE conrelid = 'study_guide'::regclass AND conname IN ('study_guide_web_import','study_guide_web_channel','study_guide_copy') ORDER BY 1;
-- expect study_guide_copy, study_guide_web_channel (and no study_guide_web_import)

SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'study_guide'::regclass AND tgname = 'study_guide_copy';
-- expect one row: study_guide_copy, O

SELECT has_function_privilege('public', 'portal_study_guide_copy()', 'EXECUTE') AS public_can_execute;
-- expect false

SELECT count(*), count(copy_of_version) FROM study_guide;
-- expect the count from step 1, and 0
```

Then deploy the code as usual (CI green, fast-forward `main`). On the Guides page, a held draft shows Release and a released guide shows Hold.

## Rolling back

- **The code only** (the usual case): roll the Vercel deployment back. The migration can stay: the earlier code works with it, as above. Note that a guide held from the web while the new code ran would show to readers again under the earlier code, because the earlier code does not know a web hold takes a version away; release or re-save it through Claude if that matters.
- **The migration itself**, only after the code is rolled back, and only if no web copy has been written (`SELECT count(*) FROM study_guide WHERE copy_of_version IS NOT NULL` returns 0; otherwise the old check would refuse those rows and the rollback fails as a whole). As the owner, in one transaction:

```sql
BEGIN;
DROP TRIGGER study_guide_copy ON study_guide;
DROP FUNCTION portal_study_guide_copy();
ALTER TABLE study_guide DROP CONSTRAINT study_guide_copy;
ALTER TABLE study_guide DROP CONSTRAINT study_guide_web_channel;
DROP INDEX study_guide_import_once;
ALTER TABLE study_guide DROP COLUMN copy_of_version;
CREATE UNIQUE INDEX study_guide_import_once ON study_guide USING btree (tenant_id, kind, reading_key, import_key) WHERE channel = 'web';
ALTER TABLE study_guide ADD CONSTRAINT study_guide_web_import CHECK (channel <> 'web' or (version = 1 and hold and not reviewed and import_credit is not null and import_key is not null));
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '5e4650ea6bc0772e1a6a54dc83b219df55310512e8d26e0ba6f357861c1d8e8b';
COMMIT;
```

Afterwards the step 1 checks read as they did before the apply (57 rows, 0057's hash last). Do not run the migration again from a checkout that still has 0058 until the code that needs it is ready to deploy.
