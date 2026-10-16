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
