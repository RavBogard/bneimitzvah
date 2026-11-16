# 05: Database schema, migrations and the MCP connector

Reviewed at commit `582aa56`. Read-only. Method: read `src/server/db/*`, `scripts/db-*.mjs`, `scripts/release-migrate*.mjs`, `src/server/mcp/*`, `src/server/http/*` route tables; grepped every table's Drizzle identifier and SQL name across `src/` and `scripts/` (tests excluded) for readers and writers. Where a claim was not verified it says so.

Numbers used below:

- 77 tables (72 declared with `pgTable("…")`, plus `session`, `account`, `verification`, and `translation_draft` / `tutor_note` from a factory in `student-work-schema.ts`).
- 57 migrations, 3,839 lines of SQL: 60 policies, 54 functions, 75 triggers.
- 369 `eq(x.tenantId, …)` filters in non-test `src/`; 153 composite foreign keys, almost all leading with `tenant_id`.
- MCP: 46 tools, 2,543 lines in `src/server/mcp/`, server instructions 6,993 characters (about 1,100 words).

Each schema suggestion is marked **code-only** or **production migration (irreversible, Daniel decides)**.

---

## Part A. Findings, ranked by payoff

### A1. The seven "release-migrate" operator families are dead code that still runs in CI

- **What:** `scripts/release-migrate*.mjs` (15 files, 1,544 lines), their tests `tests/release-*.test.mjs` and `tests/postgres/release-*` (1,737 lines), and seven fixtures `tests/fixtures/portal/release-*-reference.json` (3.7 MB).
- **Why dead:** each operator is pinned to one exact ledger transition and refuses any other.
  - `release-migrate.mjs` accepts only a ledger of 15 or 19 rows (`release-migrate-support.mjs:120`, `need([15, 19].includes(rows.length))`).
  - roster 19→20, recordings 20→21, source-assignments 21→22, honors 22→23, honoree 23→24, adult-honors 24→25 (`rows.length===N` in each `-support.mjs`).
  - Production is at ledger 56 (STATE.md line 12: "ledger 55→56"). None of these can succeed again.
- **What replaced them:** from 0026 on, STATE.md records a manual "check, apply, verify" with `scripts/db-migrate.mjs`. DEPLOYING.md:298 already tells forks they do not need the release scripts.
- **Cost today:** every CI job checks out with `fetch-depth: 0` because "Release tests verify the pinned historical migration ancestor" (`.github/workflows/ci.yml:28,48,108,150`). The tests subclass pinned `pg` 8.23.1 internals (`ReleaseClient` asserts `pgVersion === "8.23.1"`), so a `pg` upgrade breaks tests for scripts that can never run.
- **Do instead:** delete the 15 scripts, their tests and fixtures; drop `fetch-depth: 0`. Keep `db-migrate.mjs` and `tests/migration-journal.test.mjs`.
- **Saved:** about 3,300 lines and 3.7 MB of fixtures; a faster checkout in four CI jobs.
- **Type:** code-only. **Risk:** low. **Confidence:** high that they cannot run. Not verified: whether `tests/font-assets-policy.test.mjs:230` (a `.gitattributes` assertion naming `release-migrate*.mjs`) needs its line removed too.

### A2. Student recordings: the feature Daniel dropped is still fully built

- **What:** Daniel, 2026-10-22 (STATE.md:261): student recordings are dropped, "I don't think this is really a useful thing for us".
- **Still present:**
  - table `student_recording` (migration 0020 "student_recording_ledger", triggers `portal_student_recording_transition`, `portal_recording_ceremony_change`);
  - `src/server/recordings/` (8 files), `src/server/http/recordings.ts`, `src/server/data/recordings.ts`, `PORTAL_RECORDINGS_ENABLED` in `runtime/config.ts`;
  - together with the two release scripts, 836 lines of source; 28 test files mention it.
- **Verified:** no file under `src/components` or `src/app` calls `/api/students/…/recordings`. The service is composed only when the flag is true (`runtime/composition.ts:219`). Not verified: the flag's value in production.
- **Do instead:** remove the server module, route, flag and tests (**code-only**, about 600 lines of source plus tests). Dropping the empty table and its two triggers is a **production migration (Daniel decides)**; leaving the table costs nothing.
- **Risk:** low. **Confidence:** high.

### A3. `audit_event` is written from 23 places and read by nothing in the app

- **What:** 23 `insert(s.auditEvent)` call sites. No `select` from it anywhere in `src/` (grep for `from(s.auditEvent)` and `audit_event`: zero). The only readers are `scripts/bootstrap-owner.mjs` and `scripts/manage-admin.mjs`, which look for the one `owner-bootstrap` row.
- **Cost:** the allowed-action list is a CHECK constraint (`audit_action_known`) that 21 of the 57 migrations drop and re-create. Every new audited action needs a production migration.
- **For the gap analysis:** Daniel has no way, in the web app or through Claude, to see who changed a student, a tutor link or an invitation. The data exists; no screen or tool shows it.
- **Do instead (pick one):**
  1. Add one admin read (a "recent changes" list per student, or an MCP `get_change_history`). Small, and it turns a write-only ledger into a feature.
  2. Stop adding audit rows for low-stakes actions and replace the CHECK with a plain text column, so new actions stop needing migrations (**production migration, Daniel decides**; one-off).
- **Risk:** low. **Confidence:** high on "no reader".

### A4. Three identical "one JSON document per member" tables

