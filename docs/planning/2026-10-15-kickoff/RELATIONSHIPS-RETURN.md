# Authority-management service checkpoint

Status: service and HTTP/runtime adapter implementation ready for independent review. Primary's private PostgreSQL gate passed 9/9, including both new relationship revocation orderings. No UI or live-provider claim.

## Contract and authorization

`createRelationshipService({access})` exposes `listEligibleTutors`, `inspectStudent`, `assignTutor`, `revokeTutor`, `revokeGuardian`, `revokeStudentIdentity`, `setGuardianPractice`, `revokeRoleGrant`, and `setCantor`. All require explicit admin mode. Reads use the new `read-relationships` capability without the 15-minute freshness requirement. Mutations use fresh `manage-relationships`, exact-Origin POST, and the existing child-context rejection. Foreign/missing targets remain denied through tenant-qualified lookups.

Tutor selection is ID-paged (maximum 100). Inspection includes disabled students for safe cleanup and at most 500 current links of each kind; an extra-row sentinel fails closed. Safe DTOs include immutable link/grant IDs, applicable revisions/flags, and authorized display labels from already tenant-scoped memberships/grants. Labels use Parent/Student/Tutor fallbacks for unsafe or email-shaped values. No email, global user ID, session/provider object, or arbitrary identity search is exposed.

New assignments require an active verified tutor membership/grant and enabled student. Unassignment retains historical rows; reassign creates a new immutable link ID. Guardian and own-student links can only be created through existing invitation acceptance. No membership creation, admin-grant changes, role reactivation, user deletion, or implicit role union is offered. Cantor changes add no capability.

## Revision, locking, and revocation

Migration `0007_yellow_ghost_rider` adds positive default-1 `guardian.revision` and `role_grant.revision`, and permits truthful `guardian.practice-set` / `tutor.cantor-set` audit actions. Generated snapshot/journal accompany it; published migrations were not changed. No unrelated schema change was generated.

Mutable flags and grant revocation require `expectedRevision`; actual changes increment it, defeating boolean ABA. A same-value flag request with the current revision is an unchanged success with no synthetic audit. Immutable link revocation requires the exact ID and active state. Conflicts return `{ok:false,code:'stale-state'}`; stale IDs never revoke replacement links.

Every authority mutation obtains the existing tenant UPDATE lock from the outset, followed by actor authority and target membership/grant, student, link, and context operations. There is no SHARE-to-UPDATE upgrade. Target global user labels/verification are read only after scoped membership/grant establishment; they are not locked, avoiding cross-tenant actor/target global-user lock inversion. The target's next authenticated invocation independently rechecks its live verified identity.

Guardian disable/revoke closes only that exact guardian's contexts. Own-identity revoke closes its exact contexts. Grant revoke closes contexts of that grant. Link-only changes do not bump parent membership authorityRevision or invalidate sibling relationships. Re-enabling a flag never restores old handles. Mutation and operator audit commit atomically; failed audit rolls everything back. Disabled students remain inspectable/revocable but cannot receive new assignments or newly enabled practice.

## Files and evidence

- New `src/server/relationships/{service,data,types}.ts`; narrow `src/server/access/service.ts` capability addition.
- `src/server/db/tenant-schema.ts`, migration 0007 and generated metadata.
- `tests/app/relationships-fixture.ts`, `tests/app/relationships.test.ts`; two added service races in `tests/postgres/access.integration.ts` (existing fixture API unchanged).
- Focused actual-SDK/restricted-PGlite regression: **49/49 passed** (relationships 11, practice 13, invitations 14, schema 11), including role/tenant denial, read freshness, display privacy, positive revision constraints, stale replacements, guardian ABA, sibling isolation, grant versus link revocation, old invitation denial/fresh explicit reinvite, and audit rollback. Log: `.local-logs/relationships-regression.log`.
- Final `npm run typecheck`: passed after PostgreSQL test additions. Log: `.local-logs/relationships-typecheck.log`.
- PostgreSQL source adds both deterministic service orderings: authorized child write holds locks before guardian revocation waits, and real guardian UPDATE holds the transaction before a waiting old-context write is denied without executing its callback. Both observe physical blocking through the existing harness and preserve a sibling context; the first also checks committed write visibility before revocation. **Not executed by this worker at handoff**; primary owns the private PostgreSQL run and cleanup. These tests exercise a real SQL side effect through the internal future-practice callback, not an implemented audio/translation feature.

Primary subsequently ran the private PostgreSQL gate: **9/9 passed**, including both new relationship revocation orderings. This is primary-reported execution evidence, separate from the worker's PGlite author checks above.

## HTTP/runtime adapter checkpoint

`composeRuntime` now supplies `relationships=createRelationshipService({access})`. The portal adapter exposes only these additional routes:

