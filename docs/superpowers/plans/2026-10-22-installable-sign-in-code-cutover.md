# 1.5 plan: installable app (A), typed sign-in code (B), and the move to torah.centralreform.org (C)

## Changes from Daniel's 2026-10-23 rulings (binding, supersede the text below)

Source: `docs/planning/2026-10-23-cowork-offload/QUESTIONS.md` (Daniel's answers) and `HANDOFF-TO-CLAUDE-CODE.md` (the mapping). Research: `docs/superpowers/research/2026-10-23-cowork-offload/`. Where a section below conflicts with this list, this list wins. Lines marked "Decided here" are mine, logged for STATE, following the research unless a ruling conflicts.

### Rulings, by section

- **§2.2 (settings), A3.** Unchanged: 6 digits, numeric, 5-minute expiry, 3 attempts. Daniel chose "Use this version (Recommended)".
- **§2.3 item 3 (mail transport) and §10 item 1, A3.** The plain-text body is exactly these five lines, in this order, with `{link}` and `{code}` filled in:
  1. `Open this link to sign in: {link}`
  2. `Or enter this code in the CRC Torah app: {code}`
  3. `The link and the code work once, for 5 minutes.`
  4. `No one from CRC will ever ask you for this code. Don't read it to anyone or type it anywhere but CRC Torah.`
  5. `If you did not request this message, you can ignore it.`

  Line 3 drops "Don't share the code with anyone."; line 4 is new. "CRC Torah" in lines 2 and 4 is `{productName}` (E1). Format rules from `sign-in-codes.md`: render the code alone on one line, and it is the only 6-digit number in the email; no digits in the subject; no WebOTP `@host #code` line (it is defined only for SMS). The §6.1 test "the code isn't in the subject" extends to "the body holds exactly one 6-digit number".
- **§2.4 (client) and §10 item 1, button.** The installed-app button label stays `Email me a sign-in link`. The "sign-in code" label option is not used.
- **§2.8 item 5 (relay phishing).** The defence is now line 4 above plus the 5-minute expiry. Say so in the reviewer notes.
- **§3.3 (packs) and §3.4, F3.** Add a public pack, "Learn to lein course": the lessons JSON plus every lesson clip, owner `public`, same 14-day rule, same renewal and purge. The Learn to lein routes join the worker allowlist (§3.2) on the same terms as the reading pack, and the G3 guard (§3.7) applies unchanged: only human reference clips can enter it. Course progress saved to the account syncs when the app is back online; progress for a signed-out visitor is not stored. Add the pack's size to the §3.3 table and the §3.5 budget check; add tests to §6.1 and §6.2 (open the course offline, finish a lesson, reconnect, progress arrives).
- **§3 (scope), B6.** No parent offline view of a child in 1.5. Tutor, admin and parent keep the empty owner list (§3.3 table). §10 item 4 is answered.
- **§3.8 (manifest and icons), B5 and E1.** The icon is Daniel's option 2, the yad. Draw it from `icons/ICON-OPTIONS.md` and `icons/option-2-yad.svg`, with strokes as drawn or heavier, never thinner (it is the thinnest of the four at 48 px). `name` and `short_name` come from `productName` (CRC's value "CRC Torah"); the manifest route is no longer a fixed string. §10 item 3 is answered.
- **§3.8, `apple-touch-icon`.** Also serve a static, opaque 180 px `/apple-touch-icon.png` at the site root on the torah host (see Findings 4).
- **§3.9 (screens), B4 and E1.** Replace the five strings with these. `CRC Torah` is `{productName}` everywhere.
  - Install hint: `Install CRC Torah on this device to keep this week's reading and recordings for use offline (up to about 40 MB).`
  - iPhone steps: `In Safari, tap Share, then scroll to Add to Home Screen. If you don't see Share, tap the menu button next to the address bar first. Keep Open as Web App on, then tap Add.`
  - iPad steps: `In Safari, tap Share, then View More, then Add to Home Screen. Keep Open as Web App on, then tap Add.`
  - Pill: `Offline · saved until {date}` (no final period).
  - Expiry: `Saved readings stay on this device for 14 days after you last opened CRC Torah online. Open it with a connection to renew them. If the device runs low on space, it may remove them sooner.`

  The single iOS line becomes two: iPhone and iPad, chosen by platform detection (`maxTouchPoints > 1` for iPad). The 14 days run from the last successful online open (the renewal in §3.3).
- **§4.3 Phase 2 probe, §4.4, and the beta-tag step, F2.** The switch window is not the beta tag, so the probes (`X-Robots-Tag: noindex, nofollow`, `Disallow: /`) stay as written. Add a step to the 1.5 beta-tag release: `/read`, `/learn` and `/trope-chart` drop the noindex header and the robots `Disallow` for those paths; signed-in pages and workspaces keep both. Add a test that pins this list.
- **§6.4 (device check), C9.** Daniel's check is on Android (Chrome), using `PHONE-CHECK.md`. The iPhone steps in §6.4 stay as a checklist for whoever has an iPhone; the iOS strings are not blocked on it.
- **§10, answered.** Items 1 (A3), 2 (B4), 3 (B5), 4 (B6) are closed. Item 5 stays his.

### Popup rulings, 2026-10-23 (relayed after the list above; binding)

- **F2, the beta tag is v1.5.0.** The noindex flip for `/read`, `/learn` and `/trope-chart` ships with the v1.5.0 tag, not earlier. Section 4.3's switch-window probes stay noindex.
- **Section 3.9 install hint, replaces the "When" line.** Shown once to anyone on a phone or tablet, signed in or not, on the torah origin and not already installed. Once dismissed it stays dismissed (this replaces the 90-day "Not now"), and it is always available from the menu (Account and the app menu keep an Install entry). Never on reading pages, never as a modal.
- **Analytics.** Aggregate, cookieless page counts on public pages only; no per-person data; nothing on signed-in pages. It goes in its own small batched PR, after a check that Vercel Web Analytics costs nothing extra on the current plan; if it would, stop and ask Daniel. Log the check as a GATE line.
- **Learn's tap exercises (for the 1.6 activities and the current drills).** A tap answers while the question is open and plays no audio; once answered, any word opens its word card.
- **Order.** 1.5, then 1.6 (look-alikes, which half, quick ten), then the voice track M0. No family pilot until Daniel says when; announcements wait for it.

### Findings settled here ("Decided here")

From `pwa-offline.md`:
1. **Open as Web App off.** The worker registers only in standalone mode (§3.1), so a Home Screen add with the toggle off is a bookmark with no worker and WebKit's 7-day rule. Decided here: the B4 strings say "Keep Open as Web App on"; no code change, and device check step 1 records the toggle.
2. **`persist()`.** Decided here: call `navigator.storage.persisted()` on every open of the installed app and `persist()` again when it is false, instead of once after the first pack (§3.5).
3. **Android install prompt.** `beforeinstallprompt` needs a tap plus about 30 seconds. Decided here: when the event has not fired on Android, show a text fallback beside the hint: "In Chrome, open the menu and tap Install app or Add to Home screen." Check Chrome's exact menu label on the device. The wording is the research report's, not Daniel's: it is the only new user-visible text in this list, so build it behind one string constant and list it as an open wording item for Daniel.
4. **iOS icons.** `apple-touch-icon` overrides manifest icons and maskable icons are ignored. Decided here: serve the static opaque 180 px `/apple-touch-icon.png` (still generated at build time from the yad shapes, no binary in the repo) and keep the client-injected link too.
5. **Cookies.** Since iOS 17.2 the login cookie is copied into the installed app once at install, so §3.5's "separate from Safari" is only partly true. Decided here: reword §3.5 accordingly, keep B (the code) as the sign-in path for every later sign-in, and add to device check: sign in in Safari first, then add, and record whether the app arrives signed in.
6. **Old Home Screen app.** Some families may already have a beitmitzvah Home Screen app. Decided here: the §4.4 cutover message adds "If you added the old address to your Home Screen, delete it and add the new one." No worker risk, because the registration gate holds.
7. **Size.** Decided here: the hint says "up to about 40 MB", matching the plan's 35 to 40 MB for double parashiyot.
8. **Quota and eviction.** Confirmed: the `min(0.8 × quota, 300 MB)` budget, whole-origin eviction, the blob playback, the separate maskable icon and no Background Sync stand as written.

