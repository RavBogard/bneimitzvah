# Current verse progress backend return — 2026-10-16

## Contract and checkpoints

Branch `codex/progress-foundation`, owned managed checkout `C:/Users/dsbog/.codex/worktrees/recording-core/bneimitzvah`, begins at hosted-green tutor `3508ef0`. Root approved the source-evidenced identity/CAS/pruning design before implementation. Daniel's recorded product requirements and root's implementation decisions are explicitly separated in [the spec](../../superpowers/specs/2026-10-16-verse-progress-design.md).

- `b1cc068` / `b824847`: inventory/spec, including attribution correction; no product edits preceded the architecture decision.
- `e19436c`: backend schema/data/service/HTTP, current-head identity, atomic removal pruning, client-safe types and focused tests; additive local migration 0016.
- `62c2e4f`: test harness routes progress requests through its injected isolated dispatcher; no frontend change.
- `6259e93`: migration upgrade/replay regression preserving existing assignment and verse identities.
- `c8326f9`: independently authored app adversarial and real-PostgreSQL race tests, committed without content changes.

Only Torah/haftarah current confirmed assigned verses are eligible. Student self-check `unmarked / working / got-it` and tutor assessment `not-started / working / solid` have independent state and versions. Counts name each stream separately. No page visit, play or upload sets a mark. No frontend, recording, notification, raw practice-history/calendar, offline replay, provider or model processing was added. Moving Claude editor/voice source and original shared STATE/COORDINATION remain untouched.

## Identity, authority and persistence

Existing replacement keeps assignment ID but regenerates all assignment-verse UUIDs. Progress therefore uses independent heads keyed by tenant/student/assignment/canonical verse ref, with tenant-qualified student/assignment FKs. Current revision, canonical sequence and exact verse membership are checked under existing confirmed-reading SHARE locks.

Replacement keeps intersection states and versions and atomically prunes both streams' removed refs under the assignment UPDATE lock. Re-add begins default/version 0; stale old-assignment requests cannot revive it. Cut-only/date-review revision changes preserve compatible marks. Clearing an existing head to its default retains that head and increments its version; it never deletes to reset CAS. Same-state no-op requires current authority and exact expected version; stale retries conflict and require a re-read.

Self writes use existing student/explicit linked-child `practice-write` capability. Staff assessment uses existing tutor/admin `note-write` authority; parent dashboard remains read-only even for overlapping roles. Reads use existing explicit read modes. Server-derived session, tenant, membership, role, relationship and context locks remain authoritative. Session/context clocks are checked after assignment/head/unique/CAS/audit waits and before returns, including conflict/no-op. Changed writes and their internal security audit commit or roll back together.

The additive `0016_verse_progress_foundation.sql` creates FORCE-RLS tenant-private heads, composite FKs, state/version checks, immutable head identity and consecutive-version update triggers. PUBLIC privileges are revoked; restricted runtime UPDATE is limited to state/version, with DELETE available for authorized assignment pruning. Tenant RLS is not represented as student authorization; application capability checks remain required. No historical migration was edited and no general migration runner/production apply was run.

## HTTP and UI handoff

Client-safe `src/lib/progress/types.ts` imports no server/database module. The spec contains canonical synthetic request/response examples. Routes are GET `/api/students/:studentId/progress`, POST `/progress/self-check` and POST `/progress/assessment`, with closed binding/state/version inputs, exact Origin, bounded JSON/query/page handling and fixed private errors. Child context stays in its existing header, never JSON or URLs.

A single joined current-verse/both-heads SQL read supplies at most 1,000 refs; rows (100 per page) and whole-assignment counts derive from that same snapshot. DTOs expose only current binding/ref/state/version/counts; no actor IDs, emails, display names, context secrets or timestamps. Reads/default no-ops create no state or security audit. No progress history route exists.

UI may consume this contract in its own separately frozen integration; this backend checkpoint does not wire Working/Got it or assessment controls. Daniel's approved student direction/wording remains closed.

## Verification

- Author focused normal HTTP/schema and reviewer adversarial app tests: **10/10**, `.local-logs/progress-focused-app.log`. Initial author run was 4/5 because a test expected 404 for an identity lacking a parent grant; the existing 403 denial was correct and the reviewer corrected the test. That failed run is retained in `progress-adversarial-first.log`.
- Independent reviewer app adversarial tests: **5/5**, 10.02s, `progress-review/independent-app.log`.
- Independent real PostgreSQL tests: **11/11**, 6.74s, **nine observed `pg_blocking_pids` edges**, `progress-independent-pg.log`. Coverage includes first/update CAS, independent streams, coherent snapshot race, confirmation/prune ordering, completed revocation/context switch, clock expiry after assignment/head waits (including no-op/conflict), rollback and restricted SQL attacks.
- Final full app integration: **790 passed, one existing skip**, 84 files, 254.04s, at `c8326f9`, including the migration upgrade/replay case (`progress-full-app.log`).
- Final typecheck and production build pass (`progress-typecheck.log`, `progress-build.log`).
- Required final staged candidate/index repository guard and diff checks include this return and the copied independent review before the documentation checkpoint is committed.

Independent review belongs to [PROGRESS-FOUNDATION-REVIEW.md](PROGRESS-FOUNDATION-REVIEW.md). Author execution, independent execution and root architecture acceptance are separately attributed. The prior unchanged engine/Node evidence is reused locally; fresh exact-tree hosted Node/Windows/Linux/PostgreSQL/browser CI remains required.

## Isolation and delivery

Existing independent dependencies and package pins were reused. Generation used only the existing pinned Drizzle tooling in an ignored local cache; application package files did not change. Child processes use `isolatedEnv.mjs`, with production/provider credentials absent; complete logs stay ignored under `.local-logs`.

The independent PG runner asserts the known local disposable loopback cluster and creates a unique owned random anchor login. Fixtures create/drop their own fresh databases and restricted runtime roles. No browser/server/port edit, shared password rotation, cluster reset or other-process termination occurred. Independent execution confirms fixtures closed and the owned anchor was removed. No private text, real audio or personal data was used.

Production, including application of carried 0015 and new 0016, remains held. Root may publish the accepted review branch and run exact hosted CI; worker does not push. Continue with root's next authorized bounded work after this checkpoint; no additional user Continue or renewed student-design choice is required.
