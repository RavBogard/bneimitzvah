# Provider setup for Daniel's private testing

Status, 2026-10-16: canonical cutover is complete at https://beitmitzvah.centralreform.org on code bb2ddfd. Restricted Neon access, all 12 migrations, nine sensitive Production settings, exact-commit CI and the canonical native authentication transport canary are verified. Daniel confirmed both Google JavaScript origins. Daniel confirmed actual Google phone sign-in and his exact masked account; explicit CRC owner activation is verified. Refreshed workspace use and real Resend fallback acceptance remain pending. PROVIDER-RETURN.md records the completed gates. The temporary-origin instructions below are historical/rollback instructions, not outstanding provisioning.

## 1. Canonical host

Use `https://bneimitzvah.vercel.app` as the temporary production origin. Migration `0008_crc_vercel_production_host` adds that exact host to the existing CRC tenant, preserving the custom-domain mapping. Set `BETTER_AUTH_URL=https://bneimitzvah.vercel.app`; only that configured origin accepts authenticated requests. Arbitrary Vercel preview/sibling hosts are not production aliases, and neither forwarding headers nor another directory entry changes the selected origin.

Amended 2026-10-16, ruling 59: the target is now `https://beitmitzvah.centralreform.org`. Daniel's five CNAMEs and the canonical project-domain/TLS checks are complete; he reports the new canonical Google JavaScript origin added. Source migration `0011_crc_beit_production_host` adds only its exact production directory row, preserving both earlier rows for rollback. Apply and verify that reviewed migration privately before deliberately changing the single `BETTER_AUTH_URL`; no environment or live-database change is implied by this source milestone. Signing in again is required. Cookies, Google challenges, mail links and pending/review bindings remain bound to the selected origin. Authenticated previews require separate exact host mapping, synthetic database and secrets.

Only `PORTAL_ENVIRONMENT=production`, `PORTAL_DEPLOYMENT=production` and exact `BETTER_AUTH_URL=https://beitmitzvah.centralreform.org` activate canonical navigation. Then `barmitzvah`, `batmitzvah`, `bnaimitzvah`, `bneimitzvah` under `centralreform.org`, plus `bneimitzvah.vercel.app`, send page GET/HEAD navigation to fixed `https://beitmitzvah.centralreform.org/#home` with 303, private/no-store and no-referrer. The fixed harmless `#home` replaces inherited browser fragments; all incoming paths, queries and fragments are discarded. Pinned Next strips a literal empty `#` during redirect serialization, so an empty-fragment destination cannot enforce this policy. Alias `/api` requests and mutations return 404 before body/auth/runtime processing, without Location or cookies. These navigation aliases receive no new directory rows or API authority. Unknown wire hosts never redirect; forwarded metadata cannot select a navigation alias. Rollback to the earlier selected origin disables this navigation gate and retains its directory row.

Next's ordinary trailing-slash redirect is disabled so the proxy can apply this policy first. Pinned Next 16.4.2 still normalizes repeated slashes/backslashes before proxy. The reviewed exception covers malformed origin-form requests: a same-origin normalization can retain an attacker-supplied query, but the subsequent alias gate must discard it before any cross-origin navigation; malformed mutations must never reach authentication. App-generated auth links use clean paths and fragment/body transport. The separate bounded live raw-TLS review recorded only relative normalization Locations and no followed/off-origin connections; it does not establish every possible raw HTTP target or replace post-cutover alias/browser acceptance.

## 2. Google sign-in

