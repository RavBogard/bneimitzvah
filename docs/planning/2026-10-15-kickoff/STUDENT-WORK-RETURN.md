# Student translations and tutor notes — backend return, 2026-10-16

Status: Astra's independent source/security review found no remaining blocker;
focused PGlite 10/10, real PostgreSQL 15/15 and fresh SQL migration/replay 6/6 pass.
Root owns the final combined integration/build/CI gates. No commit, push, deployment, real account,
provider provisioning or mail. No frontend change in this milestone.

## Delivered

- New `src/server/student-work/{service,validation}.ts` and
  `src/server/data/student-work.ts`: current-assignment work pages, per-verse
  version history, same-actor receipt reads, and explicit CAS draft/note appends.
  Receipt responses distinguish committed from latest version. UUID/body retries
  do not duplicate versions or audits; mismatches conflict. Historical work uses
  the current assignment as its access boundary across earlier/re-added revisions.
- New `student-work-schema.ts`, additive `0010_messy_mesmero.sql`, generated
  snapshot/journal. Composite tenant/assignment/student/actor/typed-grant and exact
  guardian/student-identity lineage; tenant FORCE RLS; SELECT/INSERT grants;
  unconditional UPDATE/DELETE rejection. Audits contain IDs/attribution only.
- Literal `note-write` capability for currently authorized tutors/admins. Drafts
  use existing student/child practice-write. Existing lock order and SHARE
  authority locks are preserved. Session/context expiry is rechecked after
  assignment locks before every result, and again after insertion/receipt waits.
- Private literal endpoints at `/api/students/:id/work`, `/history`, `/receipt`,
  `/draft`, `/note`; GET for reads and POST for writes. Shared composition and
  dispatcher wire the service. Work input objects/queries are closed. Text is
  plain Unicode with newline normalization, 4 KiB bounds and control rejection;
  drafts allow explicit empty clear, notes require non-whitespace text. JSON body
  limit 32 KiB, response limit 256 KiB. Pages stop at at most ten verse boundaries
  (earlier for quote-heavy text), latest draft and three notes each; history has
  twenty versions and an exclusive version cursor.
- Author display names come through a tenant-scoped membership/user join, bounded
  and sanitized; email-shaped names fall back to `Portal member` without exposing
  email fields. Historical revoked staff authors
  stay labelled. No private note flag, retraction, staff draft editing or role
  union through child mode.

## Approved schema amendment

The immutable context UUID records historical attribution, without an FK to the
ephemeral context/session lifecycle. Root explicitly approved this adjustment:
an FK would block the existing session-to-context cascade cleanup. The existing
practice capability locks and verifies the live context; retained durable
membership/grant/student/exact guardian FKs carry lineage. Session deletion leaves
historical work intact and separately authorized readers can still read it.

## Verification

- Final combined typecheck and production build pass. The concurrent CSV issue-code
  inference diagnostic was corrected by its owner before these checks.
- Focused PGlite tests passed 10/10. Tests include role/tenant boundaries, explicit clear,
  hostile Unicode/plain text, CAS/receipts, historical revisions/removal/re-add,
  immutable schema/grants, maximum integer stream versions, quote-heavy response
  bounds, cross-mode same-actor receipt reads and email-shaped author labels.
- Real PostgreSQL: root independently passed `tests/postgres/student-work.integration.ts`
  (15/15), with final log `.local-logs/student-work-postgres-final.log`. Covers actual uniqueness lock races, lost acknowledgement/replay,
  rollback/retry, authority/assignment/context forward and reverse ordering,
  session/context expiry after waits, session cleanup, retained-history privacy,
  grants/RLS/FKs and append-only enforcement. First run passed 13/15; two test
  observability failures queried a blocked owner connection. Fixed with independent
  observer, immediate sanitized rejection handlers and release/await cleanup;
  FK forgeries now use collision-free versions and assert exact SQLSTATE. Final
  root rerun passed all 15 cases without unhandled rejections. No shared PG lifecycle or credentials
  were changed by this worker.
- Existing SQL gate discovers both new tenant tables automatically. Work-specific
  grants/lineage are asserted in the new PG suite. Detailed logs are ignored under
  `.local-logs/student-work-*`.
- Root's fresh actual SQL migration/replay gate passed 6/6 with migration 0010.
- Never-in-repo gate passed 1/1.
- Combined local integration: 127 Node + 364 app tests (one POSIX-only skip),
  31 authenticated-browser checks and six production-page checks pass. Final UI
  presentation fixes additionally pass their seven focused client checks. Logs:
  `.local-logs/student-work-roster-*`. Hosted CI/publication remain pending.

## Remaining integration

Astra owns the independent security-review record, required combined build/tests
and CI, STATE update and integration/publication. Fresh SQL/PG gates passed.
Frontend autosave,
translation editor and notes presentation are a later bounded assignment; the
approved Annotated score direction remains binding. Retention/export and note
retraction policy remain separate future decisions.
