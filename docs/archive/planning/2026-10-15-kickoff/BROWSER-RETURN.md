# Isolated HTTP browser harness — 2026-10-15

Status: test-only implementation passed its first disposable PostgreSQL browser run; four independent review corrections are implemented and await the final private PostgreSQL rerun plus reviewer confirmation. No production handler, route, provider configuration or identity shortcut was added.

## What it exercises

`npm run test:http:browser` starts a separately invoked Vitest process with a custom Next development server at `127.0.0.1:3187`. The server dispatches only approved auth/application paths through `createHttpDispatcher`; Next handles the rest. Its adapter uses the actual Host, rejects duplicate critical raw headers and ambiguous URLs, streams request bodies to the production body limiters, and keeps separate Set-Cookie headers. The test process supplies a restricted database runtime, a private in-memory synthetic mail queue and a synthetic reading loader. It does not call Resend, Hebcal, Google or Neon.

The browser uses installed Chromium without traces, videos or HAR. Browser network routing rejects any nonloopback request; the test process also rejects unexpected nonloopback fetches. It requests magic links through HTTP, consumes captured real SDK verification URLs by browser navigation, and relies on the resulting cookies. It covers admin, tutor/parent and invited student modes; two sibling tabs with separate practice handles; wrong-target and stale-handle denial; invitation landing GET without acceptance, verified preview, explicit POST and replay; and logout. No auto-sign-in fixture cookie is given to the browser.

The same command probes the actual built Next production server (`next start`) at `127.0.0.1:3188` using `isolatedEnv` with empty provider config and attempted test flags/identity headers plus local deployment settings under `NODE_ENV=production`. Unknown capture/helper URLs must be 404; known private session/student requests must return the fixed private 503 JSON response. Every production server JS/MJS/JSON file, including shared chunks, is checked for test bootstrap/capture markers. This is wrapper-denial evidence, not proof of provider success or a configured production runtime.

## Isolation and invocation

The suite requires a prebuilt `.next`, installed Playwright Chromium, and the explicit disposable PostgreSQL environment accepted by `tests/postgres/disposable.mjs`: `POSTGRES_TEST_DISPOSABLE=1`, loopback `PGHOST`, numeric `PGPORT`, `PGDATABASE=portal_rls_test`, and disposable `PGUSER`/`PGPASSWORD`. It never reads application `DATABASE_URL`. The startup guard runs before any DB provisioning. The shared fixture creates a random database and restricted LOGIN, migrates with its owner, and drops only those generated names on close. The new HTTP host row uses local environment and an exact `http-browser` deployment identity. Pinned Next drops custom-server `conf` during `prepare()`, so the harness copies the synthetic app source/config into a temporary ignored `.local-logs/http-browser-project-*` project. Next writes its dev build and TypeScript changes there; the main `.next` and `tsconfig.json` stay unchanged. The server refuses production/deployment indicators and binds only loopback.

CI's PostgreSQL job installs Chromium, builds the app, then runs this command after the existing SQL/access gates. Default `npm test` remains offline. The process suppresses provider/library diagnostics; assertions use statuses and booleans, and navigation failures produce fixed messages. No captured token, cookie, full address, provider body or connection string is reported.

## Verification

- `npm run typecheck` — passed.
- `npm run check:repo` — passed.
- `node --test tests/isolation.test.mjs` — 3/3 passed.
- `npx vitest run --config vitest.http-browser.config.mts tests/http-browser/production-denial.test.ts` — 2/2 passed against the current built app, with exact private response checks.
- `npx vitest run --config vitest.http-browser.config.mts tests/http-browser/egress.test.ts tests/http-browser/server-isolation.test.ts` — 2/2 passed. The isolation test also passed on a second consecutive run; a private Next dev output directory was observed, the main `tsconfig.json` and production build ID were byte-identical before/after, and the new temporary project was removed.
- First full PostgreSQL-backed `npm run test:http:browser` — 4/4 passed in 14.26 seconds on the private disposable cluster. A final rerun after startup/egress review edits is pending.

The custom server proves the shared dispatcher path with real browser cookies but cannot alone prove that Next's production route wrappers serve authenticated traffic. The production probe intentionally tests only denial without provider configuration. Live provider, deployed ingress and successful configured production-wrapper checks remain separate gates.

## Initial independent harness review — bounded corrections

Reviewed startup/request adapter, private fixture, real-browser flow, production
denial probe, separate Vitest/CI invocation and child-environment helper. **Not
accepted at this initial checkpoint.** Primary supplied a current stable **4/4** browser
and production-denial run; this reviewer reused that evidence and did not obtain
or run with PostgreSQL credentials. No implementation or Git edits were made.

Four required corrections were consolidated with primary and the author:

