# Original-ID registration checkpoint

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
