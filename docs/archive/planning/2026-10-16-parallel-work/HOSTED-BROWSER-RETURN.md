# Hosted browser diagnosis — 2026-10-16

Status: narrow keyboard-test correction implemented and locally browser-confirmed; frozen for independent review. Only `tests/http-browser/workspace-ui.test.ts` changes permanently. No application, UI style, authorization or geometry-threshold change; no stage/commit performed.

## Hosted baseline and two failures

Root reports pushed checkpoint `0b433ca` in hosted run `38982972152`: Windows/Linux unit jobs and public browser pass; the PostgreSQL browser job passes 67/69 cases. This assignment has inspected the relevant local test/source and the local setup log, rather than independently claiming a successful hosted reproduction.

1. `study-ui.test.ts`: first Hebrew bottom reported as 824.125 at a 390×844 viewport, beyond the existing 820 boundary (`viewportHeight - 24`). The test intentionally reserves 24 pixels for platform font differences. Do not relax that bound or modify application styles in this workstream; Claude owns the redesign and its visual acceptance.
2. `workspace-ui.test.ts`: sibling-practice case has a boolean assertion failure, with a misleading hosted source-map location. The local controlled before-run confirms the earlier keyboard assertion at line 152: first Tab reaches `A`, while the stale test expected `SUMMARY`. It fails before the delayed-child and revocation checks. After the test correction, the full file passes all three cases, including those later security assertions.

## Specific focus-order evidence

The sibling test focuses `Refresh reading`, presses one Tab, then asserts the active element is `SUMMARY` and presses Enter to open the first details element. `src/components/portal/workspace/reading.tsx` now places a focusable `Service parts` anchor immediately after Refresh when there are fewer than two readings. `AssignmentContext` renders the assigned-verse disclosure after that context row. In the full workspace test file, the first case confirms only the Torah range `Genesis 1:1-3`; the later sibling case asserts that exact range before checking mobile keyboard behavior. Thus the rendered source predicts the first Tab reaches the service anchor (`A`), and the second reaches the expected summary.

Root approved and the author applied this minimal test correction:

- Keep focusing Refresh and pressing Tab; explicitly require the `Service parts` link scoped to `.reading-student-context` to be focused.
- Press Tab again and require the summary scoped to `.reading-current-assignment > details` to be focused.
- Press Enter and assert that same details element is open, instead of matching an unrelated first disclosure.
- Preserve all remaining mobile/zoom overflow, copied-URL rejection, raw-handle nonexposure, sibling-tab isolation, held old-child reads, stale-handle 404, parent return and delayed-exit-after-role-navigation assertions.

This strengthens semantic keyboard evidence for the existing focusable entry point. It does not change server access behavior, hide a failed security assertion or loosen a geometry threshold. The three new semantic assertions have explicit descriptions so later failures identify the focus step without logging tokens, cookies, handles, request/response bodies or student content. The temporary before-run instrumentation reported only the active HTML tag and was replaced by the final semantic assertions.

## Local reproduction boundary

Root's prior `.local-logs/workspace-ci-repro-browser.log` reports **suite setup failed, all three tests skipped**. It also shows Next's suggested generated-types include adjustment in its isolated project. The generic setup error and source-map pointer do not establish which test assertion failed; no browser test passed in that attempt.

Root identified `127.0.0.1:3187` as occupied by Claude's UI browser harness (PID 52776 when observed). This assignment did not terminate or interrupt it. `tests/http-browser/server.ts` hardcodes `BROWSER_PORT = 3187`; `BROWSER_ORIGIN` derives from that constant, and `fixture.ts` imports both for host mapping/auth/runtime origins. The approved private diagnostic wrapper confirmed 3188 free, changed that one constant to 3188 only during each run, and restored the exact original bytes in `finally` after each run. No permanent server-port edit remains (`git diff -- tests/http-browser/server.ts` is empty).

`postgresAccessFixture` creates a random `portal_access_<suffix>` database and restricted login per invocation, then migrates and cleans up only those generated identifiers. Its anchor configuration still comes from the explicitly disposable loopback runner. This diagnostic preserved the other harness by using fresh unique temporary anchor roles; there was no cluster start/stop/reset, existing-role password rotation or connection/PID termination.

The ignored wrapper `.local-logs/workspace-ci-isolated.mjs` used the existing Ubuntu peer-admin path only after enforcing the exact disposable cluster identity: loopback PostgreSQL port 55439, PostgreSQL 16.15 (`server_version_num=160015`), base database `portal_rls_test`, data directory `/var/tmp/bneimitzvah-races-0006-3a17d2`. It did not use default WSL port 5432. Each run created a unique temporary login for owning only its new fixture objects, passed its random credential via `isolatedEnv`, ran browser requests under the existing generated restricted `LOGIN`/`portal_runtime` pools, then dropped only its own anchor after fixture children closed. Both runs reported anchor cleanup true and exact server restoration true. Credentials were sent to peer SQL on stdin, not printed or included in command arguments. The existing original private runner was inspected through AST metadata only; none of its credentials were reused or printed.