1. **Effective Next output/config isolation.** `server.ts:53-54` supplies a custom
   `conf.distDir`, but primary observed the declared ignored directory absent,
   `.next/dev` created instead and tracked `tsconfig.json` automatically changed
   with a dev-types include and formatting. The current source therefore does
   not establish its claimed isolated build/config behavior. Use the pinned
   Next-supported configuration path and isolated test TypeScript configuration,
   then verify the tracked file and production build remain unchanged. Do not
   stage the incidental TypeScript mutation.
2. **Production import exclusion coverage.** `production-denial.test.ts:42`
   scans `.next/server/app` only. Real route implementations can live in shared
   `.next/server/chunks`, so absence from that limited directory cannot establish
   no production test-helper imports. Inspect the whole applicable server output
   or the actual source/import graph, including shared chunks.
3. **Direct local-bypass denial and meaningful statuses.** The production child
   sets the browser flag but should also attempt explicit local environment and
   deployment configuration under `NODE_ENV=production`. The current check at
   `production-denial.test.ts:64` accepts arbitrary statuses except200/302; require
   exact fixed expected unavailable/not-found statuses and safe response shapes.
   An unrelated500 or redirect must not count as proof of the intended guard.
4. **Redirect-safe process fetch guard.** `browser.test.ts:19` validates only the
   initial URL and invokes the captured original fetch with default redirect
   following. A loopback redirect can therefore reach a destination that a direct
   call would reject. Enforce no redirects (after caller options) or validate each
   manual hop, and prove the forbidden redirected target is never contacted.

By inspection, the browser uses actual HTTP SDK magic-link verification/cookies,
not fixture cookies injected into Chromium; runtime requests use the restricted
pool and live restricted-role preflight. Synthetic transport queues are private
process objects with no capture routes. Startup validation precedes fixture
provisioning in the suite; duplicate critical raw headers, wrong raw Host and
ambiguous paths are refused before dispatcher scope. Browser routing rejects
foreign origins, and service workers/download artifacts are disabled. Production
children use isolated environment/home and no provider credentials. These useful
boundaries do not close the four verification/isolation gaps above.

Next action: author fixes, then independent focused startup/raw-header/egress and
production exclusion/denial verification. Do not infer browser UI completeness,
configured production success, live providers, deployed ingress or per-client
rate limiting from this harness. The separately reviewed shared HTTP route slice
retains its own acceptance; this pending review concerns harness/test claims.

## Corrections after that review

All four issues above were addressed in test-only source. The isolated Next test
project replaces the ineffective programmatic `conf`, with repeatable proof that
the main TypeScript config and production build ID do not change. The production
scan includes shared server chunks without a size exemption. The production
probe attempts local deployment settings under `NODE_ENV=production` and
requires exact 503 private JSON/headers and 404 unknown-path outcomes. The
process fetch guard forces `redirect: "error"`; a two-server regression proves
the redirect destination receives zero requests, and direct nonloopback fetch
is denied. Final PostgreSQL browser execution and independent review remain.

## Independent correction verification — accepted

All four bounded findings are closed for this test-only harness. Independently
inspected the copied-project arrangement: its absolute directory comes from
`mkdtemp` beneath the checked workspace `.local-logs` prefix; cleanup captures
only that created directory, with bounded Windows retry handling. The current
log root is an ordinary directory and `src` contains no reparse points. Node's
recursive `rm` removes nested symlinks rather than traversing their targets; no
source tree, production build, supplied filesystem path or shared checkout is
passed as a cleanup target. The copied app/config gives pinned Next its own
mutable TypeScript configuration and `.next/dev` output. Independent isolation
execution preserved root `tsconfig.json` and production `BUILD_ID` byte-for-byte
and left no newly generated project directories.

The production scan now covers the entire `.next/server` JavaScript/JSON output,
including shared chunks and without a file-size exemption. The actual Next
production child receives attempted local environment/deployment settings and
browser/identity flags; private application paths return exact503 private JSON
and headers, while unowned helper/test paths return exact404. This proves denial
with the current unconfigured production wrappers, not configured production
authentication success. The process fetch guard overwrites caller redirect
options with `redirect: 'error'`; its independent two-loopback-server regression
observes zero requests to the redirect target. Browser routing remains a separate
same-origin guard, and private mail/reading providers remain injected fixtures.

Added `tests/http-browser/server-review.test.ts` with two independent transport
probes. Denied startup/deployment environments create no private project and
never enter runtime scope. A real socket request positively reaches the
dispatcher; wrong raw Host, duplicate Host/Cookie/Origin/Content-Type/practice
headers, conflicting length/transfer encoding, absolute/protocol-relative
targets, encoded traversal and fragments all deny400 without a second runtime
entry. The new tests obtain no PostgreSQL credentials and do not provision data.

