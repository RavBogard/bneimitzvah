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

## Study delivery and invitation management — Astra review, 2026-10-16

Accepted at the bounded authority and client-state scope, subject to the recorded
integration and visual gates. Study delivery captures the existing explicit-mode
capability and assignment, releases its transaction for cache/provider work,
then reacquires live authority and compares the entire binding before projecting
text. Internal grant/guardian revisions and session expiry come from already
locked rows; public responses exclude those authority details. Exact route/query
validation and fixed private response projections remain in place. No schema,
RLS privilege, role-union or provider identity forwarding was introduced.

Review required explicit abort checks around an injected reader and a final
session/context expiry check after the last assignment query, so natural expiry
during that query cannot release text. Real PostgreSQL passed eleven study tests:
nine committed mutations during held provider/cache reads, plus two deterministic
expiry cases during the final SQL read. The full PostgreSQL service suite passed
24/24. The barrier tests require mutations to commit before public work resumes,
demonstrating that network/cache waits do not retain authority locks. Final
projection is the authorization point; this cannot erase data already delivered.

Public chapter coalescing is explicitly injected, limited to 32 pending keys and
five seconds, and retains no completed values or request database/actor closure.
Subscribers independently cancel and account bytes; cache hits also count toward
page limits. Corrupt cache entries fail closed and expired entries cannot become
a fallback. Sharing is process-local, not distributed. This review does not
establish whole-catalog semantic coverage or a live provider configuration.

The invitation interface uses the previously reviewed admin endpoints. Input and
target fingerprints invalidate memory-only reviews; every action re-reads the
current page and roster before comparing its exact target. A synchronous guard
prevents duplicate submission. Unknown responses block another action until
explicit recovery, and revalidation never resends. Durable lifecycle/delivery
states remain distinct from an unknown action receipt; sent does not promise
inbox delivery, and revoking an invitation does not revoke accepted access.
Actual SDK/restricted-PostgreSQL browser tests passed three scenarios, including
failed captured mail, committed actions with lost responses, target drift and
session changes. The separate visual review requested one long-value wrapping
fix; its final evidence and integration results belong in INVITATION-UI-RETURN.md.

## Private owner command and assigned-text consumer — Astra review, 2026-10-16

The private operator command is accepted at its bounded authority scope. It
requires direct ownership before reducing to the existing runtime role, binds
only CRC, and locks the tenant before sorted user/membership/grant rows. Its
singular bootstrap audit must match the immutable owner identity, enabled
membership and active owner grant. Exact ten-minute review descriptors bind
target verification, membership presence/state and bounded complete admin
history. Apply recaptures those fields, checks the digest and expiry after waits,
then atomically grants a fresh row or revokes an exact revision with its audit.
The owner's grant is protected; other admin grants confer no ownership. There is
no app route, new privilege, disabled-owner recovery or revival of old authority.

Independent review found that prefix-based containment treated an in-checkout
filename beginning `..` as outside the checkout. Sol corrected it to compare
path components and added a synthetic regression. Final file inspection also
closed a blocking FIFO-open edge with pre-open type/size/link checks and
nonblocking open where available. Reads are bounded and private output files
are exclusive. Trusted private directory ownership remains necessary: these
checks cannot eliminate malicious same-user rename races, and POSIX creation
mode cannot establish Windows ACL privacy. Diagnostics are fixed and contain no
private identities, SQL, credentials or driver causes.

Four real PostgreSQL tests pass, including competing grants/revokes with one
effect/audit and a physically observed admin read finishing before revocation;
subsequent admin and study requests deny while the separate tutor grant remains
usable. Runtime grants and transaction-local role/tenant cleanup are unchanged.
No real admin account was created or revoked.

The study frontend keeps practice handles inside the provider and validates the
complete returned student/mode/context/assignment binding and canonical page
partition. It renders structured segments as escaped React text, compares
credits to closed registry values and never interprets provider HTML. Metadata
reload clears text and explicitly passes fresh metadata into the awaited text
reload before same-session content is revealed. Generation checks, aborts and
render bindings discard replaced child/page results; authority denial clears
text. Staff drafts stay separately mounted. No client-persistent text cache or
automatic retry/prefetch was introduced. The final actual-SDK browser suite
passes 25/25, including real-assignment-conflict recovery and the corrected
reading-first phone composition. The fresh visual reviewer returned ship for
the single scored fix. Combined integration evidence is recorded in
STUDY-UI-RETURN.md; no remaining blocker was found at this reviewed scope.

