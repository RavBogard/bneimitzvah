# Explicit 0020 recording-ledger release operator

The new `scripts/release-migrate-recordings.mjs` and support module accept only the exact 20-entry 0019 baseline or its 21-entry 0020 result. Source SQL, journal and snapshots are pinned to reviewed `f5b17215302f60ba18d385e97d2a014066636971`. Candidate migration bytes and all old operator/reference bytes must match their pinned Git objects and clean working files; future migrations are refused. The old 0018/0019 operators, fixtures and future-refusal assertions are unchanged.

The existing protected-target V1 contract is reused: fifteen historically attested rows, exact derived LF rows 15–20, original tenant/owner/runtime-role identity, TLS and required channel binding. The same physical `ReleaseClient`, shared session advisory lock, source rechecks, repeatable-read snapshots, check-only default and fixed sanitized result/unknown-commit handling are retained. No generic migration authorization is added.

The new public reference contains only the three changed old table records and exact new 0020 records. Its old fields must match the prior reviewed catalog. A pinned SHA and structural delta permit only the new recording table/types/functions, audit-action CHECK and exact FK/retention triggers. This composes with every unchanged prior catalog field, including privileges, RLS, namespace and function source. Historical LF/CRLF selection changes expected hashes only; observed SQL is never transformed.

Every preexisting row column participates in full count/digest comparisons, including non-NULL Hebrew name, second contact and intake metadata from 0019. The new recording table must be empty both immediately after application and on an already-applied check. No roster, catalog, invitation, mail, grant or recording data operation is part of the operator.

Author verification:

- Pure `node .local-logs/run-isolated.mjs release-recordings-pure node --test tests/release-recordings.test.mjs`: 8/8 pass, 27.70 seconds. Covers source-before-target refusal, exact ledgers/source/dirty/future guards, historical selection, catalog mutations, one-client cleanup, unknown commit and drift. Initial reference validation exposed an expected trigger-array ordering mismatch; composition now proves the old trigger multiset unchanged before retaining the pinned native order. No observed-catalog normalization was added.
- Native `node .local-logs/release-pg-isolated.mjs --test --test-concurrency=1 tests/postgres/release-recordings.integration.mjs`: 8 reported checks (seven leaf scenarios), all pass, 17.45 seconds. Actual configured startup uses public creation schema; LF and real attested CRLF upgrade/idempotence, populated 0019 preservation, wrong attestation, shared lock, atomic late-SQL rollback, lost COMMIT acknowledgement, postcommit metadata/recording/grant drift are exercised. Log: `.local-logs/release-recordings-native.log`.
- The known disposable PostgreSQL 16 cluster identity was asserted, all fresh fixtures closed, and the generated owned anchor was removed. This is local compatibility evidence; actual PostgreSQL 18 check-only remains root-owned.
- Isolated repository protection and child-environment checks: 6/6 pass, 29.34 seconds. No guard, source pin or historical fixture was weakened.

Operator invocation defaults to inspection: `node scripts/release-migrate-recordings.mjs --expected-commit <exact-LF-candidate-SHA> --target <protected-target.json>`. Only root may add `--apply` after independent acceptance and exact candidate CI. A lost acknowledgement remains unknown and requires reconciliation, never automatic retry.

Independent adversarial review, final exact LF source proof, root PostgreSQL 18 check-only, and exact hosted CI remain pending at this author checkpoint. No production connection/application, provider operation, data import or deployment was performed. This prerequisite does not activate PCM, capture/upload/playback or physical deletion.
