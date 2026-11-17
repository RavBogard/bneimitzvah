# Private submitted-recording implementation inventory

Source checkpoint: `0ce58b6`, 2026-10-17. Source-only inventory; no runtime, provider, credential, media or student-data access and no tests rerun. This continues the existing [recording contract](../../superpowers/specs/2026-10-16-recording-foundation-design.md), not a replacement design. The earlier [foundation return](../2026-10-16-parallel-work/RECORDING-FOUNDATION-RETURN.md) records its implementation evidence.

## Existing contract and implementation

The accepted contract already requires private capture, explicit submission, submitted-only staff access, no parent-dashboard recording disclosure, linked-child practice access through its explicit context, human feedback rather than scoring, and submitted-recording deletion one calendar year after ceremony. Reference/PocketTorah indexing, generated chant and practice-history retention are separate domains.

| Source | Implemented behavior | Boundary |
| --- | --- | --- |
| `src/server/recordings/types.ts` | Internal `StudentRecording`, `ReferenceRecording`, closed media facts and revision-bound operations | Server-only policy data, not an authorization proof or transport DTO. Student metadata has tenant/student IDs and lifecycle, but no material target, creator, receipt time, storage identity or bytes. |
| `src/server/recordings/policy.ts`: `validateRecordingMedia`, `validateRecordingMetadata`, `validateRecordingOperation` | Strict shapes, canonical UUIDs, bounded integers, MIME allowlist, rejection of accessors/unexpected keys, detached frozen values | Metadata checks do not inspect or verify actual audio. Default 32 MiB/10-minute limits are engineering defaults, not new Daniel rulings. |
| Same module: `transitionRecording` | Explicit private-to-submitted; irreversible begin-delete/complete-delete; current ID/revision checked even for no-ops | Pure proposal only. Atomic database CAS, fresh authority, physical deletion and any durable notification deduplication are unimplemented. |
| Same module: `studentSubmissionRetention` | Submitted student recordings only; fresh ceremony/current dates; inclusive calendar anniversary; February 29 clamps to February 28 | Injected date-only inputs, no scheduler or production time-zone boundary. Deleting/deleted never revive. Private/reference cleanup is intentionally not decided. |

**Absent integration:** no recording schema/table, recording data adapter, authenticated service, recording HTTP route, client-safe DTO, upload/media-verification boundary, storage adapter/configuration, playback capability, deletion worker or scheduler is wired. `src/server/runtime/composition.ts` (`composeRuntime`, `createRuntimeScope`), `runtime/config.ts`, `http/portal.ts` and the schema exports in `db/index.ts` contain no recording integration. There is no recording-specific persisted audit action. Existing tests exercise policy rather than recording authorization, transport or storage.

## Selected-mode authority to reuse

| Selected mode | Existing entry point | Recording-specific restriction still to implement |
| --- | --- | --- |
| Own student | `practice/service.ts`: `createPracticeService().withPracticeCapability`, literal `read` or `practice-write` | Exact own student; permitted private/submitted operations need the reviewed recording operation contract. Upload alone cannot submit. |
| Linked-child practice | Same method, mode `child-practice`, opaque request-header context | Exact selected child/session/guardian/context and current revisions; no staff authority. Delegate capture/submit/delete semantics are not established merely by the existing capability name. |
| Assigned tutor / admin | `access/service.ts`: `createAccessService().withStudentCapability` | Submitted-only recording views; explicit staff operation restrictions. Neither generic `read` nor `note-write` authorizes student submission. |
| Parent dashboard | Generic access `read` currently permits authorized parent/student linkage | Recording routes must reject this mode and expose no recording rows, IDs, counts, timestamps, locators or playback capabilities. Overlapping tutor/admin grants must not upgrade the selected mode. |

`access/identity.ts` (`createVerifiedIdentityAccess`) derives tenant from the deployment/request host and verifies the real SDK session and database identity. `data/authority.ts` supplies `lockIdentityRecords`, `lockRoleGrant`, `lockStudent` and `lockStudentRelationship`: tenant, user, session, membership, selected grant and exact relationship are current server facts. Existing lock intent/order must be preserved.

`practice/service.ts` additionally binds child context to session, parent grant, guardian practice permission, authority/student revisions and expiry, with context last in the authority lock sequence. Old handles fail after switch/revocation. Base selected modes reject an unexpected practice header. Cookie mutations use exact-Origin protection in `http/mutations.ts` (`requireCookieMutation`). `db/runtime.ts` (`withTenantTransaction`) supplies the restricted tenant-scoped transaction, not authority by itself.

`progress/service.ts` (`createProgressService`, internal `authorized`/`assertLive`) is a useful composition example: literal operation capability, locked current material, exact revisions, fresh session/context checks after awaits and before all outcomes, including conflicts/no-ops. Future external media/storage waits require the same freshness discipline before metadata commit or playback delivery; the existing policy module proves none of this.

## Material identity and retention reuse points