From `sign-in-codes.md`:
9. **Mail suggestion in a Home Screen app.** Whether Mail offers an emailed code to a Home Screen web app is undocumented. Decided here: ship the typed field (`autocomplete="one-time-code"`) regardless; `PHONE-CHECK.md` tests it on Android now, and an iPhone result goes in STATE when someone has one. Nothing in the design depends on the answer.

---

Everything below comes from reading `C:/Users/dsbog/bneimitzvah-study` (local `main` at 8b0bea7). `origin/main` is at b233428, which adds only docs commits, so executors should branch from `origin/main`. I also read the branch `origin/claude/crc-torah-front-door` (0a0464c, 8c3e58b) and the pinned Better Auth 1.7.10 source in `node_modules`. I changed nothing.

## 0. The short version and the order

**Do them in this order: B, then C's code PR, then the C switch window, then A1, then A2.**

- **A must not ship before the switch.** A service worker installed on beitmitzvah would be stuck there after the switch:
  - The alias redirect (`canonical.ts:30-34`) sends every non-API GET, including `/sw.js`, cross-origin with a 303.
  - A redirected service-worker script fails its update check, so the old worker stays forever.
  - An installed beitmitzvah app would then open torah outside its own scope.
  - A1 and A2 may merge before the window only because the manifest link and the worker registration are gated on the torah origin (§3.1). Device testing has to wait for the switch either way.
- **Change the cutover from the PLAN outline.** The outline flips the hard-coded constant together with the env var. Instead, C becomes a small code PR that lets the env var choose between two hard-coded CRC origins.
  - The PR is inert when merged.
  - The switch is then Daniel setting `BETTER_AUTH_URL` and a redeploy.
  - Rollback is the same move in reverse.
  - This removes the 503 window described in §4.1.
- **No migration is needed for A or B.**
  - B uses Better Auth's own `emailOTP` plugin, which is already in the pinned `better-auth` 1.7.10. Its codes live in the existing `verification` table, which already has `SELECT, INSERT, UPDATE, DELETE` for `portal_runtime` (`0002_tenant_security.sql:18`).
  - A keeps all of its state on the device.
  - If the auth reviewer insists on a portal-owned code table instead (§2.9), it takes the **next free migration number** after 0035 and whatever 1.4 adds.

---

## 1. What the code says (the load-bearing facts)

| Fact | Where | Consequence |
|---|---|---|
| `CANONICAL_ORIGIN` is a hard-coded constant. Redirects work only when `BETTER_AUTH_URL === CANONICAL_ORIGIN` in production. | `src/lib/navigation/canonical.ts:2,10-12` | Changing the env var alone turns redirects off. |
| Any request whose resolved origin isn't `config.origin` throws `RuntimeUnavailable`, which becomes a 503. | `src/server/runtime/composition.ts:210-214`, `:235`, `:247-248` | This is the "503 on beitmitzvah" hazard. |
| Every derived signing key includes the origin, via `purposeSecret(...${config.origin}:${purpose})`. | `composition.ts:77-78` | The switch rotates every purpose key: MCP client registrations (`:194`), unsubscribe tokens (`:136`), Google challenges (`:208`), the session UI binding (`:205`) and the preparation signatures. |
| MCP issuer, resource, authorize and token URLs come from the origin, and pending consents check `resource`. | `src/server/mcp/oauth.ts:63-74`; `src/server/mcp/service.ts:150-151,199,233` | The existing Claude connector breaks. Its URL is also an `/api` path on what becomes an alias, so it gets a 404 (`canonical.ts:30`). |
| `trustedOrigins: [origin]`, `crossSubDomainCookies` off, `__Secure-` host-only cookies, 7-day sessions. | `src/server/auth/factory.ts:31,41,61` | Everyone signs in again once after the switch. |
| Magic links are 32 letters, expire in 300 s, are stored hashed and are single-use. The email link is `${origin}/auth/email#token=`. | `factory.ts:65`; `src/server/mail/transport.ts:16,23-33`; Better Auth `magic-link/index.mjs:89,98,164-168` | Links sent before the switch die within 5 minutes. The alias redirect replaces the fragment with `#home` (`canonical.ts:31-34`). |
| **Every magic-link request shares one rate-limit bucket.** The synthetic IP is derived from the origin only, and the plugin allows 5 per 60 s. | `src/server/http/auth.ts:83-84,198`; `magic-link/index.mjs:210-216` | This is an existing global limit on how many codes can be issued. Route the new code check through a per-binding bucket, or 3 bad tries a minute would lock out everyone. |
| The clip route accepts only an origin in `PRODUCTION_ORIGINS` and an exact Host. It refuses `Range` with a 416, sends `accept-ranges: none`, and marks clips immutable for a year. | `src/server/reference-audio/public-short.ts:51,27-31,57,112-113` | Offline playback never needs range handling (see §3.6). The front-door branch already adds torah to `PRODUCTION_ORIGINS`. |
| The player downloads whole clips with `mode:"same-origin"`, `cache:"force-cache"`, checks `response.url === url`, then checks SHA-256 and plays from a `blob:` URL. | `src/lib/reference-audio/short-playback.ts:29-30,43`; `playback.ts:151,286` | A cached response must keep its original URL. Store the network `Response`; don't build a new one. |
| The public reading routes are GET-only, keyed by date, CDN-cached (`max-age=300`, `s-maxage` 3600/86400), and refuse Range and Authorization. | `src/server/http/public-reading.ts:25-31,46-51,84-85` | Safe to cache whole. They are keyed by date only, so A2 needs 1.3's ref-keyed routes. |
| The private student endpoints are `no-store` and per student. | `src/components/portal/workspace/study/api.ts:114`; `short-reference-api.ts:63` | Never cache them (MISSION open item). |
| The session summary already holds an HMAC binding that includes `authSessionId`. | `src/server/portal/service.ts:45-47` | Too unstable to identify a pack's owner, so A2 adds its own owner key. |
| There is one client sign-out call site. | `src/components/portal/entry.tsx:65` | The purge hook goes here. |
| The browser test harness blocks service workers. | `tests/http-browser/browser.test.ts:15` (`serviceWorkers: "block"`) | Keep that. The new offline suite allows them. |
| `scripts/release-migrate-support.mjs:100` pins `canonicalOrigin === beitmitzvah`, but the operator is frozen at `RELEASE_BASE` 4ad7e0c with a 19-entry journal (`:7,9,80`). | | **Leave it alone.** It checks the beitmitzvah host row, which stays. Editing it breaks its self-check against the pinned commit and changes nothing about the switch. This differs from the PLAN outline. Log it in "Decided here". |
| On the front-door branch, torah is a navigation alias and in `PRODUCTION_ORIGINS`, and 0034 inserts its `tenant_host` row. | branch `canonical.ts` (alias list), `config.ts:28`, `0034_crc_torah_production_host.sql` | C needs no migration. |

---

## 2. (B) The typed one-time sign-in code

### 2.1 Design

One email carries both the existing link and a 6-digit code.

- The code comes from Better Auth's `emailOTP` plugin, using its server-only `createVerificationOTP` (`email-otp/routes.mjs:122-145`).
- It is called inside the existing `sendMagicLink` callback, so the portal still sends one email through its own transport.
- Typing the code goes through a new portal route that calls the plugin's `/sign-in/email-otp`. That endpoint handles hashing, the attempt limit and the atomic single use for us (`routes.mjs:386-415`, `atomicVerifyOTP :770-790`, `consumeVerificationValue` in `db/internal-adapter.mjs:802+`).
- The code-entry request carries **no email**. The email comes from a sealed, HttpOnly, path-scoped cookie set on the device that asked for the code. This blocks enumeration and cross-account guessing, and the browser never holds the address.

### 2.2 Settings (decided here, overridable by the reviewer)

- 6 digits, numeric keypad. iOS fills `autocomplete="one-time-code"` from Mail.
- 5-minute expiry, the same as the link. The landing page's 300000 ms timer (`fragment-landing.ts:34`) stays.
- 3 attempts per issued code (`allowedAttempts: 3`).
- **Storage:** `storeOTP: { hash: otp => HMAC-SHA256(purposeSecret("sign-in-code"), otp) }`. The plugin's built-in `"hashed"` option is plain SHA-256, and a 6-digit SHA-256 can be reversed from a database copy in under a second.
- **Sign-up parity:** `disableSignUp` must equal the magic-link plugin's setting (both `false` today). A test enforces this so 1.4 can't let them drift.
- **Guessing bound:** at most 3 guesses per issued code. Each issuance sends an email to the victim and passes the global 5/min magic-link bucket. That gives at most 3×10⁻⁶ per issued code. A sustained attack would block every sign-in email, so it would be noticed long before it succeeded. If the reviewer wants more margin, going to 8 digits changes one constant and one regex.

