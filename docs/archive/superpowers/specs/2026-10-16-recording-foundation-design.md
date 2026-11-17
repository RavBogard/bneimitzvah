# Settled decisions (Daniel, binding)

Authority: [MISSION.md](../../planning/2026-10-15-kickoff/MISSION.md), especially rulings 1, 14–17, the submitted-recording retention amendment, and service-learning scope. Work boundaries: [COORDINATION.md](../../planning/2026-10-16-parallel-work/COORDINATION.md).

- Student recordings start private. Sending one to the tutor is an explicit student action; saving, capture, deferred upload, validation or retry never publishes it automatically. Tutors/rabbis receive submitted recordings for human feedback; automated scoring is outside this work.
- The parent dashboard never includes recordings. Parent sign-in can access an authorized child's recordings only inside the explicitly selected linked-child practice context. This grants no tutor/admin authority.
- Delete students' submitted recordings one calendar year after their ceremony. This is separate from a separately consented adult voice-training/reference corpus. The storage/access/deletion notice is not a new consent gate.
- Portal reference audio is Torah/haftarah verse audio. Prayer audio links to CRC Music. Generated chant remains a separate asset/release path requiring G1, G2 and Daniel's G3 listening approval; it cannot enter this recording type.
- No real recordings, student/family data, licensed text, credentials or model weights enter the public repository. No provider provisioning, cloud spend, production change or student-visible release is part of this slice.

## Bounded first milestone

`src/server/recordings/types.ts` and `policy.ts` implement pure, server-only metadata validation, lifecycle proposals and a retention decision. They do not authenticate callers, grant access, read/write storage, parse upload bodies, decode media, perform database transactions, send notifications, install a deletion scheduler or expose an HTTP route. A valid policy result is **not authorization**. There is deliberately no role-to-permission boolean that could be mistaken for the existing authority service.

All public functions consume unknown data, reject malformed/unknown fields, and return immutable discriminated results. Generic `invalid-recording` and `recording-conflict` errors never echo input or distinguish a missing/foreign resource. Outputs copy and freeze every structured value. Plain data objects, including null-prototype objects, are supported; custom prototypes, accessors, symbols and hidden properties fail closed. No input getter needs to execute.

## Internal types and input boundaries

The capture descriptor accepts exactly `mediaType`, `byteLength` and `durationMs`. Ownership, tenant/student IDs, storage URLs/keys, filenames, generated flags, roles and consent flags are rejected. A future handler obtains ownership entirely from live server authority. This slice offers no create/upload operation; future creation must construct a private record from that authority plus independently verified media facts.

Internally loaded metadata has a closed discriminator:

| Kind | Required fields beyond kind | States |
| --- | --- | --- |
| `student-recording` | id, tenantId, studentId, revision, media | private, submitted, deleting, deleted |
| `reference-recording` | id, tenantId, revision, media, verse { reading, verseId } | available, deleting, deleted |

The metadata validator is for internal records loaded under authority, never a request-body schema. The tenant/student fields in its output are syntactically checked data, not trusted client claims. The future persistence adapter must bind them to the independently authorized tenant/student/recording selection. `verse.reading` accepts only `torah` or `haftarah`; `verseId` is an opaque internal identifier. Its existence, classification and current authorized assignment must be resolved by that future adapter. No licensed verse text belongs in this metadata.

The operation descriptor accepts exactly `operation`, `recordingId` and `expectedRevision`; operations are `submit`, `begin-delete`, `complete-delete`. Tenant/owner/role/context claims cannot be smuggled into it. `complete-delete` is intended for a trusted deletion worker after confirmed destruction, never as a client-selectable proof that deletion happened.

Recording/student/verse identifiers are fixed-length, canonical lowercase UUID-shaped strings (syntactic bounds, not identity proofs). A future reference adapter must bind `verseId` to the actual persisted reading-verse UUID; this slice does not invent another verse identity. Tenant IDs instead preserve the existing text primary keys such as `crc` and `other`: 1–64 ASCII characters, beginning with a letter or digit and continuing with letters, digits, underscores or hyphens. Case is preserved without normalization. Empty, whitespace/control-bearing, URL-shaped and overlong tenant keys are rejected. This is an **engineering syntax bound**, not a tenant lookup or authority check. Revisions, byte counts and millisecond durations are positive safe integers. Configurable defaults are 32 MiB, 10 minutes and revision 2,147,483,647. These are conservative **engineering bounds**, not Daniel's product rulings or a database schema. Configuration is a complete closed object of positive safe integers. Revision exhaustion blocks changes; valid current-revision no-ops do not increment.

The media declaration allowlist is exactly `audio/webm;codecs=opus` and `audio/mp4;codecs=mp4a.40.2` (AAC-LC). MIME aliases, unspecified codecs, MP3, WAV and other combinations fail closed here. This declaration check does not inspect bytes: future media processing must verify the actual container/codec, measured bytes/duration and capture support before accepting playable content. It must not trust browser declarations or transcode into generated-chant provenance. No decoder/parser is needed for this pure milestone.

## Lifecycle and concurrency contract

`transitionRecording` returns an immutable proposal with `changed` and the next record; it performs no write. Every operation first matches the recording ID and exact current revision, including retries and no-ops.

- `submit`: private student recording -> submitted, increment revision once. An already submitted record at the current revision is a no-op; references and deleting/deleted records cannot submit.
- `begin-delete`: any nondeleted supported record -> deleting, increment once; deleting/deleted retries at the current revision are no-ops.
- `complete-delete`: deleting -> deleted, increment once; already deleted is a no-op. Private/submitted/available records cannot skip deletion work.