`disposableConfig` still requires explicit opt-in, the named disposable base database and loopback-only PGHOST. The before/after runs use the same unchanged restricted-role runtime preflight in `fixture.ts`; no test fixture, migration or guard allowlist was weakened.

## Actual before/after verification

Both runs launched `node_modules/vitest/vitest.mjs run --config vitest.http-browser.config.mts tests/http-browser/workspace-ui.test.ts` through the private wrapper with `isolatedEnv`, CI capture suppression and diagnostic port 3188. Only synthetic fixtures were used.

- **Before:** 2 passed / 1 failed, 21.15 seconds. `.local-logs/workspace-ci-isolated-before.log` contains the fixed-description, tag-only diagnostic: expected `SUMMARY`, received `A`. It independently reproduces the misleading source-map pointer, so that pointer is not evidence of a failure in the later delayed-response logic. Port restored true; owned anchor cleanup true.
- **After:** **3 passed / 0 failed**, 23.43 seconds. `.local-logs/workspace-ci-isolated-after.log`. The corrected sibling case completes in 10.354 seconds and reaches all retained later assertions. Port restored true; owned anchor cleanup true.

Frozen SHA-256 of actual worktree bytes:

| File | SHA-256 |
| --- | --- |
| tests/http-browser/workspace-ui.test.ts | 3EE2D3344FC7C1AC14881812FDE7E56CCE418B5F059A48CACBCA6F9BA559263D |
| tests/http-browser/server.ts (restored; no diff) | 2962C80B82A103E66556D7DCFD632AB08B73271818FEF72FDCDB3ED0A1F2EAF3 |

No full 69-case hosted rerun, app/unit suite, typecheck or CI acceptance is claimed here. Root owns the final exact-commit checks.

## Next action

Independent reviewer checks the frozen narrow test diff and before/after evidence, then root integrates and reruns the required hosted gates. The phone geometry failure remains with the UI workstream; its 820 boundary is unchanged. No staging/commit, provider operation, real data or application/UI/auth-source change was performed by this diagnosis.

## Independent review — accepted frozen test correction

**Accept this bounded test-only correction.** The independent reviewer inspected the exact final diff, current rendered source structure, before/after browser logs and private diagnostic wrapper after the author declared the freeze. No additional browser was launched, no source was edited by the reviewer, and no broader backend audit was repeated.

The old generic tag assertion incorrectly skipped the existing focusable `Service parts` anchor. The new first assertion requires that exact link inside `.reading-student-context` to be focused. The second Tab must focus the direct summary of `.reading-current-assignment > details`; Enter must open that same scoped details element. These assertions identify the intended keyboard targets more precisely than the old `SUMMARY` tag/first-details pair. They do not skip a failed assertion or relax a timing/geometry bound.

The final test diff is exactly five insertions/two deletions in this keyboard block. All subsequent copied-URL, sibling-tab/context isolation, stale raw-handle rejection, held old-child response, late exit after role navigation, handle nonexposure, phone overflow and 200% zoom assertions remain byte-for-byte unchanged. No product/UI/auth code, fixture authority, schema, test threshold or study geometry expectation changes as part of this correction.

The reviewer directly inspected `.local-logs/workspace-ci-isolated-before.log`: two cases pass and the sibling case fails with expected `SUMMARY`, received `A`, before the later security assertions. The after log reports **three passed, zero failed** in 23.43 seconds, including completion of the corrected sibling case and its retained later checks. The misleading source-map location therefore does not establish a later authorization failure. These are accepted focused local browser results, not a new full hosted-suite pass.

Isolation review confirms the wrapper checks free diagnostic port 3188 and the exact disposable PostgreSQL identity before creating a fresh random anchor role. The existing fixture then creates its own database/restricted runtime login; `browserFixture` still serves requests through that restricted pool. The wrapper creates/drops only its own diagnostic anchor, never alters an existing role's password or starts/stops the shared cluster. Its `finally` restores the original server bytes and cleans the owned role/isolation home; the author reports successful cleanup for both runs. The reviewer independently verified `tests/http-browser/server.ts` has an empty Git diff and SHA-256 `2962C80B82A103E66556D7DCFD632AB08B73271818FEF72FDCDB3ED0A1F2EAF3`, matching the original/restored pin above. The frozen test SHA-256 independently matches `3EE2D3344FC7C1AC14881812FDE7E56CCE418B5F059A48CACBCA6F9BA559263D`.

No blocking finding remains in this test correction. Root can integrate the frozen test and run the exact-commit hosted gates. The separate phone Hebrew geometry failure remains outstanding with the UI workstream, and its existing 820 boundary is preserved. This disposition neither authorizes application styling changes nor claims that all 69 hosted browser cases now pass.