## Student translations and tutor notes — independent review, 2026-10-16

Astra reviewed the new capability, HTTP boundary, assignment locks, immutable
storage and receipt protocol independently of Sol's implementation. Acceptance is
limited to this backend slice; no autosave interface or live-provider claim.

Draft writes require the learner's student authority or an active linked-child
practice context. Notes require the explicit tutor/admin capability. Every work,
history, receipt and append request revalidates the current assignment and verse;
old history cannot grant access to a removed verse. Existing SHARE authority locks
are preserved. Post-wait expiry checks precede stale results and run again before
return, including after insertion contention. CAS and same-operation receipts
produce one version/audit; a replay distinguishes its committed version from the
current head and cannot silently overwrite later writing.

Review corrections removed an ephemeral context FK that would prevent session
cleanup, replaced a maximum-version sentinel that hid the final valid integer
version, moved expiry checks ahead of an early stale return, and added bounded
non-email author labels. Durable composite actor/grant/student/guardian and
student-identity FKs retain attribution; historical context UUIDs grant nothing.
Both tables FORCE tenant RLS and grant only SELECT/INSERT to runtime. Immutable
triggers protect UPDATE/DELETE; audit data excludes submitted writing.

Verification: ten focused PGlite checks, fifteen real PostgreSQL checks and six
fresh SQL migration/replay checks pass. Two initial PG race tests used their
blocked mutation connection as observer; Sol corrected the test harness to use
an independent idle connection and settle/sanitize concurrent failures. Final
physical lock observations cover uniqueness, revocation, context switching,
assignment changes and natural expiry. FK probes use distinct version/receipt
keys and assert the constraint SQLSTATE, avoiding uniqueness false positives.
Session deletion successfully cleans up practice context while authorized history
survives. Evidence: STUDENT-WORK-RETURN.md and ignored student-work-* logs.
No remaining blocker was found in this backend scope. Combined UI integration,
build and hosted CI remain separate acceptance gates.

## Relationship and CSV interfaces — independent review, 2026-10-16

Astra reviewed the admin-only route composition, closed response parsers, bounded
transport, target snapshots and mutation/reload lifecycle. These interfaces use
the already reviewed relationship/import endpoints and introduce no new server
permission. Reviews distinguish removing one student link from revoking an entire
congregation role; exact link/grant revisions remain separate from student revision.
Every access change re-reads its target and compares the reviewed identity/state
before POST. Disabled students permit cleanup without enabling new access.

Synchronous latches prevent double submission. Unknown responses block further
mutations until explicit recovery; no automatic POST retry or optimistic access
claim occurs. A successful write followed by a failed reload remains labelled as
saved with current state unavailable. Reload promises await pending writes and
fresh private reads; generation/lifetime checks discard replaced completions.

CSV commit retains the exact bytes, duplicate choice and opaque short-lived server
binding. Draft/lifecycle changes invalidate review. Unknown import cannot prove
failure: its original draft is protected from editing until explicit roster
inspection/acknowledgment; the recovery clears duplicate override and requires a
new preview. No local persistence, automatic clipboard action or new import
receipt is introduced. Student names follow their existing contract, independently
of the stricter authorized display-name labels. Source review found no remaining
authority blocker at this scope. The fresh visual review's focusable read-only
unknown draft and compact identifier presentation were corrected in one bounded
batch; the reviewer confirmed both and returned ship.

Six actual-SDK/restricted-PostgreSQL browser cases passed before that visual fix,
including real committed-but-unknown operations, changed review identity, stale
CSV roster binding, child-context denial and sibling survival. Initial harness
failures were corrected without changing production auth/rate limits: exact
private-content clearing, scoped alert locators and in-memory reuse of actual SDK
session cookies. The final combined suite passes 31/31, including these six cases
after both visual fixes; typecheck/build and six production-page checks also pass.
See ROSTER-CONTROLS-RETURN.md for final integration evidence.

## Student work UI and dispatcher integration — 2026-10-16

