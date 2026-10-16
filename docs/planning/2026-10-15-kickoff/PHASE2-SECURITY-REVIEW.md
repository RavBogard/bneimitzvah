# Phase 2 security review — 2026-10-15

Independent Sol review of the stable auth/schema/runtime prerequisite checkpoint
and narrow repository-policy change. No implementation files were edited by the
reviewer. **Accepted for this prerequisite slice after the fix below; no remaining
blocking finding found. This is not Phase 2 completion or a student release.**

## Finding fixed during review

**P1: privileged authenticated login could be masked by SET ROLE.** The original
`src/server/db/runtime.ts` checked only `current_user` and that role's memberships.
Reproduction against migrated PGlite: connect as the owner, `SET ROLE
portal_runtime`, evaluate the original predicate. It returned `restricted=true`
and `elevated_membership=false`; `RESET ROLE` then restored superuser authority.
The existing positive test used the same owner-session simulation, so it did not
prove separation from migration credentials. A connection configured to begin in
the runtime role could pass despite retaining elevated authenticated authority.

The author corrected `src/server/db/runtime.ts:26`–40 to inspect **both
current_user and session_user**, their privilege flags, and transitive membership
in elevated/table/schema/database-owner roles before invoking the action. The
reviewed query correlates `pg_has_role(pg_roles.oid, ...)` to each identity, and
rejects any unsafe row. `tests/app/schema.test.ts:164` adds the masked-owner
regression; lines 136 and 156 separately exercise restricted session simulation,
scope cleanup and owner-role membership denial. Independent focused validation
passed after this change.

## Other reviewed boundaries

- Auth uses the actual pinned Better Auth 1.7.10/Drizzle adapter with transactions,
  hashed/atomic magic-link consumption, DB-backed sessions/rate limits, verified
  same-email linking, no trusted-provider verification bypass, disabled identity
  email changes/password sign-up and disabled arbitrary library logging. Reviewed
  installed magic-link, account-linking and adapter implementations against tests.
- SQL and schema enforce typed/composite tenant relationships, exact actor/session/
  grant/context pairs, immutable authority identity, partial active uniqueness,
  forced tenant RLS and append-only audit. Tenant RLS is intentionally separate
  from future per-action capabilities; global auth/cache tables do not grant
  tenant access. No application routes/services are present in this checkpoint.
- `scripts/repo-policy.mjs:9,50` permits only named Drizzle metadata paths and a
  PostgreSQL/version-7 structural check. Credential, email and licensed-text scans
  still apply at lines 61–73, including staged blobs. Regressions retain those
  denials. This is a metadata exception, not a claim that marker scans recognize
  all personal data. Migration SQL remains subject to source review.
- Dependency roots are exact-pinned with a lockfile; the engine is unchanged.
  Generation-only kit/ORM tooling is isolated in ignored cache with filtered
  environment and fixed diagnostics. The explicit migration runner suppresses
  driver/connection error content and is not imported by app runtime.

## Evidence and limits

- Reviewer reran `npx vitest run tests/app/auth-stack.test.ts
  tests/app/schema.test.ts`: **20/20 passed** (9 auth, 11 schema/runtime).
- Reviewer reran `node --test tests/repo-policy.test.mjs`: **6/6 passed**.
  Logs: ignored `.local-logs/phase2-security-app.log` and
  `.local-logs/phase2-security-guard.log`. `git diff --check` passed.
- Reused foundation evidence of real PostgreSQL 16.15 **6/6**, inspecting the
  actual restricted-login, migration replay, cross-tenant denial and two-connection
  cleanup tests in `tests/postgres/rls.integration.mjs`. This reviewer did not
  provision a database or rerun that credentialed suite. Hosted PostgreSQL 17.11
  CI is configured; its run remains an integration gate, not local evidence.
- PGlite proves adapter/config behavior; synthetic signed Google tokens replace
  only JWKS fetch. It does not prove live Google redirect/PKCE, Resend delivery,
  Neon WebSocket transport or production provider configuration. Those remain
  deployment/integration checks. No overclaim of completed capability, invitation,
  host-resolution, child-mode, logger, harness or browser workflows is approved.

Re-review is required as those next-slice authorization/service boundaries are
implemented. Human testing remains Daniel-only until the feature-complete product;
generated chant remains behind G1/G2/G3.

## Access/host slice follow-up — 2026-10-15

**Accepted at this bounded utility/service scope; no remaining blocking finding
found.** Reviewed `src/server/{access,tenancy,data}/`, migration 0003, the runtime
role-closure change and test-only server marker replacement. This does not accept
the whole phase, routes, invitations, context issuance or student-facing release.

- `access/service.ts:40` obtains the real cookie/session proof with cookie caching
  and refresh disabled, then `data/authority.ts:10` locks and reloads the tenant,
  user, matching session ID/user/token, membership and exact selected role grant.
  Live expiry, verification, disable/revocation and sensitive-action freshness are
  checked before callbacks. Parent+tutor grants cannot combine into authority in
  parent mode. Student identity/guardian/tutor links are checked against the same
  tenant, target and selected grant; missing, foreign and unrelated targets deny
  uniformly. Returned student projections exclude contact/auth material.
