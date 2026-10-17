# Settled decisions (Daniel, binding)

- [MISSION ruling 14 and Teaching and progress](../../planning/2026-10-15-kickoff/MISSION.md), including rulings 45/53/58, include the student's quiet practice calendar/streak. Other people's practice summaries are days-only, without raw activity, cross-student reporting or leaderboards.
- Daniel directly confirmed on 2026-10-16: retain detailed practice activity for **90 days**, then only dates practiced until **one year after the ceremony**. This separate practice-history amendment is recorded in original coordination checkpoint `be9a1c6`; it is not inferred from submitted-recording retention. This branch does not replace root-owned shared MISSION/STATE/COORDINATION files wholesale.
- Existing generated-chant release/listening gates and recording-access rules remain binding. A client-reported practice action does not grant media access or prove that listening, recording or submission occurred.

## Architecture decisions (root, 2026-10-16)

These are approved implementation choices, not new Daniel rulings. This spec is the bounded online backend foundation following lesson checkpoint `9b914625`. Root must approve its frozen text before product source begins. No frontend, player, recording processing, offline lease/queue, service worker, notification, scheduler/provider deployment, import, production migration apply or other production operation is included.

### Selected-mode privacy and meaning

| Operation | Authorized selected modes |
| --- | --- |
| Record a client-reported action | Own student, or exact live linked-child practice using existing `practice-write` |
| Read the quiet calendar | Existing currently authorized student/parent/tutor/admin/linked-child read paths; dates only |
| Read raw current-window details | **Student mode and own current student identity only** |

Parent, tutor, admin and linked-child practice raw reads return 403, even if the signed-in person holds another role. The linked-child recording playback exception is not a raw-practice exception. Base modes reject practice-context headers as existing access primitives require. A mode, date, cursor, material selector or UUID never creates authority. No actor/session/context identity is accepted from clients.

Closed action kinds are `visit`, `play`, `record`. They describe a client report on currently authorized assigned material, not a verified duration, recording/upload, score, mastery assessment or actual audio playback. No media provider is called or checked; recording/generated-chant authorization remains separate. No GET manufactures a visit, and these actions never alter student self-checks or tutor assessments.

### Online day fence and uniform acknowledgement

Derive the practice day from a validated fresh server instant in fixed **America/Chicago**, independent of client timezone, locale, ceremony slot or tenant-custom input. Calendar reads return `serverDay`, so clients can supply `expectedDay`. It is a date fence, not a read-issued authorization capability.

An event request supplies `expectedDay`, which must equal the actual server Chicago date after every awaited authority/material/day/unique/database operation and before every result. Crossing midnight rejects the request and rolls back raw detail and the day marker, including apparent replay and quota paths. No automatic next-day retry, date rewrite, arbitrary past-date ingestion, lease or offline write queue is allowed. A new online user action can use the newly read day.

Deduplication namespace is `(tenantId, studentId, serverPracticeDay, client event UUID)`. Reusing a UUID on another current day is a new intent. Old bodies fail their day fence after midnight, including after the 90-day purge; no indefinite receipt/hash/audit record is required.

Every eligible write returns exactly `{ok:true,practiceDay}`. This promises that the date marker exists, **not** that every raw event was stored. Exact replays, the same scoped UUID with different payload/writer, and quota overflow all receive the same acknowledgement after fresh authority/current-material/day/retention checks. The first persisted raw row is immutable; a mismatch never changes it. Do not look up the old payload/writer to distinguish acknowledgement, and do not return counts, quota state, replay flags or `rawStored`. Invalid/stale authority, material, day or expired history still fails normally; acknowledgement is not a permission bypass.

### Current material verification and lock order

Reuse existing capabilities and lock order: tenant → user/session/membership/grant → student → relationship/context → material → practice-day row → raw insertion/count. Raw reads add an explicit own-student-only restriction; do not widen generic linked-child read.

For a Torah/haftarah verse event, require exact current confirmed assignment ID, assignment revision, kind and assigned canonical verse ref under `confirmedReadings` SHARE locks and its existing eligibility semantics. Existing confirmation recreates assignment-verse UUIDs, so those UUIDs are neither event identity nor historical foreign keys. Historical detail stores only the stable assignment/ref metadata, not passage text.

For a service-unit event, reuse catalog lifecycle SHARE before current service-plan SHARE; recheck exact current plan ID/revision, pinned catalog identity, selected unit and nonwithdrawn lifecycle using existing stored catalog/feed validation. No provider request, licensed feed/text copy, new review bypass, or separate nested public service transaction is introduced. Add a narrow internal verifier only where needed to compose these checks within the existing authorized transaction. Material is re-authorized for every acknowledgement, including replay/mismatch/at-cap outcomes.