| Method | Path | Closed input |
| --- | --- | --- |
| GET | `/api/admin/tutors` | optional query `afterId`, `limit` (1-100) |
| GET | `/api/admin/students/:studentId/relationships` | no query |
| POST | `/api/admin/students/:studentId/relationships/tutors` | `tutorGrantId`, `expectedState:'unassigned'` |
| POST | `/api/admin/students/:studentId/relationships/tutors/:linkId/revoke` | `expectedState:'active'` |
| POST | `/api/admin/students/:studentId/relationships/guardians/:linkId/revoke` | `expectedState:'active'` |
| POST | `/api/admin/students/:studentId/relationships/identities/:linkId/revoke` | `expectedState:'active'` |
| POST | `/api/admin/students/:studentId/relationships/guardians/:linkId/practice` | positive integer `expectedRevision`, boolean `practiceEnabled` |
| POST | `/api/admin/grants/:grantId/revoke` | positive integer `expectedRevision`, `expectedState:'active'` |
| POST | `/api/admin/tutors/:grantId/cantor` | positive integer `expectedRevision`, boolean `isCantor` |

Mode is literal admin from the route. Caller mode/actor/tenant/session claims, unknown decoded body fields, and unknown or duplicate query fields are rejected. The shared JSON parser retains standard last-value semantics for repeated lexical JSON keys; no duplicate-body rejection is claimed. All POSTs pass the shared exact-Origin guard; every relationship route rejects any child-context header. Services independently authenticate, resolve tenant, lock and recheck authority. GETs retain ordinary session availability; writes retain freshness. Response projection explicitly enumerates safe fields. Assignment returns 201, other successful reads/mutations 200, stale relationship state 409 with `code:'stale-state'`; shared fixed 400/401/403/404/405/413/415/503 errors and private no-store headers remain. No invitation status listing was added.

Adapter files: `src/server/http/portal.ts`, `src/server/runtime/composition.ts`, new `tests/app/relationship-routes.test.ts`, and narrow relationship-service wiring in `tests/app/portal-routes-fixture.ts` / `tests/http-browser/fixture.ts`. Reviewed relationship service/schema were not changed in this adapter assignment.

Focused actual-SDK/restricted-PGlite adapter regression: **22/22 passed** across relationship routes (8), existing portal routes (10), and runtime (4), log `.local-logs/relationship-routes-test.log`. Covers positive assign/revoke/reassign, guardian flag CAS and real sibling-context preservation, own-identity revoke, cantor and nonadmin grant revoke, admin protection, role/tenant/anonymous denial, forbidden context/header/Origin, strict body/query/method contracts, stale IDs/revisions, privacy sentinels, read freshness and late admin revocation. Initial test setup incorrectly expected a revision increment for a same-value flag request; corrected by starting that fixture flag disabled, preserving the specified no-op behavior. `npm run typecheck` passed with adapter/runtime wiring, log `.local-logs/relationship-routes-typecheck.log`.

Next: independent adapter review and primary broader integration/browser gates. No Git operations, provisioning, or outbound delivery performed.

## Independent core review

Accepted for the bounded service/schema scope; no implementation blocker found.
Independent focused run **52/52** passed (the author's 49 plus three reviewer
probes), and typecheck passed. New `tests/app/relationships-review.test.ts` proves
same-child guardian isolation across different authenticated parents, denial of
a genuine admin session proof after completed admin-grant revocation, and
rollback of completed grant/context writes when their audit fails. The rollback
test uses a nontransactional sequence marker to exclude an earlier-write-failure
false pass. Logs: `.local-logs/phase2-security-relationships-final.log` and
`.local-logs/phase2-security-relationships-typecheck.log`.

Primary separately reported real PostgreSQL **9/9**, including both new physical
guardian-revocation/write orderings; reviewer inspected those tests and reused
that evidence without credentials or a separate physical rerun. Detailed
authority/lock/revision/privacy findings and limits are appended to
`PHASE2-SECURITY-REVIEW.md`. No implementation/Git changes were made by this
reviewer. Concurrent relationship HTTP/runtime work is outside this core verdict;
primary integration and that adapter review remain separate.

## Independent HTTP/runtime adapter review

Accepted for all nine relationship routes and their runtime composition; no
implementation blocker found. Independently reran relationship-route, existing
portal-route, runtime and new reviewer files: **24/24 passed**; typecheck passed.
Logs: `.local-logs/phase2-security-relationship-http-final.log` and
`.local-logs/phase2-security-relationship-http-typecheck.log`.

New `tests/app/relationship-http-review.test.ts` checks every added route through
the common dispatcher with actual SDK cookies: an account owning parent/tutor
targets cannot acquire admin authority, blank child headers deny, and additional
mode/tenant claims are rejected without changes/audits. A second probe verifies
foreign grant assignment/revoke/cantor denial leaves that grant untouched, while
disabled-student inspection and conservative flag/link cleanup remain possible;
new assignment/re-enable deny and stale terminal operations return exact409
conflicts without revival. Safe DTO projection, bounded pagination, exact Origin,
fresh writes and ordinary-lifetime reads were inspected and retain author tests.

The documentation's duplicate-body rejection overclaim was narrowed with primary
agreement; parser behavior was not changed. This extends the accepted core
service verdict to the adapters only. Primary owns combined tests/build/browser,
CI/publication and product/UI completeness. No implementation/Git edits, provider
calls or credentialed execution were performed by the reviewer.