- The inspected lock protocol is tenant -> user -> session -> membership -> grant
  -> student -> relationship. Authority mutations choose exclusive locks before
  acquisition; reads/reading writes keep shared authority locks. Roster candidates
  are locked in student-ID order and links rechecked afterward. Callbacks are
  trusted internal server composition using the supplied transaction, not public
  transport handlers or arbitrary client-selected operations. Future revocation
  services must retain that order and must not upgrade shared authority locks.
- `tenancy/resolve.ts:28`–38 rejects empty/conflicting Host and proxy headers,
  forwarded lists, malformed authorities, unknown/alias hosts and production
  loopback. Proxy headers never choose a tenant. Lookup requires the exact
  normalized host/origin/environment/deployment tuple; no CRC fallback. Error
  classes and catch boundaries discard raw SQL/provider/header diagnostics.
- Approved migration `0003_tenant_lock_permission.sql:6` grants only
  `UPDATE(customs)` needed for tenant row locking. Focused tests prove that locks
  and customs writes work while enabled/ID/host-directory changes are denied and
  a foreign-tenant customs update changes no row.
- The author tightened `db/runtime.ts:28,38,46` before final validation: allowed
  membership closure is only the authenticated login and `portal_runtime`, and
  active role must be one of those. The earlier draft also allowed `current_user`
  to whitelist itself. Final tests reject both membership in `pg_write_all_data`
  and actively switching into that role. The earlier elevated-login protections
  remain in place.

**Independent final check:** `npx vitest run tests/app/access.test.ts
tests/app/schema.test.ts` passed **23/23** (12 access, 11 schema), zero failures.
Log: ignored `.local-logs/phase2-security-access-final.log`. The fixture obtains
three actual Better Auth magic-link cookies and real DB sessions for two
synthetic tenants. Coverage includes all four modes, mixed-role isolation,
forged/tampered cookies, live session deletion/expiry, stale genuine proofs,
unverified users, revoked links/grants, disabled membership/student/tenant,
pagination, transaction rollback and restricted column permissions. A requested
test-strength correction makes the other-tenant positive roster check require
exactly one result; rollback evidence also confirms both writes completed before
the intentional exception.

`vi.mock("server-only")` occurs only in `tests/app/access.test.ts:4`; it replaces
the marker, not auth/database behavior. Vitest has no global alias and application
modules retain their server-only imports. PGlite restricted-session switching is
explicit fixture simulation, not proof of a real credential boundary. No new
real-Postgres concurrent revoke/access race test or production ingress/provider
exercise was run in this follow-up; lock ordering was inspected and committed-
before-next-call revocation was exercised. Full integration/hosted gates remain
with the primary collaborator. New route CSRF/request validation and future
capability/context/revocation implementations require their own review.

## Invitation/private-bootstrap review — 2026-10-15, fixes pending

**Not accepted yet: two P2 findings require correction.** Scope is the invitation
service, verified-identity extraction, mutation boundary, invitation data/schema
and migration 0004, private bootstrap and their focused tests. Concurrent roster
work/migration 0005 is outside this review. No implementation or Git changes were
made by the reviewer.

1. **P2 — unbound preexisting admin bypasses immutable initial-owner binding.**
   `scripts/bootstrap-owner.mjs:29` permits no prior owner-bootstrap binding;
   lines 39–42 then return `already-configured` for any active grant belonging to
   the configured user without establishing or requiring that binding. Independent
   disposable PGlite reproduction: seed verified A/B, CRC membership/admin for A,
   but no bootstrap audit; bootstrap A returns `already-configured` and binding
   count remains zero. Revoke A; bootstrap B then returns `configured`. Thus the
   primary's ordinary bootstrap -> revoke -> different-user fix works, but an
   inconsistent/unbound existing-admin state is accepted and later permits an
   owner change. Fail closed for that state; idempotence must require a matching
   prior bootstrap binding. Add a regression covering this alternate path and
   revoked unbound admin history, without silently adopting another owner.
2. **P2 — delivery failure has no durable auditable outcome.**
   `src/server/invitations/service.ts:20`–28 calls transport after commit and
   returns `sent`/`failed`, but persists neither result. The invitation row and
   issue audit are identical whether sending succeeded, failed, or was never
   attempted. The auth/tenancy spec's invitation section explicitly requires an
   auditable send-failure state. Losing the response loses this evidence. Retain
   a narrow durable pending/sent/failed outcome without mailbox/token/provider
   diagnostics; report an unknown/unrecorded result if outcome persistence fails
   rather than falsely reporting a recorded terminal state. This does not require
   an external outbox, new provider or paid infrastructure. Primary agreed this
   remains in the slice's acceptance scope.

Other inspected boundaries are consistent with this scope: random 32-byte tokens
are stored as SHA-256 only, 72-hour expiry and row lock/conditional consumption
protect replay, reissue rotates atomically, exact-origin POST and Fetch Metadata
deny cross-site mutation, fresh admin mode is required to issue/revoke/reissue,
and acceptance uses the live verified matching mailbox under tenant/user/session/
membership locks. Membership/grant/link/acceptance/audit share the transaction;
the tenant authority-write lock serializes same-tenant issuance/redemption.
Sibling guardians share one parent grant, parent mailboxes do not become student
identities, stale grant/link history blocks old invitations, and HMAC-scoped
actor/recipient budgets persist with committed attempts. No raw token/email/
provider error is returned by the delivery result. Existing host/access denials
remain fixed messages.