Recheck real session expiry and exact linked-child context expiry, Chicago day and overall retention after every await and immediately before return. A student/material/context revision changed ahead of the held lock cannot be acknowledged from stale state. Preserve existing authority lock strength/order; never upgrade a previously acquired authority lock to perform unrelated revocation.

### Minimal persistence and quota

Additive local migration **0018**, without historical migration edits, introduces two tenant/student-qualified tables:

- `practice_day`: only tenant ID, student ID and practiced date, with a scoped unique/primary key. No counter, minutes, first/last timestamp, actor, UUID or receipt hash.
- `practice_event`: scoped day/UUID key, immutable server receipt instant, action, `sourceMode` (`student` or `child-practice`), and a closed discriminated historical material binding. **No user, membership, grant, session, guardian or context IDs**, licensed text, audio URLs or full payload/audit history. `sourceMode` identifies delegated assistance without retaining writer identity. All detail expires together.

Ensure/lock the current day marker and serialize writers on that row. Under its UPDATE lock, count only raw rows for this tenant/student/day. If fewer than **512**, insert the new immutable raw row with conflict-do-nothing; otherwise omit raw detail. All writers share this cap. Same-ID requests do not update an existing row; at the cap they still acknowledge the date. No stored daily count, per-event receipt, persistent rejection record or event-text audit survives deletion. Marker/raw insertion and final fresh checks share the authorized transaction, rolling back together on failure.

The rolling UTC window can intersect more than ninety Chicago date buckets, including partial dates and DST transitions; do not advertise `90 × 512` as an exact storage bound. The marker is not a synthetic daily total or a claim about effort.

Use FORCE RLS with matching tenant USING/WITH CHECK, tenant-qualified student/day foreign keys, immutable raw identity/content, closed discriminator/state checks and minimal grants. Runtime has only the INSERT/SELECT and day-lock permissions needed by reviewed operations, plus tenant-RLS-scoped DELETE used by retention. No general raw UPDATE, counter UPDATE or user-facing erase capability is added. Historical target identifiers do not depend on mutable assignment-verse rows or a live old catalog/material row; history reads do not resolve or serve withdrawn material.

### Exact retention and rescheduling

Raw detail survives only when `receivedAt > freshNow - 90 × 24 hours` in UTC, and only before overall expiry. Equality at the 90-day instant is expired. At Chicago midnight on the ceremony's calendar-year anniversary, **all raw detail and dates expire**: current Chicago date at or beyond the anniversary is due. Clamp February 29 to February 28 when the next year is not leap. This matches the accepted anniversary convention without inheriting recording retention scope.

Handle valid ceremony years 0001–9999 without changing roster validation. Internal numeric date parts and SQL date arithmetic support anniversary year **10000**; no four-digit anniversary string or deadline DTO is required. Do not reuse the recording helper's year-9999 rejection. Invalid/corrupt dates or invalid server instants fail closed; no invalid-date fallback retains history forever. Calendar arithmetic must avoid JavaScript's special 0–99 year constructor behavior, and fixed-zone conversion must cover Chicago spring/fall DST.

Read filtering uses fresh response-time bounds after delayed queries/results, not just a transaction-start timestamp or the time the query began. Calendar reads return no overdue dates; raw reads return no expired detail even if maintenance is delayed. Overall expiry returns an empty authorized calendar/raw view and rejects new event writes. Reads never perform cleanup writes or reconstruct deleted data.

Add a narrow **SECURITY INVOKER** trigger for `student.ceremony_date` changes. The student UPDATE already holds its row lock; calculate actual `clock_timestamp()` after that lock. If **either OLD or NEW ceremony anniversary is already due**, delete both practice tables for that exact tenant/student atomically with the date change. This includes postponed overdue ceremonies whose unswept history might otherwise reappear, and covers roster/import/future/direct-SQL writers. If neither deadline is due, the current ceremony governs subsequent retention. Trigger deletion/date/audit roll back together if the transaction fails. Deleted history is never reconstructed after a later reschedule.

Trigger runs as the restricted invoker, using ordinary tenant RLS and only the two narrow DELETE grants; no definer privileges, role switching or RLS bypass. Use SQL calendar-year arithmetic, actual post-lock clock and exact tenant/student predicates. This trigger changes practice retention only, not lesson or recording data.