Astra independently reviewed Sol's memory-only work coordinator, closed response
parsers, provider lifecycle integration and controlled departure paths. Draft
authority remains on the server: own student or explicit child practice may
append translations; ordinary parent and staff draft views are read-only; staff
notes require the existing explicit capability. No local persistence, background
beacon, optimistic authority restoration or generated-audio release is added.

Review closed several ordering and uncertainty findings. Old page responses and
late acknowledgements cannot lower a known stream head. Receipts must match the
frozen operation, assignment, verse, text and expected next version. Receipt 404
alone neither proves rollback nor revokes child authority; 401/403 still clear
authority. Unknown recovery waits for current metadata and head before retrying
the exact original UUID/body. Queued typing remains separate from that operation.
An older committed version with an unavailable current head is not labelled as
the current saved text.

Visibility/session revalidation pauses work and settles writes plus recovery;
metadata, text and saved work must all complete for the same lifecycle before
editing resumes. Work-page completion alone cannot unpause. Denial and changed
session/context/assignment clear mounted work and fence late callbacks. A current
403/404 during active-child revalidation now clears the child's work immediately
and returns to the parent route while the retained subtree remains hidden. Abort,
refresh sequence, context identity, practice generation and route checks prevent
an old denial from clearing replacement state. 401 retains full session denial.
The parent route performs fresh checks before showing available children.

Controlled navigation reviews staged or uncertain work. Opening that review
blocks blur autosave; only its explicit Save-and-continue path may submit during
review. Native beforeunload registration is bounded to unsent/uncertain work.
Browser termination, arbitrary Back/Forward and reload recovery remain explicitly
unsupported; synthetic lifecycle events do not establish real BFCache behavior.

Actual browser integration exposed a production dispatcher defect missed by the
earlier handler-direct tests: the general portal handler consumed work routes
before the specific handler. Sol reordered handlers and added a full-dispatch
regression covering persisted append/read and method/query/origin/student denial.
The test harness also needed to recognize work routes before delegating to its
injected runtime. These were routing corrections, not relaxed authentication.

The existing study browser suite also caught a cross-component recovery defect:
after a handled stale-assignment text response, a work-page request could clear
the baseline and remove the explicit text recovery action. The text loader now
returns success only for a current successful page. Work paging requires that
success and the same controller, generation and metadata after the departure
guard; aborted/stale/error completions cannot start it. The original stale-text,
session-expiry, privacy-clearing and sibling assertions remain in the tests.

The final affected-file browser run passed 16/16 (seven editor, six relationship,
three study cases), following a combined 35/38 run whose three failures exposed
the omitted test font asset, an obsolete parent-recovery expectation and the
stale-text defect above. The fixed isolated harness copies only the pinned font
and OFL; actual CDP glyph inspection verifies Noto rather than a declared CSS
family. A capture-only rerun passed 1/1 after a malformed phone screenshot; it
does not substitute for the independent visual verdict. Final local application
tests pass 381 with one platform-specific skip; typecheck/build and fifteen
production-page checks pass. Final hosted all-suite evidence remains separate.

Source review found no remaining authority blocker at this scope. Final browser,
visual and publication evidence belongs in STUDENT-WORK-UI-RETURN.md and STATE.md;
source acceptance alone does not establish those gates or live-provider readiness.

## Adult contact slice — independent frozen-source review, 2026-10-16

**Disposition: accepted at the bounded source and reported focused-test scope; no blocking finding.** Reviewed student validation/service and schema, migration `0012_student_kind_contacts.sql`, its journal/snapshot, portal HTTP input/admin roster projection, invitation service, roster/client DTO and invitation-review adapters, CSV UI/API changes, and their new/changed adult-contact, migration, invitation, student, route, client and roster-browser regressions. Existing tenant-scoped roster/CAS data, explicit public student projections and invitation link/recipient history were checked as targeted context. Unrelated provider/state work was preserved. No source implementation, database connection, remote action or test execution was performed by this reviewer.