- **What:** `course_progress` (0037), `service_course_progress` (0046) and `verse_review` (0047). The schema comments say each is "a copy of" the first. Each has its own table, its own forced `owner_only` policy on its own setting (`app.course_owner`, `app.service_course_owner`, `app.verse_review_owner`), its own access file, data file, service, validation and HTTP handler.
- **Size:** 786 lines of server code and 107 lines of SQL for the three. `data/service-course-progress.ts` differs from `data/course-progress.ts` by 24 lines after renaming.
- **Do instead:** one `member_document(tenant_id, membership_id, kind, version, body)` table with one owner policy and one access/data/HTTP module that takes `kind`. Validation per kind stays separate.
- **Saved:** about 450 lines, and no new table, policy and migration test the next time a course wants progress.
- **Type:** the code can be unified over the three existing tables first (**code-only**, about 300 lines saved). Merging the tables is a **production migration (Daniel decides)** that moves rows.
- **Risk:** medium (owner-only isolation is one of the protected four; the unified policy needs its adversarial pass). **Confidence:** high.

### A5. The MCP's "fresh sign-in" rule forces Daniel to disconnect and reconnect Claude

- **What:** `set_student_tutor` (adding) and `invite_tutor` work only within 15 minutes of the connection's creation (`setup-tools.ts:405,484`, `GOOGLE_CONSENT_WINDOW_MS`, compared with `mcp_connection.created_at`). After that the tool answers `fresh-sign-in-required` and the instructions tell Claude to ask the rabbi to reconnect the connector.
- **Why over-built:** the connection is already an OAuth consent by a Google-verified admin, re-locked against the grant revision on every call, with a 30-day maximum life. A 15-minute window measured from connection time means the ordinary case (Daniel asks Claude to assign a tutor on day 3) always fails.
- **Do instead:** drop the window for `set_student_tutor`; assigning a tutor Daniel already approved is ordinary roster work under his "proportion" ruling. Keep it for `invite_tutor` only if Daniel wants it (it sends email to a real person).
- **Type:** code-only. **Risk:** this touches auth, so it needs Daniel's yes and the adversarial pass. **Confidence:** high that it is disproportionate; whether to relax it is his call.
- **Related:** `TTL.connection` is 30 days (`oauth.ts:14`, and the `mcp_connection_lifetime` CHECK caps it at 31). Daniel re-approves the connector every month. Lengthening it needs a **production migration** for the CHECK.

### A6. Server instructions: 1,100 words sent to every connection, mostly irrelevant to a tutor

- **What:** `instructions.ts` is one 6,993-character string. A tutor's connection has 9 tools but receives the full text on Maven intake, student setup, discussions, portion summaries and page views.
- **Why it matters:** instructions are loaded into every conversation that has the connector, whether or not it is used. Much of it repeats what each tool's `description` already says (the Maven six steps, the setup six steps).
- **Do instead:** build instructions from the visible tool groups (`answerRpc` already computes `visible`). Keep about 150 words of standing rules (voice, citations, licensed English, `reviewed`, show before saving). Move the step lists into the first tool of each group.
- **Saved:** about 800 words per admin conversation, about 950 per tutor conversation. **Type:** code-only. **Risk:** low. **Confidence:** high.

### A7. MCP tools that should be one tool

| Tools | What to do | Evidence |
|---|---|---|
| `set_student_service`, `update_student` | One `update_student`. Both call the same `editStudent()` with a different field list. | `setup-tools.ts:432-436` |
| `get_student`, `get_student_setup` | One `get_student`; setup fields appear when the connection has the roster scope. | `tools.ts` and `setup-tools.ts:210` both read the student and `confirmedReadings` |
| `preview_student_reading`, `set_student_reading` | One tool with `dryRun: true`. Both call `prepared()` with the same arguments. | `setup-tools.ts:275-297` |
| `list_guide_work`, `list_guide_catalog` | One list with `scope: "assigned" \| "all"`. | `tools.ts` |
| `get_guide`, `get_student_guide`; `save_guide`, `save_student_guide` | Optional `studentId` on one get and one save. | `tools.ts` |
| `list_saved_readings`, `open_saved_reading` | One tool with optional `id`. | `saved-tools.ts` |
| `study_link`, `print_sheet_link` | One `reading_link` with `format: "study" \| "print"`. Each file has its own `choose()`; the calendar branch is about 20 near-identical lines in both. | `print-tools.ts:99-126`, `study-tools.ts:118-136` |
| `assign_sources`, `remove_source_assignment` | One `set_sources`; an empty list removes. | `setup-tools.ts:261-268` |

Result: 46 tools become about 37. **Type:** code-only. **Risk:** low-medium (a connected client holds the old tool list until it refreshes; keep old names as aliases for one release). **Confidence:** medium-high.

Also inside `src/server/mcp/`:

- Five copies of "withLive, check admin, `lockRabbi`, wrap `alive`": `rabbiAuthority` (`tools.ts`), `curatorAuthority` (`discussion-tools.ts:38`), `summaryAuthority` (`portion-summary-tools.ts:24`), `asAdmin` (`setup-tools.ts:74`), and inline twice in `roster-tools.ts:169,198`.
- `closed()`, `UUID_PATTERN` and the `mutationId` schema are redefined in `tools.ts`, `setup-tools.ts`, `discussion-tools.ts`, `portion-summary-tools.ts` and `saved-tools.ts`.
- One shared `asAdmin(ctx, intent, { attended, scope })` and one `schema.ts` remove about 120 lines.

### A8. Tenant plumbing: what it costs, and what actually happened with the second congregation

This is a MISSION ruling (21: "Multi-tenant from the schema up"), so the lead should not re-decide it. Facts for Daniel:

- **What happened:** the first real second congregation (Rabbi Kipnes, `docs/planning/2026-10-30-second-congregation-copy/PLAN.md`, ruling 1) is "a separate copy he runs … This is not a second tenant on CRC's site." The plan also decided "the internal tenant id stays `crc` in forks."
- **The multi-tenancy is half real:** 67 literal `"crc"` in non-test `src/` and `scripts/`, among them `PUBLIC_TENANT = "crc"` (`public-reading/service.ts:36`), `OPERATOR_SHEET_TENANT = "crc"` (`settings/service.ts:28`), reference review typed to `tenantId: "crc"`, and `orgId: "crc"` to the music broker. A second tenant on this deployment would not get public reading, the roster Sheet, reference review or the music link without more work.
- **What it costs now:**
  - Every table carries `tenant_id`; 153 composite foreign keys repeat it; 369 query filters repeat `eq(x.tenantId, tenantId)` on top of RLS that already enforces it (84 `current_setting('app.tenant_id')` uses in policies).
  - Every transaction (`withTenantTransaction`, `db/runtime.ts:20-49`) first runs a `pg_roles` catalog query with four correlated sub-selects to prove the role is not elevated, then `set_config`. That is one extra round trip per transaction, on every request. It could be checked once per pool connection or once at boot (`composition.ts:297` already does a boot check).
  - Every request resolves host to tenant with a database read (`data/tenant-hosts.ts`, no cache), after 40 lines of forwarded-header checks (`tenancy/resolve.ts`).
  - `scripts/add-congregation.mjs` and `add-congregation-host.mjs` (251 lines) exist to provision a tenant that the stop-and-ask rule forbids provisioning.
- **Suggestions:**
  1. Cache the role check per connection and the host lookup in memory for a minute (**code-only**, low risk, but tenant isolation: adversarial pass).
  2. Ask Daniel whether the fork model replaces ruling 21. If yes, nothing needs removing, but new tables could stop adding composite `(tenant_id, …)` keys and the explicit `tenantId` filters where RLS already binds. Removing `tenant_id` from existing tables is a **production migration (irreversible, Daniel decides)** and not worth doing.
- **Confidence:** high on the facts.

### A9. Migration tooling versus stock drizzle-kit

- **`scripts/db-generate.mjs` (35 lines):** installs pinned `drizzle-kit` 0.31.11 into `.cache/` with a scrubbed environment and a fake HOME, then runs `generate`. The reason given is keeping drizzle-kit "outside the application's dependency graph". A devDependency does the same job; `pg` and PGlite are already devDependencies. Replace with `"db:generate": "drizzle-kit generate"`. **Code-only**, saves 35 lines and a surprising network install. Low risk.
- **`scripts/db-migrate.mjs` (35 lines):** a thin, reasonable wrapper over drizzle's migrator (refuses pooled hosts, prints nothing sensitive). Keep.
- **The journal:** snapshots are missing for 0008, 0011, 0034, 0035, 0040; number 0050 is skipped; most of the 54 functions, 75 triggers and 60 policies are hand-written SQL that drizzle-kit cannot see. The Drizzle schema is therefore not the source of truth for security, and `drizzle-kit generate` can emit a diff that ignores them. `tests/migration-journal.test.mjs` (ordering) is worth keeping.
- **Migration tests:** 38 `tests/app/*-migration.test.ts` files, 3,817 lines, one per migration, each replaying a migration on PGlite. Tests for long-applied migrations (anything before roughly 0040) assert history that cannot change. Candidates to delete alongside A1; **not verified** which of them also serve as the only RLS test for their table, so check each before removing.
- **"Migration check scripts":** CLAUDE.md lists them as never relaxed, but none are in the repo. STATE.md:197 says one "is in the session scratchpad". The check/apply/verify procedure lives in agent sessions. Either commit one generic `scripts/db-check.mjs` (ledger length, hash of the next migration, RLS forced on new tables) or stop calling it a script.
- **Database-side validation in general:** the database re-implements application validation in CHECKs and trigger functions. Examples: `student_import_metadata_closed` (a 20-line JSON schema in SQL, `tenant-schema.ts:77-93`), `portal_honors_form_valid`, `portal_study_guide_body_valid`, `portal_tenant_settings_valid`, and control-character regexes. The comments say the app "refuses the same set first", so each rule is written twice and changing one needs a production migration. For a site of a few dozen students, keep the structural constraints (keys, RLS, immutability of licensed catalogs) and stop adding document-shape CHECKs. **Code-only going forward**; removing existing ones is a **production migration** with little payoff.

### A10. Idempotency and version machinery: proportionate in a few places, heavy everywhere else

- **Scale:** `mutation_id`, `request_digest`, `version` / `revision` or content-hash columns appear in 22 of 33 schema files; 54 source files handle `mutationId`, 91 handle `expectedVersion` / `expectedRevision`.
- **Proportionate:** `expectedVersion` on guides, voice, discussions and student setup. Claude and the web can both write, and a stale overwrite of reviewed text is a real risk. `mutationId` on MCP creates (a retried tool call must not make a second student or a second saved reading).
- **Heavy:**
  - `translation_draft` and `tutor_note` are append-only, one row per keystroke-save, each with `mutation_id` plus `request_digest` plus `base_version` plus nine foreign keys naming the actor's grant, guardian, context and identity (`student-work-schema.ts`). A head row with `updated_at` would serve a student's private translation draft. (**Production migration to change; Daniel decides. Leave as is, but do not copy the pattern.**)
  - `honoree_reading_epoch`, `honoree_group_epoch`, `honoree_material_release`, `honoree_operation` and `honors_version`: five tables and ten trigger functions (`portal_honoree_*`) to keep an aliyah honoree's guest link valid when a reading changes. Verified that all five are read (`data/honoree.ts:39-54`) and that the epoch rows are written only by triggers. This is the most intricate area of the schema for a low-stakes feature. Not proposing removal; flagging it as the place a bug is hardest to fix.
  - `catalogHash` on source assignment: used by the web panel and by MCP `assign_sources`. It guards against Sefaria's link list changing between "find" and "assign". Low value: the ids are validated on save anyway.
  - Signed roster plan token (`sealRosterPlan` / `openRosterPlan`, HMAC, 30-minute TTL, digest of every row): proportionate. Apply is the one MCP write that touches many students at once.
