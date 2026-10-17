# Original-ID registration checkpoint

## Root integrated release — 2026-10-17

Exact `bc10207a38acfcf1bafc7e850b1fed1236989c13` is main and normal READY canonical deployment `dpl_3B3w2Qqq5b7anwq3LJ4zt6ADwCe1`. Source7b7a3b7, independent2ab4479 and the root contract are integrated. All four [hosted jobs39056624743](https://github.com/RavBogard/bneimitzvah/actions/runs/39056624743) pass: Node303 per OS; app1028 Linux/1027 Windows+one existing skip in108files; nativeSQL34, restricted PostgreSQL140, authenticated browser137, public browser15, both typechecks/builds. Root local Node303, app1027+skip/108files325.63s, type/default build and final staged protection pass. Full ignored logs: `.local-logs/original-id-{full-node,full-app,full-type,full-build,integration-guard,hosted-complete}.log`.

The root-only read-only release derivative2ea0e9b5 reverses only approved pins/unique rollback filename to acceptedb9 exactly; independent12/12 offline cases pass. Root recorded the protected immutable38d5 rollback reference, then non-force fast-forwarded main. The first bound release check refused during cutover; separate default status then a fresh complete bound check returned release-ready/canaryTargetMatch true. No failed deployment was replayed or staged test promoted. Normal canonical alias, exact main/source, absent probe metadata/exposed flags and the existing OIDC/private store/sole Production link/env reference all pass. Immutable record: protected `original-id-release-bc10207-rollback.json`, not Git.

Matching canonical/anonymous-private/alias/test-route/Google-challenge HTTP checks pass. Unchanged hash-pinned563f native canary passes five route events/five matching native rows, exact source and zero secret canaries. Prior evidence is protected in `native-auth-before-bc10207`; new closed result remains ignored. No production schema/data/import/invitation/mail/provider-object or real audio operation occurred. Existing privacy/retention and registrar absence from runtime remain unchanged. This closes the internal seam checkpoint only; original author pending statements below retain their historical stage.

The server-internal registrar can compose caller writes, an exact original recording ID and its creation audit in one existing authorized transaction. No runtime/HTTP route, receipt schema, byte verification or provider operation is added. Legacy random-ID registration and asset-based retries remain intact.

## Changes

- `registration.ts`: one-shot `withRegistrationAuthority` callback exposing the existing transaction, actor, student, fresh check and `registerVerified`. Exact private/submitted replay requires the original ID and every immutable descriptor fact; collisions never adopt another ID. A private exact-identity AccessDenied bridge crosses the unchanged auth sanitizer and is translated outside authority into `RecordingRegistrationConflict` (legacy register retains its conflict return).
- A caught registration failure poisons the composition. Repeated/concurrent/escaped invocation is refused. Callback settlement closes synchronously, observes/drains pending registration inside the transaction, and permits no later registration SQL. Callback/auth/SQL errors are not classified as collisions. Whole-callback freshness remains authoritative.
- `data/recordings.ts`: `insertWithId`; existing random-ID insertion delegates to it. No schema/policy changes.

## Author verification

- `node .local-logs/run-isolated.mjs recording-original-focused npm run test:app -- tests/app/recording-original-id.test.ts tests/app/recording-ledger.test.ts tests/app/recording-ledger-review.test.ts`: 18/18 PASS across three files, 35.95s (five new ordinary cases).
- `node .local-logs/run-isolated.mjs recording-original-type npm run typecheck`: PASS; repeated composed check after native test addition via `recording-original-native-type`: PASS. Includes independent draft imports; independent execution is separate evidence.
- `node .local-logs/recording-original-pg-isolated.mjs`: native 3/3 PASS, 1.85s tests/4.47s runner. Three actual `pg_blocking_pids` edges: same-ID replay and different-ID/same-asset unique waits, plus create-audit wait crossing the anniversary. Conflicting caller audit rolls back. Exact known disposable local cluster marker checked; owned fixture clients/databases closed and anchor removed true. Log `.local-logs/recording-original-author-pg.log`.
- Staged repository protection: 3/3 PASS31.99s via `recording-original-guard`; final diff check clean.
- No failing author run, broad suite, remote database or provider operation in this checkpoint. Independent closure-drain/expiry adversaries and root integration/CI remain pending.

Root-owned spec/design notes and reviewer-owned tests are excluded from this commit. Root owns integration/release; no push or migration apply performed.