**Independent baseline evidence:** `npx vitest run tests/app/invites.test.ts
tests/app/bootstrap.test.ts` passed **17/17** (12 invitations, 5 bootstrap).
Ignored log: `.local-logs/phase2-security-invites.log`. The additional unbound-owner
probe above reproduced despite that green suite, demonstrating the missing
regression. The primary's pending-student-invite-after-unlink fix was inspected
and its old-token-denial/fresh-explicit-invite test passed; the normally
bootstrapped immutable-owner/revocation regression also passed.

Tests use actual SDK cookies/sessions, captured transport and PGlite transactions.
They do not demonstrate physical PostgreSQL/Neon concurrent invitation redemption
or live delivery. Token landing/clean-cookie exchange, routes and context issuance
are absent next-slice work, not findings here. Final invitation/bootstrap verdict
is pending author fixes and independent focused revalidation.

## Invitation/bootstrap revalidation — 2026-10-15

**Both P2 findings above are closed. Accepted for the bounded invitation/private
bootstrap service slice; no remaining blocking finding found.** No implementation
or Git edits were made by the reviewer. This verdict includes the consequential
postcommit recorder and migration 0006, not absent routes/context issuance or
whole-phase acceptance.

- Bootstrap now requires an existing matching durable owner binding for active-
  owner idempotence, and rejects any preexisting admin history before creating a
  new owner (`scripts/bootstrap-owner.mjs:39`–46). The independent original probe
  was rerun: unbound active A is denied; after revoking A, different verified B is
  also denied; no bootstrap audit binding is created. Existing genuine bootstrap,
  idempotence and revocation regressions continue passing.
- Delivery now commits `pending` before invoking transport, then records `sent`
  or `failed` plus a receipt timestamp and a dedicated audit action in a separate
  restricted tenant transaction. `data/invitations.ts:100` locks tenant then exact
  invitation, compares immutable issued-row fields (including hash, mailbox,
  role/target, inviter and timestamps), and validates the historical admin grant/
  membership/user tuple. It updates only pending delivery fields and appends the
  outcome audit. It grants, links, accepts and restores nothing. Logout or grant/
  invitation revocation during transport therefore does not erase historical
  delivery evidence or revive authority.
- Migration `0006_public_talisman.sql` adds the pending/terminal timestamp shape
  constraint and terminal-outcome immutability trigger, with matching schema/
  snapshot/journal entries and two explicit audit action values. The existing
  restricted role's tenant/invite lock and update privileges cover the recorder;
  no elevated runtime credential or expanded authority grant is introduced.
- If receipt update/audit/commit cannot be established, delivery returns fixed
  `unknown`, not a fabricated terminal confirmation. The transaction rolls back
  to pending when its audit fails. A crash after issue likewise leaves pending.
  Returned values contain only invitation ID and outcome; transport diagnostics,
  URL, token and mailbox remain private. Recovery uses explicit rotation.

**Independent focused revalidation:** `npx vitest run
tests/app/invites.test.ts tests/app/bootstrap.test.ts` passed **20/20** (14
invitation, 6 bootstrap), zero failures. Log: ignored
`.local-logs/phase2-security-invites-final.log`. Tests establish durable failure
and audit, terminal timestamp/status immutability, SQL audit-failure rollback for
both successful/failed transports, and recording after actual session deletion
and grant/invitation revocation without restoring access. Token, sibling,
mailbox, exact-Origin POST and budget regressions remain green.

Evidence here remains actual SDK/PGlite plus inspected SQL. No new live provider
delivery or physical PostgreSQL/Neon invitation race was executed by this reviewer;
the concurrent real-Postgres integration assignment and combined/hosted gates
remain owned by the primary collaborator. Human testing and generated-chant
release restrictions remain unchanged.

## Practice-context/runtime foundation review — 2026-10-15

**Accepted for these bounded backend slices after one P2 privacy fix; no remaining
blocking finding found.** Reviewer added only `tests/app/practice-review.test.ts`,
`tests/app/runtime-review.test.ts` and this note; no implementation or Git edits.

**P2 fixed: mutable denials escaped the runtime privacy boundary.**
`runtime/composition.ts` previously rethrew a callback's `AccessDenied` object
verbatim. A focused adversarial test changed its message/name/stack and attached
private cause/provider fields; those diagnostics escaped despite the boundary's
fixed-error contract. The author now copies only strictly validated 401/403/404
into a fresh denial, catches diagnostic-accessor failures, and maps malformed
statuses to a fresh unavailable error. The reviewer regression independently
passes after the fix, proving original diagnostic fields do not survive and
logging retains only fixed event/status/generated request ID.

**Practice authority:** inspected live verified user/session/membership, exact
parent grant, practice-enabled guardian and student checks; context handles are
random 32-byte secrets stored as SHA-256, scoped to exact tenant/user/session/
membership/grant/guardian/child/revision, and expire strictly at the earlier of
60 minutes or session expiry. Own-student writes require their live student
identity; parents obtain only the explicit child-practice path. Base services and
verified-identity calls reject context headers by default, including blank ones;
practice explicitly opts in. A header-bearing child request cannot acquire an
overlapping tutor/admin role. Headerless staff mode remains a separate live grant.