There is no unsubmit, restore, publication or visibility-expansion command. A stale replay conflicts even if the operation would otherwise be a no-op. Two proposals against the same initial revision can both be calculated: **the future database transaction must compare-and-swap that exact revision atomically**, so only one can commit. On conflict, reload under fresh authority before retrying. Notifications must follow a successfully committed private-to-submitted transition with durable deduplication; pure evaluation or resubmission must never send them.

Deleting/deleted metadata is a tombstone, never a playable record. Future reads must deny it even if underlying physical cleanup is retrying. Only confirmed removal from all relevant storage/caches permits the trusted worker's completion transition. Storage/version identifiers, deletion retry jobs, audit rows and retention of minimal tombstones require a separate schema design; this module does not establish a retention rule for those records.

## Calendar retention contract

`studentSubmissionRetention` accepts internally loaded metadata, a freshly authoritative ceremony date and a current date. Both dates must be strict valid ISO `YYYY-MM-DD`, years 0001–9999, Gregorian leap rules. Ceremony year 9999 fails because its anniversary cannot be represented. No date normalization or locale parsing occurs. The deadline is the next calendar anniversary, with February 29 clamped to February 28 in the next nonleap year. This is not 365-day arithmetic. Deletion is due on equality as well as after the deadline.

The core treats ISO dates as UTC-style date-only boundaries and never reads the machine clock. The current date must be derived by a future trusted scheduler, never from the client. An actual scheduler must select and bind CRC's calendar/time-zone policy before shipping; this core does not silently install a UTC-midnight schedule for St. Louis. Invalid ceremony/current dates fail closed rather than producing a guessed deadline.

Only a currently `submitted` student recording gets an applicable retention decision. Private recordings, reference recordings and deleting/deleted tombstones return `applies: false`; generated kinds are invalid metadata. This intentionally does not invent cleanup policy for private drafts or reference/training corpora. A future scheduler must still resume already-started deletion independently of this submitted-record eligibility function.

Recompute from the **fresh student ceremony date and its revision**, rather than a cached deadline. A legitimate reschedule can change eligibility while a recording remains submitted. The deletion transaction must recheck the ceremony revision, recording revision and current date before marking deleting, so a change during a storage wait cannot cause an obsolete decision to commit. Once deleting/deleted, rescheduling never revives access or content.

## Required future authority and privacy integration

Reuse the existing internal access composition instead of inventing new grants:

1. For student and explicitly selected linked-child practice, compose `createPracticeService(...).withPracticeCapability` in `src/server/practice/service.ts` with a server-chosen literal capability and exact selected student ID. It already distinguishes student versus child-practice and binds parent sessions, live guardian links, expiring context and student selection. Capture/submit/delete delegated behavior beyond today's read/practice-write semantics needs a bounded reviewed operation contract before routes exist.
2. For assigned tutors/rabbis, use `createAccessService(...).withStudentCapability` in `src/server/access/service.ts` to establish live student access, then apply a recording-specific reviewed operation restriction. Its generic `read` alone is insufficient: it also supports parent dashboard reads. Recording routes must explicitly exclude dashboard parent mode and return only submitted recordings to authorized tutors/admins. Reference mutation must require the reviewed tutor/admin operation, never a general `read` callback.
3. Preserve existing authority lock order and request origin/cookie protections. Every lookup and mutation must bind tenant ID, selected student ID, recording ID, current revision, active mode and (for delegated practice) the exact current context/revision. Do not infer a more powerful mode from overlapping roles. Unknown modes/capabilities, absent relationship/context and mismatched IDs deny by default.
4. Recheck live session/membership/grant/link/student/context authority **after every external storage/media-processing wait** before returning bytes, committing metadata or issuing any playback capability. A proof captured before a switch/revocation cannot authorize a later result. Keep revocation/sibling-switch tests at the eventual HTTP/storage boundary; current pure tests cannot establish those guarantees.
5. Project responses per operation under authority. Dashboard responses contain no recording rows, IDs, counts, submission timestamps, storage locators or playback capabilities. A linked-child response contains only the selected authorized child's permitted recording view. Tutor/admin responses omit private and deletion-state recordings. Never return raw storage URLs/keys/filenames in ordinary metadata; any future playback delivery requires its own short-lived, bound, revocable contract. Metadata types here are internal, not reusable transport DTOs.

This integration must receive independent adversarial review before any authenticated service/storage endpoint is reported complete. Existing portal authorization tests are reuse points, not evidence that these unimplemented recording routes are protected.

## Verification and return

Synthetic focused coverage is in `tests/app/recording-policy.test.ts`: closed schemas/prototype traps, media and integer limits, output immutability, forbidden generated/prayer kinds, explicit submission, retries/stale concurrent revisions, irreversible deletion, revision exhaustion, leap centuries, exact deadline equality and rescheduling. Run through `tests/helpers/isolatedEnv.mjs`; no network/audio/provider fixture is used. Exact results/hashes and the next action are recorded in [RECORDING-FOUNDATION-RETURN.md](../../planning/2026-10-16-parallel-work/RECORDING-FOUNDATION-RETURN.md).

# Open items that wait on Daniel

- Private cloud/storage selection and any added fees require Daniel's applicable money/provider gate. This slice provisions nothing.
- Offline playback leases, revocation/deletion while disconnected and deferred-upload release behavior need a later bounded contract; no lease duration is invented here.
- The production scheduler's CRC calendar/time-zone boundary needs an explicit settled policy before shipping deletion. Private unsent recording cleanup and any separate adult reference/training retention are not decided by the submitted-recording ruling.
- Student-visible release and any generated-chant release remain gated by the existing mission and G1/G2/G3 requirements. No new consent approval gate is added.