- `data/portal.ts`: `confirmedReadings` locks confirmed Torah/haftarah assignments in SHARE mode before reading bounded verse lists. `progress/service.ts` validates kind, assignment ID/revision and canonical current refs against the authoritative material.
- `data/roster.ts`: `persistAssignment` preserves assignment ID but replaces all `assignmentVerse` rows/UUIDs and increments assignment revision. Cuts-only revisions preserve verse UUIDs. Progress instead preserves the intersection by assignment ID plus canonical verse ref and prunes removed heads. A new student-recording material binding must account for this lifecycle; the current recording type does not choose one. The reference-recording type's verse UUID is not a student-recording contract.
- `service-learning/service.ts`: `verifyPracticeServiceUnit` verifies catalog identity, current plan/revision, selected unit, slot and nonwithdrawn lifecycle, using the existing lifecycle-before-plan locks and fresh checks after awaited feed/plan work. It grants no authority. Reuse only if root selects service-unit recording scope.
- `practice-calendar/service.ts` uses these material primitives, but a client-reported `record` practice event is not proof that media exists or was submitted.
- The recording policy requires a freshly authoritative ceremony date/revision before retention decisions and rechecks around deletion work. Its current year-9999 input fails because the next anniversary cannot fit its four-digit string. Roster dates allow year 9999. This documented policy/API edge needs an explicit compatibility decision before persistence/scheduling, rather than silently inheriting a new restriction.
- `practice-calendar/policy.ts` has Chicago calendar arithmetic and internal year-10000 handling; `practice-calendar/maintenance.ts` (`createPracticeCalendarMaintenance`) demonstrates bounded trusted maintenance with locked students and fresh time. Its 90-day raw retention, daily quota and ceremony-update purge trigger apply only to practice history. They do not settle recording retention time zone, draft cleanup or media destruction semantics.

## Schema, service and test integration hooks

The current migration journal ends at `0019_quiet_roster_intake`; an approved additive recording schema would start at **0020**, preserving historical SQL. No migration is proposed/applied by this inventory. Existing progress/lesson-log schemas and migrations 0016/0017 demonstrate tenant-qualified foreign keys, FORCE RLS/minimum grants, version constraints, immutable ownership and irreversible tombstones. Recording-specific audit actions would require the existing closed audit constraint to be extended without including media/locators in audit payloads.

`runtime/composition.ts` is the service-composition hook; `http/portal.ts` is the current dispatch hook. `http/progress.ts` and `http/lesson-log.ts` demonstrate closed body/query parsing, minimal mode-bound projections, fixed errors and no-store responses. No recording storage/provider abstraction exists to implement against yet; current runtime provider configuration covers the existing database/auth/mail/text integrations.

Reusable synthetic evidence and fixtures:

- `tests/app/recording-policy.test.ts` and `recording-policy-adversarial.test.ts`: closed inputs, limits, hostile object traps, immutability, lifecycle/CAS proposals and calendar retention. Reuse existing results; these are not endpoint authorization evidence.
- `tests/app/access-fixture.ts`, `practice-fixture.ts`, access/practice tests and `tests/postgres/access-fixture.ts`: real authority contexts, restricted transactions, expiry/revocation and observed database waits.
- `tests/app/progress-adversarial.test.ts` and `tests/postgres/progress-races.integration.ts`: independent-stream CAS, stale no-ops, reassignment, authority expiry after waits and rollback.
- Practice-calendar adversarial/race tests and `tests/postgres/service-learning.integration.ts`: exact current material, lifecycle/plan changes and post-wait checks.
- Existing authenticated study/progress browser fixtures: real SDK selected-mode/context switching and late-response fencing. Add recording transport/storage cases only once that boundary exists. Spawned checks must use `tests/helpers/isolatedEnv.mjs` and synthetic media facts only.

## Minimum next slice and architecture decisions

The smallest storage-independent continuation is a reviewed persisted metadata/lifecycle service: tenant/student binding, database CAS, recording-specific selected-mode/state projections, deletion tombstones and synthetic authority/race tests. It can use an internal trusted verified-media registration seam without a public endpoint that trusts browser-claimed media facts. Actual upload/playback, provider selection, scheduling, notifications and offline leases remain separate boundaries. This is an implementation option for root to scope, not an approved new product feature or a claim that fake metadata registration is shippable recording capture.

Root should settle the remaining operation/schema choices against the existing spec: material target (if any), private draft ownership between student and delegated parent, permitted deletion actors/trusted completion, verified-media registration/provenance, and any metadata retention/tombstone constraints. Storage/playback delivery and offline/deferred-upload behavior need their existing reviewed contracts before exposure. The submitted one-calendar-year rule, explicit submission, parent-dashboard exclusion and generated-chant gates are already binding and are not reopened. Production recording time-zone scheduling, private-unsent cleanup and the year-9999 compatibility edge remain explicit gaps. Independent adversarial recording-access/tenancy review is required before an authenticated recording endpoint is accepted.