- **Do:** no removal. Rule for new work: `expectedVersion` only where two writers exist; `mutationId` only on creates.

### A11. Smaller schema items

| Item | Finding | Type |
|---|---|---|
| `assignment.proposal_cache_id` | Declared (`tenant-schema.ts:216`); no reference anywhere else in `src/` or `scripts/`. Nothing writes or reads it. | Drop is a production migration; trivial. Leave, or drop with the next migration. |
| `tenant.customs` | Legacy; `tenant_settings` "readers take the head over the legacy tenant.customs keys". Still read by `students/service.ts:32-40` for calendar and Torah mode. Two sources of congregation settings. | Code-only: move the two keys to `tenant_settings`, then stop reading `customs`. |
| `student.import_metadata` | CSV-import leftovers (parent names, phone, tutor name, admin notes) in JSONB guarded by a 20-line CHECK. Maven intake is now the main path; CSV import is still wired (`/workspace/admin/students/import`). | Ask Daniel if CSV import is still used. If not, remove the page, routes and `students/preview.ts` (code-only, about 400 lines; not counted exactly). |
| `rate_limit`, `invitation_throttle` | Two throttles: better-auth's and a custom bucket table used by invitations and account requests. | Fine. |
| `sefaria_text_cache`, `hebcal_cache` | Global caches, no tenant, no RLS; read and written. | Fine. |
| `reference_review_batch`, `reference_review_decision` | Cantor Finkel's private take review (0026), with its own admin page. The takes were released 2026-10-22 (STATE.md:291). | Ask Daniel whether more batches are coming. If not, the page, routes and `src/server/reference-review/` (6 files) can go (code-only); tables stay. |
| `practice_event` | Written and read (`data/practice-calendar.ts`); the UI calls `/practice-events`. | Fine. |
| `verse_assessment` | The tutor's mark stream; the UI calls it (`progress/marks.tsx`). | Fine. |

---

## Part B. Duplicated concepts

### B1. Progress and practice: 13 tables

| Table | Whose | What |
|---|---|---|
| `verse_self_check` | enrolled student | Still working / Got it, per assigned verse |
| `verse_assessment` | tutor on a student | tutor's mark, per assigned verse |
| `practice_day`, `practice_event` | enrolled student | practice calendar ticks and their log |
| `study_theme_read` | enrolled student | "I read this" per guide theme |
| `translation_draft`, `tutor_note` | student; tutor | versioned per-verse text |
| `lesson_log` | tutor | lesson notes |
| `service_part_finished` | enrolled student | finished an assigned service part |
| `saved_verse_mark`, `saved_verse_work` | any member, on a saved reading | the same marks and the same translation and notes as above, for a non-student |
| `course_progress`, `service_course_progress`, `verse_review` | any member | course documents (A4) |

- The real duplication is **student versus member**. "Readings for everyone" (0054) gave every member saved readings with marks, translation and notes, alongside the enrolled student's `verse_self_check` / `translation_draft` on an `assignment`. An enrolled student's assignment could be a saved reading with a flag, and the mark and work tables would collapse to one set.
- That is a large **production migration (Daniel decides)** and not recommended now. For new features, build on the saved layer only.
- Practice visibility (0052) added views and `source_mode` / `marked_at` on top of `verse_self_check` so tutors and parents can see marks. Daniel's "proportion" ruling says what a child's own tutor or parent sees is ordinary product work. Note that `marked_at` is read only by SQL views (zero references in `src/`), so behaviour there lives in migrations.

### B2. People and relationships: 12 tables

`user` → `membership` (user in tenant) → `role_grant` (student / parent / tutor / admin) → relationship rows: `student_identity`, `guardian`, `tutor_student`. Then, added later:

- `tenant_member`: the "Member" role from 1.4 accounts, deliberately "never a portal_role grant".
- `account_request`, `account_approver`: the queue, and tutors who may approve.
- `learner_claim`: a tutor claims any signed-in person. For a real student it also writes a `tutor_student` row and remembers it in `tutor_link_id`, so two rows stand for one fact and must be revoked together (`learner_claim.tutor_link_id`, `tutorLinkPassesA1` in `data/learner-claims.ts`).
- `practice_context`: a parent's child-practice session token.
- `student_source_identity`: the Maven link.

Observations:

- A person's standing is spread over `membership.disabled_at`, `role_grant.revoked_at`, `tenant_member.revoked_at` and the relationship rows. "Member" is a role in everything but storage. Folding `tenant_member` into `role_grant` as a fifth enum value would remove a table and a join in "People with access" (`data/invitations.ts:32`, `accounts/data.ts`). **Production migration (Daniel decides)**; medium payoff.
- `learner_claim` plus `tutor_student` is the clearest double-entry. A `tutor_student` row whose target may be a membership rather than a student would remove it. **Production migration**; at least keep all writes in the one function that writes both.
- `authority_revision` and `role_grant.revision` are copied into `practice_context`, `mcp_connection` and every append-only actor column so that a change of authority invalidates sessions. This is auth and deliberate. It is also why `authorityRevision` appears in 76 source files.

### B3. Invitations and ways into the roster