Migration 0012 defaults existing rows and omitted SQL kind to child, permits nullable parent contact, and restricts kind to child/adult. Its contact CHECK explicitly requires a non-null parent for children and a non-null own email for adults, with nonblank checks for supplied contacts; SQL UNKNOWN cannot satisfy a missing required contact. The snapshot chains to the preceding schema snapshot and changes only the intended student columns/checks. Upgrade/replay coverage preserves an existing child's contacts/revision and refuses missing/blank required contacts and unknown kinds. Email syntax and distinct supplied mailboxes remain application validation rather than new database identity authority.

Only exact null bypasses parent-mailbox comparison in all four invitation paths: issue, reissue, preview and acceptance. Non-null malformed contacts still reach the strict normalizer and refuse. Verified exact invitation recipient, tenant/student locks, disabled-state checks, parent-role exclusion and revoked/occupied identity-link history remain independent and unchanged. Tests cover null-contact success, wrong recipient/origin, replay, contact becoming the recipient after review, malformed contacts in all four paths, revoked identity history and a parent grant acquired after review. Neither ownEmail matching nor kind selection creates a grant, guardian or student identity.

Create/edit/import retain admin capability and cookie-mutation boundaries. Kind/contact edits use the existing tenant-scoped locked student and expected-revision CAS, increment student revision, and do not grant, revoke or relink authority. Existing relationships survive both kind transitions; tests compare guardians, identities, grants and invitations before/after, reject stale/cross-tenant edits and deny a contact-matching identity access to a newly created/imported adult. Public student/parent/tutor DTOs still contain only id, names, date and revision; kind and contacts are confined to the explicit admin roster. No calendar or service-slot behavior is introduced.

Legacy five-column CSV remains child-only; the second exact header starts `studentKind` and requires an explicit child/adult cell. Duplicate identity now includes kind. Confirmation still binds the exact raw CSV, duplicate choice, actor/session and roster revisions; the existing valid-input alteration/session/replay tests continue covering that shared binding code. HTTP omitted kind likewise defaults to child and cannot infer adult from an own email. Client forms make the corresponding required field explicit and explain that linked access is managed separately.

Author/root reports 72/72 focused checks plus a refined 5/5 run, with typecheck, build and repository guards passing. Root's actual PostgreSQL/browser and full integration checks were pending at this review boundary. This verdict does not establish real PostgreSQL upgrade/concurrency results, visual capture acceptance, hosted exact-commit checks, production migration or deployed adult behavior; root retains those integration/release gates.

Final display-only re-review preserves that acceptance. The existing three-column roster now places the already authorized kind label beneath the student name; its single CSS rule changes display, muted color, size and weight only. Submission, DTO and authority behavior are unchanged. The browser repair changes one exact invalid-row copy expectation and retains its refusal to offer confirmation; tsconfig has no remaining diff. Author/root reports a further 24/24 focused run and passing typecheck/build. The fresh seven-case roster/browser capture run and full integration were still running. Existing migration files remain unchanged; only 0012 and its metadata are added. The proposed release order—exact-commit review-branch CI, then the additive migration, then the same SHA on production—avoids deploying code that requires a missing column. This is compatibility with the old child-only writer before adult records exist, not a promise that the old admin DTO parser can display later adult rows with null parent contact.

### Adult contacts — integration and actual PostgreSQL 18 migration evidence

Root subsequently completed local integration: **152 Node and 436 app passes, one existing skip**, and all ten affected actual-SDK/restricted-PostgreSQL browser cases (three invitation-management cases in the initial run, then all seven roster cases after the copy/display repair). Root accepted the fresh desktop form and mobile status readability. All four exact-commit hosted jobs passed for `7ac1480d5b03558c52c5ff48615e9335ec8402e0` in run `38945168362`; the hosted PostgreSQL suite uses version 17.

Read-only operator inspection established that actual Neon uses PostgreSQL 18, whose NOT NULL constraints have separate catalog rows. Apply was initially blocked until root reviewed an exact observed model: remove only `student_parent_email_not_null` on column 6 and add only `student_student_kind_not_null` on column 11, with exact validation/enforcement/inheritance attributes. The other seven NOT NULL rows remain byte-exact; this is not an exemption for the entire constraint class. Offline guard cases rejected wrong columns/flags/names, extra rows and mutations/replacements of existing rows.