### 2.3 Server changes

1. **`src/server/auth/factory.ts`**
   - Add `codeSecret: string` to `AuthStackInput`.
   - Add the plugin next to `magicLink` (`:65`):
     ```ts
     emailOTP({ otpLength: 6, expiresIn: 300, allowedAttempts: 3, disableSignUp: false,
       storeOTP: { hash: async otp => createHmac("sha256", input.codeSecret).update(`sign-in-code:v1:${otp}`).digest("base64url") },
       sendVerificationOTP: async () => { throw new Error("unused: codes travel inside the magic-link email") } })
     ```
   - The plugin's other endpoints (send-verification-otp, check-verification-otp, verify-email, password reset, email change) stay unreachable because the dispatcher only routes allowlisted paths (`auth.ts:13-21`; `dispatch.ts:69-72`). A test checks each one returns 404.
   - The session-create hook (`factory.ts:44-59`) gives code sessions no `googleAuthenticatedAt` (path `/sign-in/email-otp`), so a code session can't approve MCP. That matches magic-link sessions.
2. **`src/server/runtime/composition.ts:149-151`**
   - Pass `codeSecret: purposeSecret(config, "sign-in-code")`.
   - `sendMagicLink` becomes: `async ({ email, url, token }) => { const code = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } }); await send("magic-link", { email, url: projectMagicLink(url, token, config.origin), code }); }`.
   - If creating the code fails, the request fails closed with no email sent.
3. **`src/server/mail/transport.ts`**
   - The `magic-link` message gains `code`, validated as `/^\d{6}$/`.
   - Plain-text body: link, then code, then the 5-minute and don't-share lines. The exact wording is Daniel's (§10).
   - The code goes in the body only, never the subject, so it doesn't show on lock screens or in provider subject logs.
4. **New `src/server/http/sign-in-code-binding.ts`**: seal and unseal the binding.
   - AES-256-GCM, with the key `sha256(purposeSecret("sign-in-code-binding"))`.
   - Payload `{v:1, e:<lowercased email>, x:<expiry ms>}`, encoded as base64url(iv‖ct‖tag).
   - Cookie: `__Secure-portal-code=…; Path=/api/auth/sign-in/code; HttpOnly; Secure; SameSite=Strict; Max-Age=300`. On http loopback it drops the prefix and `Secure`, as `returnCookie` does at `auth.ts:45-46`.
5. **`src/server/http/auth.ts`**
   - Add `"/api/auth/sign-in/code": ["POST"]` to `methods` (`:13-18`).
   - The magic-link branch (`:195-203`) appends the binding cookie when the SDK returns 200, with the same response for every address.
   - The new branch:
     - Runs `requireCookieMutation`. `X-Practice-Context` is already refused at `:174`.
     - Requires a closed body `["code"]` matching `/^\d{6}$/`.
     - Reads exactly one binding cookie (duplicates are already refused by `cookieBoundary`, `dispatch.ts:28-39`) and unseals it. Missing, tampered or expired gives a 400 `{error:"expired"}`.
     - Calls the SDK at `/api/auth/sign-in/email-otp` with `{email, otp}` through `sdkRequest`, with **bucket `code:<sha256(cookie)>`**, so each binding gets its own 3/min limiter, following the Google-callback precedent at `auth.ts:81-84,129`.
     - Maps the result:
       - 200 sets the SDK cookies, clears the binding, and returns `{ok:true, next}`. `next` uses the same `callback` logic (`:194`, `/invitations/accept` or `/`).
       - `INVALID_OTP` returns 400 `{error:"code"}` and keeps the binding.
       - `TOO_MANY_ATTEMPTS` or `OTP_EXPIRED` returns 400 `{error:"expired"}` and clears the binding.
       - 429 returns `rate-limited`.
       - Anything else gets the generic error.
     - No response includes the email.

### 2.4 Client changes

- **`src/components/portal/api.ts:74-75`**: add the endpoint.
- **`src/components/portal/entry.tsx`** (the "Check your email" view at `:112`):
  - Add a code form: one input with `inputMode="numeric"`, `autoComplete="one-time-code"`, `pattern="\d{6}"`, `maxLength={6}`, then a Sign in button. On success, `location.replace(next)`.
  - The form shows in every context, which also fixes "the link opened on a different device".
  - Store only a timestamp, `localStorage["crc.signin.code-requested-at"]`, so an iOS Home Screen app that relaunches while you were in Mail reopens on the code form within 5 minutes.
  - The code is never stored, never put in a URL, and the input is cleared after submit.

### 2.5 Using a code after the switch

The binding cookie is host-only and its key includes the origin. A code requested on beitmitzvah fails on torah, and the person asks again. This only affects the 5-minute window.

### 2.6 Rejected for B

- **A portal-owned table that maps the code to the magic-link token.** It would store a recoverable credential, need custom crypto and a migration, and fall entirely on the reviewer. The pinned plugin already does attempt counting atomically.
- **Making the user type the email next to the code, with no binding.** That lets anyone fire guesses at whatever code is outstanding for any address.
- **A pre-check hash of the code inside the binding.** It adds nothing: success already requires that the typed code equals the latest code for that email, and a pre-check would itself be a guessing oracle unless failed checks also counted.
- **Putting the code in the subject line.**
- **8 digits.** Kept as the reviewer's option.

### 2.7 Accepted, stated for the reviewer

- The link and the code are two independent single-use credentials from the same email. Using one doesn't burn the other during its 5 minutes.
- "Latest code wins." A second request replaces the first code, and typing the older code uses up an attempt.
- Asking for codes for someone else's address cancels their earlier code. That's the same as the existing ability to spam them with links, and the global limit caps it.

### 2.8 B threat list for the auth reviewer

1. **Brute force:** the 3-per-code bound under concurrency. Check that the drizzle adapter's `consumeOne` is one atomic statement across serverless instances, not only the in-process lock.
2. **Cross-account or enumeration:** the route takes no email; error bodies and status are the same whether or not the account exists; sign-up parity with the link; timing of unseal plus the database round trip.
3. **Binding cookie:** AEAD integrity, path, SameSite and host-only scope, expiry, and that replaying a binding grants no extra attempts. Attempts belong to the code, not the cookie.
4. **CSRF and login-CSRF:** `requireCookieMutation` (Origin equals the canonical origin, `Sec-Fetch-Site: same-origin`; `mutations.ts:9-13`). Confirm a cross-site page can't sign a victim into the attacker's account.
5. **Relay phishing ("read me the code"):** binding doesn't stop it. The defenses are the email wording and the 5-minute expiry. Say this explicitly.
6. **Codes in logs or URLs:** POST body only; `logging.incomingRequests:false` (`next.config.ts:11`); Better Auth logger disabled (`factory.ts:64`); closed logger; Resend keeps the body, as it already does for links. Check that no client code puts it in storage or analytics.
7. **Storage:** HMAC keyed by a purpose secret, not plain SHA-256. Rows expire and are cleaned up (`internal-adapter.mjs` find path).
8. **Plugin endpoints:** every `email-otp` endpoint other than the one we use returns 404 through the dispatcher.
9. **Session properties:** no `googleAuthenticatedAt`; fresh-age behavior; can't approve MCP.
10. **Rate limiting:** per-binding buckets can't drain the global magic-link bucket. Note the **existing** finding: all magic-link requests share one 5/min bucket. That's out of scope here, but the reviewer may want it recorded.
11. **Invitations:** a pending invitation only changes `next`; the code never accepts an invitation by itself.
12. **Installed app versus browser cookie jars on iOS:** the code binds to the jar it was requested from. That is intended.

### 2.9 Migration

