# Settled decisions (Daniel, binding)

- [MISSION's Teaching and progress amendment](../../planning/2026-10-15-kickoff/MISSION.md), ruling 47, includes tutor-written lesson summaries visible to parents, without hours, lesson scheduling or pay/accounting.
- MISSION's amended role rules retain explicit student, parent, assigned tutor and congregation admin authority. Linked-child practice is a separate delegated capability, without tutor/admin privileges.

## Architecture decisions (root, 2026-10-16)

These are root-approved implementation choices, not additional Daniel rulings. This backend slice stores a human-written, student-scoped current lesson summary, independent of assignments, verse progress, recordings and raw practice history. No frontend, provider, notifications, calendar scheduling, import or production operation is included. Additive migration 0017 may be generated and exercised only in disposable local fixtures; production migration application remains held.

### Identity, authority and lifetime

Namespace each client-generated UUID by `(tenantId, studentId, entryId)`. Record immutable creator membership and user identities internally with tenant-qualified foreign keys. There is no assignment/verse foreign key, assignment revision binding, or dependency on the original creator's role grant remaining active. Reassigning verses or replacing a tutor does not erase a still-authorized family's lesson log.

Reuse existing `access.withStudentCapability` read and staff `note-write` capability paths, and `practice.withPracticeCapability` read for explicit linked-child practice. All tenant, actor, student, role and context authority is server-derived under existing access/relationship locks. Base modes reject practice headers. Parent dashboard, student and linked-child practice are read-only. A current authorized tutor/admin can create. An entry's current authorized original-author tutor can edit/delete it; a current authorized admin can edit/delete any entry for that student. Other assigned tutors can read. Ownership narrows an already authorized staff capability and never creates access. Admin edits preserve original creator attribution.

Each entry is one current head with a positive integer version. There is no full-text history. Edit/delete must supply the exact current expected version, lock the scoped entry and recheck current authority. Even an identical edit requires that expected version and fresh authority; it may be a current-version no-op. Stale requests conflict and require re-read, without silently overwriting.

Deletion clears the summary and increments the version while retaining an irreversible tombstone, scoped identity and creator. Deleted entries never appear in normal reads/lists and cannot be edited, restored or recreated, including with the current tombstone version. This prevents delete/recreate ABA. No one-year recording retention rule is applied to lesson summaries.

Create replay is allowed only for a live, undeleted **version 1** head whose original creator membership **and user**, normalized lesson date and normalized summary exactly match the request after fresh current authority. An edited/deleted head conflicts even if its text/date later cycle back. Admin edit authority does not authorize claiming another creator's create replay. After a unique-key wait, lock/re-read the winner and repeat all replay/expiry checks.

### Input and projection

Accept a strict real Gregorian `YYYY-MM-DD` lesson date using the existing leap-year/calendar validation algorithm in `lib/readings/ranges.ts`, without ceremony scheduling bounds or an arbitrary future-date rule. The date classifies a human lesson record; it does not schedule a lesson.

Normalize CRLF to LF and require a nonblank plain-text summary of at most 4,096 UTF-8 bytes. Reject malformed Unicode and disallowed control characters consistently with existing plain-text work. Do not interpret HTML or accept actor IDs, emails, timestamps, duration/hours, assignment bindings or unknown fields. Client timestamps/provenance are not accepted.

Use a lesson-specific minimal DTO: `entryId`, `lessonDate`, `summary`, `version`, a safe creator `displayName`, and server-derived current `canEdit`/`canDelete`. Do not copy `student-work.view`, which exposes membership IDs and creation timestamps. Reuse its safe-name idea, with a generic label for email-like, control-bearing, oversized or blank names. No user/membership/grant IDs, email, timestamp, practice handle or raw audit fields leave this DTO. The name identifies the original creator, without claiming that an administrator never edited the current text. Permission booleans are derived afresh and are never trusted on writes.

List only the authorized tenant/student's nondeleted heads, ordered by `(lessonDate DESC, entryId DESC)`, with bounded keyset pagination. Cursor date/UUID selectors grant no authority. Concurrent date edits can move entries across pages; clients must refresh after an edit, and the API makes no cross-request snapshot-pagination claim. Reads do not write, audit a mutation, infer progress or emit practice events.

### Service, HTTP and schema boundary

Expose client-safe types in a small `src/lib/lesson-log/types.ts` with no server/database imports. Proposed service is `createLessonLogService({ access, practice })` with `page`, `create`, `edit` and `remove`; each accepts the Request plus explicit selected mode/student binding. Keep ordinary private HTTP responses, closed/unique queries, bounded JSON bodies, Origin checking before mutation body processing and inside the authorized operation, and fixed safe errors. Proposed routes:

- `GET /api/students/:studentId/lesson-log?mode=tutor` with optional closed `beforeDate`/`beforeId` cursor pair.
- `POST /api/students/:studentId/lesson-log` with closed `{mode, entryId, lessonDate, summary}`.
- `POST /api/students/:studentId/lesson-log/:entryId/edit` with closed `{mode, expectedVersion, lessonDate, summary}`.
- `POST /api/students/:studentId/lesson-log/:entryId/delete` with closed `{mode, expectedVersion}`.

Use page size 50 with a single extra row to determine `nextCursor`; do not return tombstones or a total-history count. Expected conflicts produce HTTP 409; absent/unauthorized entry behavior follows existing private access semantics. No automatic offline mutation queue or retry is added.

Add one current-head table and additive 0017 migration after progress 0016, preserving all historical migrations. Enforce tenant-qualified student/creator foreign keys, FORCE RLS with matching tenant USING/WITH CHECK, minimal runtime grants, immutable scoped identity/creator, consecutive positive versions and irreversible text-clearing deletion constraints. Audit only server-derived actor/action/scoped entry identity, without summary text. Keep capability/entry locks through writes, replay and all results. Recheck actual session/context expiry after entry/unique/database waits and immediately before successful, no-op, conflict or replay returns; rollback mutations/audits on expiry.

## Synthetic API examples

Create body:

```json
{"mode":"tutor","entryId":"10000000-0000-4000-8000-000000000001","lessonDate":"2026-10-16","summary":"Synthetic lesson: reviewed the assigned reading."}
```

Safe live entry projection:

```json
{"entryId":"10000000-0000-4000-8000-000000000001","lessonDate":"2026-10-16","summary":"Synthetic lesson: reviewed the assigned reading.","version":1,"displayName":"Synthetic Tutor","canEdit":true,"canDelete":true}
```

Edit and irreversible deletion bodies respectively:

```json
{"mode":"tutor","expectedVersion":1,"lessonDate":"2026-10-16","summary":"Synthetic corrected lesson summary."}
```

```json
{"mode":"tutor","expectedVersion":2}
```

## Acceptance and ownership

Independent adversarial review is required before acceptance: current author/other tutor/admin/parent/student/child mode matrix; revocation and overlapping modes; same-ID identical/different-content/different-creator races; replay after edits/date changes/text cycles/deletion; stale edit/delete and tombstone irreversibility; scoped UUID collisions; real expiry/unique/row-lock waits and rollback; safe DTO/name projection; current-only keyset ties; actual restricted PostgreSQL FK/RLS/immutable/version/deletion attacks. Author adds normal schema/data/service/HTTP tests and isolated migration upgrade/replay coverage. Reuse accepted progress evidence for unchanged code and run appropriate integration gates on the final source.

This spec may be prepared during editor-modal integration. Lesson-log implementation waits for the modal checkpoint and root's approval of this saved contract. No UI owner source, provider operation or production migration apply is authorized by this document.

## Open items that wait on Daniel

No product decision is needed for this bounded backend contract. A distinct long-term lesson-summary retention/deletion policy, any scheduling/accounting feature, notification behavior and student-visible frontend release remain outside this slice; the recording retention rule is not substituted for those future decisions.