- **Invitations:** `invite` (the token), `tutor_invite_hold` (students waiting for an invited tutor), `invitation_throttle`, `account_request` (the self-service route to the same end). Two doors for a family: Daniel invites them, or they ask and an approver links them. Reasonable as product, but each door has its own tables, service (`invitations/service.ts` 367 lines, `accounts/service.ts` 258) and admin page (`/workspace/admin/invitations`, `/workspace/accounts`).
- **Ways a student record is created (three):** web "Add student" (`POST /api/admin/students`), web CSV import (preview and confirm), MCP `create_student` and MCP Maven intake (`propose_roster_changes` / `apply_roster_changes`). All end in `writeNewStudent` (`students/service.ts`), which is good. CSV import predates Maven and is the candidate to retire (see A11).
- **Roster Sheet:** `src/server/roster-sheet/` rewrites a Google Sheet nightly and on a button. It is one-way out and small (168 lines). Fine.

### B4. Service (liturgy) parts: 9 tables

- `service_catalog`, `service_catalog_lifecycle`: licensed Beit Mitzvah catalog bytes and which build is active.
- `course_text_catalog`, `course_text_lifecycle`: "a copy of service_catalog's shape" for public text.
- `student_service_plan`: which parts a student will lead.
- `service_ceremony`, `student_ceremony`, `student_service_part`, `service_part_request`: the link to CRC Music's setlists.
- `service_part_finished`, `service_course_progress`: progress.

The two catalog pairs are the same mechanism twice, kept apart on purpose so licensed text never shares a table with public text (never-in-repo and licence are protected; leave). The plan versus ecosystem split (`student_service_plan` beside `student_service_part`) is two representations of "which parts this child does": one chosen in the portal, one synchronised with Music. Not verified which one the UI treats as truth; worth a look by whoever reviews the service area.

---

## Part C. Table inventory

RLS: **T** = forced, `tenant_isolation` on `app.tenant_id`. **T+** = that plus a second transaction-local setting, named in the purpose column. **O** = forced owner-only on its own setting. **none** = no RLS.

Readers and writers are the non-test modules under `src/server/` that reference the table. `data/x` means `src/server/data/x.ts`.

### Auth and tenancy

| Table | Purpose | RLS | Reads / writes |
|---|---|---|---|
| `user`, `session`, `account`, `verification` | better-auth | none | better-auth adapter; `user` joined in about 37 files for names |
| `rate_limit` | better-auth rate limiting | none | `auth`, `http` |
| `tenant` | the congregation row (name, product name, summary credit, legacy `customs`) | T (by id) | `data/product-name`, `students/service` (customs), `scripts/add-congregation` |
| `tenant_host` | host → tenant directory | none | R `data/tenant-hosts`; W migrations and `scripts/add-congregation-host` only |
| `tenant_settings` | append-only congregation settings | T | `data/tenant-settings`, `settings/service` |
| `membership` | user in tenant | T | `access`, `data/authority`, many |
| `role_grant` | student / parent / tutor / admin grant, cantor flag | T | `data/authority`, `relationships`, `accounts`, `people` |
| `tenant_member` | 1.4 "Member" role | T | `accounts/data`, `data/invitations`, `people` |
| `account_request` | pending account or link requests | T | `accounts/data` |
| `account_approver` | tutors who may approve | T | `accounts/data` |
| `audit_event` | append-only action log | T, immutable trigger | W 23 sites; **R none in app** (A3) |

### Students and relationships

| Table | Purpose | RLS | Reads / writes |
|---|---|---|---|
| `student` | the student record | T | `data/students`, `data/roster`, `students/service`, MCP setup |
| `student_identity` | student ↔ own account | T | `relationships`, `learners`, `data/authority` |
| `guardian` | parent ↔ student, practice toggle | T | `relationships`, `data/authority` |
| `tutor_student` | tutor ↔ student | T | `relationships`, `staff`, `roster-sheet`, MCP |
| `learner_claim` | tutor claims any member | T | `data/learner-claims`, `learners` |
| `student_ceremony_done` | ceremony marked done or reversed | T+ `app.ceremony_done_actor` | `students/ceremony-done`, `data/ceremony-done`, `learners` |
| `student_source_identity` | Maven Contact ↔ student | T | `data/roster-source`; W only via MCP apply and unlink (web unlink too) |
| `invite` | invitation tokens | T | `data/invitations`, `invitations/service`, `staff` |
| `tutor_invite_hold` | students held for an invited tutor | T+ `app.tutor_hold_actor` | `data/tutor-invite-holds` |
| `invitation_throttle` | send budget buckets | T | `data/invitations`, `accounts/data` |
| `practice_context` | parent's child-practice session | T | `data/practice`, `relationships/data` |

### Readings and study

| Table | Purpose | RLS | Reads / writes |
|---|---|---|---|
| `hebcal_cache` | Hebcal responses | none | `data/reading-cache` |
| `sefaria_text_cache` | Sefaria text | none | `data/study-cache` |
| `assignment`, `assignment_verse` | a student's confirmed reading and its verses | T | `data/roster`, `data/portal`, `students/service`, `staff` |
| `verse_source_assignment` | sources pinned to a verse for a student | T | `data/source-assignments` |
| `study_voice` | the study voice, append-only | T | `data/study-guides`; W MCP only |
| `study_guide` | base guides, append-only | T | `data/study-guides`, `guide-share`; W MCP and import |
| `study_guide_student` | per-student additions | T | `data/study-guides`; W MCP only |
| `study_theme_read` | student's "I read this" | T | `data/study-guides` |
| `source_translation`, `curated_discussion`, `curated_discussion_source` | curated discussions and Claude translations | T (plus a public view) | `discussions`, `guide-share`; W MCP only |
| `portion_summary` | parashah summaries, draft / approved | T | `portion-summary`; W MCP only |
| `public_page_view_day` | daily counts per public page | T | `data/page-views`; R MCP only |