None. If the reviewer rejects the plugin approach, the fallback is a `sign_in_code` table (hashed binding, HMAC'd code, attempts, expiry, RLS forced, runtime `SELECT/INSERT` plus column `UPDATE(attempts, used_at)`) at the **next free number**. I don't recommend it.

---

## 3. (A) Installable app, 14-day offline reading and reference audio

### 3.1 Architecture

**A hand-written service worker, no library.**

- The worker's source is `src/offline/service-worker.js`: plain JS, no imports. Tests load it into `node:vm`.
- It is served by `src/app/sw.js/route.ts` (`dynamic = "force-static"`), which adds a header at build time:
  - `const BUILD = <VERCEL_GIT_COMMIT_SHA ?? "dev">`
  - `const ENABLED = <PORTAL_OFFLINE_ENABLED !== "false">`
  - `const ORIGIN = "https://torah.centralreform.org"`
  - It sends `content-type: text/javascript` and `cache-control: public, max-age=0, must-revalidate`.
- When `ENABLED` is false, the route serves a **tombstone** worker: it deletes every `crc-*` cache and unregisters itself. This is A's rollback. Redeploying code from before A doesn't remove a worker that is already installed, because a 404 on update leaves the old worker in place.
- **Registration is limited to keep the blast radius small.** The client registers `/sw.js` only when the page is running as an installed app (`matchMedia("(display-mode: standalone)")` or `navigator.standalone`) **and** `location.origin` is the torah origin or loopback (for tests).
  - In installed apps on Chrome, Android and desktop, the worker then also controls browser tabs of that origin. That's acceptable.
  - Plain browser users never get a worker.
  - On activate, the worker checks `self.location.origin === ORIGIN` (or loopback) and otherwise turns itself into the tombstone.
- **The manifest link is injected by the client** only on the torah origin, as `<link rel="manifest" href="/app.webmanifest">` plus `apple-touch-icon`. Using `app/manifest.ts` would auto-link it on every host, including beitmitzvah before the switch.

**Caches:**
- `crc-shell-<BUILD>`: app code (`/read` and `/offline` HTML, `/_next/static/**`, `/fonts/**`). It is replaced on worker update; the old ones are deleted on activate. No `skipWaiting`, so the new worker activates on the next launch.
- `crc-offline-v1`: pack assets (public JSON and clips) plus the pack index, stored as a JSON `Response` under the synthetic key `/__crc_offline__/index`. The worker never serves that key to a page.
- No IndexedDB. Cache Storage is the only store, and its eviction is all-or-nothing per origin, so the index and its data disappear together.

### 3.2 Worker routing, the complete allowlist

Everything else is not intercepted, so the browser's normal network behavior applies and nothing is cached:

```
if (url.origin !== self.location.origin || req.method !== "GET" || req.headers.has("range")) return;
navigate                                   → network; on network failure: shell "/read" if pathname==="/read", else shell "/offline". Never cache navigations at runtime.
/_next/static/*, /fonts/*                  → cache-first into crc-shell-<BUILD> (200, type "basic" only)
/reference-audio/short-v1/<64 hex>.mp3     → crc-offline-v1 if a live pack references it, else network (not stored)
/api/public/(reading|text|reference/short) → network-first; on failure crc-offline-v1 if a live pack references it (ignoreVary)
```

- `/api/*` outside those three public routes is never handled. That includes `/api/session`, `/api/auth/*`, `/api/students/*`, `/api/offline/packs`, recordings, reference-review and MCP.
- `word-aids`, `word-details` and `commentary` stay network-only: word tools and Study need a connection.
- Responses served from the cache carry the synthetic header `x-crc-offline: 1`, which drives the offline indicator.
- There are no `push`, `notificationclick` or `sync` listeners. A test asserts this, since notifications stay off.

**Installing the shell:**
- Fetch `/read` and `/offline` with `credentials:"omit"`.
- Collect same-origin `/_next/static/` URLs from their HTML, and `url(...)` references from their CSS.
- Limit: 200 files or 10 MB.
- Chunks that load later are caught by the cache-first rule during the first online use. The offline browser test proves that one online visit to `/read` is enough.

### 3.3 Packs: what goes offline

A pack is `{ key, owner: "public" | <ownerKey>, label, descriptor, assets[], bytes, renewedAt, expiresAt, format: 1 }`. Its `descriptor` is one of:
- `{type:"week", date}`, using today's routes;
- `{type:"ref", kind, ref}`, using 1.3's ref routes.

| Pack | Who | When | Size (18 s per verse at 64 kbps ≈ 144 KB per verse) |
|---|---|---|---|
| This week (`thisShabbat()`, America/Chicago), Torah plus haftarah | Anyone running the installed app | Every online open; last week's pack is dropped on rollover | About 20–25 MB typical, about 35–40 MB for combined parashiyot |
| Your reading (confirmed Torah and haftarah readings) | The signed-in student, own sign-in only | A2 | About 1–5 MB, more for a full parashah |
| My readings | 1.4 members | A2, newest first, within budget | A few MB each |

- **Assets per descriptor:**
  - the reading JSON;
  - every text page;
  - every `reference/short` page, if `listening.pocketTorah` is on;
  - each clip at `references[i].source.path`.
- URLs come from one shared module, `src/components/portal/public-reading/urls.ts`, which `api.ts` also uses, so the packer and the reader produce byte-identical keys.
- **The packer runs in the page, not the worker.** iOS kills idle workers, and page-side code is easier to test.
  - It holds `navigator.locks.request("crc-offline")` so two tabs can't pack at once.
  - It fetches with `credentials:"omit"` and concurrency 3, and on 429 it stops and resumes at the next open. The firewall allows 120 requests a minute per IP on `/api/public/`.
  - For clips it calls the existing `downloadShortReferenceAudio` checks: path regex, size, SHA-256 (`short-playback.ts:9-46`). Then it stores the **original network response** (`cache.put(url, response.clone())`), so `response.url` and the attribution headers (`x-reference-*`, `link`) survive.
  - Clips whose path isn't `^/reference-audio/short-v1/[a-f0-9]{64}\.mp3$` are refused.
- **Renewal (on every online open):** "open" means page load, or becoming visible after at least an hour hidden.
  - Re-fetch the pack's JSON (cheap and CDN-cached, and it keeps the data in step with the current build's parsers).
  - Download any clips that are missing; don't re-download clips that are present.
  - Set `renewedAt = now` only if every step worked. Otherwise the old expiry stands.

### 3.4 Enforcing the 14 days, and purging

