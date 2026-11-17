# Explicit 0019 schema release — author return

Status: bounded source frozen for independent review, uncommitted. No production connection, migration, roster import, invitation, mail or deployment was performed by this author. Root owns the protected target and authorized release sequence.

## Contract

The new entrypoint is `scripts/release-migrate-roster.mjs`. It defaults to check-only and accepts the existing exact `--expected-commit`, protected `--target` file and optional `--apply` arguments. It reuses the existing V1 target unchanged: fifteen owner-attested historical entries, including their exact selected CRLF hashes; entries 0015–0018 must match the original pinned LF source. The old 0018 entrypoint, source guard, catalog activation contract and migration runner are unchanged.

Only the nineteen-entry 0018 baseline or twenty-entry 0019 result is accepted. Source validation pins all migration files to reviewed `add56e72cd83e8077519cc233161bd322b6e65e7`, independently verifies the unchanged 0000–0018 history against `4ad7e0c`, and requires exactly the 0019 SQL/snapshot plus journal append. Future migrations, alternate SQL, historical rewrites, dirty/untracked migration/operator files, wrong HEAD, and working bytes differing from exact Git bytes fail before protected input is read. Unrelated application integration commits may follow the pinned roster commit.

The existing `ReleaseClient`, verified TLS/completed required PLUS, owner/database/runtime-role/CRC-host identity checks, public creation namespace, session advisory lock and closed result format are reused. One physical owner client spans read-only preflight, fresh comparison, the existing migrator and postcheck. No outer migration transaction or second-connection apply gap is introduced. The existing migrator owns its transaction. Unknown commit acknowledgement and committed verification conflict require reconciliation; neither is automatically retried or described as rolled back.

The public catalog reference contains schema metadata only. Its complete pre-migration student record must hash to the accepted 0018 reference. Its result permits only `hebrew_name`, `second_parent_email`, `import_metadata`, their three CHECK constraints, and the corresponding column/check counts. Every other student attribute, table, type, function, policy, trigger, grant, schema and role remains exact. The complete native PostgreSQL student result is additionally pinned to SHA256 `c271b09b5968d4f431ebc7454364e616e05337c75ac32e5aa11daf1c1926ffaf`. Historical function-body expectations still use the prior exact attested LF/CRLF selector; observed SQL/catalog bytes are never normalized.

All public table row counts/digests are compared before and after. Student digests exclude only the three newly added keys on both sides, because adding NULL columns changes row JSON without changing prior values. A separate postcheck requires all three new fields to remain NULL. The old nineteen ledger rows must remain byte-for-byte equivalent in the captured projection. This is a schema-only first-release operation: populated intake fields, concurrent row changes or altered roles/catalog cause refusal or committed-verification-conflict, not permission to import or overwrite anything.

## Files and hashes

- Entry: `scripts/release-migrate-roster.mjs`, SHA256 `13a067ce634161f7f9967a9a0c83d3e4098f3091645f5981cfe8fd5da69c4922`.
- Source/ledger/reference guard: `scripts/release-migrate-roster-support.mjs`, SHA256 `28cebc78c72989164bdaebebbe8c3a0c83d41bf333180d940b64a9510a73cb2d`.
- Public reference: `tests/fixtures/portal/release-roster-reference.json`, SHA256 `ff0a48bbd0c495f84f9d5f4aa9091f549cd7dbb6480742daf5e9b1bc9f9c1c90`.
- Focused tests: `tests/release-roster.test.mjs`, `tests/postgres/release-roster.integration.mjs`; fresh owned fixture: `tests/helpers/release-roster-fixture.mjs`.

## Executed evidence

`node .local-logs/run-isolated.mjs release-roster-pure-final node --test tests/release-roster.test.mjs tests/release-migrate.test.mjs tests/isolation.test.mjs` passes **32/32, 27.29s**. This includes all prior 21 operator checks, three isolation checks and eight new cases. New cases cover target/source ordering, closed 19/20 ledger states, check-only/apply/idempotence, one-client cleanup, transport/identity/lock/idle failure, changed preflight, unknown/postcommit outcomes, metadata mutants, exact source/tree pinning and refusal by the unchanged old source guard. Every test subprocess uses the scrubbed isolated environment and awaited cleanup.

`node .local-logs/release-pg-isolated.mjs --test tests/postgres/release-roster.integration.mjs` passes **7/7, 17.64s**, using fresh native PostgreSQL fixtures and actual public-first parsed connection options. It proves default check-only, 19→20 with only one migration invocation, original ledger/data preservation, NULL fields, idempotence, new-constraint mutation refusal, actual CRLF history plus wrong-attestation denial, a competing physical shared advisory lock, late SQL failure with schema/ledger rollback, actual COMMIT lost acknowledgement, and postcommit changes to old/new student fields remaining reconciliation outcomes. All owned fixtures closed and the owned anchor was removed. The fixture explicitly overrides only loopback transport and observed local major; it does not claim actual Neon TLS evidence.

The reference generator applied only pinned 0019 to a synthetic native 0018 fixture and validated the old record before writing schema metadata; it contains no application row content. The final pure pass adds the complete result pin and its weakened-CHECK mutant. No further broad app/browser tests were run for these operator-only changes. Logs remain ignored: `release-roster-reference.log`, `release-roster-pure-final.log`, `release-roster-configured-pg.log`. Diff check passes; previous operator/application files remain unchanged.

## Remaining gates

Independent source/adversarial review, a clean committed exact-LF default-source proof and final exact hosted checks remain. Root must run the default check-only command against its protected target and review that result before any authorized apply. Root must reconcile any unknown/postcommit result rather than retrying automatically. Real roster import and invitations remain prohibited by this assignment.