After exact-commit CI passed, root independently reviewed and executed the private 0012 helper on actual PostgreSQL 18. Precheck/postcheck proved **12 → 13 ledger entries**, preservation of the first twelve entries including IDs, and only the expected student catalog changes, including the precise NOT NULL delta. Roles, memberships, relation/schema ACLs, indexes and triggers were unchanged. No student/contact values or synthetic production records were needed. Successful postchecks confirm completion; a failed postcheck would not undo the already committed migration.

**Catalog and upgrade acceptance on actual PostgreSQL 18 is complete.** The PostgreSQL 17 CI/auth-suite results and actual PostgreSQL 18 catalog/migration evidence have different scopes; no full auth-suite run on version 18 is claimed. Root pushed the same reviewed SHA to main after migration. Matching production deployment `dpl_FxS3AdwUKaEkGyYRDv54UFJJjioE` is now READY at exact `7ac1480d5b03558c52c5ff48615e9335ec8402e0`; root's canonical native canary passed all five expected/observed routes and five native records with bounded retrieval complete, fragment cleared and query-free requests. Body, cookie, response-cookie and browser-diagnostic markers were absent. This closes bounded deployment/canary acceptance. The canary was synthetic (`realAuthentication=false`, `emailSent=false`); it does not establish new human authentication, mail delivery or adult end-user acceptance. This reviewer performed no database connection, execution or repeated integration check.

## Service slot and reading date — independent frozen-source review, 2026-10-16

**Disposition: accepted at the final source and focused/browser evidence scope; no remaining blocking finding.** Reviewed `reading-date.ts`, reading normalization/proposals and the persistent cache adapter, student validation/preparation/service and roster data, portal projections, staff roster/reading client adapters/editor, migration 0013 and its snapshot/journal, and the affected date, migration, reading, student, runtime, portal and browser tests. Source implementation was left to Sol. The reviewer separately changed only the authorized CI image line to PostgreSQL 18.6 and prepared the private migration helper; neither action changes application authority.

The public student/practice DTO remains id, names, ceremony date and revision. Admin roster input/output carries the closed service-slot enum; the reading service reads only that planning field after the existing student SHARE lock, without upgrading it or projecting contact data. Unknown remains the migration/default/legacy-CSV value. Morning Saturday derives that date; Havdalah Saturday derives exactly seven days later using calendar-date arithmetic. Unknown slots, non-Saturdays and out-of-range derivation have explicit manual fallback and no lookup. Ceremony and derived reading dates remain separate through fetch, signed review, staff DTO parsing and persisted provenance. Manual unknown-date assignments expose a null public source date and no fetched timestamp.

Custom references are the initial method for both Torah and haftarah. Calendar helpers require explicit selection and a regular classification; holidays, multiple/missing/nonregular results and unavailable sources require manual choice. Classification requires an explicit Shabbat type and bounded parashah number metadata, rather than inferring Shabbat from a full reading. The v2 cache preserves missing-type uncertainty and multiple-result ambiguity on roundtrip, and checks date/calendar/range bindings before early multiple-result returns.

The persistent adapter initially remained v1-only, causing root's full runtime integration to fail despite the in-memory/browser paths passing. The final repair now accepts only the normalized v2 key/metadata vocabulary: bounded numeric parashah numbers, explicit allowed source types, and only the exact top-level multiple/empty marker. Nested unknown properties still refuse; the 128-KiB bound, key/date/calendar/range validation, timestamp/TTL limits and sanitized cache errors remain. Persistent database roundtrip/mutant tests cover regular, missing-type and multiple results, reject private extra fields and wrong bindings, and prove v1 rows are not transplanted into v2 lookups. The passing browser fixtures bypass this adapter and are not used as proof of its repair.

Review claims bind origin, user/session, membership/authority revision, role grant/revision, relationship/revision, student/revision, ceremony date, slot, derived reading date, calendar and assignment revision. Confirmation reacquires authority and rereads current planning context/calendar before assignment lock/CAS. Date/slot edits preserve confirmed ranges/verses while marking both assignments for review and incrementing revisions; legacy snapshots missing slot provenance require review without losing work. No new identity, relationship or role authority is inferred from a slot or contact.