Switch authorizes the new child before closing the old context. Exit/switch old-
context cleanup checks immutable actor/session/membership provenance rather than
reviving a revoked old grant/link; context changes and correctly attributed
guardian/child audits share the transaction. Inspected lock order remains tenant
-> user -> session -> membership -> grant -> student -> guardian -> context, with
SHARE ordinary writes and UPDATE switch/exit. The new independent probe obtains a
genuine SDK session proof, completes a sibling switch before returning that stale
proof, then attempts an old-context write: denied before callback execution while
the successor remains usable. This is deliberate boundary interleaving, not a
claim of physical PGlite concurrency.

**Runtime/privacy:** configuration is lazy and explicit, rejects operator
credentials/contradictory environments/unsafe origins and unsupported connection
options. Restricted-role closure and exact configured mapping are checked before
exposing SDK/cache access; request-scoped pools close on failure. Fixed-field
logging does not serialize arbitrary diagnostic objects. Mail is restricted to
the official endpoint and canonical same-origin path/token/redirect allowlists,
with deadlines, no redirects, plain text and discarded provider bodies. The
global SQL cache revalidates bounded nonpersonal metadata, namespaces, envelopes,
dates/calendars/ranges/TTL and rejects hidden properties. No route or provider
configuration was introduced by this review.

**Independent evidence:** the six focused practice/runtime/mail/logging files
passed **24/24** before the isolated denial fix, including the new stale-proof
probe. After the fix, both new reviewer files passed **2/2** independently; the
runtime regression checks mutated diagnostic fields and malformed denial status.
Logs: ignored `.local-logs/phase2-security-practice-runtime-baseline.log` and
`.local-logs/phase2-security-practice-runtime-final.log`. The lifecycle privacy
test mocks driver/startup boundaries only; practice uses actual SDK cookies and
restricted PGlite services. Primary supplied separate PostgreSQL 16.15 service
evidence **7/7**, including two practice races; inspected tests observe real
blocking edges and preserve the other tab. This reviewer did not rerun that
credentialed suite.

Acceptance does not cover future routes/UI/browser response-generation handling,
real Neon WebSockets, Google, Resend delivery or provider-side tracking settings.
Incoming auth handlers must validate the actual request through `resolveHost`
before the SDK; creation/data responses need no-store, and the private tab handle
must never enter URLs/logs. Those intentionally absent transport boundaries still
require implementation/review. Primary retains full integration/hosted gates;
human testing and generated-chant release restrictions remain in effect.

## Independent HTTP primitives and portal projection review — 2026-10-15

**Scoped verdict: accepted; no additional implementation blocker found.** Reviewed
the uncommitted HTTP body/query/response/pending-cookie primitives, portal session
and confirmed-reading projections, and invitation preview/reviewed acceptance.
This accepts these server composition APIs only; routes, dispatchers and the
browser harness are not present or accepted by this checkpoint.

Body reads enforce actual streamed UTF-8 byte limits independently of advertised
length, reject malformed media/encoding/length/JSON and bound timeout/abort even
when cancellation remains pending. Query/object helpers reject unknown authority
fields, duplicate decoded keys and accessor/prototype tricks. Fixed responses
select their diagnostics and private headers; SDK projection validates all cookie
headers before appending any and does not relay SDK bodies, redirects or provider
headers. Pinned Better Auth's actual Google initiation `state` cookie is covered
for local and HTTPS origins; the reviewer additionally exercised genuine SDK
magic-link callback and logout cookies through the projection, including durable
session invalidation. AES-GCM pending envelopes use fresh nonces, origin AAD,
purpose/environment/origin-derived keys and strict ten-minute timestamps. Their
reader rejects duplicate cookie names and local/secure shadow names. Cookie
encryption does not confer invitation authority.

Portal summaries project only live tenant membership availability and role names.
Student reads retain explicit base-mode or live matching child-context authority.
Reading DTOs whitelist source metadata, expand canonical references, require the
exact ordered stored verse list and preserve date-change review state. Assignment
SHARE locks precede verse reads and conflict with the existing replacement UPDATE
path. The new reviewer corruption probe proves an incomplete confirmed verse list
fails through fixed unavailable JSON, while repairing that list restores the
expected reading without exposing the private stored snapshot sentinel.

Preview and acceptance now share read-only relationship-history/occupancy checks,
including no-recipient-grant student identity checks. The existing focused cases
verify old revoked guardian/identity histories deny, while a later explicit
reinvite can succeed. Reviewed acceptance binds token hash, exact tenant/origin,
user/session, role/target and invitation expiry; its lifetime is additionally
bounded by five minutes and live session expiry. All checks and consumption stay
inside the existing locked transaction. The reviewer composed actual SDK session
cookies, two encrypted sibling pending cookies and the real services: replacing
the pending cookie after review denied acceptance and consumed/audited neither
invitation; restoring the originally reviewed cookie succeeded, and replay then
denied. No implementation edits or Git operations were performed by this review.

**Independent verification:** five focused files passed **42/42** (HTTP boundaries,
pending invitations, portal, invitations, and new `portal-http-review.test.ts` with
three adversarial cases). `npm run typecheck` passed. Logs remain ignored at
`.local-logs/phase2-security-portal-http-final.log` and
`.local-logs/phase2-security-portal-http-typecheck.log`. Only `server-only` is
mocked locally; service probes use the actual pinned SDK and restricted PGlite.
Primary separately reported the current-code physical PostgreSQL service suite
**7/7** after the invitation helper refactor; this reviewer did not rerun it.

