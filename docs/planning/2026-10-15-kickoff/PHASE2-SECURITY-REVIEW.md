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
