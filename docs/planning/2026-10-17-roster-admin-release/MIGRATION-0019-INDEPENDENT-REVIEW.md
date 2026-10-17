# Migration 0019 — independent operator review

Accepted within the reviewed 19-to-20 ledger transition. This review performs no production access or migration, roster import, invitation or mail operation. The old 0018 operator, source guard, catalog helper, reference and shared migrator remain unchanged. Final committed/LF artifact and target PostgreSQL18 preflight are still release gates.

## Source and invariants

Reviewed the six new source/reference/test files frozen on managed `3bc99ea` while they were still untracked. Source pins `add56e72cd83e8077519cc233161bd322b6e65e7` and the previous protected migration base. Exact candidate Git blobs, migration/snapshot/journal bytes and clean protected paths are checked before reading private target configuration and again around execution. It cannot apply an unreviewed extra migration. Existing V1 target and the exact previously attested 15-row history stay intact; rows15–18 require the accepted LF hashes. Only exact 19-row baseline or its sole twentieth 0019 row is admitted.

The preflight uses the existing strict direct-owner identity, verified TLS/required PLUS and fixed advisory lock on the same client as the migrator. Before/current snapshots must agree. Catalog validation preserves the complete prior schema, functions, grants, RLS, constraints and types. The additional student reference is constrained to three nullable no-default columns and three checks; native full-record SHA `c271b09b5968d4f431ebc7454364e616e05337c75ac32e5aa11daf1c1926ffaf` pins CHECK semantics, rather than trusting constraint names or a weak expression substring alone. Its migration hash matches exact pinned0019 bytes.

The student row digest excludes only the three newly added JSON keys, and the final snapshot separately requires those columns to be NULL in every student row. All old student values and every other public table remain covered by counts/digests; roles and the nineteen previous ledger rows are compared exactly. This exclusion cannot silently permit intake writes. Consequently already-applied validation also refuses a database whose new fields have since been populated; that is intentional for this no-import release gate, not a general post-import health endpoint.

Migration owns its transaction/COMMIT. A migration exception or lost acknowledgement returns unknown; a later verification failure returns committed-verification-conflict. Neither implies rollback after commit or triggers retry. Concurrent legitimate application writes can cause reconciliation conflicts; these digests do not prove migration corruption or impose a runtime write lock. Output stays fixed/sanitized and captures no family rows. Client errors, deadlines and cleanup failures remain closed results.

## Evidence and limits

Independent execution: `node .local-logs/run-isolated.mjs release-roster-review-pure node --test tests/release-roster.test.mjs` — 8/8 passed, 24.13s. Read the real wrapper, support, reference, fixture and integration cases; compared protected old operator paths unchanged. Pure source tests use injected Git/read composition and do not constitute the final default CLI source proof.

Author evidence inspected, not independently rerun: 7/7 actual configured local PostgreSQL tests,17.64s (`.local-logs/release-roster-configured-pg.log`), covering exact startup options/non-superuser owner, check/apply/idempotence, LF/attested CRLF, wrong attestation denial, physical advisory contention, late SQL rollback, real COMMIT lost acknowledgement and old/new-field postcommit writes. Author reports owned anchors removed and fixtures closed. Fixture transport deliberately overrides strict remote TLS for verified local PostgreSQL; no real production transport claim is derived from it. Prior accepted transport evidence is reused for unchanged code.

Frozen SHA-256:

| File | SHA-256 |
|---|---|
| scripts/release-migrate-roster.mjs | 13a067ce634161f7f9967a9a0c83d3e4098f3091645f5981cfe8fd5da69c4922 |
| scripts/release-migrate-roster-support.mjs | 28cebc78c72989164bdaebebbe8c3a0c83d41bf333180d940b64a9510a73cb2d |
| tests/fixtures/portal/release-roster-reference.json | ff0a48bbd0c495f84f9d5f4aa9091f549cd7dbb6480742daf5e9b1bc9f9c1c90 |
| tests/helpers/release-roster-fixture.mjs | af36815d8917f85c95dad6091295db99b62fc84db713045dd84c21bb9c5a03ba |
| tests/release-roster.test.mjs | d66eb334a102a7f371074c8de6ca7682976f419a862a52a67667fff6647889d7 |
| tests/postgres/release-roster.integration.mjs | 41f69e29460b6ed859013474f275a455a7d864eecb1820827e6a20befa03e798 |

No blocking source finding remains. Root retains commit/repository gates, actual default source validation from the exact LF candidate, reviewed target check-only and explicit release sequencing. None is represented as already completed here.

## Hosted SQL file-isolation follow-up

Hosted run `39028397076` reached the combined Node SQL glob and recorded18 passed/6 failed nodes. Old-operator lost-ack and new-operator postcommit cases received not-started instead of their expected migration/committed outcomes; the old CRLF case explicitly failed in recheck. This failed run is retained as evidence, not relabeled a migration success.

Independent read-only source/log review found that the SQL command launches its three files concurrently. Both release fixture families create/drop uniquely owned roles and memberships on the same PostgreSQL cluster. Their databases isolate table data, but the protected operator snapshots deliberately include all pg_roles and pg_auth_members. Concurrent fixture setup/cleanup can therefore change before/recheck snapshots and cause a correct pre-migration refusal. Per-database operator advisory locks do not serialize fixture creation in other databases. The observed phases are consistent with this mechanism; exact changed-role snapshot deltas were not captured, so the cause is source-supported rather than a measured interleaving trace.

The independently accepted repair is exactly one package.json script change: `node --test --test-concurrency=1 "tests/postgres/*.integration.mjs"`. The glob and every SQL test remain. Production role comparisons, both operators, tests and their explicit physical-connection contention cases are unchanged. This serializes test files, not the concurrency intentionally exercised inside the cases. Source diff and whitespace checks passed on base `1d9d0f78622e712dcd99ceea9548ac8830fdb17f`. No additional independent test run was performed for this line-only review. The author's combined actual24-node SQL run is pending the existing full-app lane finishing; replacement hosted CI also remains pending.

Separately attributed root evidence: exact LF candidate1d9 passed the default protected source proof (20 migration pins) and actual production PostgreSQL18 check-only, returning ledger19. No apply occurred. This closes the earlier default-source/target compatibility uncertainty for that candidate; it does not claim application or turn the failed hosted suite green.
