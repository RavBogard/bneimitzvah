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
