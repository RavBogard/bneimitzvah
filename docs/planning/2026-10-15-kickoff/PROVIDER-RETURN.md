# Provider preparation return — 2026-10-16

**Current status, 2026-10-16: canonical authentication transport is enabled and verified at https://beitmitzvah.centralreform.org.** Code `bb2ddfd` passes all four hosted jobs in run `38941201880`; matching READY deployment `dpl_2u3oYjaxx6yoLVp8MvinneTSjKjH` passes the five-record native canary with credential markers absent. Anonymous session is 401 private/no-store, Google challenge is 200 with binding cookie, ten alias page checks redirect to fixed canonical /#home and five alias API checks return 404. Daniel confirmed the Google JavaScript origin. Daniel confirmed successful Google phone sign-in and the exact masked account. Explicit owner bootstrap now has one verified active CRC administrator grant and one bound owner audit. Refreshed workspace use and real Resend email fallback acceptance remain pending.

Migration 0011 added the canonical CRC host, bringing the verified ledger to 12. The first 11 SQL files are unchanged from their original published Git blobs; live ledger hashes match one Git-byte representation and ten exact CRLF checkout representations. No historical ledger entry was rewritten or migration repeated. Existing host rows and all nine sensitive Production binding IDs/scopes were preserved; only BETTER_AUTH_URL changed before the same-Git redeploy. See QUERY-FREE-AUTH-REVIEW.md for independent review and STATE.md for the next action.

## Historical initial database setup (completed before auth activation)

At this earlier checkpoint authentication was disabled:
The exact resource/project connection was removed, the owner credential rotated,
the authenticated-client retirement gate completed after two separately authorized
endpoint restarts, all 11 migrations applied and verified, and the restricted
production login passed the actual WebSocket acceptance probe. Only its sensitive
Production `DATABASE_URL` was installed; the existing Resend binding is preserved.
No auth settings, deployment, email, owner bootstrap, real student data, second
tenant, account or billing change was performed. The session endpoint still returns
**503**. Root retains integration and authentication-enabling ownership.

## Execution evidence — approved bounded setup

- Exact connection removal: **18 managed aliases removed**, project connections
  **0**, Neon resource/integration retained. Final project metadata has **2**
  sensitive Production-only variables (restricted database URL and unchanged Resend
  key); Preview variables, branch overrides, hidden Production variables and
  owner/operator/bootstrap/other auth variables are each **0**. Immutable older
  deployments' copies were addressed by credential/session retirement below.
- Owner reset finished; **2** prior exact owner/database client backends were
  terminated and the immediate remaining count was **0**. Fresh original-password
  direct and pooled authentication rejected with actual authentication SQLSTATE;
  replacement direct and pooled credentials worked. The original authenticated
  pooled handle nevertheless remained usable, so setup stopped at that gate.
- Root separately reviewed the exact-endpoint restart remedy. **2 restart requests
  total**, with no resize/resource/plan change: the first observer stopped on one
  terminal `skipped` intermediate operation and closed its controls, so that run
  did not establish client invalidation. After read-only confirmation of five
  finished/one skipped operations and active endpoint, root authorized the second.
  The corrected observer treated terminal skipped as completion only. Both held
  **current** direct and pooled handles then became unusable, fresh current
  credentials worked on both paths, and original stale credentials failed on both.
  This demonstrates endpoint client invalidation; it does not claim retesting the
  already closed original pooled handle. All operator/control clients were closed.
- Owner preflight: PostgreSQL **180006**, direct database owner with reviewed
  attributes; actual client TLS socket **encrypted=true, authorized=true** using
  `verify-full`. Neon's proxy makes backend `pg_stat_ssl.ssl=false`; that backend
  value was not misreported as evidence about client TLS.
- Existing migrations **0000–0010**, ledger rows **11**, every exact SQL hash and
  journal timestamp matched. Enabled CRC tenant **1**, exact production host rows
  **2**, user/membership/grant/student/audit rows **0**. No owner identity was seeded.