Limits: PGlite is not evidence of physical confirmed-reading replacement
concurrency, and no new such race is claimed. Transport must still resolve exact
host/tenant before invoking SDK/mail, apply exact mutation Origin and closed
request DTOs, select `acceptReviewed` exclusively with the decrypted internal
token, clean pending cookies and enforce response/privacy policy. Splitting token
landing from the clean Next page is the next route slice's architectural task.
Provider OAuth success, live delivery, external access-log redaction and browser
late-response/context handling remain separate gates. Primary owns broader
integration/CI/deployment; existing human-testing and chant-release limits remain.

## Independent routed auth/portal and opaque-binding review — 2026-10-15

**Scoped verdict: accepted after the P2 correction independently verified below.**
Reviewed the new auth/common dispatcher, portal adapter, runtime composition,
thin Node/dynamic Next routes, separate `/invitations/open` landing selector,
fixed redirects, opaque student review envelopes and disabled framework incoming
request logging. No implementation or Git edits were made by the reviewer.

**P2, fixed — caller-controlled forwarding address bypassed magic-link throttling.**
Before the correction, `src/server/http/auth.ts:19-23` copied incoming headers into SDK mutation
requests without establishing an ingress-only client address. The current auth
factory supplies no explicit IP-header trust policy, and pinned Better Auth's
`@better-auth/core/dist/utils/ip.mjs` defaults to trusting a single-valued
`X-Forwarded-For` header. Through the real dispatcher and pinned SDK, five
magic-link requests with one synthetic address succeed, the sixth is429, and
changing only that header permits another200/delivery. The fixed Origin/tenant
checks do not authenticate this header. New reviewer regression
`tests/app/http-routes-review.test.ts:53` requires the rotated request to remain
rate-limited and initially failed with200 instead of429. This required a trusted
ingress projection or safe non-spoofable fallback; merely accepting caller
forwarding headers was insufficient. A later
provider deployment may prove its own overwrite policy, but no such proof comes
from the direct application route or current local tests. This is an anti-abuse
gap, not an identity/tenant privilege escalation.

The remaining inspected boundaries showed no additional required correction:
actual incoming host resolution precedes SDK/service/mail; only explicit paths
and methods reach runtime; unknown SDK APIs are not mounted. All mutation inputs
use exact Origin and bounded closed DTOs. SDK callbacks keep library state/PKCE
processing but project only reviewed cookies and clean fixed local redirects.
Google initiation returns200 and one validated authorization URL, avoiding a
cross-origin fetch redirect. No SDK session/provider body is relayed. Assigned
reading correctly passes child headers to live practice authorization while base
modes reject them. Reviewed-accept404 preserves a potentially recoverable pending
cookie; invalid encrypted carriers and terminal preview failures use the explicit
clear policy.

Student reviews now have randomized AES-GCM ciphertext with purpose-derived
key/AAD, canonical versioned encoding, bounded plaintext/envelope, five-minute
expiry and no readable legacy downgrade. Existing live actor/session/tenant/mode,
roster and assignment revision checks remain at confirmation. A new actual-SDK
reviewer case gives one identity both tutor/admin grants, prepares as tutor and
denies confirmation as that genuinely authorized admin mode; replacement-session
confirmation also denies while its ordinary tutor read succeeds. The original
session/mode confirms successfully and replay yields409. Cross-purpose use as an
import binding denies. Another new probe creates genuine database OAuth state
then presents missing/forged state cookies: clean failure occurs with zero
provider fetches and no new sessions.

**Independent evidence before correction:** existing auth HTTP, portal routes,
opaque bindings and student service focused files passed **25/25**. New reviewer
file passed **2/3**, with the single throttle regression above failing as expected
for the current flaw. `npm run typecheck` passed including reviewer tests. Logs:
ignored `.local-logs/phase2-security-http-routes-baseline.log`,
`.local-logs/phase2-security-http-routes-probes.log` and
`.local-logs/phase2-security-http-routes-typecheck.log`. Tests use real SDK cookies,
restricted PGlite and locally mocked `server-only`; no physical concurrency or
provider success is claimed. The separately assigned browser harness,
production-wrapper probes, provider/ingress setup and broader integration remain
primary-owned gates.

**Correction independently verified:** the adapter now reconstructs SDK headers
from a closed set, discarding every incoming forwarding/IP/vendor/custom field
and overwriting even a forged `x-portal-auth-bucket`. Its synthetic IPv6 bucket
depends only on the resolved configured origin, and factory configuration reads
only that internal header with `/128` normalization. Inspected all five SDK entry
paths: magic-link/social/logout POSTs and magic verification/Google callback GETs
all use this reconstruction. Actual Host/Origin/cookies and CSRF/state processing
remain intact. No raw SDK handler is mounted elsewhere in the thin routes.

Independent reviewer/auth HTTP/auth stack revalidation passed **20/20** across
three files after the fix, including the original failing spoofed-address probe,
vendor/forged-internal-header rotations with no additional mail, and all SDK-entry
header checks. Log: ignored
`.local-logs/phase2-security-http-routes-correction.log`. The earlier independent
25-test portal/student/binding baseline remains reusable; no related source
changed. Author also supplied current correction typecheck success; primary is
running broader integration/build separately.