### Progress and work

| Table | Purpose | RLS | Reads / writes |
|---|---|---|---|
| `verse_self_check` | student's marks | T (plus 0052 views on `app.practice_reader`) | `data/progress`, `data/practice-visibility`, `staff/data` |
| `verse_assessment` | tutor's marks | T | `data/progress` |
| `practice_day`, `practice_event` | practice calendar and its event log | T | `data/practice-calendar` |
| `lesson_log` | tutor lesson notes | T | `data/lesson-log`, `data/practice-visibility` |
| `translation_draft`, `tutor_note` | versioned per-verse text | T | `data/student-work` |
| `student_recording` | **dropped feature (A2)** | T | `data/recordings`; no UI |
| `saved_reading`, `saved_verse_work`, `saved_verse_mark`, `starred_comment`, `account_preference` | a member's own saved layer | O `app.saved_owner` (plus `saved_viewer` and `saved_directory` for a claimed learner's tutor) | `data/saved`, `saved/*` |
| `course_progress` | Learn to lein document | O `app.course_owner` | `data/course-progress` |
| `service_course_progress` | service course document | O `app.service_course_owner` | `data/service-course-progress` |
| `verse_review` | review cards document | O `app.verse_review_owner` | `data/verse-review` |
| `service_part_finished` | finished an assigned part | T+ `app.service_part_reader` / `_context` | `data/service-part-finished` |

### Service, honors, notifications, MCP

| Table | Purpose | RLS | Reads / writes |
|---|---|---|---|
| `service_catalog`, `service_catalog_lifecycle` | licensed catalog bytes and active build | T, immutable | R `service-learning`, `service-course`; W operator only |
| `course_text_catalog`, `course_text_lifecycle` | public course text | T, immutable | R `service-course/text`; W `scripts/import-course-text.mjs` |
| `student_service_plan` | chosen parts | T | `service-learning/data`, `data/service-part-finished` |
| `service_ceremony`, `student_ceremony`, `student_service_part`, `service_part_request` | link to CRC Music | T | `service-ecosystem/*` |
| `honors_version` | aliyah honors form, append-only | T | `data/honors`, `honoree`, `staff/data` |
| `honoree_link`, `honoree_operation`, `honoree_reading_epoch`, `honoree_group_epoch`, `honoree_material_release` | honoree guest links and their invalidation | T | `data/honoree`, `honoree/service`; epochs written by triggers |
| `notification_preference`, `notification_delivery` | email choices and send ledger | T | `data/notifications` |
| `reference_review_batch`, `reference_review_decision` | Finkel take review | T, immutable | `data/reference-review` |
| `mcp_connection`, `mcp_token` | Claude consents and hashed tokens | T | `data/mcp`, `data/mcp-connections` |

Nothing in this inventory is unread **and** unwritten except the column `assignment.proposal_cache_id`. Write-only: `audit_event`. Built but unused: `student_recording`.

---

## Part D. The MCP connector

### D1. How it is wired

- Route: `src/app/api/[...path]` → `server/http/dispatch.ts` → `server/http/mcp.ts` (`/api/mcp`, `/api/oauth/*`, `.well-known/*`).
- `src/app/connect/page.tsx` is the consent screen (`components/portal/connect.tsx`), with one checkbox: "This is a scheduled routine that runs on its own".
- `mcp/service.ts`: OAuth 2.1 with dynamic registration, PKCE, hashed tokens; 1-hour access tokens, 30-day connections.
- Every tool call runs `withLive`, which re-locks the tenant, connection, user, membership and grant in the transaction.
- `mcp/transport.ts`: stateless JSON-RPC. It filters tools by role, scope and `attendedOnly`, applies a 25 s or 55 s deadline, and withholds any result containing an email-shaped string or a bearer token (`LEAK`, `transport.ts:35`).
- Three scopes: `portal:read`, `portal:study`, `portal:roster`. The roster scope is never given to an unattended connection.
- Web management: `/workspace/claude` lists and ends connections (`/api/staff/claude-connections`).

Proportion: the OAuth surface and the per-call re-lock are auth and are sound. The `LEAK` regex is a blunt tool: a student whose name contains "@" makes a whole result vanish, which is why `setup-tools.ts:64` has a `shown()` helper to work around it. No tool returns an email address on purpose, so the regex could be dropped in favour of not selecting those columns. Low priority.

### D2. Every tool

"Source of truth" is the function both the web and the MCP end up in. Where it is the same function, there is one code path, with an MCP-side wrapper.

