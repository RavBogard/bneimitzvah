# Dedicated honoree database release

## Settled decisions (Daniel, binding)

Daniel authorizes completing and deploying the revised product. Quiet imports send no invitations or mail. Generated voices and student recordings are outside this release. On2026-10-18 Daniel explicitly approved before/after Torah blessings from CRC's existing Beit Mitzvah booklet, including its English translation and required credits, for invited CRC honorees' private expiring own-aliyah links. No booklet publication or audio sharing is approved. Exact source, notices and projection remain required; database deployment activates none of that material.

## Root architecture decision

The immutable honoree source baseline is `122a35f7fa4eea45c690d8be7f96bc80025ee5a2`. Implement a dedicated migration0023 operator; do not alter or reuse the0022 operator's honors-empty precondition. Production currently has23 ledger rows through0022. This release permits exactly24 through0023, and rejects future migration files or journal changes. Preserve exact historical source, reference and ledger contracts; runtime source guards require exact Git LF bytes. Offline fixtures use immutable Git blobs and isolated child environments, including on Windows.

Owner: one Sol implementation worker owns only the six new honoree operator, support, reference, offline test, fixture and manual acceptance files. Root owns architecture, immutable anchors, actual reference installation and execution. A separate reviewer must accept auth/tenancy/source/transport and outcome handling. No historical SQL, journals, operators, references or shared helpers change.

Preserve all preexisting rows, columns, catalog properties, functions, grants and roles, including populated honors_version, verse source assignments and recordings. The only catalog changes are the exact0023 SQL delta: five new tables, ten functions, eleven user triggers, exact FK/internal trigger dependencies, tenant RLS/grants and the three additional audit actions. Derive the full structural contract from the actual migration and native catalog, not an approximate hand-authored reference.

Backfill zero reading epochs for every existing student, without readiness filters. Backfill zero group epochs only for nonempty groups in each student's latest honors_version. Compare exact expected sets and digests. Link, operation and material-release tables must remain empty. New student INSERT remains quiet; do not add import seeding or modify application behavior.

Use existing closed owner target/provenance/tenant/origin/runtime-role rules, direct Neon PG18 verified TLS and enforced SCRAM-SHA-256-PLUS channel binding. Keep one connection, the existing advisory lock, bounded execution and two agreeing repeatable-read preflight snapshots. Default check-only; apply requires its explicit flag. No secrets or private driver errors in output. Source validation precedes target access and is repeated at execution boundaries.

Ledger/catalog already-applied recognition is separate from proof of the initial release state. Already-applied verification succeeds only while the exact zero-epoch derived state and empty capability tables remain provable. Later legitimate mutations produce `observed-applied-initial-state-unverified`, never a replay/reset instruction. Lost COMMIT acknowledgment remains unknown; post-COMMIT drift is a committed verification conflict, never claimed rollback. No blind retries or new override switches.

## Acceptance and release sequence

1. Implement structural checks and explicitly model-only offline fixtures. A model is not native evidence. Checkpoint reviewed preparation source first. Normal honoreeSourceContract must refuse a model-only reference before target access; a separate internal honoreeReferenceSource may prove exact committed preparation bytes and all historical references solely for the disposable capture fixture. It supplies no production CLI override and makes no new catalog claim. After actual capture and independent acceptance, root installs/pins the real reference and makes the final release checkpoint.
2. Root captures actual before/after catalog on an owned disposable PostgreSQL instance with synthetic populated historical honors, sources and recordings. Keep documented PG16 normalization distinct from actual PG18 production transport checks.
3. Independently review the native delta and reference provenance, then install and pin actual reference bytes. No family data or prayer bodies enter Git.
4. Commit and pass offline/hosted gates. Run the explicitly invoked exact-commit manual acceptance outside the ordinary integration glob:23-to24 check/apply, source/role/transport/catalog refusals, advisory exclusion, exact backfill, preservation, rollback, already-applied limitation, unknown COMMIT and postcommit conflict. Verify all owned cleanup.
5. Root performs production check-only and then authorized apply/deployment only after those gates. No material activation accompanies this release.

## Open items that wait on Daniel

Adult self-edit authority remains denied pending a policy decision. Sharing blessing audio is outside the granted text permission. Neither blocks implementing or validating the empty-capability schema; the approved booklet text still needs exact source/notices and scoped projector integration after the schema release.