The configured magic-link request limit is **five attempts per minute shared per
trusted configured origin**, across recipients. This is deliberately not a
per-client limit or observed client-IP identity, and one caller can exhaust that
shared sign-in budget. Improving availability requires a separately explicit and
tested ingress-normalization contract at provider readiness; no Vercel header
trust or live-provider proof is inferred. With that documented temporary
availability constraint, the P2 bypass is closed and this bounded HTTP/binding
slice is accepted for primary integration. Browser/production-wrapper and
deployment/provider gates remain separate.

## Independent relationship-service/schema review — 2026-10-15

**Scoped verdict: accepted; no required core-service correction found.** Reviewed
`src/server/relationships/{service,data,types}.ts`, the `read-relationships`
capability, guardian/grant revisions, migration 0007 and generated metadata.
Concurrent HTTP/runtime adapters are outside this verdict. No implementation or
Git edits were made by this reviewer.

Reads require explicit live admin authority with ordinary session lifetime and
SHARE intent. Writes require fresh admin authority, exact-Origin POST, no child
context header and tenant UPDATE intent from the outset. Scoped immutable-key
probes are rechecked under target membership/grant -> student -> link -> context
locks. Target global profile/verification reads do not acquire a second global
user lock; that target's next authenticated invocation independently verifies
its live identity. This avoids cross-tenant actor/target global-user inversion.

New assignments require active verified tutor authority and enabled students.
Historical links remain immutable targets; stale IDs cannot revoke replacement
links. Revision CAS defeats flag ABA, same-value current revisions are honest
no-ops, and re-enable never restores old handles. Disabled students remain
inspectable/revocable but cannot receive new assignments or enabled practice.
Guardian/identity creation remains invitation-only; no membership recovery,
administrator grant/revoke, role revival or implicit role union is exposed.
Tenant-authorized labels use safe fallbacks and omit mail, global user/session
identifiers and provenance/provider objects. Exact guardian/identity/grant
predicates close only matching contexts, atomically with operator audit.

Added three independent probes in `tests/app/relationships-review.test.ts`:
another authenticated parent's context for the **same child** survives guardianA
revocation; a genuine SDK admin proof becomes insufficient after completed
admin-grant revocation before capability locking, with no target mutation/audit;
and failed grant-revocation audit rolls back grant revision/revocation plus both
context writes. A test-only nontransactional sequence advances only after both
writes are visible inside the failing audit trigger, excluding an earlier-write
failure false pass.

**Independent evidence:** five focused relationship/reviewer/practice/invitation/
schema files passed **52/52**; typecheck passed including reviewer additions.
Logs: ignored `.local-logs/phase2-security-relationships-final.log` and
`.local-logs/phase2-security-relationships-typecheck.log`. Actual SDK cookies and
restricted PGlite are used; only `server-only` is mocked locally. Deliberate
proof/revocation interleaving is not physical concurrency. Primary separately
reported current real PostgreSQL **9/9**, including both new service guardian-
revocation/write orderings with observed blocking and surviving sibling contexts;
their source was inspected without a credentialed rerun. Primary retains broader
integration/migration/CI and separate adapter/UI review. Synthetic internal
practice callbacks do not claim future audio/translation features.

## Independent relationship HTTP/runtime adapter review — 2026-10-15

**Scoped verdict: accepted; no implementation blocker found.** The nine added
relationship routes use literal admin mode, closed decoded request fields,
bounded unique query keys and explicit response projections. They retain exact
POST Origin and universal child-header denial before invoking the independently
authorized services; reads preserve ordinary session availability and writes
retain fresh authority. Runtime composition constructs the service from the
same private access instance. Existing common dispatcher host checks and fixed
private status/header policy remain intact. No core service/schema change was
required by this adapter review.

Independent focused route/portal/runtime/reviewer checks passed **24/24**, and
typecheck passed. New `tests/app/relationship-http-review.test.ts` exercises all
nine routes through the dispatcher using actual SDK cookies, including an actor
who genuinely owns the target's parent/tutor roles but lacks admin, empty child
headers, forbidden mode/tenant claims and no resulting writes/audits. It also
proves foreign grant operations remain tenant-denied and unchanged; disabled
student cleanup is allowed while assignment/re-enable denies; exact terminal
replays yield409 without revival. This supplements the earlier core **52/52**
and primary-reported PostgreSQL **9/9**, rather than claiming new concurrency.
Logs: ignored `.local-logs/phase2-security-relationship-http-final.log` and
`.local-logs/phase2-security-relationship-http-typecheck.log`.

One documentation overclaim was corrected with primary agreement: closed body
validation rejects unknown decoded keys; standard JSON.parse still resolves
repeated lexical JSON keys to their last value. Unique-query rejection is
separate. No parser-disagreement authority bypass was found: one canonical parsed
object is passed to services, with literal admin and live scoped authorization.
No parser expansion was needed for this slice. Primary retains combined build,
browser, CI/publication and broader product gates. No implementation/Git edits,
provider calls or credentialed execution were performed by the reviewer.

## Independent admin invitation-list review — 2026-10-15

