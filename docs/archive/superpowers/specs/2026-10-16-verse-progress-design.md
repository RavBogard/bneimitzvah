# Settled decisions (Daniel, binding)

- MISSION's Teaching and progress amendment (rulings 36/40/45–48/54) includes tutor verse statuses `not started` / `working` / `solid`, alongside separate student self-checks.
- MISSION ruling 1, amended/clarified by rulings 32/48: the parent dashboard is read-only except honors; explicitly selected linked-child practice is a separate delegated capability, without tutor/admin authority.
- MISSION ruling 14 and Teaching and progress amendment (45/53/58): private practice-event details remain student-scoped, and other roles receive days-practiced summaries rather than raw activity.

## Architecture decisions (root, 2026-10-16)

These are approved implementation choices for this slice, not additional Daniel rulings. Self-check is `unmarked` (default), `working`, or `got-it`; assessment is `not-started` (default), `working`, or `solid`. Counts identify their actual stream. No visit, play, recording or upload changes a mark.

Only the student's currently confirmed, assigned Torah/haftarah verses are eligible. Self-check writes require the student's own mode or explicitly selected linked-child practice. Parent dashboard, tutor and admin modes do not impersonate a student. Assessment writes require an authorized tutor/admin. Existing authorized student/parent/tutor/admin/child-practice reading paths may read both streams.

No frontend change is included. Daniel's approved student surface remains approved. Service parts, raw practice-event history/calendar, recordings, notifications, offline replay and new providers are outside this backend slice. Production/provider/migration-apply/import/model work remains held; generation and disposable local test fixtures do not authorize production operations.

## Source inventory and architecture decision

Inventory uses accepted `3508ef0` source, excluding migration snapshots from searches; no broad audit or test suite was run for this inventory.

| Existing primitive | Observed behavior / consequence |
| --- | --- |
| `db/tenant-schema.ts:162–192` | One assignment per tenant/student/kind; assignment revision is positive. Verse rows have UUIDs, ordered canonical refs and tenant-qualified assignment/student FKs. |
| `data/roster.ts:46–53` | Replacement retains assignment ID, increments revision and deletes/reinserts **all** verse UUIDs, even for unchanged refs. A verse-UUID progress FK would lose compatible marks on every replacement. |
| `data/roster.ts:29–31,43–44`; `students/service.ts:205–239` | Date/slot review marking and cut-only confirmation increment assignment revision without replacing verse rows. |
| `data/portal.ts:confirmedReadings` | Locks confirmed Torah/haftarah assignments `FOR SHARE` before ordered verses; max 1,000 verses. Confirmation takes the same assignment `FOR UPDATE`. |
| `student-work/service.ts:authorized` | Establishes current authority, exact kind/assignment ID/revision and canonical verse equality; checks session/context time after assignment locks and after database work. Its historical text stream and author/timestamp DTO are **not** progress semantics. |
| `access/service.ts`, `practice/service.ts` | Existing `read`, `practice-write`, and staff `note-write` gates already provide the required role/context distinction and lock order. No new grant path is needed. |
| `db/migrations/0010_*`, `0015_*`; `scripts/db-generate.mjs`; `drizzle.config.ts` | Pinned offline generation, schema glob, journal/snapshot, additive SQL security/immutability clauses; FORCE RLS, tenant USING/WITH CHECK, revoked PUBLIC access and restricted runtime grants. Latest migration is 0015. |

**Architecture approved by root on 2026-10-16:** two independent current-head tables, one per stream, keyed by `(tenant_id, student_id, assignment_id, verse_ref)`. Keep the existing assignment-verse UUID lifecycle unchanged. Composite tenant/student and tenant/assignment/student FKs bind each head; service validation binds the canonical ref to the locked current assignment. Each table has its own state enum/check and CAS version. There is no history table or public author/timestamp field.

Replacement preserves each continuously assigned ref's state **and version**, including reordering/expansion/contraction. In the existing confirmation transaction, after the assignment UPDATE succeeds and under that same lock, delete both streams' heads whose refs were removed. Removed/re-added refs therefore begin at absent/default version 0. Cut-only and date-review revisions retain all compatible heads. Every request still binds the exact current assignment revision; an old request cannot revive a removed ref even if that ref later returns.

Clearing a written self-check to `unmarked`, or assessment to `not-started`, **updates its existing head and increments its version**. It never deletes a head or resets its version. Only assignment removal prunes. A never-written default remains absent/version 0. This avoids same-assignment delete/recreate ABA.

## Authorization, locks and atomicity