Expose testable **internal** bounded maintenance, with tenant scope from trusted server composition, consistent student locking and fresh post-lock time. Process a bounded student batch and bounded raw/day deletion chunks, returning only internal continuation information; repeated calls physically purge detail past the 90-day bound and all rows past overall expiry. Raw cleanup preserves still-eligible day markers. The ceremony trigger's atomic exact-student purge remains complete. No HTTP cleanup endpoint, public caller-provided clock, scheduler, provider job or deployment operation belongs to this slice; immediate response-time filtering supplies privacy while a sweep is delayed.

### Closed API and client-safe types

Publish small client-safe TypeScript shapes without server/database imports. Proposed service: `createPracticeCalendarService({access, practice})`, `calendar(request, selection, window)`, `events(request, studentSelection, cursor?)`, and `record(request, selection, event)`; internal maintenance is separately composed and not an HTTP method. Route names and DTO bounds are ordinary implementation choices:

- `GET /api/students/:studentId/practice-calendar?mode=...&fromDate=YYYY-MM-DD&throughDate=YYYY-MM-DD`, with a closed inclusive window of at most **366 calendar dates**. Return `{ok:true,studentId,mode,serverDay,dates:[...]}`. Dates contain no count/action/ID/target/source mode/actor/timestamp. No cross-student query.
- `GET /api/students/:studentId/practice-events?mode=student`, optional paired `beforeReceivedAt`/`beforeId` keyset. Page size **50**, bounded chronological ordering by immutable receipt instant and UUID, no total count/snapshot claim. Return only own current-window event ID/day, server receipt instant, action, source mode and historical target binding, plus the next cursor. No writer identity or text/media/context locator.
- `POST /api/students/:studentId/practice-events` with closed `{mode,eventId,expectedDay,action,target}`. `target` is either `{type:"verse",kind,assignmentId,assignmentRevision,verseRef}` or `{type:"service-unit",catalogId,catalogIdentity,planId,planRevision,unitId}`. No client timestamp, timezone, duration, score, actor or extra fields. Return only the uniform day acknowledgement.

Cursor/date/material selectors grant no access. Strict unique/closed queries and discriminated bodies use existing ordinary JSON size/deadline limits, Origin before mutation body processing and inside the capability, private no-store responses, fixed safe failures and bounded response sizes. Expected day or material staleness uses private conflict/re-read semantics, without quota or same-ID mismatch distinctions. No automatic writes/retries occur on reads or failed responses. Historical raw data is evidence of a reported action, not a media receipt.

### Required acceptance and ownership

No broad audit/tests were needed for this contract inventory. Existing access/practice/confirmed-readings/service-plan primitives were checked against the frozen source; the independent contract report records threat review and root's final decisions. Author owns later schema/data/service/HTTP/types, normal tests and minimal runtime integration; reviewer owns independent adversarial source/tests/report. Product implementation still requires root approval of this saved spec.

Required evidence includes own-student/raw versus all-mode dates and child-context/overlapping-role boundaries; current-assignment/ref and service-plan/unit/withdrawal locks; immutable same-ID mismatch plus uniform at-cap acknowledgement; real concurrent cap/day-row/unique waits; no counter or receipt/audit leak; midnight rollback after waits; UTC 90-day strict equality and delayed read filtering; Chicago DST 23/25-hour days; Gregorian leap-century/Feb29/year9999→10000; fresh session/context/retention checks on every result; old-or-new-expired ceremony changes via restricted SQL and roster/import paths, including postponement and rollback; bounded physical cleanup leaving eligible dates; and actual SQL RLS/FKs/grants/immutability. Test only disposable local resources, preserve package lock/dependencies and other streams, and run exact hosted integration gates before final acceptance. No raw activity is exposed to non-student modes to make testing easier.

## Synthetic examples

```json
{"mode":"student","eventId":"10000000-0000-4000-8000-000000000001","expectedDay":"2026-10-16","action":"visit","target":{"type":"verse","kind":"torah","assignmentId":"10000000-0000-4000-8000-000000000002","assignmentRevision":3,"verseRef":"Genesis 1:1"}}
```

```json
{"ok":true,"practiceDay":"2026-10-16"}
```

```json
{"ok":true,"studentId":"10000000-0000-4000-8000-000000000003","mode":"parent","serverDay":"2026-10-16","dates":["2026-10-15","2026-10-16"]}
```

## Open items that wait on Daniel

No additional product answer is required for this bounded online backend. Offline authorization/release lease, client caching/queued event behavior, recording/provider integration, UI release and scheduler/production operation remain separate future decisions/gates. This spec neither chooses an offline lease nor applies practice retention to lesson logs or recordings.