**Scoped verdict: accepted; no implementation blocker found.** The literal-admin
GET uses the ordinary-lifetime `read-invites` capability with live authority and
SHARE intent. Its SQL selects explicit fields, qualifies invitation and joined
student by tenant, orders by immutable UUID and limits pages to100. No global
user/profile join, hash, token, issuer/acceptor/session or audit identity is
selected. Intentional recipient contact projection stays inside the private
authenticated admin response, consistent with existing authorized roster access.
Unknown/duplicate query fields and child headers deny; writes retain freshness.

Date/role-target/contact/delivery validation fails whole pages to fixed503;
accepted/revoked/expired/pending are historical lifecycle labels, not current
redemption authority. Pending delivery means an unconfirmed outcome, not queued
work. No mutation or provider call is performed by the list. Existing invitation
mutations and acceptance checks remain unchanged.

Independent listing/reviewer/invitation/portal checks passed **33/33**, plus
typecheck. New `tests/app/invitation-list-review.test.ts` proves a genuine SDK
proof cannot expose the list after completed admin-grant revocation, and a later
malformed terminal date fails the entire requested page without a partial contact
response or data/audit changes; a bounded valid first page is a positive control.
Logs: ignored `.local-logs/phase2-security-invitation-list-final.log` and
`.local-logs/phase2-security-invitation-list-typecheck.log`. No contact values are
included in review output. Current physical PostgreSQL9 evidence is reused for
unchanged service locks; no new credentialed execution is claimed. Primary owns
combined integration/build/CI/publication and broader UI/product gates.

## Independent private-attachment repository guard review — 2026-10-15

**Scoped verdict: accepted after one narrow index-parser correction.** The exact
private attachment directory is ignored and explicitly prohibited by normalized
path independently of content, extension, case or separators. Candidate paths
are rejected before lstat/readFile; indexed paths before cat-file. Findings use
fixed category-only messages without private filenames. Existing sensitive-data,
credential, licensed-content and metadata checks retain their strength; no broad
exception was added. The real attachment directory was not opened, enumerated,
deleted or used by this reviewer, and no shared-checkout Git changes were made.

Review found that splitting an index record on every TAB truncated a legal Git
pathname containing TAB before the protected directory. The worktree candidate
pass still blocked publication, but its index pass could attempt a private blob
read. New `tests/repo-policy-review.test.mjs` constructs only a synthetic
index-only path and deliberately nonexistent blob in an isolated temporary Git
repository. It initially failed at cat-file, proving the forbidden attempt. The
author now splits only the first metadata separator and preserves the entire
pathname; the same regression returns path-only findings without touching the
blob. Windows path protection is disabled only for that temporary index insertion;
no corresponding filesystem path or actual attachment is needed.

Independent policy/reviewer/actual repository guard/process-isolation checks
passed **13/13** after correction. Log: ignored
`.local-logs/phase2-security-attachment-policy-correction.log`. The original
synthetic regression failure remains at
`.local-logs/phase2-security-attachment-policy-probe.log`. This accepts the bounded
ignore/path protection and parsing fix; no private payload inspection or deletion
was required. Primary retains staging/publication and final combined gates.
# Temporary Vercel origin and design metadata — independent Astra review, 2026-10-15

Accepted at this scope. Daniel requested the stable Vercel hostname while DNS is pending. Reviewed config and pending-cookie factories now permit that exact production value, while `BETTER_AUTH_URL` still selects one origin. The unchanged dispatcher resolves the tenant and rejects a different configured origin before SDK/provider work. Migration 0008 adds only the exact stable host for CRC; preview aliases and sibling hosts remain excluded. Pending envelopes use origin-derived keys and AAD, and host-only secure cookies remain unchanged. Existing migrations are not rewritten.

Independently reran 42 focused auth/runtime/pending/access/schema checks, including actual SDK initiation and magic-link flows at the Vercel origin, bidirectional inactive-origin denial before SDK calls, and incompatible pending envelopes. All passed. Real PostgreSQL migration/replay and RLS checks passed 6/6 in a new isolated cluster. The first attempt correctly refused a previously populated disposable database; it did not alter that database. The replacement cluster was stopped afterward. This does not establish live Google, Neon or Resend operation.

Also reviewed the exact `.impeccable/design.json` metadata allowance and ignored review-evidence directory. Neighboring JSON files remain disallowed, credentials/emails/binary checks still apply to metadata, and force-staged screenshots receive no binary exemption. Independent policy/guard tests passed 11/11, including attachment index-path protection. The generated design metadata still requires content review at UI integration.

## Initial entry UI — independent integration review, 2026-10-15

Accepted for sign-in, session summary and explicit invitation review/acceptance only. Astra reviewed the client request/projection boundaries and actual cookie-based flow tests. Raw invitation tokens remain in the server's HttpOnly envelope; the client keeps only the review binding in memory and submits it once. Requests use same-origin credentials, no-store, a bounded response reader and fixed errors. The reviewer found a missing visible OAuth-failure notice; Sol added the fixed recognized-error state without echoing query contents. Roles are labels at this checkpoint, with no nonexistent workspace links or invented passage.