- SQL-created `portal_app`: safe role attributes, **1** membership (only
  `portal_runtime`), elevated/unexpected/ownership closure **0**, public-schema
  CREATE **false**. **161** inherited table privilege checks and **25** column
  update checks matched the intended narrow grants, including auth/cache exceptions.
  Ledger access, SET ROLE owner, role elevation and public CREATE denied with
  **42501**. Neon intercepted SET ROLE neon_superuser with **XX000**; this was
  recorded separately, with SET membership absent and current/session role unchanged
  after savepoint recovery. It was not counted as an RLS denial.
- Exact ENABLE/FORCE tenant policies **15**, including invitation_throttle from
  0004; immutable authority/audit/work triggers **22**. Separate actual
  `withTenantTransaction` owner-negative check rejected before callback entry
  (**callbackEntered=false**). Owner input never entered the restricted probe child.
- Actual pinned Neon WebSocket/Drizzle/runtime probe **passed (close)** on the same
  direct endpoint class installed for Production. It checked all 15 protected
  tables, restricted closure, missing/empty/wrong contexts, CRC read/write,
  rolled-back fixture, before/inside/after physical-backend cleanup, parallel
  isolation and exact-host composition. RLS denials still required **42501**.
  Final independent inspection: student/identity/authority/audit rows **0**,
  remaining owner client backends excluding the inspector **0**; inspector closed.
- Live acceptance used frozen base
  `d655c15abd8692e222ec86aa1fa11709461cf7ef`, plus only the independently approved
  invitation_throttle addition to the probe's protected-table list. Actual executed
  `neon-ws.ts` SHA-256:
  `0ec8e203d4182b385c5e4eec4b8819fda14723906c1e615f75e03ca344f892c4`.
  Main and frozen source match after line-ending normalization. Concurrent auth
  implementation was not imported. Frozen worktree remains for root to archive.
- Latest focused checks: **6/6** probe tests and typecheck pass after the catalog
  addition. No broad suite was repeated for that one-line strengthening. Main
  source fixture literals were constructed to satisfy the existing repository
  guard, without weakening the guard.

Canonical private file locations and sanitized operator result files are recorded
only in the ignored operator handoff. Historical preparation/proposed-procedure
sections below are retained as the reviewed execution contract; their earlier
pending/read-only descriptions are superseded by these actual results.

## Pre-execution capability and database evidence

- Vercel CLI 50.35.0 is authenticated and linked to the existing
  `ravbogards-projects/bneimitzvah` project. The one connected Neon resource is
  available and maps to the exact Neon project inspected below. No other project
  was listed or accessed.
- The resource's 18 managed environment variables are bound to **both production
  and preview**. They include owner-capable database URLs/password aliases and
  optional Neon Auth variables. Integration secret synchronization is enabled.
- A production environment pull into the ignored private provider-bootstrap
  directory succeeds, but sensitive values are returned **empty**. Database URL
  names and the newly added `RESEND_API_KEY` name are present; there is no usable
  connection or sending key in that pull. Runtime auth secret, Google pair and
  sender settings are absent. Empty sensitive output is not evidence the remote
  key is missing. Existing production Resend binding should be preserved.
- Existing Neon CLI 2.22.0 credentials work for the exact linked project through
  the supported project/connection-string commands. No new account or interactive
  login was requested. The direct connection was captured only in an ignored
  operator environment file containing `DATABASE_MIGRATION_URL`; no connection,
  password, token, account email or provider response was printed.
- A catalog inspection on PostgreSQL **18.6** (`server_version_num=180006`) ran in
  `BEGIN READ ONLY`, with bounded connection/query timeouts, then rolled back.
  TLS certificate verification was explicit; the pinned `pg` client's existing
  channel-binding negotiation was enabled. This does not claim mandatory channel
  binding enforcement.
