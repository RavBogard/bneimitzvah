# Student roster and confirmed reading service checkpoint

Sol, 2026-10-15. Astra owns integration, STATE and release decisions. No UI, routes, provider provisioning, Git mutations, actual student records or live person/date-based calendar requests were introduced.

## Delivered

- `src/server/students/`: admin roster create/edit/disable/list and CSV preview/confirmation; signed reading preparations and exact confirmation persistence. All mutations use the existing capability transaction and exact-Origin POST guard. Creation/import changes contacts only, never grants, invitations, identities or email delivery. Assigned tutors can prepare/confirm readings but cannot edit the roster; parent mode never inherits tutor writes.
- `src/server/data/roster.ts`: all new tenant SQL, always scoped by the trusted tenant. Student edits use expected revisions. A date edit preserves confirmed ranges/verses and original confirmation metadata, marks `needsReview` and increments assignment revision. Audit writes share the transaction; failures roll back domain writes.
- Authorized schema change: `assignment_current_kind_key` unique `(tenant_id,student_id,kind)`, generated as `0005_spotty_dakota_north.sql` with Drizzle snapshot/journal after the auth owner confirmed `0004` generation was complete. One current assignment per kind uses revisioned updates. First-insert contention is handled with `ON CONFLICT DO NOTHING` and a typed stale-revision result; unrelated database errors are not relabeled as conflicts.
- `catalog.ts` and `catalog.PROVENANCE.md`: 39 books of trusted numeric per-chapter verse counts from Sefaria's official Shape API. No text payload is retained. Schema/metadata provenance and source response hash are recorded beside the catalog.
- `tests/app/students.test.ts`: eight focused offline tests using actual restricted PGlite, auth cookies and current access services.

## Preparation and confirmation

`createStudentService({access, signingSecret, loadReading, verseCounts?, now?})` accepts trusted server dependencies. `prepareReading` authorizes first, releases its transaction, then fetches/loads the nonpersonal calendar proposal. It validates provider metadata again, strips arbitrary summaries/fields, applies reviewed congregation customs and expands canonical ranges against numeric chapter bounds. CRC's existing selection mode requires an explicit staff choice; no CRC cuts are fabricated.

Preparations expire after five minutes. Their signatures bind actor, session, role grant/mode, tenant, student/revision, ceremony date/calendar, existing assignment revision, kind/basis, validated ranges and sanitized source snapshot. `sourceFetchedAt` and source availability are signed, shown in the review response and persisted. `confirmReading` reauthorizes and revalidates revisions/calendar/ranges before replacing exact `assignment_verse` rows plus assignment snapshot/basis and audit. Replays return a stale-revision result. Raw picks are canonicalized before determining basis, including case/whitespace variants.

Explicit custom ranges may be prepared when a typed `ReadingUnavailable` occurs. The proposal visibly warns `calendar-source-unavailable`, binds/persists `sourceStatus: unavailable` and null source timestamp, and contains only date/calendar with null reading/haftarah. It invents no parashah or maftir and still requires confirmation. Automatic selections never fall back. Unexpected provider errors become a fixed sanitized unavailable error. Torah and optional haftarah are supported; separate blessing kinds remain modeled without invented liturgical definitions.

## CSV binding

CSV input is bounded to 1 MiB and 500 data rows, with required names/date/parent contact, optional own contact, strict quoting and known headers. Preview exposes safe row-number/error summaries. It preserves original record indices even after invalid rows. Duplicate warnings use exact complete-row equality and require an explicit choice; shared parent mailboxes or names never merge learners. Confirm reparses input and checks a signed actor/session/tenant/input/duplicate-decision/roster-state binding. The state fingerprint contains sorted IDs/revisions and is checked under the admin tenant UPDATE lock; a replay after import or intervening roster change conflicts. No import-receipt schema was needed.

## Verification and limits

