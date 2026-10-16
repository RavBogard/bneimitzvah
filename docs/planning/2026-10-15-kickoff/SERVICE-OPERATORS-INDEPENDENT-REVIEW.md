# Independent private service-operator review — 2026-10-16

Current disposition: **accepted for the final frozen offline scope**. The final addendum below identifies the accepted hashes, independent evidence and limits. Earlier findings and the first repair remain as review history.

Final verdict: **accepted for the bounded offline helper review after two repairs**. All findings below are resolved in the final frozen source; the final addendum records its exact hashes and verification. Scope is the ignored migration/import helpers and their offline support/checks. No production migration, activation, provider connection, deployment, staging or commit was performed. Existing unfinished UI changes were preserved. Private artifact bytes were processed only by the existing bounded offline validator; no licensed wording or credentials were opened in tool output.

## Findings

1. **P1 — trigger verification accepts column-filtered immutability enforcement.** In the initial `.local-logs/provider-bootstrap/service-catalog-import-support.mjs:199`, `newShape` checks application-trigger events, function, arguments, enabled status and `WHEN`, but omits `pg_trigger.tgattr`. All four application triggers pass both `newShape` and `delta` after changing the synthetic column list from empty to `1` (`UPDATE OF id`). A catalog `feed_bytes` update, a service-plan `student_id` update, or lifecycle state/revision update can then bypass its expected trigger. This matters particularly for service plans, where runtime has table UPDATE privilege. The FK-trigger verification at initial line 186 likewise omits column filters and conditions. Require the exact empty column vector for every reviewed application/FK trigger and null FK `tgqual`; retain the existing event/function/arguments/enabled checks. Add independent mutants for each trigger, plus FK child/parent UPDATE filters and a false FK condition.

2. **P2 — CHECK normalization changes SQL string literals.** Initial support line 132 strips `::text`/`::jsonb` and double quotes globally before examining string boundaries. Both `student_service_plan_slot` with `'morning::text'` substituted for `'morning'` and `service_lifecycle_state` with `'superseded::text'` substituted for `'superseded'` pass `newShape` and `delta`. These are different constraints that would reject valid application/lifecycle operations, despite the operator claiming the reviewed schema is present. Preserve SQL literals exactly, including escaped single quotes, while normalizing casts/qualification/formatting only outside literals. Keep the existing positive PostgreSQL ANY-array/IN and BETWEEN normalization cases, and add quoted-cast/literal regression cases.

These are verifier gaps; this review did not find the mutations in the actual migration SQL. Root assigned a separate author to repair support/self-tests. Acceptance awaits the frozen repair and independent rerun.

## Offline evidence

- Existing isolated runner passed both entry points: **13 accepted / 63 rejected** synthetic cases each; migration/import flags stayed false. The bounded private artifact check passed **85 units / 13 sections**, maximum projected envelope **5,158 bytes**. No provider connections occurred.
- Six author helper modules passed `node --check`.
- New ignored `service-catalog-import-independent-check.mjs` reuses only the author's synthetic fixture and challenges `newShape`/`delta`; it reproduces the findings, while disabled-trigger and conditional-application-trigger controls are correctly rejected. It reads no credentials or licensed artifacts. Its output is diagnostic: `rejected: false` means the mutant escaped the guard, except the explicitly named unmodified control.
- New ignored `service-catalog-import-preconnection-check.mjs` runs actual entry points in isolated child environments with private-input reads denied and `pg.Client` construction replaced by a failing stub. All four invalid-argument/wrong-candidate cases failed in the expected arguments/source phase with **zero protected-read attempts and zero client constructions**.
- Source check found HEAD at foundation `41b7ee7daaa980a49a1ca0358a3e798e2770cc39` during the initial review. Migration worktree bytes differ from the published migration solely in newline encoding: working SHA-256 `d35881147b0dc3f5889deaa47ac0b39c590858bdb756232b0f31e0e63bd1713e`; published/normalized SHA-256 `aed6568b57906f6387047dce83a84c90b8db85673458644ccbf87ed8cd922cd4`. The helper correctly requires exact published bytes before credential read. This review did not alter the migration or hide this gate.
- Parser SHA-256 matches its fixed pin `b1073d50f081913337e344352c78b824d6aca85059e6548fd9e58ef44da64f1a`; the existing migrator matches `99dc1c45036e4c816d834dc4dfc511103a638809b2916e9ee5e8929417738aec`.

## Contract assessment and limits

The source guard requires exact candidate HEAD, clean relevant tracked/untracked source, baseline/foundation ancestry, preserved historical migration bytes/journal and exact 0015 SQL. Artifact validation pins exact feed/provenance bytes and independently fixed producer metadata, reuses the pinned public parser, bounds all selected-unit envelopes and finishes before credential lookup. Native parser/projection execution is limited to pinned public source; artifact text is never executable.

Connection setup permits only a direct Neon PostgreSQL URL, forbids extra connection parameters, clears PG environment overrides, enables certificate/hostname verification and prefers SCRAM channel binding. The installed driver's `enableChannelBinding` is a preference; the URL's `channel_binding=require` is not an enforcement guarantee in node-postgres. No provider TLS/auth handshake was tested.

Owner prechecks require the separate non-superuser BYPASSRLS owner, existing ownership, PostgreSQL 18, and a runtime role closure without privileged memberships/ownership. Snapshot/delta guards cover historical ledger, existing public data, roles/memberships/schema objects and the explicitly allowed audit CHECK replacement. Effective runtime grants are checked for both roles; RLS policies/force flags, immutable functions/triggers and active-generation uniqueness are inspected. The two findings above limit the strength of schema verification until repaired.