- The login is direct and owns the database: LOGIN true, SUPERUSER false,
  CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS true, `neon_superuser` membership true.
  It owns no public table. Public table count is **0**; `portal_runtime`, the tenant
  table and the Drizzle migration ledger are absent. No migrations have been
  applied. This credential is suitable for reviewed operator preparation and
  **unsuitable for runtime**.

Only numeric/boolean catalog metadata and allowlisted resource/variable metadata
were emitted. Private pulls/operator files remain under ignored
`.local-logs/provider-bootstrap/`; they must not be staged or copied into app builds.

## Billing decision resolved

The scoped Vercel store response labels its plan `launch_v3`, subscription,
**Launch**. Daniel subsequently explicitly approved using this existing Launch
resource, as recorded in `PROVIDER-SECURITY-REVIEW.md`. No plan/billing setting was
changed. This resolves the discrepancy for this resource; another upgrade/spending
decision remains Daniel's mission gate.

## Exact proposed changes for root/security review

1. Independently review this operator procedure and the new probe. Existing Launch
   use is approved. Keep application runtime unavailable while owner credentials exist
   in its integration bindings.
2. Disconnect **only this existing Neon resource from this existing Vercel
   project**, retaining the Neon resource, integration installation and account.
   This removes the 18 managed owner/Neon Auth variables from both production and
   preview and prevents synchronization from reinstalling them. Do not use
   integration removal, resource deletion or the CLI's `--all` option. The reviewed
   CLI seam is `vercel integration-resource disconnect <exact-resource-id>
   bneimitzvah --yes --non-interactive --scope ravbogards-projects`. Verify the
   resulting project environment metadata before installing the replacement URL.
3. Rotate the default owner's password through the existing Neon project and
   capture the replacement direct operator URL privately. This invalidates owner
   credentials already captured by previous production/preview deployments; merely
   deleting current project defaults does not invalidate those copies. Keep the
   replacement owner URL out of Vercel runtime. Password rotation alone does not
   end authenticated sessions: complete the retirement procedure below. Recheck
   direct ownership and role capability using the private connection before migrations.
4. Run the existing `scripts/db-migrate.mjs` once with only the private operator
   `DATABASE_MIGRATION_URL`. The reviewed journal has **11 migrations, 0000–0010**.
   Verify applied hashes/ledger, CRC seed and exact production host mapping. Do not
   repurpose deployment/build hooks or expose an operator route.
5. Create one SQL-managed application LOGIN, for example `portal_app`, with a new
   privately generated password and explicit `NOSUPERUSER NOCREATEDB NOCREATEROLE
   NOREPLICATION NOBYPASSRLS INHERIT`. Grant only membership in `portal_runtime`
   plus necessary database CONNECT. It must own no database/schema/table and must
   have no transitive owner/elevated-role membership or ability to assume one.
   SQL creation matters: provider-created roles receive `neon_superuser` membership.
   Keep all actual password text out of command arguments, logs and review files.
6. Verify the new login's actual role closure and FORCE RLS using the existing
   runtime contract, then perform the separately reviewed live Neon WebSocket
   isolation/transaction-context check. Local PostgreSQL/SDK checks do not prove
   that transport. Keep all test data synthetic and reversible; no persistent
   second-tenant setup or real-family records are authorized by this preparation.
7. Install a **production-only** `DATABASE_URL` for that restricted login. It must
   use an exact Neon hostname and only `sslmode=require`, following the pinned
   WebSocket runtime contract. Unsupported libpq URL options must not be portrayed
   as enforced. Keep `DATABASE_MIGRATION_URL`, bootstrap identity configuration,
   owner URL/password aliases and unused Neon Auth variables absent from all
   deployed runtime environments. Leave previews without production database or
   provider credentials; a preview needs its own later synthetic setup.