Eight focused tests passed after the final review fixes; typecheck passed. Coverage includes mode/origin/cross-tenant denial, contact-only creation, immediate disable denial, stale revisions, exact cross-chapter verses and special maftir, optional haftarah, one-kind duplicate DB rejection, snapshot provenance, date-review preservation, token tampering/expiry/session binding, CSV alteration/replay/duplicate choices/row-index correctness and bounds, malformed provider/range/customs denial, typed manual fallback, opaque-provider sanitization and write/audit rollback. Logs are ignored under `.local-logs/`.

This slice has not yet passed hosted CI or a real PostgreSQL first-confirmation race; the unique constraint and conflict-aware insert are present, with local duplicate/replay coverage. No UI, student release, live Google/email delivery or complete-Phase-2 claim is made. Root integration should perform the required broader and independent checks before publication.

## Independent adversarial review — 2026-10-15

**Accepted for this bounded roster/reading/CSV service slice; no blocking finding
found.** Independent reviewer made no implementation or Git changes. Reviewed
`src/server/students/`, `src/server/data/roster.ts`, numeric catalog/provenance,
assignment-current-kind schema/migration 0005 and the focused tests. Concurrent
invitation/delivery corrections are outside this verdict.

- Roster create/edit/disable/import require admin capability, and mutations check
  exact-Origin POST. Client tenant/role fields do not enter persisted student
  authority. Contact records create no grant, guardian, identity or invitation.
  Student edits/disable use expected revisions; audit and writes share the same
  transaction. Assigned tutors may prepare/confirm readings only; parent mode
  receives no tutor union privileges, and foreign targets fail through access.
- CSV input is bounded to 1 MiB/500 rows. Reparse plus signed actor/session/grant/
  mode/tenant, raw-input hash, duplicate decision and sorted roster ID/revision
  fingerprint bind confirmation to the reviewed preview. The admin tenant UPDATE
  lock serializes fingerprint check/import; committed imports change that state,
  denying replay. Invalid-row positions and exact duplicate decisions are retained.
- Five-minute reading claims bind actor/session/tenant/student/date/revisions and
  the source, kind, basis and ranges. Confirmation reauthorizes, checks current
  student/date/calendar/assignment revision, and re-expands canonical ranges against
  trusted numeric bounds before replacing exact ordered verse rows. Date edits
  preserve confirmed ranges/verses and original source/date metadata, increment
  revision and mark review instead of replacing a confirmed reading silently.
- `roster.ts:35` targets the precise `(tenant_id,student_id,kind)` unique key with
  `ON CONFLICT DO NOTHING` for first confirmation. A competing winner leaves the
  loser without a returned assignment, so it returns typed stale state before
  verse/audit writes. Existing runtime grants cover assignment/verse DML and row
  locks; enum usage and the tenant column-level locking grant were already present.
  New migration 0005 adds only the unique constraint. This inspection establishes
  the intended SQL path, not an executed physical-Postgres contention result.
- The catalog contains 39 frozen book arrays of bounded positive integers and
  no verse text; direct structure check passed. Provenance names the official
  Sefaria Shape API and source response hash. Provider snapshots are revalidated
  and arbitrary summaries dropped. Approved custom fallback retains explicit
  unavailable/null provenance, warns for confirmation and invents no parashah or
  maftir. Unexpected errors become fixed unavailable diagnostics.

**Independent focused run:** `npx vitest run tests/app/students.test.ts` passed
**8/8**, zero failures. Log: ignored `.local-logs/phase2-security-students.log`.
Fixtures use actual SDK cookies and a simulated restricted PGlite session, not
an owner connection for service calls. The suite checks the core permission,
revision, HMAC alteration/replay, canonical verse, duplicate/row-bound and rollback
contracts. It does not prove a real PostgreSQL first-confirmation race, live
provider transport, route/body limits or a browser confirmation workflow. Root
retains combined/hosted integration gates and future public-route review.

## Integration follow-through

Published as 18918c0. Combined local integration passed 120 Node and 73 app tests, typecheck/build and 3 placeholder browser checks. Real PostgreSQL tests now prove two first-assignment inserts contend on the unique index and produce one confirmed assignment with one stale result. All four hosted jobs passed in run 38841820697, including PostgreSQL 17.11; matching deployment reports success. Routes, role UI and live-provider behavior remain future gates.