Import resolves the enabled CRC tenant from the exact canonical production host binding under locks, uses SERIALIZABLE for apply, refuses another active generation, verifies exact existing catalog bytes/pins, and writes only catalog/lifecycle rows. An already active exact catalog rolls back as a no-op. Reactivation of withdrawn/superseded matching generations is rejected. Existing rows, unrelated tables, plans, roles/schema and ledger are compared inside the transaction and again after commit.

Migration reuses the pinned existing migrator. Both operators distinguish committed, uncommitted and unknown outcomes: migration sets `migrationCommitted: null` when invocation begins, import sets `importCommitted: null` before COMMIT, and a post-commit failure retains true rather than claiming rollback. Errors contain phase/status only. None of the database assertions, actual COMMIT/rollback behavior, provider ledger/roles/RLS or live idempotency was exercised here; those require separately authorized provider work. The current instruction forbids that work.

Initial reviewed support SHA-256: `a732e0813b12cdce4336c13dcec6c6c3ee33898dc58879266619ea7af71dc330`; initial self-test SHA-256: `4dffd8dde9d0fb33ff76f6abdb26a406b1e440ec8c19dc6696f2d7e68548dbf1`. Updated digests and acceptance belong in the repair addendum after independent rerun.

## First frozen repair re-review — changes still required

Reviewed support SHA-256 `0e1b948d104a19dc07ae715942ce6292f1f69ef6ec648751b7163de13dc1c746` and self-test SHA-256 `da8d225dd1790cbe6b8856ae3f56ec4e529a631491313ac2380ad9301f49ca25`. Both files exactly match their private `checkpoints/offline-guard-repair-20261016` copies and manifest hashes. This checkpoint records the first repair, not final acceptance.

The two original findings are repaired: all four application-trigger column filters, FK child/parent column filters, FK conditional enforcement and the original literal mutants are independently rejected; the unchanged fixture remains accepted. All six syntax checks pass. Both entry points now pass **19 accepted / 149 rejected** offline cases; bounded artifact compatibility remains **85 units / 13 sections / maximum 5,158 bytes**. All four independent actual-entry-point preconnection probes still fail before any protected-input read or client construction.

**Remaining P1 verifier gap — qualification normalization can substitute a different function.** Support line 145 still strips every quoted lowercase qualifier. Replacing `octet_length` with `"user".octet_length` in the synthetic catalog bytes-bound CHECK passes both `newShape` and `delta`. A separate bounded, in-memory PGlite test created reserved schema `"user"`, a SQL function of that name returning constant 1, and a CHECK calling it. PostgreSQL's deparser retains `"user".octet_length`; the guard nevertheless treats its expression as the reviewed builtin. An empty byte array is then accepted by the different CHECK. This uses synthetic bytes only, with no provider connection or private input. Public-only schema/function capture does not establish the identity of a function in another schema.

Correction: normalize only explicitly permitted qualification of the current table's column references, preserve unrelated function/schema qualification and quoted-identifier case, and independently reject this actual deparser form. A quoted uppercase function such as `"OCTET_LENGTH"` must also remain distinct from the lowercase builtin. Root assigned the bounded second repair; final acceptance remains pending its frozen source and rerun.

## Final frozen repair re-review — accepted offline

Final reviewed SHA-256 values:

| File under `.local-logs/provider-bootstrap/` | SHA-256 |
| --- | --- |
| `service-catalog-import-support.mjs` | `bc9f3a156f1c2a1636ac4491bcfa3abdb979656e906bf3ab3ff5c0e36cc60b61` |
| `service-catalog-import-self-test.mjs` | `bbf41daded7eadfab5a63a9bea1d6d58886d9accfb642eb62d6a8624c3b39cbe` |

Both current files exactly match the saved copies and manifest in private `checkpoints/offline-identifier-repair-20261016`. The prior `offline-guard-repair-20261016` checkpoint remains historical evidence of the first repair. Final source hashes were checked before and after the independent lexer/deparser exercise.

`checkTree(input, tableName)` now removes qualification only for exact reviewed columns of the supplied current table, while preserving unrelated schema/function qualification, quoted identifier case and literal bytes. Application and FK triggers require the complete empty column vector; FK conditions must be absent. No remaining finding was identified in this bounded re-review.

Fresh independent verification on the frozen files:

- Both actual entry-point self-tests pass **23 accepted / 166 rejected** each, with migration/import invocation and commit flags false. All six author modules pass syntax checks.
- The independent original fixture control passes; all twelve original trigger/literal challenge checks now reject their mutants.
- **27/27** further independent lexer/deparser checks pass. These cover foreign reserved schemas, a schema named after the reviewed table, a column-named qualified function, uppercase quoted functions/columns, escaped quotes and syntax inside literals, literal/syntax separation, multiple-digit placeholder indices and collision refusal. All eight actual migration CHECKs match genuine in-memory PostgreSQL deparses. Actual malicious deparses using a reserved foreign schema or uppercase quoted function are rejected; their synthetic SQL functions were separately shown to accept invalid empty byte arrays, so rejection tests a real semantic difference.
- All four instrumented actual-entry-point invalid-argument/wrong-candidate probes again fail in the expected phase with **zero protected-read attempts and zero client constructions**.
- Existing bounded artifact validation again passes **85 units / 13 sections / maximum projected envelope 5,158 bytes**, emitting counts/status only.

This acceptance covers local source and offline behavior. It does not authorize provider access or establish live TLS/authentication, production ledger/schema/data/role state, applied migration/import, real database transaction outcomes, hosted CI or deployment. The existing source/commit and exact migration-byte gates remain active; the known worktree CRLF mismatch was not changed by this review. Root owns final integration and any later separately authorized release work.