8. Preserve the existing production `RESEND_API_KEY`. Install a new independently
   generated `BETTER_AUTH_SECRET`, the existing private Google client JSON's paired
   credentials, the selected bare sender mailbox on verified `centralreform.live`,
   and `PORTAL_ENVIRONMENT=production`, `PORTAL_DEPLOYMENT=production`,
   `BETTER_AUTH_URL=https://bneimitzvah.vercel.app`. Use private stdin/file channels,
   never credential command arguments or chat. Google's intentionally public OAuth
   setting remains; no new consent action or email test is implied.
9. Check names/scopes/presence, but **do not enable runtime authentication or deploy
   enabling configuration until the separate hosting request-log query leak is
   repaired and reviewed**. Database success cannot waive that gate. Once all
   release gates pass, root coordinates Daniel's genuine sign-in and the existing
   private owner bootstrap. Account identity sign-in alone grants no congregation role.
   Real mail delivery, Google round trip, owner grant, provider logging/tracking
   checks and any family pilot remain separate explicit acceptance work.

The sequence above was the reviewed proposal. The execution evidence at the top
records which steps are now complete; the later auth/bootstrap/deployment steps
remain outside this database milestone.

## Concrete owner credential/session retirement

Perform this serially in the exact confirmed branch and database after fresh
review/authorization; no step in this section has executed.

1. Privately bind the expected branch/endpoint/database and owner role before
   rotation. Capture the exact database/role OIDs and operator backend PID without
   printing identifiers or credentials. Inspect numeric counts of this owner's
   client sessions in the target database and any other databases in the branch.
   If other database use exists, stop to review scope before claiming full retirement;
   do not terminate unrelated provider/project sessions. Keep one controlled direct
   and one controlled pooled old-credential session for explicit stale-session tests.
2. Disconnect the exact Vercel resource/project binding and verify synchronization
   and all owner aliases absent in Production/Preview. Rotate the owner password
   through the exact existing Neon branch role. Capture the replacement direct
   owner URL into a new private operator file. Establish a fresh replacement-password
   direct connection and verify target/identity/attributes before proceeding.
3. On that fresh direct operator session, terminate prior owner **client backends**
   only for the bound database and role, excluding this operator. The predicate is
   exactly `datid = $expectedDatabaseOid AND usesysid = $expectedOwnerRoleOid AND
   backend_type = 'client backend' AND pid <> pg_backend_pid()`; use bound values
   with `pg_terminate_backend(pid)`. Inspect only bounded counts/booleans, not query
   text, application names or account identities. Recheck no prior owner client
   backends remain in the target database.
4. Prove the controlled pre-rotation direct and pooled handles are no longer usable.
   Prove **fresh** old-password direct and pooled authentication fails with an actual
   authentication category (for example SQLSTATE 28P01/28000), while replacement
   credentials work on each tested path. A timeout, DNS error or TLS error is not
   stale-credential rejection. Close all successful test connections immediately;
   perform no user-data query through an unexpectedly accepted stale connection.
5. PgBouncer frontend authentication/cache state is not proven retired by terminating
   PostgreSQL backends. If a prior pooled handle remains usable or fresh stale pooled
   authentication succeeds, stop runtime setup. Obtain a separately reviewed,
   exact-resource pooler/session drain procedure from Neon (potential endpoint
   restart is a distinct reviewed operation); repeat both existing-handle and fresh-
   authentication tests after it. Never assume a cache TTL or claim password
   rotation alone purged authenticated pooler clients.
6. After reviewed migrations/login checks, close the operator connection. A separate
   short-lived direct inspector may verify bounded remaining owner-client counts,
   excluding itself, then close. Do not leave operator pools/credentials in runtime.

The owner's `withTenantTransaction` rejection is a separate private operator
preflight after migrations supply `portal_runtime`: invoke the existing wrapper
through the direct operator database, require rejection before callback entry,
and emit only a boolean/fixed phase. Do not pass the owner file or URL into the
restricted WebSocket probe child. Its launcher refuses owner aliases and accepts
only the exact new `portal_app` login.