Use the existing Google OAuth **Web application** client with Google Identity Services (GIS) Sign in with Google in popup/callback mode. Daniel confirmed on 2026-10-16 that public Google availability is intentional; do not switch it back to testing. Under **Authorized JavaScript origins**, the current stable origin is exactly `https://bneimitzvah.vercel.app`, without path or trailing slash. Daniel reports both that entry and the new canonical `https://beitmitzvah.centralreform.org` added; keep the stable entry for rollback. Observed Google behavior on the canonical origin remains a cutover acceptance gate. For local manual testing, register `http://localhost` and the actual configured `http://localhost:<port>`. JavaScript origins and Authorized redirect URIs are different fields. Existing callback-path entries do not establish JavaScript-origin permission or make another portal origin trusted; runtime selects exactly one through `BETTER_AUTH_URL`. Store client ID and secret privately as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. [Google GIS setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

The official Google button uses a server-created nonce prepared by `POST /api/auth/google/challenge`. Its callback submits the ID token, challenge ID and CSRF secret in a same-origin JSON body to `POST /api/auth/sign-in/social`. The server binds the challenge to the browser cookie and canonical origin, checks expiry, consumes it once under a database lock, then invokes the pinned Better Auth ID-token verification path in-process with the stored nonce. Only validated session cookies and a fixed local destination leave the adapter; SDK session-token JSON and diagnostics are discarded. No authorization code or token is returned to an app-owned callback URL. Public `/api/auth/callback/google` and `/api/auth/magic-link/verify` routes are retired, and the full SDK endpoint set remains unmounted. [Google GIS JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference).

The portal accepts families' Google accounts rather than requiring a CRC Workspace domain. A successful sign-in establishes identity only; it does not grant a congregation role or access to a child. Preserve verified same-email magic-link ↔ Google identity reuse and reject unverified/different-email linking. Explicit invitation acceptance remains separate. Keep the email fallback visible if Google scripts/popups are blocked; do not fall back to the retired code/query flow. Do not enable the console's AI-agent option for this ordinary portal sign-in. See `QUERY-FREE-AUTH-REVIEW.md` and `docs/superpowers/specs/2026-10-16-query-free-auth-design.md` for the reviewed contract.

## 3. Neon database

The portal has its own connected Neon project through Vercel. Daniel explicitly approved its existing Launch subscription on 2026-10-16; the earlier Free recommendation is superseded. Runtime database access must be Production-only. The integration may inject default connection variables; replace those with the restricted runtime login and remove unnecessary owner credentials before enabling the portal. Review the current plan and spending controls before creation. Any new charge or upgrade needs Daniel's approval. Keep migration credentials separate from runtime credentials and out of Vercel's runtime environment.

Apply the reviewed migrations as a dedicated owner. Create the application LOGIN role through SQL with no superuser, role-creation, database-creation, replication or RLS-bypass privilege. Grant it membership in the migration-defined `portal_runtime` privilege group only. It must own no application table and must not be able to assume the owner or an elevated role. Neon Console/CLI/API-created roles receive `neon_superuser` membership, so they are unsuitable as the unmodified application login. [Neon role management](https://neon.com/docs/manage/roles).

Store the restricted connection privately as `DATABASE_URL` and the separate owner connection as `DATABASE_MIGRATION_URL` for the operator migration runner only. Verify migrations, role attributes/membership, FORCE RLS, cross-tenant denial and transaction-local context on the actual Neon WebSocket driver before marking remote isolation accepted. Local PostgreSQL checks do not replace that transport check.

The runtime accepts a restricted Neon URL with `sslmode=require` and no additional connection options. Neon-generated URLs can include libpq options such as `channel_binding=require`; the pinned WebSocket driver does not enforce that requirement. Follow the reviewed runtime URL instructions in [`src/server/runtime/README.md`](../../../src/server/runtime/README.md), keeping the operator URL separate. If channel binding is required by deployment policy, resolve driver support before configuration rather than claiming it is enforced.

## 4. Resend magic links

Reuse the existing CRC Resend account. Daniel reports centralreform.live is Verified (2026-10-16); this is the selected candidate domain. Daniel reports click/open tracking appear off; preserve the shared CRC configuration. Sending capability and real delivery remain acceptance items before calling mail ready. A new account is unnecessary. If a new sending subdomain is needed, add the exact verification records shown by Resend and preserve the congregation's existing mail records. Confirm domain verification before delivery testing. Keep click/open tracking disabled for authentication messages. A subdomain can isolate transactional sending reputation. [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction).

Create a dedicated API key limited to sending on the chosen domain. Store it privately as `RESEND_API_KEY`, with the verified sender in `RESEND_FROM`. Resend supports permission and optional domain restrictions for keys. [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction).

Until then, local automated tests capture synthetic messages inside the test process. No production route may expose the capture transport, magic-link tokens or account inventory.

Canonical outward links are `/auth/email#token=…` and `/invitations/open#token=…` on the selected origin. Each isolated landing captures the fragment into lexical memory and immediately clears browser history before displaying its explicit confirmation button. No GET redeems a token or stages an invitation. Confirmation sends only a same-origin JSON body to `/api/auth/email/confirm` or `/api/invitations/open`; the magic-link adapter invokes the SDK verifier locally, while invitation staging creates the short-lived sealed HttpOnly pending cookie. Actual invitation acceptance still requires verified identity, review and its separate POST. No token is put in persistent browser storage or an outgoing request URL. Reopening the latest email recovers from reload/expiry; old query-token links must be reissued rather than converted after ingress.

## 5. Private configuration and acceptance

For PostgreSQL 16+, owner membership alone does not establish permission to `SET ROLE portal_runtime`; privately verify the separate SET capability before bootstrap. On this Neon project, the original creator membership had ADMIN true but INHERIT/SET false. The reviewed operator correction added only an owner-authored membership with ADMIN false, INHERIT false and SET true, preserving the original edge, all application memberships and all role attributes. This correction and the confirmed CRC owner activation are complete; do not repeat them as provisioning steps. See QUERY-FREE-AUTH-REVIEW.md and PostgreSQL's [role membership options](https://www.postgresql.org/docs/17/sql-grant.html).

Put secrets directly into the appropriate local ignored environment file or Vercel environment settings. Never paste credentials, database URLs, cookies, magic links or personal account details into chat, Git, screenshots or logs. Create a unique strong `BETTER_AUTH_SECRET` privately; do not reuse another product's secret. The reviewed configuration loader will reject missing production configuration rather than substituting test defaults.

Set `PORTAL_ENVIRONMENT=production`, `PORTAL_DEPLOYMENT=production`, and currently `BETTER_AUTH_URL=https://bneimitzvah.vercel.app`. Apply reviewed migrations, including the new host mapping, through the private operator runner before configuring runtime. Preview and local development require distinct explicit host mappings; a local origin must be loopback HTTP with a port, and is rejected by a production runtime. Google credentials may be omitted together while magic-link sign-in is prepared, but configured runtime still requires database, auth secret and mail settings. Missing providers are not an authentication bypass. The isolated browser harness uses synthetic data and does not establish live provider readiness.

After implementation review, required local/CI checks and the deployed harmless hosting canary below pass, use Daniel's account to verify the actual GIS popup/body sign-in, delivered fragment magic link with explicit confirmation, expired/replayed link rejection, logout, exact-host enforcement and explicit invite acceptance. Verify blocked/cancelled popup recovery through the visible email fallback and that no app-owned request URL carries credentials. Acknowledged logout expires the Google binding cookie and invalidates late UI callbacks; it cannot cancel a POST already in flight with captured cookies. After Daniel has a verified auth identity, run `node scripts/bootstrap-owner.mjs --confirm` from a private operator environment containing `DATABASE_MIGRATION_URL` and `BOOTSTRAP_OWNER_EMAIL`. The connection must directly own the portal tables and be permitted to assume the fixed `portal_runtime` role. The script uses a transaction-local CRC context, binds the initial owner identity in the append-only audit, and refuses a different identity or revival of revoked authority. Repeating it for the same active owner is idempotent. Remove `BOOTSTRAP_OWNER_EMAIL` from the private operator environment after success; neither bootstrap variable belongs in the deployed runtime. No public sign-in hook grants owner access. Other humans are not invited to test until the full product is feature complete and Daniel approves Phase 7.

The isolated SDK/PostgreSQL checks cover actual library verification, persistence and challenge contention. They do not establish a genuine Google GIS round trip, Resend delivery, DNS/TLS or deployed role flows. Record provider results separately; verified Neon setup is recorded in `PROVIDER-RETURN.md` and does not by itself establish authentication readiness.

The HTTP adapter deliberately ignores caller-supplied IP and forwarding headers for authentication throttling. Until ingress normalization is independently verified, the SDK uses a server-selected bucket per configured origin: magic-link requests share five attempts per minute. Google challenge issuance also has database-backed exact-origin and browser-binding budgets. This prevents header rotation from bypassing the shared limits, but can delay unrelated users. Before family access, validate the hosting platform's address-header trust boundary and replace or augment this conservative fallback with a reviewed limiter suitable for concurrent families. Do not describe the current origin bucket as per-client protection.

Application request-URL logging is disabled, but the harmless canary recorded in `PROVIDER-SECURITY-REVIEW.md` proved that native Vercel request metadata retains query parameters. Source-side logging suppression or rejecting a legacy query route cannot remove the ingress copy. The fragment/body transport is the repair; before real authentication acceptance, run a harmless fragment/body/cookie canary against the matching deployed implementation and inspect raw native request metadata for secret absence, including URL, body and cookie fields. Projected CLI output alone is insufficient. Hosting acceptance remains unclaimed until that observation passes; do not send real sign-in credentials through the retired query routes.

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