Independent review found that the five-minute envelope was checked before lock waits only. The repair reauthenticates the original opaque envelope with a fresh clock immediately after the assignment lock and before CAS/persistence, requiring the same payload digest. The reviewer independently ran its deterministic delayed-lock-result regression: **1 passed, 15 other tests skipped**, with unchanged assignments, verses and audit after expiry. This models the ordering and is not a real PostgreSQL blocking proof. The browser repairs open the actual haftarah disclosure and verify each assignment's review notice while retaining the Torah assignment.

Migration 0013 is exactly one additive text column with unknown default/NOT NULL and the three-value CHECK; its snapshot changes only that column/check and chains correctly. The separately reviewed private helper preserves all thirteen old ledger entries and existing catalog/role/membership state, allowing only the slot column, CHECK and exact PostgreSQL 18 NOT NULL addition. It has not been executed. Root reports **all ten affected actual-SDK/restricted-PostgreSQL browser cases passing** and accepted fresh desktop/mobile captures. Author reports 83 focused checks before repairs, 21/21 final runtime/reading checks and passing typecheck/build/guard checks. Root's earlier full run had 152 Node passes and 447 app passes with one runtime failure and one existing skip; the final full rerun was in progress at this boundary. Exact-commit PostgreSQL 18 hosted coverage, actual 0013 execution and matching deployment/canary remain root-owned pending gates.

Final local integration on the repaired frozen source subsequently passed **152 Node and 450 app tests, with one existing skip**. Root published exact commit `be7f1d62b42dff54a185c2ff40b948ef977f063c` only to the slot review branch and ran the independently reviewed helper in `--check-only` mode against that same SHA: actual Neon PostgreSQL 18 precheck passed with thirteen existing ledger rows and no mutation. Hosted run `38949611235`, now using PostgreSQL 18.6, was still in progress. No 0013 apply, production deployment or matching canary acceptance is established by these local/precheck results; those gates remain pending. No tests or operator actions were repeated by this reviewer.

### Slot review-status consistency — hosted failure and bounded repair

Hosted run `38949611235` on `be7f1d62b42dff54a185c2ff40b948ef977f063c` passed the PostgreSQL 18 SQL/service suites but reached only **39/46 browser passes**: all seven student-work cases failed at the unchanged loaded/readiness helper. Metadata, work and text responses were 200 with no page errors. This exposed a real cross-service mismatch: portal metadata marked legacy assignments lacking slot provenance for review, while study text still reported the old false flag. The strict study client correctly refused that disagreement. The previous local/focused evidence did not establish hosted acceptance, and no migration/main publication followed that failure.

**The frozen consistency repair is independently accepted at source/focused-test scope; no blocking finding.** Exact repair scope is new pure `src/lib/readings/review.ts`, its call sites in portal/study services, and `tests/app/study-service.test.ts`. Both review-status producers now use one predicate: provenance must be numeric version 1, slot must be a literal known value, needsReview must be exactly false, and confirmation date must be valid and match the current ceremony date. Legacy/malformed/marked snapshots require review; explicitly confirmed manual unknown-slot snapshots remain supported. Review status does not hide preserved authorized verses or grant access.

The study service uses the same predicate inside both existing authority captures around its load, preserving its complete before/after binding check. No DTO field, capability, relationship rule, lock, public fetch input or cache boundary changes. The regression obtains actual HTTP metadata and study responses, parses them through both unchanged strict clients in admin/tutor/parent/student modes, and covers ten current/legacy/manual/marked/malformed/null variants while retaining the expected verse references. Browser fixtures, readiness assertions and workflow settings are unchanged by this repair. Author reports 28/28 focused checks and passing typecheck/build/diff checks. Root's fresh full integration and seven actual-SDK/PostgreSQL student-work browser cases were running; a new exact-commit hosted result, actual 0013 apply and matching deployment/canary remain pending. No extra broad checks or provider/database operations were performed by this reviewer.

### Slot release — exact-commit integration and actual Neon upgrade

Root's final local run passed **152 Node and 451 app tests, one existing skip**. All seven unchanged actual-SDK/restricted-PostgreSQL student-work browser cases passed; the previous three reading and seven roster browser passes remain valid. All four hosted jobs passed for exact commit `799e119b05b89df41535b703f662e4b88d3ede2d` in run `38951011087`, including the full SQL/service/browser coverage on PostgreSQL 18.6. This closes the earlier hosted parity failure on the repaired source.

