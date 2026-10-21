# Congregation settings and minimal onboarding (2026-10-21)

MISSION rulings 9 and 21/52; PLAN-REVIEW §3.1 tenant additions and §3.12. Branch `claude/settings`.

## Decided here

- **Storage.** New append-only, RLS-forced `tenant_settings` (migration `0030_congregation_settings`, regenerated on 0029_rehearsal_dates' snapshot after merging main; hand-written SQL unchanged). Runtime role: SELECT and INSERT only; an immutable trigger refuses UPDATE/DELETE even for the owner. Body is a closed set of optional fields checked by `portal_tenant_settings_valid` in SQL and `validateSettings` in TypeScript; the service is never looser than the database. `tenant.customs` is not migrated or rewritten; readers take the head settings version first and fall back to the legacy customs keys.
- **Authority.** Writes use the existing admin capability `manage-defaults` (admin grant, admin mode, cookie mutation). The study-source spec says ordinary admin may be insufficient for rabbi-only defaults; in this product the admin grant is the rabbi/clergy (study spec S21), so no separate clergy capability was invented. A read-only `read-defaults` admin capability backs the page. Audit action `tenant-settings.set`.
- **Onboarding row.** The owner script writes an actorless `channel='operator'` row, allowed only as the empty first version; every other row needs the admin actor receipt. CRC has no settings row until an admin first saves (version 0 = none).
- **Wired readers.** Rabbi name (study guides), preferred works first in source discovery (display order only; the catalog hash is unchanged so source assignment re-checks still match), siddur link and an optional music link on the reading page's service panel. Service slot labels/times, roster sheet ID and consent notice are stored only; the page says so.
- **Defaults.** Siddur link falls back to `https://siddur.centralreform.org/` (today's link). There was no CRC Music link in the UI, so a blank music link shows nothing. The "Open in Siddur" deep links in My service stay on the CRC siddur: their parameters come from the CRC siddur feed.
- **Onboarding script.** `scripts/add-congregation.mjs` needs `OWNER_DATABASE_URL`, refuses any connection that does not own `tenant`/`tenant_host`/`tenant_settings` (the runtime role cannot insert there), is a dry run unless `--apply`, writes `customs = {"calendar":{"diaspora":true|false}}` so reading preparation works, and prints counts and ids only.

- **Adversarial pass (second agent), fixed here:** lone UTF-16 surrogates are now refused by the validator (jsonb would have rejected them as a 503); the runtime policy's WITH CHECK also requires `channel='web'`, so only the owner can write the actorless first version; the links read refuses a practice-context header instead of ignoring it.
- **Migration ordering:** renumbered to 0030 after main gained 0028_portal_mcp and 0029_rehearsal_dates; its journal `when` is later than both, idx contiguous, snapshot prevId = 0029's. The migration test compares with whichever entry precedes it; the rehearsal test now finds its entry by tag rather than assuming it is last.
- **Roster sheet ID vs GOOGLE_ROSTER_SHEET_ID:** main now configures CRC's roster sheet from the environment. The settings field is kept (stored only, never read) for a future congregation, and its help text says the CRC sheet is set by the operator. Dropping it later is a one-field change in the validator, SQL function and page.
- **Known limit:** changing preferred works while a student pages through sources can shift later pages (the catalog hash deliberately stays the public-catalog hash).

## Open for Daniel

- Provisioning a real second congregation is your gate. It also needs a deployment origin of its own: the runtime serves exactly one configured origin today. The first admin is then invited through the existing invitation flow.
- The settings page copy and the reading-page "Service music" link label are new student/admin-visible text.
- The siddur link label still reads "CRC digital siddur collection" for every congregation.