| # | Tool | Who | What it does | Calls |
|---|---|---|---|---|
| 1 | `list_students` | admin, tutor | page of visible students | `lockVisibleStudentCandidates`, `mcpSeesStudent` |
| 2 | `get_student` | admin, tutor | names, date, slot, confirmed readings | `lockStudent`, `confirmedReadings`, `readingView` |
| 3 | `get_study_voice` | admin | the voice document | `guides.getVoice` |
| 4 | `save_study_voice` | admin, study, attended | new voice version | `guides.setVoice` |
| 5 | `list_guide_work` | admin | readings needing guides | `guides.guideWork` |
| 6 | `list_guide_catalog` | admin | every guide key in the rite | `guides.guideCatalog` |
| 7 | `get_reading_for_guide` | admin | Hebrew, JPS and citable sources, paged | `guides.guidePassage`, `loadText`, `related` |
| 8 | `get_guide` | admin | base guide and held draft | `guides.getBaseGuide` |
| 9 | `save_guide` | admin, study | new base guide version | `guides.setBaseGuide` |
| 10 | `publish_guide` | admin, study | release a held draft | `guides.publishBaseGuide` |
| 11 | `get_student_guide` | admin | guide as one student sees it | `guides.rabbiStudentGuide` |
| 12 | `save_student_guide` | admin, study | per-student additions | `guides.setStudentGuide` |
| 13 | `get_maven_roster_query` | admin, roster | SOQL for a date window | `students/maven-roster` |
| 14 | `propose_roster_changes` | admin, roster | diff Maven rows against roster; signed plan | `students/maven-intake`, `sealRosterPlan` |
| 15 | `apply_roster_changes` | admin, roster, attended | create, update, link per row | `writeNewStudent`, `writeStudentEdit` (web's own) |
| 16 | `unlink_maven_record` | admin, roster | undo a wrong link | `unlinkSourceIdentity` (web's own) |
| 17 | `list_tutors` | admin, roster | tutor grants | `relationships` data |
| 18 | `get_student_setup` | admin, roster | readings, tutors, slot, revisions | `lockStudent`, `confirmedReadings`, `inspectLinks` |
| 19 | `find_sources` | admin, roster | Sefaria sources for a verse | `currentVerseCapture`, `projectRelatedCatalog` |
| 20 | `assign_sources` | admin, roster | pin sources to a verse | `sources.replaceAs` (web's own) |
| 21 | `remove_source_assignment` | admin, roster | unpin | `sources.replaceAs` |
| 22 | `preview_student_reading` | admin, roster | what a reading choice would set | `readings.prepareReadingAs` (web's own) |
| 23 | `set_student_reading` | admin, roster | confirm it | `readings.confirmReadingAs` (web's own) |
| 24 | `set_student_tutor` | admin, roster | replace tutor list | `writeTutorAssignment`, `writeTutorRevocation` (web's own) |
| 25 | `set_student_service` | admin, roster | slot and rehearsals | `editStudent` → `writeStudentEdit` |
| 26 | `update_student` | admin, roster | names, Hebrew name, date | `editStudent` → `writeStudentEdit` |
| 27 | `create_student` | admin, roster | add one student | `studentInput`, `writeNewStudent` (web's own) |
| 28 | `disable_student` | admin, roster | take off roster | `writeStudentDisable` (web's own) |
| 29 | `invite_tutor` | admin, roster, fresh | email a tutor invitation, hold students | `invitations.issueAs`, `writeTutorHolds` (web's own) |
| 30 | `print_sheet_link` | admin, tutor | link to a print sheet | own `choose()` + `printAddress` |
| 31 | `study_link` | admin, tutor | link into Study | own `choose()` + `resolvePick` + `readAddress` |
| 32 | `get_reading` | admin, tutor | a portion's aliyot and haftarah as refs | `weekFor`, `portion-reading.ts` |
| 33–36 | `list_` / `open_` / `create_` / `revise_saved_reading` | admin, tutor, attended | the person's own saved readings | `saved/mcp.ts` (a separate facade over the saved layer) |
| 37 | `get_page_views` | admin | public page counts | `readPublicPageViews` |
| 38 | `add_source_translation` | admin, study, attended | store a Claude translation | `discussions.addTranslation` |
| 39–41 | `add_` / `revise_` / `withdraw_discussion` | admin, study, attended | curated discussions | `discussions.*` |
| 42 | `list_discussions` | admin | list | `discussions.listDiscussions` |
| 43 | `draft_portion_summary` | admin, study | save a draft | `draftSummary` |
| 44 | `list_portion_summaries` | admin | list | `listSummaries` |
| 45 | `approve_portion_summary` | admin, study, attended | make public | `approveSummary` |
| 46 | `withdraw_portion_summary` | admin, study, attended | withdraw | `withdrawSummary` |

Two code paths for one operation:

- **Student edit, create, disable, tutor assign and revoke, reading confirm, source assign, invitation issue:** one path. The MCP calls the web's write function (`students/service.ts`, `relationships/service.ts`, `invitations/service.ts`, `study/source-assignments-service.ts`). What is duplicated is the pre-checks and messages around them: `editStudent` re-derives "no change" and the rehearsal error; `createStudent` has its own duplicate detection that the web's Add student does not have (`setup-tools.ts:556-568`); `alreadySet` re-prepares a reading to turn a conflict into a success. Source of truth: the `write*` functions. The duplicate check should move into `writeNewStudent` so the web gets it too.
- **Saved readings:** `saved/mcp.ts` is a second facade beside `saved/service.ts`, sharing validation and data. Source of truth: `data/saved.ts`. Acceptable.
- **Reading selection** ("this Shabbat", parashah, pick): three implementations. `print-tools.ts` `choose`, `study-tools.ts` `choose`, and `portion-reading.ts` `resolvePick` (which the comment at `study-tools.ts:111` calls "the one resolver"). Make `resolvePick` the only one (A7).
- **Guides, voice, discussions, summaries:** one path, and the MCP is the only writer.

### D3. What a tutor's connection can do versus the admin's

**Tutor** (scope `portal:read` only; `mcp_connection_scope` CHECK forbids more), 9 tools:

- `list_students` and `get_student` for their own linked students only (a live `tutor_student` link that also passes the learner-claim check);
- `print_sheet_link`, `study_link`, `get_reading`;
- their own four saved-reading tools (not on a scheduled routine).

A tutor's Claude **cannot** see a student's marks, practice calendar, lesson notes, guide or guide ticks, tutor notes or honors, and cannot write anything about a student. So a tutor cannot ask "what did I note for Noa last week", "who hasn't practised" or "draft next lesson's plan from her marks". For tutors the connector is nearly a link generator.

**Admin**: all 46, subject to scope (study for guide, discussion and summary writes; roster for setup and Maven) and attendance (a scheduled routine can draft guides and summaries as "claude" and read; it cannot review, approve, withdraw, change the voice, touch the roster or use saved readings).

### D4. Parity: MCP versus web admin

**Things Daniel can do only through Claude (no web equivalent):**

| Capability | MCP tool | Web |
|---|---|---|
| Write or edit the study voice | `save_study_voice` | read-only (`GET /api/admin/study-voice`) |
| Write, edit, hold or publish a base guide | `save_guide`, `publish_guide` | read-only status card (`study/guide-status.tsx`); import and export only |
| Per-student guide additions | `save_student_guide` | none |
| See which readings lack a guide | `list_guide_work`, `list_guide_catalog` | none |
| Curated discussions and Claude translations | `add_` / `revise_` / `withdraw_discussion`, `add_source_translation` | none (public display only) |
| Portion summaries: draft, approve, withdraw | 4 tools | none (display only) |
| Public page-view counts | `get_page_views` | none |
| Maven roster intake | `get_maven_roster_query`, `propose_` / `apply_roster_changes` | none (web has CSV import instead; unlinking a Maven record is on both) |

Consequence: if the connector is down, the 30-day connection has lapsed, or Daniel is on a phone without Claude, he cannot fix a typo in a published guide, pull a wrong discussion or withdraw a summary. A minimal web "withdraw / hold" for guides, discussions and summaries is the gap most worth closing.

**Things in the web admin with no MCP tool:**

| Web function | Route | MCP |
|---|---|---|
| "This week" student status (who is behind, chips) | `GET /api/admin/student-status` | none |
| A student's marks and tutor assessments | `/api/students/:id/progress` | none |
| Practice calendar and practice visibility | `/practice-calendar`, `/practice-visibility` | none |
| Lesson log (read, add, edit) | `/lesson-log` | none |
| Tutor notes and a student's translation drafts | `/work` | none |
| Family view (parents, accounts linked) | `GET /api/students/:id/family` | none |
| Invite a parent or student; reissue, revoke, copy link; "invitations needed" | `/api/admin/invitations*` | only `invite_tutor` |
| Account requests: approve, decline | `/api/accounts/requests*` | none |
| People with access; make tutor, remove tutor; end a member | `/api/accounts/people*`, `/members/end` | none |
| Approvers: add, remove | `/api/accounts/approvers*` | none |
| Revoke a parent link or a student's own account link; toggle a parent's practice access | `/api/admin/students/:id/relationships/*` | none (tutor links only) |
| Revoke a grant; cantor flag; hand a tutor's students to another | `/api/admin/grants*`, `/tutors/:id/hand-over` | none |
| Mark ceremony done, reverse it | `/ceremony-done`, `/ceremony-reverse` | none |
| Re-confirm a reading sent to review | `/reading/reconfirm` | partly (`set_student_reading` again) |
| Second parent's address, student kind, contact addresses | student edit form | deliberately not ("addresses and the student kind stay in the portal") |
| Honors form, honoree guest links, booklet | `/honors`, `/honoree-links`, `/booklet` | none (`print_sheet_link` covers the reader's sheet only) |
| Service plan and "my service" (parts, Music link) | `/service-plan`, `/my-service` | none |
| Congregation settings | `/api/admin/congregation-settings` | none |
| Guide export and import | `/api/admin/guide-share/*` | none |
| Roster Sheet "update now" | `/api/admin/roster-sheet/sync` | none |
| Reference (Finkel) take review | `/api/reference-review/*` | none |
| CSV roster import | `/api/admin/students/import/*` | none (Maven intake instead) |
| Claude connections: list, end | `/api/staff/claude-connections*` | n/a |
| Email notification settings | `/api/notifications/preferences` | none |

**In neither:** a change history (A3); re-enabling a disabled student (not found in either surface; not verified exhaustively); any view of how many students opened or ticked a guide.

Reading the two columns together: the MCP is strong on content (guides, discussions, summaries) and setup (roster, readings, tutors), and blind on oversight. Daniel can set a student up from Claude but cannot ask Claude how any student is doing. The single most useful addition for him as programme overseer is one read tool over the data `/api/admin/student-status` already computes (`staff/service.ts`), plus lesson-log and marks reads for one student. The same reads, limited to linked students, would make the tutor connection useful.

---

## Part E. Summary of suggested actions

| # | Action | Type | Lines | Risk |
|---|---|---|---|---|
| A1 | Delete release-migrate scripts, tests, fixtures; drop `fetch-depth: 0` | code-only | about 3,300 + 3.7 MB | low |
| A2 | Remove student recordings module, route, flag, tests | code-only (table drop: production, optional) | about 600 + tests | low |
| A3 | Give `audit_event` a reader, or stop growing it | code-only (or one production migration) | adds about 100 | low |
| A4 | One generic per-member document module | code-only first; table merge is production | about 300–450 | medium |
| A5 | Drop the 15-minute fresh-sign-in rule for `set_student_tutor` | code-only, auth: Daniel decides | small | needs review |
| A6 | Build instructions per connection; trim to about 150 standing words | code-only | n/a | low |
| A7 | Merge overlapping tools (46 → about 37); one authority helper; one schema helper | code-only | about 300 | low-medium |
| A8 | Cache the role check and host lookup; ask Daniel whether forks replace ruling 21 | code-only; question for Daniel | small | medium (isolation) |
| A9 | Stock `drizzle-kit generate`; commit one `db-check` script; prune old migration tests | code-only | 35 + up to about 2,000 of tests | low |
| A11 | Retire CSV import and reference review if Daniel confirms; drop `proposal_cache_id` | code-only (+ trivial production) | several hundred | low |
| D4 | Web "withdraw / hold" for guides, discussions, summaries; MCP oversight reads | new work | adds | low |
