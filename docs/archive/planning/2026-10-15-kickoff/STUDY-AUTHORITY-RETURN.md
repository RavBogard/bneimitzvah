# Assigned study text authority — 2026-10-16

Bounded implementation following `STUDY-PIPELINE-PLAN.md`, the reviewed adapter
and cache checkpoint `67e7175`. No frontend, provider fetch, licensed passage,
schema change, commit or push. Root retains integration and release ownership.

`study/service.ts` captures a frozen binding under the selected existing read
capability, ends that transaction, loads public chapters, then re-enters the same
capability. It compares tenant/origin, user/session ID and expiry, membership ID
and authority revision, grant ID/role/revision, mode, relationship ID/revision
where present, context ID/authority revision/student/live student revision/expiry,
student revision, confirmed assignment ID/kind/revision/basis/ranges/ordered refs,
confirmation date and derived `needsReview`. References are re-expanded against
the trusted catalog. Snapshot drift returns a discriminated result inside the
callback, then fixed 409 outside; existing authority denials retain 401/403/404.
No text leaves an unsuccessful final callback. Disconnects deny before load,
before final re-entry and before projection. Session/context expiry is checked
again immediately before projection, covering natural expiry during a final SQL
wait. Authorization linearizes at that final projection; it cannot erase content
already delivered or in flight.

The added internal actor fields derive from already-locked rows. Guardian
revisions are captured for parent and child practice; immutable student/tutor
relationship identities have null revision. Existing lock order and tenant
privileges remain unchanged. The invitation audit actor constructor received
only the corresponding required fields. Public DTOs exclude these internal
authority details.

`study/sefaria.ts` now uses the persistent normalized cache outside authority
transactions. Cache failures/corruption deny; expiry cannot become a stale
fallback. Complete chapters are cached, and only assigned rows enter a page.
The injected public-only coalescer has at most 32 pending keys, no queue, a
five-second task ceiling and independent subscriber cancellation/accounting.
The last subscriber aborts shared work; late responses after ignored abort are
canceled before a reader is acquired. Shared tasks retain public transport
dependencies only, with no actor or database handle. Runtime shares tasks per
fetch function within one process; this is not distributed coalescing across
processes/deployments. Completed task values are not retained there.

Each page retains two concurrent chapters, eight chapters/100 selected verses,
an eight-second deadline and 2 MiB aggregate bytes. Each fetched/coalesced chapter
counts the greater of normalized bytes and observed original response bytes;
cache hits count complete normalized chapter bytes. The public database cache
and public task coalescer confer no assignment access. Provider requests remain
the closed reviewed Sefaria v3 request, without incoming headers or identities.

The literal GET `/api/students/:id/study-text` accepts only the unique approved
mode/kind/assignmentId/assignmentRevision/translation/offset query. Translation
is `jps2023`, kind is Torah/Haftarah, and the practice handle stays in its header.
The handler projects assignment/student/context binding, page rows and reviewed
credits with private/no-store/no-referrer headers. Invalid requests, stale
metadata, unavailable text and missing/partial translation remain explicit.
The existing metadata endpoint is unchanged.

Tests include all five authorized modes, anonymous/foreign/unrelated/missing-role
denial before provider work, closed queries, stale IDs/revisions, assignment
corruption, grant/guardian/session/confirmation drift, disconnects, poisoned cache,
partial translation, shared cancellation/cap/deadline/late-body cleanup and page
byte limits on cache hits and coalesced work. New synthetic helpers generate
invented syllables and numbered labels, never passage fixtures. Typed runtime
fixtures add the study service with an unavailable synthetic reader. The shared
browser fixture also includes the invitation UI worker's requested captured-mail
failure callback solely in its injected test transport.

Real PostgreSQL 16.15 first passed **9/9** cases: reassignment, link/grant revocation,
logout, context switch and student edit commit while actual synthetic fetch is
held; cache-hit barriers also cover reassignment/context switch/student edit.
Requiring COMMIT before releasing the barrier proves provider/cache work holds
no old authority transaction locks. All reads use a fresh fixture's restricted
runtime role; context switching uses its independent runtime connection. Two
additional deterministic final-SQL expiry cases were then added. Root's final
run passed **11/11**, including both expiry cases; the complete PostgreSQL service
suite also passed **24/24**. Evidence: `.local-logs/study-authority-postgres-final.log`
and `.local-logs/invitation-study-postgres.log`.

Final focused synthetic gates passed **145/145** across the study adapter/cache/
composition/service and existing access/practice/portal route tests. Repository
guard passed **1/1**, and typecheck passed after the final expiry addition.
Ignored evidence: `.local-logs/study-authority-focused.log` and
`.local-logs/study-authority-guard.log`.
No live provider or full-catalog semantic/edition coverage is claimed. Existing
adapter limitations and all generated-chant/listening gates remain in force.

Published checkpoint `2b37394` passed Astra's independent authority review, full
local integration and all four hosted jobs in run `38891100680`; matching Vercel
deployment `7117315075` succeeded. The approved frontend DTO consumer and its
late-response/context clearing checks are the next bounded slice.