1. Reuse server-derived tenant/host, SDK session identity, membership, selected role grant, student and relationship locks in their existing order. Base modes reject a practice header. Child practice additionally locks/checks its exact opaque context after the guardian link.
2. Self writes call `practice.withPracticeCapability` with mode `student`/`child-practice`, `practice-write`; staff writes call `access.withStudentCapability` with `note-write`; reads use existing `read` paths. Exact Origin/POST checks apply before mutation bodies and inside the authorized service boundary.
3. Use `confirmedReadings` assignment SHARE locking and its eligibility semantics. Validate exact kind, ID, revision, expanded canonical range sequence and requested verse membership before accessing progress. `needsReview` is conveyed by the existing reading contract; progress creates no text-review bypass.
4. For writes, lock the selected stream head after assignment locks. Missing-head insert uses unique-key conflict handling; existing-head update compares the expected version. Same-state no-op is allowed only after current authority, exact assignment and expected version match. Stale version/assignment returns 409 and requires re-read, including retries after a lost acknowledgement. No automatic offline replay or silent overwrite.
5. Recheck real session/context expiry after assignment locks, after stream lock/unique/CAS waits, and before **every** return, including stale/conflict/no-op. Authority rows stay locked so completed revocation/switch/logout wins before later operations; in-flight writes finishing first are ordered before revocation. Failure rolls back state and its security audit together.
6. Changed-state writes append only the existing internal security audit using server-derived actor/request identity, with distinct self/assessment actions. No read/default materialization, no audit for pure reads/no-op, no practice-event feed and no public audit/history API are introduced.

FORCE RLS on both tables uses the existing tenant `USING`/`WITH CHECK` pattern; PUBLIC has no privileges. Runtime gets bounded current-head SELECT/INSERT/UPDATE and DELETE needed by authorized confirmation pruning, with immutable head identity. Application capability checks remain mandatory; tenant RLS is not represented as student-level SQL authorization. The additive 0016 migration extends known audit actions, constraints and security without changing historical migrations.

## Closed HTTP / view contract

- `GET /api/students/:studentId/progress` accepts only `mode`, `kind`, `assignmentId`, `assignmentRevision`, optional `offset`. Same explicit modes as existing reading; current assignment order, page size at most 100, total at most 1,000. No write on read.
- `POST /api/students/:studentId/progress/self-check` and `/assessment` accept no query fields. Closed JSON body: `mode`, `kind`, `assignmentId`, `assignmentRevision`, `verseRef`, `state`, `expectedVersion`. The URL chooses the stream. UUIDs, integer bounds, canonical refs, enums and extra/duplicate query keys are strictly validated. Existing ordinary-body size/deadline limits and private fixed-error responses apply.
- View binding is server-derived student/mode/kind/current assignment ID/revision. Rows contain only canonical `verseRef`, `selfCheck:{state,version}` and `assessment:{state,version}`. Defaults are projected from missing heads. No actor IDs, names, emails, context handles, client provenance or timestamps appear.
- Counts are computed from **current assigned refs only** and reported separately as self-check `unmarked/working/got-it` and assessment `not-started/working/solid`, plus total. A bounded current-verse joined read gives page rows and whole-assignment counts from the same progress snapshot; removed refs do not contribute.
- A successful write returns only the selected stream's resulting state/version and current assignment binding/ref. Stale assignment/version responses reveal no private head or actor details. Integer exhaustion fails closed without wrapping; matching same-state no-op does not increment.

## Bounded implementation and acceptance

The client-safe TypeScript contract is `src/lib/progress/types.ts`; it imports no server/database module. Example using synthetic identifiers only:

```http
POST /api/students/10000000-0000-4000-8000-000000000001/progress/self-check
Content-Type: application/json
```

```json
{"mode":"student","kind":"torah","assignmentId":"10000000-0000-4000-8000-000000000002","assignmentRevision":1,"verseRef":"Genesis 1:1","state":"working","expectedVersion":0}
```

```json
{"ok":true,"binding":{"studentId":"10000000-0000-4000-8000-000000000001","mode":"student","kind":"torah","assignmentId":"10000000-0000-4000-8000-000000000002","assignmentRevision":1},"verseRef":"Genesis 1:1","stream":"self-check","state":"working","version":1}
```

The corresponding page request is `GET /api/students/10000000-0000-4000-8000-000000000001/progress?mode=student&kind=torah&assignmentId=10000000-0000-4000-8000-000000000002&assignmentRevision=1&offset=0`. Each row is shaped as `{"verseRef":"Genesis 1:1","selfCheck":{"state":"working","version":1},"assessment":{"state":"not-started","version":0}}`. Page counts name each stream separately. Use `/assessment` with explicit tutor/admin mode and that stream's expected version for assessment writes. A parent-assisted self-check uses child-practice mode and the already established practice header, never a context secret in JSON or the URL.

Own new progress schema/data/service/HTTP/validation and tests; integrate only required schema exports, runtime/dispatch and atomic roster pruning. Add local migration **0016**, generated with the existing pinned tool plus reviewed security SQL. Do not edit frontend, historical migrations, moving UI/voice files, original shared STATE/COORDINATION or package pins.

Focused synthetic validation/service/HTTP/schema tests must cover closed DTOs, no read writes, both independent CAS streams/default clearing, counts, exact binding and retention/removal/re-add semantics. Actual restricted PostgreSQL tests must prove tenant/FK/RLS behavior, same-stream contention, independent-stream concurrency, replacement/prune ordering, completed revocation/context switch and expiry after awaited locks/uniqueness. Reuse existing fixtures and isolated child environments; keep logs ignored and return only sanitized failures. Independent adversarial review is required before final source acceptance and exact-tree hosted CI. Production apply remains held.

## Open items that wait on Daniel

- Existing production migration/import/provider/release holds remain attached to deployment; no new product question blocks this bounded backend implementation.
- Raw practice history/calendar purpose and retention, recording access/release and offline authorization/replay remain separate future contracts. This slice does not resolve them or collect their data.
