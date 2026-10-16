# Provider setup for Daniel's private testing

Status, 2026-10-16: Daniel has corrected the Google callbacks and intentionally keeps OAuth public. He already has a CRC Resend account, not yet connected to this portal, and is creating the Neon project through Vercel. Use the stable Vercel host until custom-domain DNS is ready. Private runtime credentials have not been installed by this implementation work. This is a preparation checklist, not evidence that live authentication works; no database creation, outbound delivery or paid provisioning is claimed.

## 1. Canonical host

Use `https://bneimitzvah.vercel.app` as the temporary production origin. Migration `0008_crc_vercel_production_host` adds that exact host to the existing CRC tenant, preserving the custom-domain mapping. Set `BETTER_AUTH_URL=https://bneimitzvah.vercel.app`; only that configured origin accepts authenticated requests. Arbitrary Vercel preview/sibling hosts are not production aliases, and neither forwarding headers nor another directory entry changes the selected origin.

When DNS is ready, complete the pending CNAME for `bneimitzvah` to `a008a8e486abbe24.vercel-dns-016.com.`, verify ownership/TLS, then deliberately switch `BETTER_AUTH_URL` to `https://bneimitzvah.centralreform.org`. That requires signing in again. Cookies, OAuth callbacks, mail links and pending/review bindings stay bound to the selected origin; requests to the previous origin are denied rather than accepted through fallback. Authenticated previews still require a separate exact host mapping, synthetic database and separate secrets.

## 2. Google sign-in

