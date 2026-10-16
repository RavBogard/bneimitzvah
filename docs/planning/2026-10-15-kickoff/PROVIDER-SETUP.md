# Provider setup for Daniel's private testing

Status, 2026-10-15: Daniel confirmed Google OAuth, Neon and Resend are not configured. Continue local implementation; this is a preparation checklist, not evidence that live authentication works. No new account, paid service, outbound email or database has been provisioned by these steps.

## 1. Canonical host

The intended authenticated origin is `https://bneimitzvah.centralreform.org`. Complete the pending CNAME for host `bneimitzvah` to `a008a8e486abbe24.vercel-dns-016.com.`, then verify Vercel domain ownership/TLS. The existing Vercel hostname remains an infrastructure placeholder. Authenticated previews need an explicit separate host mapping and synthetic database; they must not inherit production credentials.

## 2. Google sign-in

Create a Google OAuth Web application client for this portal, with the consent screen restricted to Daniel's testing while the full product is built. The planned production callback is `https://bneimitzvah.centralreform.org/api/auth/callback/google`. A separate local client may use `http://localhost:3000/api/auth/callback/google`. These paths assume the standard Better Auth `/api/auth` mount, which the route implementation must verify before setup is finalized. Register exact callbacks, without wildcards. Store client ID and secret privately as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; set `BETTER_AUTH_URL` to the matching origin. [Better Auth Google setup](https://better-auth.com/docs/authentication/google).

The portal accepts families' Google accounts rather than requiring a CRC Workspace domain. A successful sign-in establishes identity only; it does not grant a congregation role or access to a child. Explicit invitation acceptance is a separate operation.

## 3. Neon database

Select the portal's own project/database and review the current plan and spending controls before creation. Any new charge or upgrade needs Daniel's approval. Keep migration credentials separate from runtime credentials and out of Vercel's runtime environment.

Apply the reviewed migrations as a dedicated owner. Create the application LOGIN role through SQL with no superuser, role-creation, database-creation, replication or RLS-bypass privilege. Grant it membership in the migration-defined `portal_runtime` privilege group only. It must own no application table and must not be able to assume the owner or an elevated role. Neon Console/CLI/API-created roles receive `neon_superuser` membership, so they are unsuitable as the unmodified application login. [Neon role management](https://neon.com/docs/manage/roles).

Store the restricted connection privately as `DATABASE_URL` and the separate owner connection as `DATABASE_MIGRATION_URL` for the operator migration runner only. Verify migrations, role attributes/membership, FORCE RLS, cross-tenant denial and transaction-local context on the actual Neon WebSocket driver before marking remote isolation accepted. Local PostgreSQL checks do not replace that transport check.

The runtime accepts a restricted Neon URL with `sslmode=require` and no additional connection options. Neon-generated URLs can include libpq options such as `channel_binding=require`; the pinned WebSocket driver does not enforce that requirement. Follow the reviewed runtime URL instructions in [`src/server/runtime/README.md`](../../../src/server/runtime/README.md), keeping the operator URL separate. If channel binding is required by deployment policy, resolve driver support before configuration rather than claiming it is enforced.

## 4. Resend magic links

Choose a CRC-controlled sending subdomain and add the exact verification records shown by Resend; preserve the congregation's existing mail records. Confirm domain verification before delivery testing. Keep click/open tracking disabled for authentication messages. A subdomain can isolate transactional sending reputation. [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction).

Create a dedicated API key limited to sending on the chosen domain. Store it privately as `RESEND_API_KEY`, with the verified sender in `RESEND_FROM`. Resend supports permission and optional domain restrictions for keys. [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction).

Until then, local automated tests capture synthetic messages inside the test process. No production route may expose the capture transport, magic-link tokens or account inventory.

## 5. Private configuration and acceptance

Put secrets directly into the appropriate local ignored environment file or Vercel environment settings. Never paste credentials, database URLs, cookies, magic links or personal account details into chat, Git, screenshots or logs. Create a unique strong `BETTER_AUTH_SECRET` privately; do not reuse another product's secret. The reviewed configuration loader will reject missing production configuration rather than substituting test defaults.

Set the nonsecret production values `PORTAL_ENVIRONMENT=production` and `PORTAL_DEPLOYMENT=production`, with `BETTER_AUTH_URL` equal to the canonical HTTPS origin above. Preview and local development require distinct explicit host mappings; a local origin must be loopback HTTP with a port, and is rejected by a production runtime. Google credentials may be omitted together while magic-link sign-in is prepared, but configured runtime use still requires the database, auth secret and mail settings. Missing providers are not a local authentication bypass. The separate synthetic browser harness remains implementation work.

After the routes and capabilities are complete, use Daniel's account to verify Google round-trip sign-in, delivered magic link, expired/replayed link rejection, logout, exact-host enforcement and explicit invite acceptance. After Daniel has a verified auth identity, run `node scripts/bootstrap-owner.mjs --confirm` from a private operator environment containing `DATABASE_MIGRATION_URL` and `BOOTSTRAP_OWNER_EMAIL`. The connection must directly own the portal tables and be permitted to assume the fixed `portal_runtime` role. The script uses a transaction-local CRC context, binds the initial owner identity in the append-only audit, and refuses a different identity or revival of revoked authority. Repeating it for the same active owner is idempotent. Remove `BOOTSTRAP_OWNER_EMAIL` from the private operator environment after success; neither bootstrap variable belongs in the deployed runtime. No public sign-in hook grants owner access. Other humans are not invited to test until the full product is feature complete and Daniel approves Phase 7.

The isolated SDK checks currently cover actual library handlers and local persistence. They do not establish Google authorization-code delivery, Resend delivery, DNS/TLS, deployed role flows or live Neon behavior. Record those results separately when configuration is available.

The HTTP adapter deliberately ignores caller-supplied IP and forwarding headers for authentication throttling. Until ingress normalization is independently verified, the SDK uses a server-selected bucket per configured origin: magic-link requests share five attempts per minute. This prevents header rotation from bypassing that limit, but can delay unrelated users. Before family access, validate the hosting platform's address-header trust boundary and replace or augment this conservative fallback with a reviewed limiter suitable for concurrent families. Do not describe the current bucket as per-client protection. Application request-URL logging is disabled; separately verify that hosting access logs redact invitation and authentication query strings.