Root then executed the independently reviewed 0013 helper against that exact SHA on actual Neon PostgreSQL 18: **13 → 14 ledger rows**, with the thirteen old entries preserved, only the expected student catalog additions, and roles/memberships preserved. The helper's remaining catalog/ACL/index/trigger checks passed. Exact PostgreSQL 18.6 CI establishes the full test-suite scope; actual Neon execution separately establishes the live upgrade/catalog scope. Neither substitutes for the other. Root pushed the same SHA to main only after the migration succeeded. **Source, integration and migration acceptance are complete; matching deployment and root's canary remain pending.** No checks or operator/provider actions were repeated by this reviewer.

Final root release acceptance: exact `799e119b05b89df41535b703f662e4b88d3ede2d` passed all four hosted jobs in `38951011087`, including the full PostgreSQL 18 job. The reviewed actual-Neon 0013 helper then passed its 13 → 14 ledger/catalog preservation checks, and root pushed that same SHA to main. Matching production deployment `dpl_EPty7Btu7YEtW2BvKEeYKEbDRTeM` is READY. Its canonical native canary passed five expected/observed routes and five matching native records, fragment clearing, query-free credential requests and absence of body/cookie/response-cookie/browser-diagnostic markers. This closes the bounded release gates. The canary is synthetic and sent no real email; Daniel's administrator-workspace refresh and real email fallback acceptance remain pending. No generated audio or wider human pilot is released by this checkpoint.

## Whole-portion preview — independent frozen-source review, 2026-10-16

**Disposition: accepted at the bounded source and reported focused-test scope; no remaining security blocker.** Reviewed the new student preview service, binding purpose, staff HTTP routes, roster assignment-version lookup, runtime wiring, preview API/component, shared study-parser extraction and their focused service/client/browser regressions. Existing access capture, public text loader and assigned-study envelope were targeted context. No application implementation, database/provider operation or additional test execution was performed by this reviewer.

Both preview routes require cookie-mutation Origin and admin/assigned-tutor set-reading capability. Authority is captured before and after calendar/text work, including session, membership, grant/relationship revisions, student revision, ceremony date, service slot, calendar and assignment id/revision. Final capture uses SHARE reads without lock upgrades and checks the original opaque claim's expiry after its final waits. The distinct preview purpose and body-only token cannot authorize assignment confirmation or widen the assigned-text route. No assignment, verse-cut or audit mutation is introduced; existing public cache writes remain possible.

The claim freezes kind, canonical ranges and source snapshot/hash for its original five-minute lifetime. Pages accept only server-planned offsets, with trusted verse counts, at most 1,000 total verses and the existing 100-verse/eight-chapter page limits. Public text work retains the existing timeout/byte/normalizer/credit boundaries and receives no actor context. This freezes reference/calendar provenance rather than every future upstream chapter byte. Manual references now validate before external work; unresolved calendar/slot cases require manual choice, and separate maftir is not silently appended.

The shared parser extraction preserves the assigned DTO's context, assignment identity/revision and review-status checks. Preview has its own closed envelope, exact scope/date/source checks and recomputed canonical page plan, then reuses the same strict text/edition/credit validation. The UI marks text unassigned and renders calendar boundaries as orientation only. It captures a manual draft before either await, including while no preview exists; draft changes, context changes, access pause and expiry abort/invalidate pending generations and clear text, token and stale notices. Both preparation and first-page completions compare the captured manual draft; later pagination remains tied to that draft.

The first browser run passed the delayed-manual-reply and authority-revalidation cases but failed the whole-portion case. Investigation found a real projection defect: an omitted optional maftir reason became internal null, which the unchanged strict HTTP projector refused. The narrow repair preserves omission until that projector emits the existing nullable public field. A new actual-HTTP regression reproduces the prepare/page path and now expects 200 with public reason null; no shared validator or authority rule was relaxed.

Author reports 81/81 focused checks before that repair, then 12/12 focused checks plus passing typecheck/build/diff and four repository/isolation guards on the repaired source. Root's fresh browser rerun and full local integration are still pending. The earlier 2/3 browser result does not establish whole-portion or capture acceptance. Exact-commit hosted checks, matching deployment/canary and visual acceptance remain separate root-owned gates; this source verdict does not claim their completion.

