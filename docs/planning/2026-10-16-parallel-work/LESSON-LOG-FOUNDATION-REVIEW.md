# Independent lesson-log foundation review — 2026-10-16

**Accepted bounded source and independent security/runtime review. No remaining blocking finding in this slice.** Frozen product `f2aabe24c21688e1d8bf6d0df9236689914f15d4` on `codex/lesson-log-foundation`, from accepted modal `243d133`; reviewer tests committed unchanged by author as `8264fcc5b041391df69f3c65b58e9e514bfd6c63`. Full integration and exact hosted CI remain separate gates. Reviewer owns only this original report plus `tests/app/lesson-log-adversarial.test.ts` and `tests/postgres/lesson-log-races.integration.ts` in the managed checkout. Product/schema/normal tests remain author-owned; no recursive delegation, production operation, frontend/provider work or progress-source changes are included.

## Contract and boundary

Review against approved spec `f1694103bd3f3a4da1ee2d7919719f529cc1a749`, `docs/superpowers/specs/2026-10-16-lesson-log-design.md`, and [the accepted independent contract advice](LESSON-LOG-DESIGN-REVIEW.md). Current student-scoped summaries are independent of assignment/progress lifetime. Selected current tutor/admin authority creates; original-author current tutor or current admin edits/deletes. Other tutors/family modes read only. Identity is tenant/student/client UUID; immutable creator membership+user remains internal. Version CAS, live-v1 exact create replay and irreversible text-clearing tombstones prevent stale resurrection. Closed date/plain-text inputs and minimal safe-name/permission DTOs expose no actor IDs, emails or raw timestamps. Existing capability/context/session locks and real expiry rechecks remain mandatory after waits and on every result. No scheduling, hours, events, notification, history or production migration apply is authorized.

## Independent tests and results

- App: exact normalized v1 replay without duplicate audit; edit/text-cycle/stale mutation and tombstone irreversibility; current author versus other assigned tutor/admin and revoked author grant; parent/student/explicit-child read-only modes and switched handles; same UUID across authorized students/tenants; current-only keyset ties, closed safe DTO, unsafe names and read-without-audit behavior.
- Restricted PostgreSQL: same/different-content/different-creator create uniqueness races; edit/edit, edit/delete and delete/edit CAS; session expiry after actual entry waits for valid/no-op/stale/delete/other-author outcomes; uniqueness expiry; expiry during a real audit-insert wait with head/audit rollback; committed relationship revocation and context switch ahead of blocked readers; child-context expiry during a real table wait; RLS, tenant/creator FKs, identity, versions and tombstone SQL attacks.

Public API/import/schema names were explicitly coordinated with the author before drafting: `createLessonLogService` from `src/server/lesson-log/service`, client-safe `src/lib/lesson-log/types`, and `s.lessonLog` with boolean `deleted`. The author's initial typecheck found only the reviewer's conditional-promise generic inference; reviewer corrected the owned safe-result helper to accept `PromiseLike<unknown>`. No product change resulted. Both independent runtime runs then passed on their first execution.

Executed independently in the managed checkout, with isolated environments and verbose output saved locally:

```text
node .local-logs/run-isolated.mjs lesson-independent-app npm run test:app -- tests/app/lesson-log-adversarial.test.ts
# 5/5 passed; 11.42 seconds; .local-logs/lesson-independent-app.log

node .local-logs/lesson-pg-isolated.mjs
# 17/17 passed; 11.06 seconds; .local-logs/lesson-independent-pg.log
```

The 16 successful `waitForLock` assertions require actual `pg_blocking_pids` edges: three uniqueness races, three edit/delete CAS races, five entry-row expiry outcomes, uniqueness expiry, audit-table wait/rollback, relationship revocation, child-context table wait and context switch. Expiry time is advanced only after each blocking edge has been measured; a near-term expiry is configured in the owned fixture first. Child-context expiry uses owner-only fixture recreation preserving its immutable token/identity, not an application expiry-update path. These are actual restricted PostgreSQL transactions, not PGlite race claims or sleep-based ordering assumptions.

