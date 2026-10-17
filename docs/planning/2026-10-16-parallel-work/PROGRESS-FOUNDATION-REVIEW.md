# Independent verse-progress foundation review — 2026-10-16

**Accept the bounded progress foundation at frozen product source `e19436cacafc2581d5ef9e1447cbd8fa9f7927cc`. Independent app 5/5 and actual restricted PostgreSQL 11/11 pass; no source blocker remains.** Broader final integration/hosted gates remain the author's/root's responsibility. Inventory baseline is accepted green `3508ef0e696b8f4d015f0b6659e41cfe528f3184`, managed checkout `C:/Users/dsbog/.codex/worktrees/recording-core/bneimitzvah`, branch `codex/progress-foundation`. Reviewer owns this report and explicitly coordinated `tests/app/progress-adversarial.test.ts` / `tests/postgres/progress-races.integration.ts`; author owns product/schema and normal tests. No provider, production, migration apply, model/audio, frontend or money operation is authorized here.

## Requirement and threat contract

Read current MISSION/STATE/shared coordination and PLAN-REVIEW rulings 45/48. Progress consists of distinct student self-check, tutor assessment and practice history concepts. This slice implements only current assigned Torah/haftarah verse self-checks and assessments. It must not infer practice from reading, playing, recording or visiting, and introduces no raw event/history/calendar/recording/service-unit scope. Parent practice-activity reporting remains days-only; this feature's explicit progress states are separately authorized progress data. Raw-event purpose/retention remains a later release contract, not a blocker for these current states.

| Operation | Allowed authority | Required separation |
| --- | --- | --- |
| Read current progress | Existing authorized student/parent/tutor/admin read or explicit child-practice read | Live tenant/student/relationship/session and exact assignment binding |
| Write self-check (`unmarked`, `working`, `got-it`) | Own student or explicit, valid linked-child practice | Existing practice-write capability; parent dashboard cannot write |
| Write assessment (`not-started`, `working`, `solid`) | Authorized tutor/admin in that explicit mode | Existing staff note-write role gate; self-check never changes assessment |

Selectors and route/body IDs grant no authority. A parent/tutor overlap must not let parent mode gain tutor writes; a child-practice header must not be ignored in a base staff mode. No new grants or bypasses are needed. Reuse `practice.withPracticeCapability` for self writes and child-practice reads, `access.withStudentCapability` for normal reads and the existing staff-only write gate.

Return a closed DTO containing only binding/ref and each stream's state/version, with separate honest current-assignment totals/counts. Do not expose raw timestamps, actor IDs, emails or internal audit rows. In particular, do **not** reuse `student-work/data.view`: that existing work projection includes author identity and creation time. A student's Got it must never count as staff Solid; absent heads use explicit defaults and version zero. Reads and summaries must perform no write or inferred state transition.

Root further requires page rows and their per-stream summary counts to derive from the same fetched heads/snapshot, with the current assigned denominator locked. Separate page/count queries must not contradict one another under concurrent writes. Cross-stream mutations stay independent, but both projections bind to the same current assignment. Filter all projections/counts against current assigned refs even if stale removed-verse heads are seeded; fetching the bounded current head set once and deriving rows/counts from it is the straightforward implementation.

## Assignment identity and confirmation evidence

- `tenant-schema.ts` has one current `assignment` per tenant/student/kind. `data/roster.persistAssignment` updates the existing assignment ID and increments its revision; it then deletes/recreates **all** `assignment_verse` UUIDs, including unchanged refs. `persistCuts` increments the revision without recreating verse rows.
- Therefore a progress FK solely to `assignment_verse.id` is not a stable identity without additional confirmation-copy/preservation work. It would otherwise lose unchanged progress or block ordinary replacement.
- Recommended minimal current-head identity: `(tenantId, studentId, assignmentId, verseRef)` independently for each stream. Assignment ID is stable and separates Torah/haftarah; every request still supplies and validates exact kind, assignment ID, revision, and current verse membership. Use tenant-qualified assignment/student foreign keys and a canonical verse-ref shape; service membership is mandatory even with those FKs.
- `data/portal.confirmedReadings` SHARE-locks the confirmed assignment rows before reading verses; reading confirmation UPDATE-locks the same assignment. Reuse this ordering, followed by progress-row/unique-key locks, so a write either commits before replacement or rejects its obsolete revision. Preserve existing identity→grant→student→relationship→context→assignment→progress ordering.