## Operator-only WebSocket probe implementation

Files under `scripts/provider-bootstrap/` are `probe-neon-ws.mjs`, its declaration,
`neon-ws.ts`, `neon-ws.operator.test.ts` and `vitest.operator.config.mts`. The launcher
reuses the installed Vitest/Vite TypeScript runtime without a new package or loader.
Its dedicated runner is outside ordinary npm-test/CI includes; `.env` loading is
disabled. The marker-only `server-only` stub exists only in this operator runner.

After root reviews the source and authorizes execution, create a trusted private
single-key file containing only `PROVIDER_RUNTIME_DATABASE_URL` for the restricted
`portal_app` login and the reviewed `sslmode=require`-only Neon URL. Then invoke:

```text
node scripts/provider-bootstrap/probe-neon-ws.mjs --env <private-restricted-probe.env> --run
```

The launcher checks key/role/URL shape, excludes owner/database/PG/provider values
and Node hooks from the child environment, and forwards only the restricted URL
and explicit execution gate. It never forwards the private input path or owner file.
Raw child reporter output stays captured and is not logged; the parent emits only
one closed pass/fail phase. The operator test catches every failure into fixed
sanitized phase codes without a cause, SQL, rows, connection, token or raw driver
error. Connections/queries/idle transactions and the whole runner have finite bounds.

Actual probe behavior (live execution now passed above):

- Uses pinned `@neondatabase/serverless` 1.2.0 `Pool`, Drizzle and the unmodified
  `withTenantTransaction` role-closure contract. Requires all 15 tenant/work/throttle tables
  to have both ENABLE and FORCE RLS.
- Checks no-context and explicitly empty-context protected reads/CRC insert denial.
  Uses savepoints and requires RLS SQLSTATE 42501; network errors are not denials.
- Creates/reads/updates one synthetic CRC student inside a transaction. A different
  unmapped context string must hide both CRC seed and that fixture; CRC insert and
  update attempts must be denied. It creates no second tenant. Every write fixture
  is rolled back, including on probe failure, and a subsequent CRC transaction must
  prove the fixture absent.
- Compares backend identities immediately before, inside and after each tested
  transaction rather than assuming reuse; all three must match and the before/after
  context must be empty for the SELECT-only commit and synthetic-write exception
  rollback. Identical outside samples cannot hide a different transaction backend.
  Two concurrent physical backend identities must differ while their
  local contexts remain independent. A pooler that prevents observed reuse fails
  this bounded acceptance check rather than receiving an invented reuse claim.
- Resolves the selected Vercel origin through the actual composed runtime. The
  other seeded production origin, arbitrary preview and inconsistent/forwarded
  hosts must fail. Outgoing component fetch is blocked; no SDK authentication or
  sending path is invoked. Synthetic in-memory mail placeholders are not a claim
  that actual Resend configuration works.

Offline verification after the reviewed backend-sampling repair: **6/6 focused
tests pass** and `npx tsc --noEmit` passes.
Tests cover strict private input/scrubbed child environment, closed sanitized
reporting, invalid-input-before-connect, driver-error sanitization/cleanup and
savepoint recovery that distinguishes actual RLS denial from other errors or an
unexpectedly successful insert. The added adversarial case rejects matching outer
PIDs with a different transaction PID for both commit and rollback, changed
post-transaction backends, retained contexts and invalid IDs. They mock the driver
and establish no live Neon result. Independent correction review and explicit
remote-execution authorization were completed before the execution above. The prior full app run passed 398 tests
plus one existing skip before this narrow correction; it was not repeated here.

Daniel reports the Resend domain is Verified, the key is installed and click/open
tracking appears off. Root accepts those reported facts for preparation. Actual
sending readiness remains for Daniel-initiated delivery; no test email was sent.
