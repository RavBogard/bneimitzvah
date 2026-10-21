# Congregation settings and minimal onboarding (2026-10-21)

MISSION rulings 9 and 21/52; PLAN-REVIEW §3.1 tenant additions and §3.12. Branch `claude/settings`.

## Decided here

- **Storage.** New append-only, RLS-forced `tenant_settings` (migration `0029_congregation_settings`, journal idx 29; the integrator renumbers beside the parallel 0028). Runtime role: SELECT and INSERT only; an immutable trigger refuses UPDATE/DELETE even for the owner. Body is a closed set of optional fields checked by `portal_tenant_settings_valid` in SQL and `validateSettings` in TypeScript; the service is never looser than the database. `tenant.customs` is not migrated or rewritten; readers take the head settings version first and fall back to the legacy customs keys.
- **Authority.** Writes use the existing admin capability `manage-defaults` (admin grant, admin mode, cookie mutation). The study-source spec says ordinary admin may be insufficient for rabbi-only defaults; in this product the admin grant is the rabbi/clergy (study spec S21), so no separate clergy capability was invented. A read-only `read-defaults` admin capability backs the page. Audit action `tenant-settings.set`.
- **Onboarding row.** The owner script writes an actorless `channel='operator'` row, allowed only as the empty first version; every other row needs the admin actor receipt. CRC has no settings row until an admin first saves (version 0 = none).
- **Wired readers.** Rabbi name (study guides), preferred works first in source discovery (display order only; the catalog hash is unchanged so source assignment re-checks still match), siddur link and an optional music link on the reading page's service panel. Service slot labels/times, roster sheet ID and consent notice are stored only; the page says so.
- **Defaults.** Siddur link falls back to `https://siddur.centralreform.org/` (today's link). There was no CRC Music link in the UI, so a blank music link shows nothing. The "Open in Siddur" deep links in My service stay on the CRC siddur: their parameters come from the CRC siddur feed.
- **Onboarding script.** `scripts/add-congregation.mjs` needs `OWNER_DATABASE_URL`, refuses any connection that does not own `tenant`/`tenant_host`/`tenant_settings` (the runtime role cannot insert there), is a dry run unless `--apply`, writes `customs = {"calendar":{"diaspora":true|false}}` so reading preparation works, and prints counts and ids only.

- **Adversarial pass (second agent), fixed here:** lone UTF-16 surrogates are now refused by the validator (jsonb would have rejected them as a 503); the runtime policy's WITH CHECK also requires `channel='web'`, so only the owner can write the actorless first version; the links read refuses a practice-context header instead of ignoring it.
- **Migration ordering, for the integrator:** drizzle applies a migration only if its journal `when` is later than the last applied one, and the release scripts expect contiguous idx. Renumber this migration after the parallel 0028 with a later `when` (and regenerate its snapshot's `prevId`) before any deploy; the 0029 migration test compares against whichever entry precedes it.
- **Known limit:** changing preferred works while a student pages through sources can shift later pages (the catalog hash deliberately stays the public-catalog hash).

## Open for Daniel

- Provisioning a real second congregation is your gate. It also needs a deployment origin of its own: the runtime serves exactly one configured origin today. The first admin is then invited through the existing invitation flow.
- The settings page copy and the reading-page "Service music" link label are new student/admin-visible text.
- The siddur link label still reads "CRC digital siddur collection" for every congregation.