**Routine lifecycle decision for root before code:** preserve states and versions for intersection verses and cuts-only revisions; atomically delete/reset removed heads inside reading confirmation so removal/re-addition cannot resurrect an old assessment or self-check. PLAN-REVIEW's “keep hidden history” is a proposed mechanism, not an approved mission requirement. Retaining historical heads instead requires an explicit current-membership/incarnation rule and must not become an accidental history/retention feature. Reviewer recommends current heads with removal deletion and no new history in this slice.

**Root decision received:** use stable independent heads, preserve intersection/cuts, and atomically prune only removed-verse heads under the existing assignment UPDATE lock. Clearing a state back to its default retains the head with its incremented version, preventing version-zero ABA. Only assignment removal prunes; a subsequent re-add is protected from stale requests by the new assignment revision. A same-state no-op requires fresh authority and the current expected version. This approved decision supersedes the open-choice wording above.

## CAS, authority and schema requirements

- Independent stream versions and strict closed validation: no cross-stream update, unknown keys, coerced numbers, arbitrary states, loose revisions, alternate kind or unassigned verse. Default version zero means no head; creation must participate in the unique/CAS race. Same-stream concurrent requests with one expected version must not both succeed. Different streams must not create false conflicts or overwrite each other.
- Exact assignment/revision binding prevents stale clients from applying an old action to a newly confirmed selection. Current ref membership must be checked while assignment SHARE locks remain held; validate the stored ordered refs against the existing canonical range expansion as student-work does.
- Capability/identity locks must remain held through data waits. Check real session and child-context expiry after assignment waits, after row-CAS/unique waits, and before returning **every** result, including stale/conflict/no-op paths. A write must roll back if expiry occurs during a uniqueness wait. Existing locked authority checks determine whether concurrent revocation precedes or follows an operation; do not replace them with cached selectors.
- Additive migration `0016` after held `0015`; no production application. Add tables/FKs/checks, tenant isolation with ENABLE and FORCE RLS and matching USING/WITH CHECK, explicit minimum runtime privileges, and any required audit-action constraint update without weakening prior constraints. Review generated metadata and migration parity normally.
- A current-head service can return an honest CAS conflict after an uncertain write and require a fresh read. Do not claim idempotent receipt replay without an actual command/receipt contract. No raw event log is needed merely to expose state.

## Frozen implementation review

Root approved the architecture before implementation; saved spec began at `b824847`. Product/schema freeze is `e19436c`. The service reuses existing read/practice-write/note-write gates, exact current assignment/ref validation, canonical range equality and session/context expiry checks after assignment/head/unique waits and before returning results. Same-state no-op checks the current version first. Default clearing retains the head and increments; only removed refs are pruned. Snapshot is one joined assignment-verse/both-head query; row projection and whole-assignment counts derive from that same bounded result. Public types have no server import, actor or timestamp fields.

The migration is additive 0016; no historical SQL migration changed. Snapshot comparison adds exactly `public.verse_assessment` and `public.verse_self_check`, removes no table, changes only the existing audit-action constraint, and has the correct previous snapshot ID. Tenant-qualified student/assignment FKs, state/version checks, immutable identity, +1 update-version trigger, ENABLE/FORCE RLS, matching tenant USING/WITH CHECK, revoked PUBLIC grants and column-limited UPDATE(state,version) are present. Confirmation prunes both streams in its existing transaction after the assignment UPDATE succeeds and before replacing verse rows. No grant path or frontend change was added.

Source Git blobs at the freeze:

| Source | Git blob |
| --- | --- |
| `src/server/progress/service.ts` | `232de31bc7074f7e22dade5ccf8e064e07919416` |
| `src/server/data/progress.ts` | `20dd59af245fca76767a00b1c0cc6366388f40e8` |
| `0016_verse_progress_foundation.sql` | `633cb3754b6c21db71d49e26f8147914e19916e5` |

