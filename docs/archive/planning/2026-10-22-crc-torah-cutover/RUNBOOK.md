# Runbook: switching the canonical origin to torah.centralreform.org

A copy of section 4.3 of [the 1.5 plan](../../superpowers/plans/2026-10-22-installable-sign-in-code-cutover.md#43-runbook-in-order). The plan, its 2026-10-23 rulings and its section 4.2 hazards govern; if this copy and the plan ever disagree, the plan wins.

The code that makes this a configuration switch is `src/lib/navigation/canonical.ts`: `CANONICAL_ORIGINS` holds beitmitzvah and torah, and production `BETTER_AUTH_URL` selects one. The other becomes a navigation alias. The switch and the rollback are Daniel setting `BETTER_AUTH_URL` and a redeploy; no code change, no migration.

## Phase 0: prerequisites (can be days earlier)
1. The front-door branch is merged; 0034 and 0035 are applied with the guarded operator. Verify `tenant_host` has a torah row: `crc`, `production`, `production`, origin `https://torah.centralreform.org`.
2. The C code PR is merged and deployed. Probes:
   - `beitmitzvah /` gives 200;
   - `torah /` gives 303 to `https://beitmitzvah.centralreform.org/#home`;
   - every alias gives 303 to beitmitzvah;
   - `POST /api/mcp` on beitmitzvah gives 401.
3. Daniel's named helper reports "torah steps done" (FORWARD-STEPS.md).

## Phase 1: preflight probes (the day of the switch; each must pass)
1. **DNS:**
   - `nslookup -type=CNAME torah.centralreform.org 1.1.1.1` and the same against `8.8.8.8` show `cname.vercel-dns.com`;
   - an A lookup resolves to Vercel;
   - `nslookup -type=CAA centralreform.org` shows no CAA record, or one that allows `letsencrypt.org`.
2. **Vercel** (MCP or `vercel domains inspect torah.centralreform.org`): the domain is verified, assigned to this project's **Production**, its certificate is issued, and no domain-level redirect is set on any of the six hosts.
3. **TLS:** `openssl s_client -connect torah.centralreform.org:443 -servername torah.centralreform.org` gives verify code 0 with the host in the SAN. `curl -sSI https://torah.centralreform.org/` gives the 303 to beitmitzvah, which proves it routes into our project.
4. **Google redirect URI:** take the client ID from `POST /api/auth/google/challenge`; it's public, but don't paste it into logs.
   - Request `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=https%3A%2F%2Ftorah.centralreform.org%2Fapi%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid&state=probe` without following redirects. It must not return the 400 `redirect_uri_mismatch` page.
   - Control: the same request with `/callback/nope` must return the mismatch, which proves the probe can tell the difference.
5. **Google JavaScript origin** (best-effort, inferred): `https://accounts.google.com/o/oauth2/iframerpc?action=checkOrigin&origin=https%3A%2F%2Ftorah.centralreform.org&client_id=…` with `X-Requested-With: XmlHttpRequest` should return `{"valid":true}`, with a bogus origin as control.
   - Google says console changes can take hours to apply. If this fails, wait.
   - The binding check is Daniel's live sign-in in Phase 2.
6. **Production read-only counts:** unexpired pending invitations = 0; live honoree links = 0; pending `notification_delivery` = 0.
7. **Baselines:** the cron host and status, and the firewall rule `rule_public_reading_rate_limit_4G2hTb` is path-only, with no host condition.
8. **Main is green and nothing is queued to merge.** Log `GATE: merge freeze for canonical switch`.

## Phase 2: the window (about 30 minutes)
1. **Daniel:** Vercel, Project, Settings, Environment Variables, Production: `BETTER_AUTH_URL = https://torah.centralreform.org`, exactly, with no trailing slash. This does nothing until the redeploy.
2. **Redeploy production** (Vercel Redeploy of the current production deployment, which rebuilds with the new env). The agent may do this; Daniel sets the env himself.
   - The redeploy must be a real rebuild, not a promotion of an old build: `/sw.js` is built once per deploy (N24, #113), so its origin list is fixed at build time from `BETTER_AUTH_URL`, `PORTAL_ENVIRONMENT` and `PORTAL_DEPLOYMENT`. Probe: `GET https://beitmitzvah.centralreform.org/sw.js` gives 200 (not 303) and its body is the tombstone (it clears the `crc-` caches and unregisters), so a worker installed there before the switch removes itself and the packs stored with it.
3. **Automated post-switch probes:**
   - `torah /` gives 200; `/read` gives 200 with `X-Robots-Tag: noindex, nofollow`; `/robots.txt` says `Disallow: /`.
   - Each of `beitmitzvah`, `barmitzvah`, `batmitzvah`, `bnaimitzvah`, `bneimitzvah`, `bneimitzvah.vercel.app`: `GET /read?x=1` gives 303 with Location exactly `https://torah.centralreform.org/#home` and `private, no-store`; `GET /api/session` gives 404; `POST /` gives 404.
   - `torah /api/public/reading?date=<this Shabbat>` gives 200 JSON. A known short-v1 clip gives 200 `audio/mpeg` with `x-reference-license`.
   - `/.well-known/oauth-protected-resource/api/mcp` shows `resource: https://torah.centralreform.org/api/mcp` and `authorization_servers: ["https://torah.centralreform.org"]`; `/.well-known/oauth-authorization-server` shows issuer torah.
   - `POST /api/mcp` gives 401 with `WWW-Authenticate … resource_metadata="https://torah.centralreform.org/.well-known/oauth-protected-resource/api/mcp"`.
   - Vercel runtime logs show no burst of `runtime.unavailable` 503s.
4. **Daniel, live sign-in:** Google popup on desktop, Google redirect on his phone, an email link (the link host must be torah), and the code (if B has shipped).
5. **Daniel, Claude:**
   - remove the old "CRC B'nei Mitzvah" connector;
   - add the custom connector `https://torah.centralreform.org/api/mcp`;
   - sign in with Google and approve, including `portal:roster` if wanted (the 15-minute freshness rule applies to adding tutors);
   - run one `list_students` call.
   - Then revoke the old connection rows on `/workspace/claude`.
   - Reconnect any Cowork routine that used the old connector.
6. **The next cron runs** show the same status as the baseline.
7. **Docs PR** (`[skip ci]`):
   - STATE gets a GATE line;
   - MISSION ruling 23 gets a dated note that the canonical is torah;
   - FORWARD-STEPS is marked done.
   - Tag after the 1.5 slices.

## Rollback (triggers: torah sign-in failing, lasting 503s, or MCP broken even after reconnecting)
- **Fastest:** Vercel Instant Rollback to the production deployment from just before the switch. It was built with `BETTER_AUTH_URL = beitmitzvah` and contains the two-origin code. Then Daniel sets `BETTER_AUTH_URL` back to beitmitzvah so later deploys agree, and undoes the rollback lock when ready.
- **Or:** set the env back and redeploy. The code handles both origins.
- No database step. DNS and the Google entries stay, and they're harmless.
- Anyone who signed in on torah signs in again on beitmitzvah. Claude reconnects to the beitmitzvah URL.

### Rolling back code after migration 0052 (1.9 N23, practice visibility)
- Code from before 0052 is safe to run against the migrated database, but it does not name a mark's source. When a mark changes state, 0052's trigger stamps a new instant and keeps the previous source.
- So if a parent's child-practice mark is followed by the student's own mark made on pre-0052 code, that later mark reads as "with parent" (and is dated the day of the change). Nothing else is affected.
- After such a rollback, roll forward before the release gate (`PRACTICE_VISIBILITY_FROM`) is opened. If the gate is already open, tell the tutors that "with parent" may be wrong for marks changed during the rollback window. The window can be found from the deployment times; no data needs changing.
