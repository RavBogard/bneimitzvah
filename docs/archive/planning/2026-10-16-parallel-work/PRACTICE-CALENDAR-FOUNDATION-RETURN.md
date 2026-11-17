# Practice calendar foundation return

2026-10-16. Managed branch `codex/practice-calendar-foundation`, based on clean lesson checkpoint `9b914625f16a38a3df44082761c15a7a76baee18`. Approved contract: `3caa231d9de9fcf2de7879a700ba52688ea69d04`. Product/schema/migration freeze: `28494a7efc32f1ebeb3bc0ab561f3ac50bce68bd`; independent tests saved unchanged as `78c7b726cab9a6153902ef13ced47adde0cd7a08`. Independent source/app/PostgreSQL acceptance and author full app/typecheck/build are complete. Exact hosted CI remains root's next gate.

Evidence: [approved contract review](PRACTICE-CALENDAR-DESIGN-REVIEW.md), [independent foundation review](PRACTICE-CALENDAR-FOUNDATION-REVIEW.md), and [frozen spec](../../superpowers/specs/2026-10-16-practice-calendar-design.md).

## Scope and meaning

This implements Daniel's separate practice-history retention ruling: raw detail for ninety rolling UTC days, followed by dates only until the ceremony's calendar-year anniversary at Chicago midnight. It does not change recording or lesson retention. Raw read is restricted to the student's own selected student mode; parent/tutor/admin/linked-child modes receive only dates. Student or explicit live linked-child practice can report a current assigned verse or selected service unit using existing capabilities. Visit/play/record are client reports, without media proof, duration, scores or inference from reads.

Every valid online write returns the same `{ok:true,practiceDay}` acknowledgement, including quota overflow or same scoped UUID with different payload/writer. It promises the date marker, not a raw receipt. The first raw row is immutable. There are no actor/session/grant/context IDs, event audits, durable receipts, daily counts or offline retries. The shared 512-detail cap is serialized by the student/day row and counted from raw rows only. Exact current assignment or catalog/plan/unit binding, fresh authority and the expected Chicago day are checked even on these uniform-acknowledgement paths.

Overall expiry clamps leap day and supports valid ceremony year 9999 through internal year-10000 date arithmetic. Reads filter at fresh response time before cleanup. A narrow SECURITY INVOKER ceremony-date trigger samples actual wall time after the student lock and prunes when either old or new deadline is due, so postponement cannot revive expired history. Trusted internal maintenance takes at most 25 students and a total deletion budget of at most 1,000 raw-plus-date rows, returning only `more`. No public cleanup endpoint, scheduler or production operation is added.

## Files and API

- Client-safe shapes: `src/lib/practice-calendar/types.ts`; server policy, closed validation, service, maintenance and data modules.
- `practiceDay` / SQL `practice_day` contains only tenant/student/date. `practiceEvent` / SQL `practice_event` contains scoped day/UUID, receipt/action/sourceMode and closed material binding. Tenant-qualified student/day foreign keys, FORCE RLS, immutable content and minimal grants apply.
- Additive local `0018_practice_calendar_foundation.sql`, snapshot and journal entry. Receipts use explicit trusted server milliseconds plus timestamp(3) storage/default; the database requires practice day to match the receipt's Chicago date. Historical migrations remain unchanged.
- Narrow internal service-learning verifier shares existing stored catalog validation and lifecycle-before-plan locks. No public nested authorization transaction, provider call or licensed text response is introduced. Existing service-learning regression coverage was run.
- Minimal HTTP/runtime/dispatch and injected test-fixture composition. No frontend implementation or visual change.

Service `createPracticeCalendarService({access,practice,now?})` exposes `calendar(request, selection, window)`, `events(request, selection, cursor?)`, and `record(request, selection, write)`. Trusted injected `now` controls practice policy/receipt time; real session/context expiry remains checked against actual time, never a client clock. Internal maintenance is `createPracticeCalendarMaintenance({db,now?}).run({tenantId,studentIds,limit?})` and is not exposed through HTTP.

HTTP GET `/api/students/:studentId/practice-calendar` accepts only `mode`, `fromDate`, `throughDate` (at most 366 inclusive dates). GET `/api/students/:studentId/practice-events` accepts only `mode` and paired `beforeReceivedAt`/`beforeId`, page 50. POST to the latter accepts a closed body and no query. Existing Origin, body, method, no-store/private-error policies apply. Stale material/day or expired retention returns HTTP 409 with a fixed code; authorization denials remain the existing private 401/403/404 semantics. Reads never write.

Synthetic POST body:

```json
{"mode":"student","eventId":"10000000-0000-4000-8000-000000000001","expectedDay":"2026-10-16","action":"play","target":{"type":"verse","kind":"torah","assignmentId":"10000000-0000-4000-8000-000000000002","assignmentRevision":1,"verseRef":"Genesis 1:1"}}
```

Uniform successful response:

```json
{"ok":true,"practiceDay":"2026-10-16"}
```

## Executed verification

| Gate | Current evidence |
| --- | --- |
| Author pure policy/validation | 8 passed; Chicago midnight, spring/fall DST, exact rolling UTC age, leap anniversary, internal year 10000, canonical/bounded windows/cursors |
| Author normal HTTP/schema/maintenance | 4 passed; actual private dispatch, read-only/default privacy, uniform mismatch acknowledgement, closed bodies/query/Origin, stale binding/day, scoped RLS/FKs/grants, old/new ceremony pruning and exact stored receipts |
| Author migration upgrade/replay | 1 passed; prior lesson/current authority preserved, empty forced-RLS tables and exact grants, SQL anniversary year 10000 and invoker trigger. Final five-test normal/upgrade batch passed in 7.44s |
| Existing service-learning regression | 13 passed; shared verifier extraction preserves plan/catalog/withdrawal/child authority/expiry behavior |
| Composed source typecheck | Passed at frozen source, including reviewer app draft |
| Independent app | 7 passed, 12.62s at `28494a7`; own-mode privacy, quota/mismatch immutability, day reuse after purge, current verse/unit withdrawal, equal/adjacent-ms cursor pagination, exact retention/maintenance and DST/leap/year-9999 behavior |
| Independent actual PostgreSQL | 25 passed, 14.55s; nineteen observed `pg_blocking_pids` blocker edges across quota/day/unique/authority/context/material/maintenance waits, plus ceremony pruning, actual restricted SQL attacks, native receipt precision and pagination ties |
| Full author app integration | 820 passed plus one existing skip, 91 files, 280.50s at `78c7b726` / product `28494a7`; one full run after independent PG cleanup/lane release |
| Final typecheck and build | Both passed at the same frozen source/reviewer tests, without source/config restoration needed |
| Final staged candidate/index guard | Passed using `npm run check:repo` with final return/review documents staged; candidate and index protection plus `git diff --check` passed |

First focused batch was honestly 24 passed / 2 failed. Author corrected two implementation defects before freezing: a plain rollback exception was masked by the existing identity boundary (now a private AccessDenied subclass translated only after rollback), and cleanup requested unnecessary raw-row FOR UPDATE without UPDATE privilege (student UPDATE already serializes writers/pruning; immutable raw DELETE rechecks fresh cutoff and selected keys). The affected four tests passed after correction. A final schema check additionally rejects numeric catalog identities, matching the closed string DTO; upgrade and normal tests passed after that bounded change. No failure was hidden or attributed to an independent run.

Ignored logs: `.local-logs/calendar-schema-generation.log`, `calendar-normal.log`, `calendar-normal-confirm.log`, `calendar-final-normal.log`, `calendar-source-typecheck.log`, `calendar-independent-app.log`, `calendar-independent-typecheck.log`, `calendar-independent-pg.log`, `calendar-full-app.log`, `calendar-final-typecheck.log`, `calendar-final-build.log`. Independent command was `node .local-logs/calendar-pg-isolated.mjs`, a bounded copy of the inspected prior runner: exact loopback cluster identity assertion, fresh owned anchor and disposable databases/restricted fixture roles, cleanup only owned resources. Reviewer measured anchor removed true, all fixture closes complete, HEAD/source/migration unchanged. The exclusive lane was released before author full app integration began. No shared role password, cluster or other process was changed.

Independent test hashes (SHA-256) are app `2f297e65c75a21b62f8a46dd0f549f236ead1fae223f2cfe37216321256f1a72`, PostgreSQL `2f4a8a96c7851eaeaa33a37c828672f99d83ede8735a0634836e66aac5d33f1b`. The reviewer additionally checked that the 0018 snapshot links to 0017, adds only the two new tables, changes no prior snapshot tables/sections or journal entries, and leaves historical SQL untouched. Independent executed checks remain distinct from author normal/integration gates.

## Remaining gates and next action

Independent source/adversarial app and actual PostgreSQL race review accepted the frozen source, followed by one full local app integration and final build/typecheck. Final reports are copied byte-for-byte from the reviewer's original context; candidate/index repository guard and diff check run with all documentation staged before the handoff commit. Root publishes the accepted review checkpoint and watches exact hosted CI, including required Node, Windows/Linux app, PostgreSQL and browser gates. Existing unchanged 185-test engine evidence is reused locally. No new browser/visual lane is needed for this backend-only milestone. The predecessor lesson checkpoint's exact hosted gates are green, including all 78 browser cases; this is reused context, not claimed as the new calendar tree's CI result.

Publishing the reviewed branch for CI is allowed. Production/deploy/provider/migration apply, scheduler deployment, frontend and offline work remain held. Original shared STATE/COORDINATION and moving UI/voice streams are outside this implementer's ownership. Follow-up implementation remains subject to root's next bounded assignment; the practice-calendar contract does not authorize an offline lease or automatic write queue.