For the audit wait, an owner-held table lock blocks the runtime audit insert after the lesson head was inserted; expiry then rejects and rolls back **both** head and audit. Valid/no-op/stale/delete/other-author results after row waits all reject expired sessions. Expired child reads return no private DTO. Another valid actor's unique-key winner survives an expired contender. Revocation and a context switch committed ahead of their blocked requests deny stale authority.

The inspected runner asserts the existing dedicated loopback cluster's exact port, data directory, version and database before creating a fresh generated anchor role. Each fixture creates its own database and NOSUPERUSER/NOBYPASSRLS runtime login; privileged owner connections are fixture maintenance only. All 17 fixture closes completed and runner reports **Owned PostgreSQL anchor removed: true**. No shared role was rotated, no browser/server port was edited, and no production migration was applied. The exclusive lane was released before the author began broader app/build checks.

Final tested SHA-256 values:

- App: `79b8d7ded007b1a7801b48b6e30a2d2c2705989dcab218ff7416d95223d46796`.
- PostgreSQL: `2c0b75a65c9844e62f60e80d88dce13570e98e5e6350363e2a172dc38b25cabf`.

## Frozen source and migration findings

Independently inspected the bounded source/data/service/HTTP/runtime diff, public types, schema, additive `0017_lesson_log_foundation.sql`, snapshot/journal and the author's upgrade-test source. No authority grant is derived from UUID, cursor, creator identity or permission booleans. Existing note-write/read/practice capabilities enforce current selected mode and relationships; creator membership **and user** narrow tutor mutation after authorization. Admin edits preserve creator attribution, and read projection does not depend on the old creator grant remaining live.

Create uniqueness contention locks/re-reads the winner and accepts only exact same-creator normalized live v1 replay. Edit/delete lock the scoped row and enforce current version before no-op or mutation. Deleted rows clear text and cannot be restored even with their current tombstone version. Real-time session/context expiry is asserted after data/unique/row/audit/name waits and before results. The HTTP boundary checks closed unique query/body shapes, Origin before body processing, strict real dates and bounded valid plain Unicode; responses remain private with fixed safe errors. No read writes or inferred progress/events were introduced.

0017 adds the tenant/student/UUID head and tenant-qualified creator membership+user FK, FORCE RLS with matching USING/WITH CHECK, SELECT/INSERT and four-column UPDATE grants without DELETE, immutable identity/creator, positive consecutive versions, strict initial live v1 and irreversible deletion. Actual restricted SQL tests verify RLS denial, cross-tenant and mismatched-creator FKs, byte bounds, denied identity edits/delete, rejected version jumps and failed tombstone resurrection. SQL security and service authority are complementary; runtime tenant privileges do not substitute for the service's selected-role authorization.

Snapshot `prevId` matches 0016; only `public.lesson_log` and the three added known `audit_event` actions differ. The primary key, nine columns, tenant/student/creator FKs and three checks match generated SQL/schema. Historical migrations are unchanged. `git diff --quiet 243d133..f2aabe24 -- src/server/progress src/lib/progress src/server/db/progress-schema.ts src/server/db/migrations/0016_verse_progress_foundation.sql` returned zero. After both independent runs, HEAD remained `f2aabe24`, `git diff --quiet f2aabe24 -- src/server src/lib/lesson-log` returned zero and only the two reviewer test files were untracked, before their author commit.

## Author evidence, limits and next action

Author separately reports normal HTTP/schema **4/4**, disposable 0016→0017 upgrade/replay **1/1**, and typecheck passing with the reviewer files. Reviewer inspected the upgrade test's preservation checks for assignment/verse identity, existing progress and membership authority plus empty protected lesson heads/minimal grants; reviewer did not independently rerun that normal test. Author's full app and sequential build checks are in progress as this report is finalized. Exact final repository/hosted checks remain the integration gate; no production/release claim is made.

The independent scope is this lesson backend and its additive migration, using accepted unchanged access/practice/progress/modal evidence. No browser, UI audit, model/private-audio/provider call, scheduler or production operation was needed. Lesson-summary retention remains the separate approved lesson contract; Daniel's new practice-event retention ruling does not silently change it. No additional lesson test/source work is required absent a new failure or changed source. Next authorized work is a separate bounded practice-calendar backend **contract** review, without implementation or event ingestion yet.