- `expiresAt = renewedAt + 14 × 86,400,000`.
- **The worker enforces it:** an asset is served only if some pack lists it and `renewedAt − 5 min ≤ now < expiresAt`. The 5-minute allowance handles small clock skew; a clock set backwards makes the pack expired.
- **The page enforces it:** a sweep at app start (and in the worker's activate) deletes expired packs and assets no pack references.
- Setting the clock forward or back is not a security boundary: this is public text and CC BY-SA audio. The window is about freshness and privacy, as Daniel ruled.
- **Purge on sign-out:** `entry.tsx:65` calls `offline.purgeAll()` before the sign-out POST. It deletes `crc-offline-v1` and tells the worker to drop its in-memory copy of the index. This Week downloads again at the next open if the app is installed.
- **Purge on account switch (A2):**
  - Every online open calls `GET /api/offline/packs`, which returns `{ owner, packs }` with `private, no-store`.
  - If `owner` differs from the index owner, purge everything, then pack for the new owner.
  - A 401 or 403 purges owner packs and keeps the public This Week pack. That covers sign-out elsewhere, session expiry and revoked access.
  - 5xx or a network error changes nothing.
  - This also covers Android and desktop, where the installed app shares cookies with the browser.
- **Owner key:** `HMAC(purposeSecret("offline-owner"), ["offline-owner:v1", tenantId, userId])`. It is opaque and stable for each user.
- **No people data beyond your own:** labels are "Your Torah reading", "Your haftarah" plus the verse range, with no name or ceremony date, and members' own reading names. Public JSON and clips contain no people data.
- **Shared devices:** a "Remove saved readings from this device" button on `/offline`.

### 3.5 Storage quota, eviction and iOS limits

- **Budget:** pack only if `usage + needed ≤ min(0.8 × quota, 300 MB)`, from `navigator.storage.estimate()`. Otherwise the pack shows "Not saved: not enough space on this device."
- Call `navigator.storage.persist()` once after the first successful pack, in the installed app. WebKit grants it to Home Screen apps by heuristics.
- **Eviction:** the index and data go together. Each open checks every asset with `cache.match`:
  - missing assets offline show "Partly saved";
  - online, they are filled back in.
- **iOS:**
  - A Home Screen app gets the same quota as Safari (up to 60% of disk per site; this is from the research doc's WebKit sources). It is best-effort and LRU-evicted.
  - Its cookies and storage are separate from Safari's, which is exactly why B is needed.
  - There is no Background or Periodic Sync, so renewal happens only when the app is opened. That fits the ruling.
  - Packing pauses when the app goes to the background and resumes at the next open. Packing is idempotent.
  - There is no `beforeinstallprompt`, so iOS gets written instructions instead.
  - Background and lock-screen audio is unreliable. Make no promise in the copy, and test it on a device.
  - Test Google redirect sign-in inside the installed app on a real iPhone. If it fails, hide Google in installed iOS and use the code.

### 3.6 Range requests offline

They don't happen.

- The player fetches the whole clip and plays a `blob:` URL (`playback.ts:151,286`), so `<audio>` never sends a Range request to the network or the worker.
- The worker skips any request that has a `Range` header (`return;`), and the server would answer it with a 416 anyway (`public-short.ts:57`).
- The worker never builds a 206.
- A browser test asserts that no clip request carries `Range`.

### 3.7 CC BY-SA and G3 guards

- **CC BY-SA:**
  - Clips are stored as the exact bytes and headers received, unencrypted, in ordinary browser storage.
  - No key, no obfuscation, no DRM: no "effective technological measures".
  - Attribution stays on screen offline: the reader's disclosure comes from `SHORT_SOURCE_ATTRIBUTION`, `short-source.ts:8-12`.
  - No export button (ruling 14).
- **G3:** the worker's clip rule and the packer accept only the short-v1 PocketTorah path, taken from a parsed `ReferenceShortResolution` with the pinned attribution version. A test proves that nothing generated can be cached or served offline:
  - `/reference-audio/generated*`
  - any `voice` path
  - Finkel and reference-review routes
  - `/api/students/*/recordings*`
  - any path not on the allowlist

### 3.8 Manifest and icons

- **`src/app/app.webmanifest/route.ts`** (force-static, `application/manifest+json`):
  - `name` and `short_name` "CRC Torah", `id "/"`, `start_url "/"`, `scope "/"`, `display "standalone"`;
  - `theme_color "#1d5ba6"` (lake), `background_color "#ebf2fa"` (canvas);
  - icons 192, 512, maskable 512;
  - no push fields.
- **`src/app/icons/[name]/route.tsx`** builds the icons at build time with `ImageResponse` from `next/og`, using shapes only so no font licensing applies: `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-180.png`. No binary files enter the repo.
- **The icon design is Daniel's** (§10).

### 3.9 Screens (DESIGN.md "Song session": lake as the one field, no modals, no pep talk, no status on learner reading surfaces)

- **Install hint:**
  - **Where:** one quiet row under the front door's three doors, and in Account.
  - **When:** only on the torah origin, when not already installed, and not dismissed. "Not now" is remembered for 90 days.
  - **What:** on Chrome, Edge and Android, an "Install CRC Torah" button that uses the deferred `beforeinstallprompt`. On iOS (including iPadOS, detected with `maxTouchPoints > 1`), one line of instructions.
  - **Never** on reading pages and never as a modal.
- **Offline indicator:**
  - **Where:** a small white-outline pill in the reading hero's meta line.
  - **When:** only when data came from the cache (`x-crc-offline`) or the device is offline.
  - **What:** "Offline · saved until {date}".
  - Word tools and Study show a one-line "Needs a connection" in place of an error.
- **"Saved for offline":**
  - On the front door, a muted line under This week: "Saved on this device".
  - In My readings (1.4), a per-item state: Saved (forest), Saving, or "Not saved: not enough space".
  - `/offline` (`src/app/offline/page.tsx`, static) lists the saved packs, each with an Open link to the same `/read` URL the reader uses, plus the expiry sentence and "Remove saved readings from this device".

### 3.10 The private endpoint (A2 only)

`GET /api/offline/packs` lives in `src/server/http/offline.ts` and `src/server/offline/service.ts`, wired into `composition.ts` and `dispatch.ts`.

- It returns descriptors only, never text or audio.
- **Student:** confirmed readings through the existing student-mode `assignedReading` (`portal/service.ts:50-57`). With no confirmed reading there is no pack, only This week (decided here).
- **Member:** 1.4 saved readings.
- **Tutor, admin and parent:** an empty list. Parents' child-practice view is not offline in 1.5; see §10.
- Always `private, no-store`, never cached by the worker. Its authorization model goes to the adversarial reviewer.

### 3.11 Dependency

A2's ref-keyed packs need 1.3's public "Any reading" routes. Required contract for 1.3:
- `/api/public/{reading,text,reference/short}?ref=…` (plus `kind` and `offset`);
- the same paging and parse shapes;
- a closed canonical query;
- CDN cache headers.

If 1.3 ships different shapes, A2 adapts `urls.ts` only.

### 3.12 Rejected for A

- **Serwist or next-pwa:** a new dependency and build plugin, a Next 16 compatibility risk, and generic runtime caching that works against the "no generic private cache" rule.
- **Workbox loaded from a CDN.**
- **IndexedDB for audio bytes.**
- **Encrypting the cache** (forbidden by CC BY-SA and pointless).
- **A private offline-pack API that returns student text and audio:** that would cache private responses and duplicate the public routes.
- **Caching `/workspace/*` pages.**
- **Background or Periodic Sync** (not on iOS; renewing on open is the ruling).
- **`Clear-Site-Data: "storage"` on sign-out:** it also wipes reading preferences and the worker, and Safari's support is partial.
- **Packing in ordinary browser tabs:** silent use of storage on shared computers.
- **Keeping packs through session expiry with a retained owner:** more state to reason about. A 401 purges.
- **Extending sessions to 14 days:** an auth change nobody asked for.
- **`skipWaiting`:** risks a mix of old pages and new chunks.

---

## 4. (C) The move to torah.centralreform.org

### 4.1 The code PR: two hard-coded origins, chosen by the env var

The 503 hazard with the PLAN's single flip:
- If any production deploy happens while code and env disagree (for example a stray merge after Daniel sets the env var), `CANONICAL_ORIGIN ≠ BETTER_AUTH_URL`.
- Redirects then turn off and `resolveHost` returns 503 on beitmitzvah and every alias.
- Rollback would need a code revert.

The fix, in `src/lib/navigation/canonical.ts`:

```ts
export const CANONICAL_ORIGINS = Object.freeze(["https://beitmitzvah.centralreform.org", "https://torah.centralreform.org"] as const);
const aliases = new Set(["barmitzvah.centralreform.org","batmitzvah.centralreform.org","bnaimitzvah.centralreform.org","bneimitzvah.centralreform.org","bneimitzvah.vercel.app",
  ...CANONICAL_ORIGINS.map(o => new URL(o).host)]);
export function selectedCanonicalOrigin(env: Environment): string | null {
  const v = env.BETTER_AUTH_URL;
  return env.PORTAL_ENVIRONMENT === "production" && env.PORTAL_DEPLOYMENT === "production" && typeof v === "string" && (CANONICAL_ORIGINS as readonly string[]).includes(v) ? v : null;
}
export const canonicalNavigationEnabled = (env: Environment) => selectedCanonicalOrigin(env) !== null;
// canonicalNavigation: origin = selectedCanonicalOrigin(env); canonicalHost = new URL(origin).host;
// if (!host || host === canonicalHost || !aliases.has(host)) return null;  (line 21)
// line 24 check uses canonicalHost; Location = `${origin}/#home` (line 34). Everything else unchanged.
```

- The security property doesn't change: navigation can only point at one of two hard-coded CRC origins, only in production.
- With `BETTER_AUTH_URL = beitmitzvah`, behavior is identical to today plus the front-door branch: torah redirects to beitmitzvah.
- With `= torah`, beitmitzvah becomes an alias like the other four.

| Files in the C code PR | Change |
|---|---|
| `src/lib/navigation/canonical.ts` | The change above |
| `tests/app/canonical-navigation.test.ts` | Replace the front-door test "navigation alias for now". Cover: both selections; each canonical is never its own alias; the other canonical redirects with exactly `${selected}/#home`; `/api` on an alias gives 404; non-GET gives 404; a trailing-slash or unknown env value disables redirects; preview and other deployments stay inert. |
| `tests/http-browser/canonical-navigation.test.ts` | Run with both selections |
| `docs/planning/2026-10-22-crc-torah-cutover/RUNBOOK.md` | A copy of §4.3 |

- `config.ts` needs no change: the front-door branch adds torah to `PRODUCTION_ORIGINS`.
- No migration: 0034 has the row.
- No `release-migrate-support.mjs` change (§1).
- Adversarial pass, since this is host trust.
- Merge and deploy whenever ready. The probes must show no change in behavior.

### 4.2 Hazards beyond the four in the brief

1. **Every derived key rotates** (`composition.ts:77-78`):
   - Claude's registered client IDs stop verifying (`oauth.ts:27-43`, `mcp/service.ts:71`), so it must register again.
   - Unsubscribe links break. None exist, because `PORTAL_NOTIFICATIONS_ENABLED` is unset.
   - Google sign-ins in progress fail; signed UI bindings refresh.
2. **Cron host:** `vercel.json` has three crons, and those `/api/internal/*` routes pass through `resolveHost`. If Vercel calls a host that becomes an alias, they get a 404. **Before:** record the host and status of the last run in the logs. **After:** the next run must match.
3. **Vercel domain-level redirects** would forward the path and query, including credential queries. They must stay off. All five aliases plus torah serve through the app's proxy.
4. **Invitation and honoree links** already sent point at beitmitzvah. The alias drops the path, so they break. Do the switch while there are none: a read-only production count must be 0.
5. **Local storage is per origin**, so reading preferences (colors, size, tikkun) reset once.
6. **Rollback by Instant Rollback:** Vercel then stops auto-promoting new production deploys until the rollback is undone. Note it in the runbook.

### 4.3 Runbook, in order

**Phase 0: prerequisites (can be days earlier)**
1. The front-door branch is merged; 0034 and 0035 are applied with the guarded operator. Verify `tenant_host` has a torah row: `crc`, `production`, `production`, origin `https://torah.centralreform.org`.
2. The C code PR is merged and deployed. Probes:
   - `beitmitzvah /` gives 200;
   - `torah /` gives 303 to `https://beitmitzvah.centralreform.org/#home`;
   - every alias gives 303 to beitmitzvah;
   - `POST /api/mcp` on beitmitzvah gives 401.
3. Daniel's named helper reports "torah steps done" (FORWARD-STEPS.md).

**Phase 1: preflight probes (the day of the switch; each must pass)**
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

**Phase 2: the window (about 30 minutes)**
1. **Daniel:** Vercel, Project, Settings, Environment Variables, Production: `BETTER_AUTH_URL = https://torah.centralreform.org`, exactly, with no trailing slash. This does nothing until the redeploy.
2. **Redeploy production** (Vercel Redeploy of the current production deployment, which rebuilds with the new env). The agent may do this; Daniel sets the env himself.
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

**Rollback (triggers: torah sign-in failing, lasting 503s, or MCP broken even after reconnecting)**
- **Fastest:** Vercel Instant Rollback to the production deployment from just before the switch. It was built with `BETTER_AUTH_URL = beitmitzvah` and contains the two-origin code. Then Daniel sets `BETTER_AUTH_URL` back to beitmitzvah so later deploys agree, and undoes the rollback lock when ready.
- **Or:** set the env back and redeploy. The code handles both origins.
- No database step. DNS and the Google entries stay, and they're harmless.
- Anyone who signed in on torah signs in again on beitmitzvah. Claude reconnects to the beitmitzvah URL.

### 4.4 What people experience

Today Daniel is the only tester: no family invitations have gone out and the roster import is held. So in practice this is him.

| Who or what | What happens |
|---|---|
| Everyone | Signed out once, because cookies are host-only |
| Bookmarks to the old address | Land on the torah home page; the path is dropped by the reviewed redirect contract |
| Reading preferences | Reset once |
| Claude | Daniel reconnects once |
| Sign-in links and codes sent in the last 5 minutes | Fail; the person asks for a new one |
| Invitation, honoree and unsubscribe links | None are outstanding (preflight 6) |
| Installed apps | None exist, because A ships after the switch |

---

## 5. PR order and the files in each

| # | Branch | Contents | Files | Gate |
|---|---|---|---|---|
| 1 | `claude/sign-in-code` | B | `src/server/auth/factory.ts`, `src/server/runtime/composition.ts`, `src/server/mail/transport.ts`, `src/server/http/auth.ts`, **new** `src/server/http/sign-in-code-binding.ts`, `src/components/portal/api.ts`, `src/components/portal/entry.tsx`; tests in §6 | **Adversarial auth review** (§2.8); CI all four jobs |
| 2 | `claude/canonical-two-origin` | C code | §4.1 | Adversarial pass (host trust); inert-deploy probes |
| — | (no PR) | The switch window | §4.3 | Preflight all green; Daniel sets the env |
| 3 | `claude/installable` | A1: worker, manifest, icons, `/offline`, install hint, offline pill, This week pack, sign-out purge, tombstone flag | **new** `src/offline/service-worker.js`, `src/app/sw.js/route.ts`, `src/app/app.webmanifest/route.ts`, `src/app/icons/[name]/route.tsx`, `src/app/offline/page.tsx`, `src/lib/offline/{policy,pack-index,packer,platform}.ts`, `src/components/portal/offline/{runtime,install-hint,status,shelf}.tsx` and `offline.module.css`, `src/components/portal/public-reading/urls.ts`; **edit** `public-reading/api.ts` (use the URL builders; surface `x-crc-offline`), `public-reading/view.tsx` (pill; offline tool messages), `src/app/layout.tsx` (mount the runtime), `front-door/front-door.tsx` (install row, saved line), `entry.tsx:65` (purge), `next.config.ts` (`PORTAL_OFFLINE_ENABLED` passed to the client) | CI; real-device check (§6.4); adversarial pass on worker scope |
| 4 | `claude/offline-packs` | A2: assigned and saved packs, owner key, account-switch and 401 purge | **new** `src/server/offline/service.ts`, `src/server/http/offline.ts`; **edit** `composition.ts` (`purposeSecret("offline-owner")`), `src/server/http/dispatch.ts:69,96`, `src/lib/offline/packer.ts`, `shelf.tsx`, the 1.4 My readings component | **Adversarial review** (cache scope, purge, authorization); depends on 1.3 ref routes and 1.4 |

---

## 6. Test plan

### 6.1 Unit and app tests (`npm test`, no network; Vitest on PGlite following `tests/app/*` patterns)

**B (`tests/app/sign-in-code.test.ts`, plus updates to the mail transport and auth-route tests):**
- The email has both the link and a 6-digit code, and the code isn't in the subject.
- Body is closed to `code`; a bad format gives 400.
- A missing, tampered, expired or duplicate binding is refused.
- A wrong code gives `{error:"code"}`; the 4th try gives `expired` even with the right code.
- The right code sets session cookies and `next`: `/`, or `/invitations/accept` when an invitation is pending.
- The code from an older email fails; the code works for a new address (parity with the link).
- The verification row's value isn't `sha256(code)` (it's an HMAC).
- A code session has `googleAuthenticatedAt` null and can't approve MCP.
- The per-binding bucket can't touch the global magic-link bucket.
- `X-Practice-Context` gives 403; a foreign Origin gives 403.
- Every other `email-otp` path gives 404.
- With a captured logger, the code never appears in any line.
- Unknown and known addresses get identical responses.

**C:** the canonical tests in §4.1. `tests/app/runtime.test.ts` (front-door version) still passes for both origins.

**A:**
- Worker (`tests/app/offline-sw.test.ts`, the worker in `node:vm` with fake `self`, `caches` and `fetch`):
  - pass-through for private `/api/*`, `/api/auth/*`, non-GET, Range, cross-origin;
  - navigation falls back to the `/read` or `/offline` shell;
  - clips and public JSON are served only from live packs; expired or clock-rolled-back packs are not served;
  - G3, Finkel and recordings paths are refused;
  - no `push`, `notificationclick` or `sync` listeners;
  - the tombstone deletes caches and unregisters;
  - the worker's constants match `src/lib/offline/policy.ts`.
- Packer:
  - the exact asset list from fixture week and short pages;
  - URLs identical to `api.ts`;
  - a SHA mismatch is not stored; a non-short-v1 path is refused;
  - budget refusal; idempotent fill-in of missing clips;
  - renewal only when every step succeeds; This week rollover.
- Manifest and icons: shape, 200, PNG.

**A2 (`tests/app/offline-packs-route.test.ts`):**
- 401 when signed out;
- a student gets only their own confirmed readings; a member gets only their own saved readings; tutor, admin and parent get empty lists;
- no name, email or ceremony date in the body;
- `no-store`;
- the owner key is stable for a user and differs between users;
- tenant isolation;
- the packer purges on a different owner and on 401 or 403, and doesn't purge on 5xx.

### 6.2 Browser tests (new `tests/http-browser/offline-ui.test.ts`; Chromium context with `serviceWorkers: "allow"`; synthetic clips as in `public-reading-ui.test.ts`)

Playwright can't emulate `display-mode`. The test seam is `localStorage["crc.offline.force-installed"]="1"`, honored **only on loopback**.

1. Open `/read` online and wait for "Saved on this device". Then `context.setOffline(true)` and reload:
   - Hebrew and English render;
   - tapping a verse starts the player (assert player state and blob creation, as the existing playback tests do);
   - the pill shows "Offline";
   - `/api/session` and `/api/students/*` were never answered by the worker (`response.fromServiceWorker()` is false, and they fail offline);
   - no clip request had `Range`.
2. **Expiry:** rewrite the index entry's `renewedAt` to 15 days ago, reload offline: the reading doesn't load, the expiry message shows, and no clip is served. Playwright's clock doesn't reach the worker, which is why the test rewrites the index.
3. **Sign-out purge:** sign in with synthetic mail (`auth-navigation.ts`), pack, sign out: `caches.keys()` has no `crc-offline-v1` entries. (A2: also the assigned pack.)
4. **A2 account switch:** pack as user A, then sign in as B and open online: A's packs are gone.
5. **B in the browser:** request a sign-in, read the code from synthetic mail, type it, signed in. A wrong code three times gives the expired state.

**`e2e/installable.spec.ts`** (the built, unconfigured server): `/sw.js` gives 200 `text/javascript` with `max-age=0`; `/app.webmanifest` is valid; no manifest link is injected on `127.0.0.1` unless the seam is set.

### 6.3 Never-in-repo

It must stay green. No binary icons are committed and no clips are committed.

### 6.4 Device check (Daniel, after A1 deploys on torah; record in STATE)

On iPhone in Safari:
1. Add to Home Screen, open, sign in **with the code**.
2. Try Google redirect sign-in inside the app.
3. Turn on airplane mode, relaunch: This week loads and a verse plays.
4. Note whether audio continues with the screen locked, so the copy can say what works.
5. Sign out: the saved state is gone.

Android Chrome: the install button, then the same offline steps.

---

## 7. Risks and how each step is checked

| Risk | Step | Check |
|---|---|---|
| Code brute force or limiter DoS | 1 | §2.8 review; attempt and bucket tests |
| 503 or redirect gap during the switch | 2, window | Two-origin design; inert-deploy probes; merge freeze; post-switch probes |
| Claude, crons or old links break | window | Hazards §4.2; preflight counts; cron baseline and next-run check |
| Google origin not yet live | window | Preflight 4 and 5; Daniel's live sign-in; Instant Rollback |
| Bad worker stuck on devices | 3 | Registration only in installed apps on torah; tombstone env flag; no `skipWaiting` |
| Private data cached | 3, 4 | Allowlist worker; vm tests; `fromServiceWorker` browser assertions; adversarial pass |
| G3 bypass offline | 3 | Path allowlist plus resolution-only clip sources; refusal tests |
| Storage eviction or quota | 3 | estimate and persist; "Partly saved" and "not enough space" states; refill on open |
| Firewall 429 while packing | 3 | Concurrency 3, stop on 429, resume next open |
| 1.3 ref routes differ | 4 | Contract in §3.11; only `urls.ts` changes |

---

## 8. Spend

No new service. The worker reduces repeat traffic. Packing adds about 25 MB of CDN-cached transfer per installed device per week. Cache-miss clip reads from private Blob cost about $0.05/GB. Estimate under $0.50 a month at beta scale; log it in STATE.

---

## 9. Decisions to write in "Decided here" (logged, not Daniel's)

- 6 digits, 3 attempts, 5 minutes; HMAC at rest; a device-binding cookie; the `emailOTP` plugin; no migration.
- Packs only in the installed app.
- A student pack only for confirmed readings.
- Purge on 401 or 403.
- The two-origin canonical.
- `release-migrate-support.mjs` left unchanged.
- The order B, C, window, A1, A2.

**Decided here while building B (`claude/sign-in-code`, 2026-10-23):**

- A code request with no usable binding (none, tampered, other cookie scheme, another origin's, or past 5 minutes) answers **409** `{error:"expired"}`, not the 400 in §2.3. The client's `requestPortal` drops error bodies and keeps only the status, so 400 is "wrong code" and 409 is "ask again". A duplicated cookie name stays the dispatcher's 400.
- After a wrong code the route reads the code's remaining tries (better-auth 1.7.10: identifier `sign-in-otp-<email>`, value `<hmac>:<tries>`). With none left, or no live code (already used, replaced and spent), it answers `expired` at once (it only reads; the SDK consumes the spent row on the next try, so a newer code is never removed), so the person isn't told to type a fourth time into the per-binding 3/min limiter. The SDK's own attempt count is still the real limit (tested directly against the SDK).
- `/api/auth/sign-in/code` joins the paths on which a pending invitation sets `next` to `/invitations/accept`; it never accepts an invitation.
- The device remembers only a timestamp (`crc.signin.code-requested-at`) and reopens on the code form for 5 minutes, also on a plain reload of the sign-in page. "Use a different email" clears it, as do sign-in and sign-out.
- `disableSignUp: false` on both plugins, named once (`SIGN_IN_DISABLE_SIGN_UP`), so a code signs in exactly the addresses a link does.
- Email wording is Daniel's final (2026-10-23, offload A3): link line, then "Or enter this code in the {productName} app:" with the code alone on the next line, the once-and-5-minutes line, "No one from CRC will ever ask you for this code. Don’t read it to anyone or type it anywhere but {productName}.", then the ignore line. The code must be the email's only run of 6+ digits and the subject has no digits; the transport refuses to send otherwise. No WebOTP line. `productName` is the congregation's `tenant.product_name` (E1), read through the shared reader `src/server/data/product-name.ts`: the sign-in email resolves the deployment's configured origin to its tenant before a code exists, and invitations pass their tenant. A name with any number, control or invisible character sends nothing.
- Per-address cap (review §2.8 finding 1, decided by Claude 2026-10-23; 6 digits kept because Daniel approved that wording): an address gets at most 3 codes in any rolling hour and at most 6 in any rolling 24 hours (the daily ceiling, from the cap's re-check: about 9 real guesses an hour would otherwise add up to roughly a 7.9% chance a year against one address), and later sign-in emails carry the link only. After 9 failed tries in the hour, every code for that address, right or wrong, answers `expired` until the hour passes; the link still works. Kept as Better Auth `verification` rows (no migration), one per event, keyed `sign-in-cap:<code|code-day|guess>:<HMAC of the normalized address>` and expiring after their window. Each time a cap holds, one `{"event":"sign-in.code-capped","cap":"code"|"guess"}` log line is written, with no address, hash or code.
- Decided (mechanical derivation of Daniel's approved wording, not new wording): a link-only email leaves out line 2, and line 3 becomes "The link works once, for 5 minutes." Lines 1, 4 and 5 are unchanged.
- Noted for the reviewer: a wrong guess recreates the row with a fresh `createdAt`. If a new code is issued between the SDK's consume and that recreate, the older code becomes "latest" for its remaining tries and lifetime. This is bounded by the same 3 tries and 5 minutes.

---

## 10. Waiting on Daniel (flagged, not decided)

These are new user-visible wording or design with no precedent, so under your global rule they're his. The executor can build with the proposals and swap the strings.

1. **Sign-in email wording.** Proposed:
   - "Open this link to sign in: {link}"
   - "Or enter this code in the CRC Torah app: {code}"
   - "The link and the code work once, for 5 minutes. Don't share the code with anyone."
   - "If you did not request this message, you can ignore it."
   - Also the button label in the installed app: "Email me a sign-in code" or the current "…link".
2. **Install and offline wording.**
   - Install hint: "Install CRC Torah on this device. This week's reading and recordings stay available offline (about 25 MB)."
   - iOS: "In Safari, tap Share, then Add to Home Screen."
   - Pill: "Offline · saved until {date}."
   - Expiry: "Saved readings last 14 days without a connection. Connect to renew them."
3. **The app icon** (a shapes-only mark on lake blue, or something else).
4. **Whether parents' child-practice view should work offline.** Recommended: not in 1.5, because switching children brings purge-on-switch complexity.
5. **Already his:** who makes the DNS and Google changes (FORWARD-STEPS), setting `BETTER_AUTH_URL` in Vercel, and the live sign-in and Claude reconnect in the window.

---

## 11. A1 as built (Decided here, 2026-10-23; PR `claude/installable`)

Logged decisions, following the rulings above. Daniel may overrule any of them.

- **Manifest at `/api/public/manifest`, not `/app.webmanifest`.** E1 makes `name` and `short_name` the tenant's `productName`, which only the public runtime can read (one column of the one public tenant, after `resolveTenant`). A Next route outside `/api` cannot reach that runtime in the isolated browser harness, so the manifest joined the closed `/api/public` allowlist (no query at all; `application/manifest+json`; CDN 1 h). The page links it only on the torah origin. The client reads `productName` from the same manifest for the install and expiry strings, and the worker keeps it in the shell so `/offline` can name the app offline.
- **Icons are generated, never committed.** `/icons/{icon-192,icon-512,maskable-512,apple-180,favicon-48}.png`, `/apple-touch-icon.png` (opaque 180 px) and `/favicon.ico` (the yad at 48 px, served as PNG) are `ImageResponse` renders of the exact `option-2-yad.svg` geometry at build time (`force-static`). A committed PNG would trip never-in-repo's binary check, which is not weakened. `src/app/icon.svg` (text) is the page favicon link.
- **Learn to lein pack (F3): fixed course passages.** The lessons JSON is bundled in the app code, so it travels in the shell. Its verse data now always loads in the same passages (`coursePassages` in `verses-api.ts`: every course example verse of a melody, grouped once by `passagesFor`), so every lesson, drill and review card asks for identical URLs and the pack holds exactly them. Size: 53 Torah and 53 haftarah verses, about 15 MB of clips plus a few hundred KB of JSON. Budget check as §3.5. The This week pack also holds the by-ref text and short pages Learn's This week asks for (same clips, no extra audio).
- **Course progress sync.** The progress hub calls `sync.start()` on the `online` event; the existing marker and merge rules do the rest. Signed-out progress stays in the browser exactly as before (nothing new is stored).
- **Shell pages:** `/read`, `/offline`, `/learn`, `/learn/about`, `/learn/review` and every lesson page. A failed navigation falls back to the shell copy of its own path, else `/offline`.
- **The worker keeps no copy of the index in memory**; it reads the index for every packed request, so a purge or an expiry rewrite takes effect at once (no purge message is needed). The worker's activate sweep drops only expired packs; orphan assets are the page's sweep, both under the `crc-offline` Web Lock. `clients.claim()` on activate (never `skipWaiting`, except in the tombstone) so the first online visit fills the shell's lazy chunks.
- **Packing waits for nothing the user does**: it runs on every online open and on reconnect in the installed app; "Saved on this device" shows once This week's pack is complete and the worker is active.
- **Install hint placement:** one row under the front door's doors (phones and tablets, until "Not now"), and an always-available entry on Account (`/account`, signed in or not). A desktop browser with no install prompt shows no entry: there is no approved instruction for it. Offline wording (pill, "Needs a connection", the expiry line) shows only on the torah origin.
- **Typography:** the strings use the repo's typographic apostrophes (’), as every other page does.
- **New wording, flagged for Daniel** (one constant each in `src/lib/offline/copy.ts`, `NEW`): "This week’s reading" and "Learn to lein" as `/offline` item labels (existing titles reused), "Nothing is saved on this device yet.", "Saved readings were removed from this device.", "Saved until {date}" and the bare "Offline" pill when nothing saved is live. The Android menu sentence was approved verbatim by Daniel on 2026-10-23.
- **Renewal at most twice a day (from the adversarial review).** "Renew on every open" would re-ask about 42 public requests on every page load, and Learn moves by full page loads, so three lessons in a minute would pass the firewall's 120 per minute per address (and a synagogue Wi-Fi shares one address). A complete pack renewed in the last 12 hours is left alone; reconnects are debounced 5 s. The 14 days still run from the last successful renewal, so this costs at most 12 hours of them.
- **Review fixes, also logged:** a sign-out broadcasts the purge to every tab (BroadcastChannel) so no other tab finishes a pack after it; the worker never reopens, and so never recreates, a deleted pack cache, and its activate sweep takes the lock only if it is free; a renewal stores the JSON only after every clip it names, so a failed renewal never leaves new pages over old clips; static paths with an encoded slash, backslash or dot segment are never treated as app code; `/offline` renders nothing off the torah origin; `/sw.js`'s source file is traced into the deploy.
- **Accepted as is:** the yad favicon (`icon.svg`, `/favicon.ico`) shows on every host, beitmitzvah included: it is the product's icon, not an install surface. Saved clips can outlive a PocketTorah release pull by up to 14 days on a device that stays offline; they are human recordings (G3 is about generated chant), and the next online open re-checks every short page. Lesson pages now fetch their melody's whole fixed course passage (CDN-cached), the price of identical offline keys.
- GATE: worker scope, cache allowlist, sign-out purge, G3 guard and origin gating — proceeded because the adversarial review found nothing private or generated can enter or leave Cache Storage, and its one High and two Mediums are fixed with tests.

## 12. A2 as built (Decided here, 2026-10-23; PR `claude/offline-a2`)

Daniel's A2 rulings (2026-10-23, binding): a student's confirmed reading goes offline, and no confirmed reading means nothing beyond This week; a member's 1.4 saved readings, only the 3 nearest upcoming; tutor, admin and parent get an empty list, with no parent offline view of a child in 1.5; the same 14-day rule and the same purge on sign-out and account switch; A1's six NEW strings approved ("Keep all"); the sign-in email's line 4 names `{productName}`. Logged decisions, following those rulings. Daniel may overrule any of them.

- **No migration.** `GET /api/offline/packs` (`src/server/http/offline.ts`, `src/server/offline/service.ts`) reads through existing services only: one verified-identity read for the roles and the member row, then the student-mode `listStudents` and `assignedReading`, and the saved layer's own `list` (so `app.saved_owner` is still set only in `saved/access.ts`). `private, no-store` through `privateJson`; no query; `X-Practice-Context` is 403; 401 signed out. The worker does not handle the path.
- **Who counts as a member:** an active `tenant_member` row (the approved account), not the saved layer's wider eligibility. A tutor, admin or parent with saved readings and no member row gets nothing; one who is also a member gets their own saved readings, never a child's or tutee's reading.
- **"Nearest upcoming":** a saved reading dated today or later in the congregation's calendar (America/Chicago), earliest first, ties by creation time; undated readings are skipped as not upcoming. At most 8 owner packs in all, deduplicated by kind and canonical ref; a ref that is not canonical is skipped.
- **Descriptors only:** `{ owner, packs: [{ kind, ref, name }] }`. `name` is the member's own name for a saved reading, null for a student's reading. No student name, email address or ceremony date.
- **Owner key** `HMAC(purposeSecret("offline-owner"), ["offline-owner:v1", tenantId, userId])`, base64url, stable per person and congregation. The index now carries `owner` (an A1 index reads as owner null); an owner pack is valid only under its index's own owner, otherwise the whole index reads as empty (page and worker alike) and the sweep clears it.
- **Each online open of the installed app asks the endpoint first.** Another owner than the index's: the whole pack cache is deleted, public packs too (the sign-out purge), then this owner's are packed. 401 or 403: owner packs go, public packs stay, index owner becomes null. Anything else (5xx, network, a malformed body): nothing changes. A reading the endpoint stops naming is dropped at that open; a renamed one is renewed.
- **Owner packs are fetched exactly like public ones:** the public ref routes (`/api/public/reading|text|reference/short?ref=…`), no cookie, the same clip checks and G3 path allowlist; a ref pack stores the reading route too, because `/read?ref=` asks for it. Order: This week, then the person's own readings, then the course. Same 12-hour renewal floor, budget and 14 days.
- **Where they show:** `/offline` lists them with an Open link to `/read?ref=…&kind=…` (works offline; `/read?saved=` needs the private saved API). The label is the member's own name, else "Torah" or "Haftarah" plus the range, as My readings already shows it. While online, owner packs are listed only after this page load's owner check, so a person who replaced another on the device never sees the other's list. No per-item state in My readings: it cannot load offline, and the ruling adds no controls.
- **Copy:** A1's six NEW strings moved to `APPROVED` in `src/lib/offline/copy.ts` with the dated approval. A2 adds no new string (`NEW` is empty).
- **Sign-in email line 4:** "No one from {productName} will ever ask you for this code. Don’t read it to anyone or type it anywhere but {productName}." (separate commit).