Independent Sol browser tests exercise real restricted PostgreSQL and pinned SDK magic links, session/logout, recipient-bound invitation preview, one explicit acceptance, replay denial, history navigation after logout, and cross-tab revalidation. Google initiation is real SDK code with provider navigation intercepted; error/retry cases are explicitly mocked. Eight existing browser tests passed, then all five new tests passed after correcting a test locator that also matched Next's route announcer. Native BFCache restoration was not established; do not claim it. Production UI checks passed 6/6 across desktop/tablet/phone. No live providers or real families were used.

Astra also found that Playwright's webServer environment merged operator variables. The reviewed replacement spawns built Next directly with isolatedEnv, rejects existing production dotenv paths by metadata without reading their contents, rejects an occupied port and waits for teardown before removing its temporary HOME. Independent synthetic environment/dotenv/port/isolation checks passed 6/6, and the isolated production UI gate passed 6/6. This gate requires a clean checkout when private dotenv files are present; it must not remove or ignore operator files.

Fresh-context Impeccable finish review returned `ship` for this bounded surface after seven desktop/phone/enlarged-text captures; the documenter extracted DESIGN.md and schema-v2 metadata from the reviewed implementation. No generated audio, study text, role workspace or complete Phase 2 claim is made.

## Role workspace — independent Astra review, 2026-10-16

Accepted at the bounded capability/client-state scope, subject to final visual and hosted integration gates. Astra reviewed the new per-tab practice coordinator, strict response projections, role-specific calls and session comparison binding separately from the Sol implementer. Practice handles remain in memory and the explicit child request header; base parent/tutor/admin calls do not inherit them. Mutations serialize and invalidate old subject views before awaiting responses. Unknown outcomes never automatically retry, restore an old handle or revoke sibling tabs. Only a known handle gets targeted cleanup; an unknown committed handle expires on the server.

The initial lifecycle design destroyed unsaved forms on every window/tab return. Review required safe retention for the Zoom use case. The resulting opaque HMAC binding covers origin, tenant, user, live auth session, membership identity/revision and ordered active grant identities/revisions from the same locked read. A separately derived runtime key is mandatory; no raw identity/session IDs leave the projection, and the binding is never accepted as authorization. Same-binding UI state stays hidden/inert until fresh authorized data reloads finish. Changed or failed session checks discard it. Target-row changes produce a roster conflict. Student revision in a practice response is refreshed metadata, not an immutable context authority field; the returned student and context revisions must agree, while stable context ID, authority revision and expiry must match the selection.

Review also corrected a stale draft-retention notice after manual roster reload and caught a browser-proof gap: checking a hidden input's value did not prove usable restoration. The strengthened test now holds a real session response, observes the checking gate and hidden draft, then requires the gate to disappear and the preserved draft to become visible. All three final restricted-PostgreSQL/actual-SDK workspace browser cases pass. They also cover same-role new-session discard, real roster creation, stale revision refusal, uncertain mutation outcome, copied practice URL rejection, sibling-tab isolation, delayed old-child responses and keyboard/phone reading references. Five entry/browser regressions passed alongside the earlier workspace run. Dispatched lifecycle events do not prove native BFCache use or a live provider round trip.

Local integration passed 127 Node checks and 255 of 256 app checks; the failure was a synthetic test creating two supposedly identical context expiries with separate clock reads. The fixture now shares one context, retains a deliberate expiry-mismatch negative, and focused checks pass 15/15. Production strict equality was not weakened. Study-adapter source was independently reviewed as a separate, unexposed public-text module: exact provider/edition requests, bounded stream/deadline handling, canceled late responses and plaintext-only output. Its 51 synthetic and two private live contract checks do not establish an authorized text endpoint, cache or whole-catalog coverage.

## Reading confirmation and public cache — Astra review, 2026-10-16

The reading editor uses existing literal staff endpoints and retains drafts without retaining confirmation authority. Input/baseline changes invalidate the prepared review; uncertain confirmation outcomes block further preparation until an explicit authoritative reload. Review found that a server preparation could use a newly changed date while the form still displayed its old baseline. Sol added a post-preparation authorized reading GET and compares student identity/revision/date plus assignment identity/revision before either proposal variant becomes visible. Monotonic revisions prevent silently accepting a newer baseline. Actual-SDK browser checks cover changes both before preparation and before confirmation, explicit recovery, single submission and a committed save whose response is lost. No server authorization contract was expanded.

Separately reviewed cache persistence has a closed canonical chapter and edition-key namespace, exact registry provenance, reconstructed Hebrew written/read projections, validated hashes and 24-hour timestamps on reads and writes. Runtime privileges are SELECT/INSERT and content-column UPDATE only; no DELETE, key UPDATE, definer helper or tenant privilege expansion. Expired entries are misses; corrupt envelopes fail closed. Real PostgreSQL verifies those grants and constraints, corruption/expiry behavior and operator-only bounded cleanup. Database reads sample the clock after awaiting the query. Generated migration metadata uses stable edition keys rather than embedding a publisher-title literal; full runtime provenance still requires exact titles/licenses, and repository protection was not relaxed. This cache has no public route and does not establish the later two-stage authorized text delivery path.

The integrated source checkpoint passed 127 Node and 310 app tests, plus six fresh-cluster PostgreSQL migration/isolation checks and four cache checks. Browser and visual evidence, remaining corrections and subsequent publication gates are recorded in READING-UI-RETURN.md and STUDY-CACHE-RETURN.md.