**Independent focused results:** **6/6** across reviewer startup/raw-header,
server isolation, egress and production-denial files; typecheck passed;
`tests/isolation.test.mjs` **3/3** passed. Logs are ignored at
`.local-logs/phase2-security-browser-corrections.log`,
`.local-logs/phase2-security-browser-typecheck.log` and
`.local-logs/phase2-security-browser-isolation-lint.log`. Primary separately
reported the corrected actual-browser/restricted-PostgreSQL suite **6/6** across
the four author files; that reusable execution establishes genuine HTTP SDK
cookies/role/context/invitation flows, and is not claimed as an independent
credentialed rerun by this reviewer.

**Cleanup limitation:** the earlier failed-run directory
`.local-logs/http-browser-project-XkpsGh` remains ignored, with only its `.next`
child reported by primary. Automatic approval review rejected primary's manual
cleanup; no retry or alternate deletion was attempted by this reviewer. This
residual is disclosed rather than claimed removed. Corrected subsequent runs
independently demonstrated cleanup of their newly created directories.

Scoped harness acceptance is complete; primary retains integration/CI/publication
gates. There is no production identity bypass/test import, provider setup,
configured live-provider success, portal UI completeness, per-client throttle
claim or generated-chant release in this result. No implementation/Git edits or
recursive delegation were performed by this reviewer.

## Initial portal UI browser acceptance and production-test isolation

Independent test ownership covered `tests/http-browser/portal-ui.test.ts`, its
optional synthetic Google fixture configuration, and the replacement
`e2e/foundation.spec.ts`. Primary executed the PostgreSQL-backed UI file:
**5/5 passed** in `.local-logs/portal-entry-browser-rerun.log`; the other eight
HTTP browser checks passed in the preceding combined run. These are primary's
private executions of reviewer-authored tests, not a claim that the reviewer
received or used database credentials.

The UI tests use actual SDK magic-link requests, captured synthetic mail,
verification navigation and browser cookies against the restricted PostgreSQL
runtime. They exercise synchronous double-submit protection for magic links and
reviewed acceptance, explicit separate role labels without invented role
destinations, cookie-only invitation landing/review, no acceptance before review,
one binding-only acceptance POST, invalid/replayed invitation denial, own logout,
and cross-tab logout revalidation. The history-navigation case leaves an open
invitation review, logs out in another tab, goes back, and requires sign-in with
no stale student label or acceptance button; signing in again restores a fresh
review. **Native BFCache restoration was not observed and is not claimed.**

Google initiation is actual SDK HTTP behavior with state/PKCE/callback checks;
the browser fulfills the provider navigation locally, so this does not prove a
Google provider round trip. Setup/retry and malformed-provider-response cases
are explicitly mocked UI failures. Desktop/phone checks cover overflow, fixed
errors, focus and privacy; they are not a comprehensive accessibility audit.
No mail address, captured token or cookie is asserted as failure output. Browser
and process egress guards stay enabled; no traces, video or HAR are captured by
the private UI suite. Primary generated four ignored synthetic screenshots under
`.impeccable/review/` for the separate fresh visual reviewer, before email entry
and at invitation review. This reviewer did not perform that visual finish review.

The built unconfigured production UI tests replaced the technical-placeholder
assertions for desktop, tablet and phone. Primary's first execution was **6/6**;
the following test-harness safety correction requires a final primary execution.
Installed Playwright 1.64.1 `lib/runner/index.js` merges parent `process.env` into
`webServer.env`, so supplying an allowlist there cannot isolate provider config.
`playwright.config.ts` now uses `e2e/server-setup.ts` and the test-only
`tests/helpers/builtE2eServer.mjs` to spawn Node/Next directly with `isolatedEnv`,
explicit production mode, no shell, ignored child output and fixed diagnostics.
It refuses an occupied port, waits for readiness and returns teardown which
waits for process termination before removing only its fresh isolated HOME.

Pinned Next also reads production dotenv files independently. Before any child
or isolated HOME is created, metadata-only `lstat` checks all four possible
filenames and refuses any existing entry, including directories or symlinks;
no private dotenv contents are opened. This unconfigured production gate must
therefore run from a clean checkout without `.env`, `.env.local`,
`.env.production` or `.env.production.local`. An operator-configured checkout
should use a separate clean checkout; the private SDK harness already uses a
copied project. Shell provider/operator variables are discarded rather than
overridden selectively.

Focused synthetic regression and existing isolation checks passed **6/6**:
all four dotenv names and a directory entry deny before project execution;
a disposable fake Next child receives no synthetic inherited provider/operator
configuration and its HOME disappears after teardown; occupied ports cannot
reuse another service. Typecheck and Playwright discovery passed (six device
tests). Logs: `.local-logs/e2e-server-isolation.log`,
`.local-logs/e2e-server-typecheck.log`, `.local-logs/e2e-server-list.log`.
Repository publish-candidate/index guard passed **1/1** in
`.local-logs/portal-ui-repo-guard.log`; no guard exception was introduced.
No application implementation, Git, provider setup or real attachment access
was involved. Primary retains final production e2e, independent harness review,
integration, CI and publication gates.