Root preview release acceptance: the unchanged three authenticated browser cases pass on the repaired source. Full local integration passes 152 engine and 463 app tests (one existing skip); build/typecheck/guards pass. Independent visual review accepted the supplied desktop/mobile layout and subsequently scored its sole documentation fix resolved. Exact `5b652c6026b98d00ba6a8cbabf21ed9b0b409ff0` passed all four jobs in run `38956763174`, including full PostgreSQL 18 coverage, then the same SHA reached READY deployment `dpl_9MaSkDbzrrutwPJ4C1DLPCXxGJr2`. The native canonical canary passes five route events/five matching records with no secret canaries observed. No migration, provider settings or owner grant changed. This closes the preview release gates, not the full product or generated-chant release.

## Unsent-work recovery prerequisite — independent source review, 2026-10-16

**Disposition: accepted at the bounded repaired-source scope; no remaining blocking finding.** Reviewed student-work service/data/HTTP/runtime changes, strict work API parsers, coordinator and verse tools, reading/provider verification hooks, focused work tests and the new PostgreSQL/browser regressions. Existing access/practice capabilities, assignment locks and immutable work schema were targeted context. This reviewer changed only this note and performed no tests, browser runs, database/provider operations or source implementation.

Retention is per reading kind and mounted memory only. It requires fresh session verification, unchanged mode/student revision/child context, the same assignment id, a strictly increased assignment revision and the exact ordered canonical verse list. Incompatible kinds clear; an unchanged kind retains its existing scope, pending UUID and ordinary same-revision retry semantics. Replacement scopes invalidate old acknowledgements. A distinct-purpose opaque work-authority HMAC additionally binds origin, tenant, user/session, membership authority, grant id/revision, student id/revision, exact relationship id/revision where present and child-context id/authority revision. Student identity uses its actual replacement id and canonical null revision, not an invented revision column. Fresh page comparison precedes retained-text visibility; the HMAC does not grant authority or replace current expiry checks.

The new body-only POST recovery route is closed, Origin checked and requires the current stream's write capability, preserving read-only parent access. Under existing assignment SHARE locks it requires a newer current revision of the same assignment and current canonical verse membership. It validates the frozen original write and recomputes its original digest, checking committed row assignment/revision, text/version and actor membership/mode/grant/guardian/context/student-identity provenance. Explicit proof echoes current assignment/revision, original revision, mutation UUID, verse, stream and authority binding; strict client checks reject mismatches. Ordinary receipt parsing still requires the current revision and is not loosened.

Only a successful locked proof can establish absence: an earlier old writer must finish before the assignment UPDATE commits; a later old writer sees the newer revision and rejects. Final session/child expiry is checked after the action's waits. History and matching text are not mutation receipts. Pending uncertainty remains frozen until proof plus a fresh current head resolve it. Review never retargets or automatically retries the old body; a reviewed later save uses a new UUID, current revision and current-head CAS. An already committed original copy cannot be posted again as recovered unsent work, while later typed text remains separate. Revision review blocks edits, debounce and blur saves until explicit resolution.

Independent review found that a manual recovery404 could swallow actual authority loss and leave retained text visible. The repair hides the cell before a fresh page wait; denial/binding mismatch clears, and every unsuccessful page result leaves the copy unverified/hidden. Scope/generation/request checks prevent late restoration. A successful same-authority page restores only blocked unknown-state visibility, never absence. Existing Retry work can restore visibility after an outage without releasing the original pending mutation. Six controlled regressions cover these denial, mismatch, outage, older-head, same-authority and held-response cases. The earlier missing verse/stream proof echoes were also corrected and have strict parser mutants.

Author reports final **66/66 focused checks** and passing typecheck/build, with repository guards passing before the final narrow client repair. Root reports **18/18 actual PostgreSQL checks** on identical server code, including observed writer-first/update-first lock races and expiry after waking. The initial authenticated browser run passed all seven existing cases; three new cases failed before their intended HTTP action because the staff helper fetched relatively from about:blank. That test helper now enters the real staff workspace first; the browser rerun and final full integration remain pending. Exact-commit hosted checks and matching deployment/canary remain root-owned pending gates. No schema, migration, cut controls or provider change is part of this prerequisite.