Test-harness-only `62c2e4fb5089be8e696a51c4a0a225f66da44a20` adds progress route classification to the existing browser fixture dispatcher. Test-only `6259e93fbc3283362ec64e94209de426a48ff5ba` adds an actual 0015→0016 upgrade/replay check with synthetic preexisting assignment revision/verse UUID/membership authority, empty protected heads and no PUBLIC grants; reviewer inspected its source without rerunning it separately. Neither changes product source. `git diff --quiet e19436c -- src/server src/lib/progress` remained clean before/after independent execution and after these test-only additions.

## Actual independent adversarial evidence

The reviewer authored two distinct files; author committed them without edits at `c8326f973c2f41a95db762863205fb6699a363b9` (normal Git newline conversion only). Tested worktree SHA-256:

| Test | SHA-256 |
| --- | --- |
| `tests/app/progress-adversarial.test.ts` | `951742293fb10c15b2c142df0e090f546f2b93ad26bf30ad0c7153652b062b21` |
| `tests/postgres/progress-races.integration.ts` | `461893af96ced13416125d98f68cf1dc4337c22e4b67b907183c5e8d10df9101` |

**Independent app: 5/5, 10.02 seconds.** Covers default reads creating no heads, default clearing with retained version/no ABA, stale-version same-state rejection, no-op audit absence and revoked identity denial; whole-assignment counts across a 100-row page, exact closed DTO fields/no actor metadata and seeded unassigned-head exclusion; overlapping parent/tutor roles and exact live child context; closed malicious binding/ref/kind/cross-tenant substitutions; actual replacement intersection/removal/re-add and cuts-only confirmation across regenerated verse UUIDs.

The author's earlier run of these tests was 4/5 because the test expected 404 when a learner without a parent grant supplied a parent's child handle. Existing practice authorization correctly denies 403 before context matching. The reviewer corrected that assertion; no product permission changed. The independent final 5/5 is after that correction and the final cuts-only assertions.

**Independent actual restricted PostgreSQL: 11/11, 6.74 seconds.** Nine required `pg_blocking_pids` edges were observed, rather than inferred from sleeps:

1. Missing-head unique contention and existing-row update contention each yield one same-stream CAS winner; a stale same-state competitor gets conflict, not a false acknowledgement.
2. Independent self/staff changes finish while the other stream is held. A read captured before an intervening self-write returns coherent old rows **and old counts**; the next read reflects both new state and count.
3. Both assignment/progress orderings are measured: a progress-first mark is pruned by the following removal; a confirmation-first update causes the blocked old-revision progress request to reject. Counts exclude the removed mark.
4. Session expiry across an assignment lock wait overrides both ordinary write and stale-assignment results.
5. Child-context expiry across a head-row wait overrides both CAS conflict and same-state no-op, without changing the head or audit.
6. Session expiry during real uniqueness contention denies the expiring competitor while preserving the separately authorized winner.
7. Completed context switch and tutor-link revocation deny later same-state calls. Actual SQL attacks verify no-scope/foreign-tenant invisibility, RLS write denial, qualified FK and state checks, identity column privileges, monotonic versions and FORCE RLS on both tables.

Expiry clocks advance only **after the actual blocking edge** is observed. Short-lived contexts are recreated solely by the fixture owner, preserving immutable fields/handle; the application never updates immutable context expiry. All test data is synthetic.

## Commands, cleanup and limits

From the managed checkout:

```powershell
node_modules/.bin/vitest.cmd run tests/app/progress-adversarial.test.ts
node .local-logs/progress-pg-isolated.mjs
```

Independent logs are `.local-logs/progress-review/independent-app.log` and `.local-logs/progress-independent-pg.log`. The reviewer inspected the ignored PostgreSQL runner before execution: exact known loopback cluster identity assertion; generated isolated environment and fresh owned anchor login; existing fixtures create fresh databases/restricted roles; no shared password, browser port or server edit. All fixture closes succeeded and runner confirmed **owned anchor removed: true**. No production database or provider was accessed.

No new frontend, browser, practice-event collection, raw-event retention mechanism, notification or recording/model work is included. Unchanged auth/guard/voice/recording evidence is reused; these tests do not re-prove unrelated whole-project behavior. Author broader app/build/repository gates and exact final-tree hosted CI remain required. This independent source acceptance can support the backend candidate contract for a later authorized UI integration; it is not production/migration/import/G3 approval. Reviewer remains available for the next frozen dependency review.