Use a Google OAuth Web application client for this portal. Daniel confirmed on 2026-10-16 that public OAuth availability is intentional; do not switch it back to testing. Public identity sign-in does not grant portal membership or invite other people to test the product. Add `https://bneimitzvah.vercel.app/api/auth/callback/google` under **Authorized redirect URIs** for the temporary production host. The eventual custom-domain callback is `https://bneimitzvah.centralreform.org/api/auth/callback/google`; a separate local client may use `http://localhost:3000/api/auth/callback/google` when that exact local origin is configured. Registering both future/current callback URIs at Google does not make both portal origins trusted: runtime still selects exactly one through `BETTER_AUTH_URL`. The route adapter exposes this callback through an explicit allowlist; the full SDK endpoint set is not mounted. Store client ID and secret privately as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. [Better Auth Google setup](https://better-auth.com/docs/authentication/google).

The portal accepts families' Google accounts rather than requiring a CRC Workspace domain. A successful sign-in establishes identity only; it does not grant a congregation role or access to a child. Explicit invitation acceptance is a separate operation.

Use full callback paths, not a bare site root or bare HTTPS loopback address. Do not enable the console's AI-agent option for this ordinary portal sign-in. Google's server flow requires the redirect URI to match exactly, including scheme, port and path. [Google server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

## 3. Neon database

Create the portal's own Neon project/database through the Vercel Marketplace on the Free plan, connected only to Production for now. The integration may inject default connection variables; replace those with the restricted runtime login and remove unnecessary owner credentials before enabling the portal. Review the current plan and spending controls before creation. Any new charge or upgrade needs Daniel's approval. Keep migration credentials separate from runtime credentials and out of Vercel's runtime environment.

Apply the reviewed migrations as a dedicated owner. Create the application LOGIN role through SQL with no superuser, role-creation, database-creation, replication or RLS-bypass privilege. Grant it membership in the migration-defined `portal_runtime` privilege group only. It must own no application table and must not be able to assume the owner or an elevated role. Neon Console/CLI/API-created roles receive `neon_superuser` membership, so they are unsuitable as the unmodified application login. [Neon role management](https://neon.com/docs/manage/roles).

Store the restricted connection privately as `DATABASE_URL` and the separate owner connection as `DATABASE_MIGRATION_URL` for the operator migration runner only. Verify migrations, role attributes/membership, FORCE RLS, cross-tenant denial and transaction-local context on the actual Neon WebSocket driver before marking remote isolation accepted. Local PostgreSQL checks do not replace that transport check.

The runtime accepts a restricted Neon URL with `sslmode=require` and no additional connection options. Neon-generated URLs can include libpq options such as `channel_binding=require`; the pinned WebSocket driver does not enforce that requirement. Follow the reviewed runtime URL instructions in [`src/server/runtime/README.md`](../../../src/server/runtime/README.md), keeping the operator URL separate. If channel binding is required by deployment policy, resolve driver support before configuration rather than claiming it is enforced.

## 4. Resend magic links

Reuse the existing CRC Resend account. Daniel reports centralreform.live is Verified (2026-10-16); this is the selected candidate domain. Confirm sending capability and tracking configuration before live authentication delivery. A new account is unnecessary. If a new sending subdomain is needed, add the exact verification records shown by Resend and preserve the congregation's existing mail records. Confirm domain verification before delivery testing. Keep click/open tracking disabled for authentication messages. A subdomain can isolate transactional sending reputation. [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction).

Create a dedicated API key limited to sending on the chosen domain. Store it privately as `RESEND_API_KEY`, with the verified sender in `RESEND_FROM`. Resend supports permission and optional domain restrictions for keys. [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction).

Until then, local automated tests capture synthetic messages inside the test process. No production route may expose the capture transport, magic-link tokens or account inventory.

## 5. Private configuration and acceptance

Put secrets directly into the appropriate local ignored environment file or Vercel environment settings. Never paste credentials, database URLs, cookies, magic links or personal account details into chat, Git, screenshots or logs. Create a unique strong `BETTER_AUTH_SECRET` privately; do not reuse another product's secret. The reviewed configuration loader will reject missing production configuration rather than substituting test defaults.

Set `PORTAL_ENVIRONMENT=production`, `PORTAL_DEPLOYMENT=production`, and currently `BETTER_AUTH_URL=https://bneimitzvah.vercel.app`. Apply reviewed migrations, including the new host mapping, through the private operator runner before configuring runtime. Preview and local development require distinct explicit host mappings; a local origin must be loopback HTTP with a port, and is rejected by a production runtime. Google credentials may be omitted together while magic-link sign-in is prepared, but configured runtime still requires database, auth secret and mail settings. Missing providers are not an authentication bypass. The isolated browser harness uses synthetic data and does not establish live provider readiness.

After the routes and capabilities are complete, use Daniel's account to verify Google round-trip sign-in, delivered magic link, expired/replayed link rejection, logout, exact-host enforcement and explicit invite acceptance. After Daniel has a verified auth identity, run `node scripts/bootstrap-owner.mjs --confirm` from a private operator environment containing `DATABASE_MIGRATION_URL` and `BOOTSTRAP_OWNER_EMAIL`. The connection must directly own the portal tables and be permitted to assume the fixed `portal_runtime` role. The script uses a transaction-local CRC context, binds the initial owner identity in the append-only audit, and refuses a different identity or revival of revoked authority. Repeating it for the same active owner is idempotent. Remove `BOOTSTRAP_OWNER_EMAIL` from the private operator environment after success; neither bootstrap variable belongs in the deployed runtime. No public sign-in hook grants owner access. Other humans are not invited to test until the full product is feature complete and Daniel approves Phase 7.

The isolated SDK checks currently cover actual library handlers and local persistence. They do not establish Google authorization-code delivery, Resend delivery, DNS/TLS, deployed role flows or live Neon behavior. Record those results separately when configuration is available.

The HTTP adapter deliberately ignores caller-supplied IP and forwarding headers for authentication throttling. Until ingress normalization is independently verified, the SDK uses a server-selected bucket per configured origin: magic-link requests share five attempts per minute. This prevents header rotation from bypassing that limit, but can delay unrelated users. Before family access, validate the hosting platform's address-header trust boundary and replace or augment this conservative fallback with a reviewed limiter suitable for concurrent families. Do not describe the current bucket as per-client protection. Application request-URL logging is disabled; separately verify that hosting access logs redact invitation and authentication query strings.

## 6. Private owner grant/revoke commands

After genuine owner bootstrap, `scripts/manage-admin.mjs` provides private CRC
admin issuance/revocation. This is an operator tool, not an application route or
an admin invitation. These instructions prepare later operator execution; no real
authority has been changed by the synthetic tests.

Use a dedicated direct migration-owner connection in the private operator
environment (`DATABASE_MIGRATION_URL`). The command verifies direct ownership
before switching transaction-locally to the restricted role. A runtime login or
a masked `SET ROLE` connection is refused. Do not install this credential in
application runtime or pass it in command-line arguments.

Obtain the genuine bootstrap audit UUID, owner user ID and exact verified target
user ID through private database administration. Keep the selection and review
files in a trusted private directory outside this checkout, excluded from cloud
sharing, build inputs and logs. A grant selection is exactly:

```json
{"operation":"grant","tenantId":"crc","bootstrapId":"<bootstrap-audit-uuid>","ownerUserId":"<verified-owner-user-id>","targetUserId":"<exact-target-user-id>","targetGrantId":null}
```

For revocation, use `"operation":"revoke"` and the exact active admin grant UUID
in `targetGrantId`. No other role or tenant is supported. Replace placeholders
privately; these are shape examples, not usable identities.

```text
node scripts/manage-admin.mjs prepare --input <private-selection.json> --review <new-private-review.json>
```

Prepare makes no authority change. Privately inspect the review's exact owner,
target, membership state/revision and complete bounded admin-grant history. An
absent target membership will be created on grant. A previously revoked admin
grant remains revoked; confirmed regrant creates a new UUID. Disabled membership
is refused. Review files last ten minutes and are created exclusively; choose a
new filename for another preparation.

```text
node scripts/manage-admin.mjs apply --review <private-review.json> --confirm-digest <reviewed-64-character-digest>
```

Copy the digest only after reviewing that exact file. It confirms reviewed bytes
and does not authenticate the operator. Apply requires the same direct owner
capability and rechecks every identity, revision and history field under locks.
Any stale state requires a fresh prepare. A retried successful operation cannot
create another grant/audit. CLI output contains fixed status/error categories,
never the identities, connection or driver diagnostics.

The command never transfers ownership, revokes the bound owner's grant, restores
a revoked row/context, re-enables membership or recovers a disabled owner. Other
roles remain separate. Recovery requires a separately reviewed policy.

File checks reject checkout paths, existing output files, symbolic/junction
ancestors and linked inputs, and compare canonical parent locations/identities.
They cannot defend against malicious same-user filesystem renames between system
calls. Node's POSIX `0600` creation mode does not establish private Windows ACLs;
use an owner-only directory with trusted ACLs. Do not use shared or adversarially
writable directories. Keep private files outside Git and remove them when the
operator review is complete.
