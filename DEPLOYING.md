# Running your own copy of this portal

This is the runbook for a congregation that runs its own copy (a fork) of the CRC B'nei Mitzvah portal on its own GitHub, Vercel, Neon, Google and Resend accounts. It is written for the AI assistant (Claude) who does the work for a non-technical rabbi. Every command and value below is exact. A step marked **(unverified)** could not be confirmed, so check it as you go and do not assume. Sections 3, 4 and 9 and the build and start in section 8 were rehearsed end to end on a disposable local Postgres with a fork identity (no real Neon, Vercel, Google or Resend account); everything that needs those live services is still unverified.

Ground rules for the assistant:

- This is a separate copy that your congregation owns and pays for. It is not a second tenant on CRC's site. Never ask CRC for access to anything.
- Never put a secret in chat, in Git, in a screenshot or in a log. Secrets are listed in section 7. Put them straight into Vercel's settings or into the private operator file described in section 3.
- Nothing in this guide needs a change to the code. Your name, address and logo come from settings.
- Stop and ask the rabbi before anything that spends money, sends messages to real people, or changes who can see student information.

## 1. What you need

| Account | Used for | Cost |
|---|---|---|
| GitHub | Holds your fork of the code | Free |
| Vercel | Hosts the portal; its Blob storage holds the optional reference audio | See note below |
| Neon | The Postgres database | Free tier exists; check current limits and price |
| Resend | Sends the email sign-in link and the family invitations. **Required.** | Free tier exists; check current limits |
| Google Cloud | An optional additional "Sign in with Google" button | Free |
| A domain you control | The portal's address (for example `torah.example.org`) | Optional but recommended; a `*.vercel.app` address also works |

Also needed on the machine that runs commands: Node 24 LTS, npm, Git, and the GitHub CLI (`gh`). The `psql` client is useful but not required, because Neon has a web SQL editor.

**Vercel plan note.** Vercel's Hobby plan is for personal, non-commercial use. A congregation is an organization, so read Vercel's current terms and pricing before choosing a plan, and have the rabbi decide. Do not assume Hobby is allowed. The repository ships three daily cron entries in `vercel.json`; check that your chosen plan allows them (unverified for any specific plan).

**Costs are the congregation's decision.** Report any plan, upgrade or spend notice to the rabbi before accepting it. The reference-audio kit (section 9) stores about 900 MB in Vercel Blob; check Blob storage pricing before installing it.

## 2. Fork and the first Vercel import

1. Fork the repository `RavBogard/bneimitzvah` on GitHub into your own account or organization. Keep the fork's default branch as `main`.
2. Clone it: `git clone https://github.com/<your-account>/bneimitzvah.git`, then `cd bneimitzvah` and `npm ci`.
3. Add the upstream remote so you can update later (section 11): `git remote add upstream https://github.com/RavBogard/bneimitzvah.git`.
4. In Vercel, choose Add New, then Project, and import your fork. Framework preset: Next.js (it is detected). Leave the build command and output directory at their defaults. In Settings, then General, set Node.js Version to 24.x.
5. Do not connect Vercel's Neon integration. Create the Neon project yourself in section 3, so that the database owner's password never enters Vercel. (If the integration is already connected, delete every database variable it injected, such as `DATABASE_URL`, `POSTGRES_*`, `PG*`, `NEON_*`, before continuing; the portal refuses an owner login and refuses to start with `DATABASE_MIGRATION_URL` set.)
6. The first build can run with no environment variables (verified: `npm run build` completes with none set). `npm run build` runs two small `prebuild` probes (`scripts/private-media-oidc-probe.mjs` and `scripts/private-media-object-probe.mjs`). Without their special flags they print nothing and exit 0, so they need no setup (verified). They contain CRC's fixed Vercel identifiers, which are harmless and unused in a fork.
7. Add your domain under Settings, then Domains, and add the DNS record Vercel shows. Wait until Vercel shows the domain as valid with a certificate. Decide the one canonical address now (for example `https://torah.example.org`); it is used in several places below and must match exactly everywhere: `https://`, no trailing slash, no path, no port.

The portal will not work until sections 3 to 7 are done. A failed first request is expected.

## 3. Neon database: roles, migrations, first owner

The portal uses two database logins, and the split is a security requirement, not a preference:

- **Owner login** (Neon's default owner, usually `neondb_owner`). It owns the tables and runs migrations and the operator scripts. Its URL is `DATABASE_MIGRATION_URL`. It lives only in a private operator file on the machine running commands. It is never set in Vercel.
- **Runtime login** (you create it; this guide calls it `portal_app`). The deployed app connects as this login through `DATABASE_URL`. It owns nothing, is not a superuser, cannot bypass row security, and is a member only of the group role `portal_runtime`, which migration `0002_tenant_security.sql` creates. Row-level security is forced (`FORCE ROW LEVEL SECURITY`) on the student and authority tables, so even a bug in the app cannot read another tenant's rows.

The app checks this on every request (`src/server/db/runtime.ts`) and refuses to run as an owner, a superuser, a `BYPASSRLS` role, or any role with extra memberships. `loadRuntimeConfig` also refuses a `DATABASE_URL` whose user is `postgres`, `neondb_owner` or `portal_runtime`, whose host does not end in `.neon.tech`, or whose query string is anything but `?sslmode=require`.

### 3.1 Create the Neon project

1. In Neon, create a project. Pick a region near your congregation (US East is closest to Vercel's default functions region; check Vercel's current default; unverified). Use Postgres 16 or newer. Keep the default database name (usually `neondb`) and owner.
2. From the Connect dialog, copy the **direct** connection string for the owner. Direct means the host does not contain `-pooler` (turn off "Connection pooling" in the dialog). Migrations and the operator scripts refuse a pooled host.
3. Create a private operator file named `.env.operator` in the repository root. Git ignores `.env*` files. Put these lines in it (replace the value; keep `?sslmode=require` and delete any `channel_binding=...` or other options Neon adds, unless noted):

   ```
   DATABASE_MIGRATION_URL=<the direct owner string from Neon, with only ?sslmode=require as its option>
   ```

   Never paste this file's contents anywhere. Delete the file when section 4 and the first-owner step are done and keep the owner password only in Neon.

### 3.2 Apply the migrations

```
node --env-file=.env.operator scripts/db-migrate.mjs
```

(`npm run db:migrate` runs the same script, but it does not load `.env.operator`; use `node --env-file` as shown.) Expected output: `Database migrations completed`. Running it again is safe and prints the same line. Any failure prints one fixed sentence and no detail; the usual causes are a pooled host, a wrong password, or a missing `?sslmode=require`.

This applies every migration in `src/server/db/migrations/` in order, `0000` through the latest (56 files when rehearsed). It creates the `portal_runtime` group role and seeds one tenant with the internal id `crc`. **A fork keeps that internal id.** It is never shown to anyone; your congregation's name comes from settings (section 4). Do not rename the tenant.

Verify (Neon SQL editor, as the owner; these checks were run on a local Postgres 18):

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;          -- the number of migration files (56 when rehearsed)
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname IN ('student','membership','role_grant','audit_event');  -- all true, true
```

### 3.3 Create the runtime login

Generate a long random password using only letters and digits (so it needs no URL escaping), store it in a password manager, and run this in the Neon SQL editor as the owner. Replace the placeholder, and make sure the database name matches yours:

```sql
CREATE ROLE portal_app LOGIN PASSWORD '<generated-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
GRANT portal_runtime TO portal_app;
GRANT CONNECT ON DATABASE neondb TO portal_app;
```

Do not create this login in Neon's console or CLI. Roles created there are added to `neon_superuser` and the portal will reject them. Creating it with SQL as above avoids that.

Verify that the login is restricted and has exactly one membership:

```sql
SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
  FROM pg_roles WHERE rolname = 'portal_app';          -- all f
SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
 WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'portal_app');   -- only portal_runtime
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'portal_app');  -- 0
```

Build the runtime connection string from the same direct host, with the new user and password and only the one option:

```
<scheme>://portal_app:<generated-password>@<host>.neon.tech/neondb?sslmode=require
```

where `<scheme>` is the same scheme Neon shows at the start of the owner string (`postgresql`). The `<host>` is the same direct host.

This becomes `DATABASE_URL` in Vercel (section 7). The code accepts any `.neon.tech` host here. Use the direct host; a pooled host (`-pooler`) is untested for this guide (unverified).

### 3.4 Let the owner assume the runtime role (needed for the first owner)

On Postgres 16 and newer, owning the tables is not enough: the owner needs permission to `SET ROLE portal_runtime`, which the bootstrap script does. At CRC this was missing on Neon and the first bootstrap failed until this grant was added. Run once as the owner:

```sql
GRANT portal_runtime TO CURRENT_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
```

(Verified on a local Postgres 18 as a login with CREATEROLE; not checked on a fresh Neon project, where it is the correction CRC applied. If it errors, read the error and consult the PostgreSQL `GRANT` documentation for your version.)

### 3.5 First owner (bootstrap)

The first administrator must have signed in once, so the account exists, and then be promoted privately. There is deliberately no web route that can make anyone an owner.

Order of events (do sections 4 to 8 first; the person can only sign in after the app is deployed and its host row exists):

1. The rabbi opens the deployed portal and signs in with Google or with the email link (section 8). That creates the account with a verified email.
2. Add this line to `.env.operator` (do not print the address in chat beyond what is needed):

   ```
   BOOTSTRAP_OWNER_EMAIL=<the rabbi's sign-in email address>
   ```

3. Run:

   ```
   node --env-file=.env.operator scripts/bootstrap-owner.mjs --confirm
   ```

   Expected: `Owner bootstrap completed; remove private bootstrap configuration`. Running it before the person has signed in fails with `Owner bootstrap failed; verify private operator configuration` (verified). A failure prints one fixed sentence. Likely causes: the person has not signed in yet, the email is not verified, the owner cannot `SET ROLE portal_runtime` (section 3.4), or an admin already exists that this script did not create (it refuses to adopt one).
4. Remove `BOOTSTRAP_OWNER_EMAIL` from `.env.operator`. Re-running it for the same person is safe and changes nothing; it prints the same completed line.
5. The rabbi reloads the portal and sees the admin areas (Settings, Share guides, and so on). Adding more admins later is done with `scripts/manage-admin.mjs`, a private operator tool that needs a prepared review file; see `docs/planning/2026-10-15-kickoff/PROVIDER-SETUP.md` section 6. Ordinary staff are invited from inside the portal instead.

## 4. Identity settings and the host row

These variables make the portal say your congregation's name instead of CRC's, and tell it which address is yours. All are optional for CRC and **required in practice for a fork**. They are not secrets.

| Variable | What it is | Example |
|---|---|---|
| `CONGREGATION_NAME` | Full name, shown in titles and emails. 80 characters at most. No `<`, `>`, `&` or `"`. | `Temple Example` |
| `CONGREGATION_SHORT_NAME` | Short name. The product is called `<short name> Torah`. With no short name, the full name is used as the product name. | `Example` gives "Example Torah" |
| `CANONICAL_ORIGIN` | The one https address of the portal. Must equal `BETTER_AUTH_URL`. A real DNS name, no port, no path. | `https://torah.example.org` |
| `ORIGIN_ALIASES` | Optional comma separated host names that only redirect to the canonical address (pages only; their APIs return 404). | `bnei.example.org,www.torah.example.org` |
| `CONGREGATION_LOGO` | A bare file name that exists in `public/` (png, webp or jpg). With none, no logo is shown. | `logo.png` |

Without any of these (and off CRC's addresses) the portal says "Beit Mitzvah" and shows no logo, which is safe but generic.

Steps:

1. Add your own logo file to `public/` in your fork (for example `public/logo.png`, a square image your congregation owns the rights to), commit and push it. Never copy anything from `public/brand/` (section 12).
2. Set the five variables above in Vercel (section 7).
3. The portal only serves an address that has a row in the database table `tenant_host`. Add yours, and set the credit approved portion summaries carry, with one operator command. Put the canonical address in the private operator file too:

   ```
   CANONICAL_ORIGIN=https://torah.example.org
   ```

   (add that line to `.env.operator`), then run:

   ```
   node --env-file=.env.operator scripts/add-congregation-host.mjs --summary-credit "Rabbi Example" --confirm
   ```

   `--summary-credit` and `--confirm` are required. It is the plain-text name (no `@`, no `<` or `>`, 240 characters at most) printed under every approved portion summary. Use the rabbi's name as the rabbi wants it credited. **Until the credit is set, portion summaries cannot be approved** (migration `0056` makes the database fail closed). Expected: `Congregation host configured; remove private operator configuration` (verified). Running it again with the same address prints `Congregation host already-configured; remove private operator configuration` and updates the credit. The address must be https, a real DNS name, with no port or path, and not one of CRC's own hosts. To change only the credit later, add `--credit-only` and leave out the `CANONICAL_ORIGIN` line (the migration's comment says `--set-summary-credit-only`; the script's flag is `--credit-only`). Approving a portion summary fails until the credit is set.
4. Aliases need no database row.
5. Review Settings in the portal as the owner, because the seeded tenant settings were written for CRC. The seed in `0002_tenant_security.sql` writes `"credits":{"issuedBy":"Central Reform Congregation"}` and the tenant's stored name is still CRC's (verified in the rehearsal database; the pages still showed your name, because it comes from the identity variables). Open the settings page and change anything that still says CRC (which fields that page lets you edit is unverified).

## 5. Google sign-in (optional, in addition to the email link)

The email link (section 6, Resend) is **required** and is also how family invitations go out; the app will not start without `RESEND_API_KEY` and `RESEND_FROM` (verified in `loadRuntimeConfig`). Google is an optional additional method, shown beside the email option. The email option is always shown, so the portal cannot be Google-only. Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or neither. Setting only one makes the app refuse to start. The honest trade-off for the rabbi: Google is quicker for people who have a Google account; the email link works for everyone and needs no account.

Setup in Google Cloud Console (an existing or new project owned by the congregation):

1. APIs and Services, then OAuth consent screen. User type External. Fill in the app name (your product name), a support email and the developer email. Add your domain under authorized domains. To allow any family's Google account, publish the app (move it out of Testing); in Testing mode only listed test users can sign in. Publishing may require Google's brand verification (unverified; follow what the console asks). Do not turn on any "AI agent" option for this ordinary sign-in.
2. Credentials, then Create Credentials, then OAuth client ID. Application type **Web application**.
3. Under **Authorized JavaScript origins** add exactly your canonical origin, for example `https://torah.example.org`, with no path and no trailing slash. For local testing also add `http://localhost` and `http://localhost:3000`.
4. **Authorized redirect URIs**: none are required. The portal uses Google's popup button and posts the Google ID token to its own server; its old `/api/auth/callback/google` route is retired. (This matches CRC's records; unverified on a new client. If Google insists on a redirect URI, leave it blank or add the canonical origin and test.)
5. Copy the Client ID and Client secret directly into Vercel as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The secret is a secret.

Signing in with Google establishes identity only. It does not grant any role. A person sees a child's information only after an explicit invitation is accepted.

## 6. Email link via Resend (required)

This is the primary sign-in and the way invitations reach families. Set it up before the first sign-in.

1. Create a Resend account. Under Domains, add the domain you will send from (a subdomain such as `mail.example.com` keeps sign-in mail separate from your normal mail). Resend shows DNS records; add each exactly as shown at your DNS host: the SPF record (TXT), the DKIM record(s), and any return-path (MX or CNAME) record. Keep any email records the congregation already has. Wait until the domain shows Verified.
2. In the domain's settings, turn **off** open tracking and click tracking. Sign-in mail must not be rewritten. (The code sends plain text and no tracking, but Resend also applies domain settings.)
3. Create an API key with sending access only, limited to that domain. It starts with `re_`. Put it in Vercel as `RESEND_API_KEY` (secret).
4. Set `RESEND_FROM` to a bare address on the verified domain, such as `login@example.com`. It must be a plain address: no display name and no angle brackets.
5. Verify in section 8 by requesting a real sign-in link. A message that never arrives usually means the domain is not yet verified or the From address is not on it.

## 7. Environment variables

Set these in Vercel under Settings, then Environment Variables, for the **Production** environment only. Mark every secret as Sensitive. Leave Preview and Development empty: a preview needs its own separate database and address and is out of scope here.

| Variable | Purpose | Secret | Example or rule |
|---|---|---|---|
| `PORTAL_ENVIRONMENT` | Selects the mode. | No | `production` |
| `PORTAL_DEPLOYMENT` | Must match the seeded host row's deployment. | No | `production` |
| `BETTER_AUTH_URL` | The one canonical origin; cookies, links and Google are bound to it. Must equal `CANONICAL_ORIGIN`. | No | `https://torah.example.org` |
| `BETTER_AUTH_SECRET` | Signs sessions and sign-in codes. 32 to 512 characters, random, unique to you. Changing it signs everyone out. | **Yes** | generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `DATABASE_URL` | The restricted runtime login (section 3.3). | **Yes** | the string from section 3.3 |
| `RESEND_API_KEY` | Sends email (required). | **Yes** | `re_...` |
| `RESEND_FROM` | Sender address on the verified domain. | No | `login@example.com` |
| `GOOGLE_CLIENT_ID` | Google sign-in (optional extra method; set both or neither). | No | `123...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google sign-in (optional pair). | **Yes** | from Google |
| `CONGREGATION_NAME` | Identity (section 4). | No | `Temple Example` |
| `CONGREGATION_SHORT_NAME` | Identity. | No | `Example` |
| `CANONICAL_ORIGIN` | Identity; same value as `BETTER_AUTH_URL`. | No | `https://torah.example.org` |
| `ORIGIN_ALIASES` | Optional redirect-only hosts. | No | `www.torah.example.org` |
| `CONGREGATION_LOGO` | Optional file in `public/`. | No | `logo.png` |
| `BLOB_STORE_ID` | Your private Blob store id; only for reference audio (section 9). | No | `store_...` |
| `REFERENCE_AUDIO_CATALOG_SHA256` | Reference audio (section 9). Printed by the installer. | No | 64 hex characters |
| `REFERENCE_AUDIO_SHORT_MANIFEST_SHA256` | Reference audio. Printed by the installer. | No | 64 hex characters |
| `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE` | Reference audio, public pages. Printed by the installer. | No | `true` or `false` |
| `REFERENCE_AUDIO_STUDENT_RELEASE` | The congregation's switch for students hearing reference audio. Absent or `false` is off. | No | `true` or `false` |
| `PORTAL_NOTIFICATIONS_ENABLED` | Optional. Email notifications send only when exactly `true` and each kind is also switched on in Settings. | No | `true` |
| `PORTAL_MCP_ENABLED` | Optional. Claude connector for staff. Off unless exactly `true`. Left out of a first install (unverified for a fork's connector setup; it uses Google sign-in). | No | `false` |
| `CRON_SECRET` | Optional. Protects the scheduled-job routes. 32 to 512 characters, must differ from the other secrets. | **Yes** | random |

Never set these, in Vercel or anywhere the app runs: `DATABASE_MIGRATION_URL` and `BOOTSTRAP_OWNER_EMAIL` (the app refuses to start if present), and the owner database URL under any name.

Leave all of these unset in a fork: `PORTAL_RECORDINGS_ENABLED` (student recordings are parked), `CHANT_BLOB_TOKEN`, `BEIT_MITZVAH_MUSIC_URL`, `BEIT_MITZVAH_SERVICE_TOKEN` (CRC's own music service), `GOOGLE_SHEETS_SERVICE_ACCOUNT`, `GOOGLE_ROSTER_SHEET_ID` (CRC's roster sheet), `PORTAL_OFFLINE_ENABLED` (the offline pack is CRC-only), `FINKEL_REVIEW_*`, `CRC_COMPONENT_PAGE`, `BLOB_READ_WRITE_TOKEN` (used only on your own computer for section 9, never in Vercel Production).

The three entries in `vercel.json` `crons` call internal routes for music, roster sheet and notifications. With the related variables unset all three answer `503` and do nothing (verified locally), so Vercel's cron log shows a failed run each day. That is expected and harmless in a fork; tell the rabbi so it does not look like an outage.

## 8. Deploy and verify

1. After the variables are saved, trigger a new Production deployment: Vercel, then Deployments, then the three dots on the latest, then Redeploy. Wait for Ready.
2. Open `https://<your canonical origin>/`. You should see the portal's front door titled with your congregation's name or "Beit Mitzvah" and **no CRC name and no CRC artwork**. If you see an error page, open Vercel's runtime logs: a configuration mistake is reported as an unavailable runtime, with no detail by design. Re-check section 7 against these rules: exactly one of the Google pair is set; `DATABASE_URL` user is not `neondb_owner` or `postgres`; its host ends in `.neon.tech` and the query is only `?sslmode=require`; `BETTER_AUTH_URL` equals `CANONICAL_ORIGIN` and has no trailing slash; `PORTAL_ENVIRONMENT` and `PORTAL_DEPLOYMENT` are both `production`.
3. The CRC artwork must not be served: `curl -I https://<your origin>/brand/favicon-48.png` should return 404 (verified: every path under `/brand/` returns 404 on a fork host, although the files sit in `public/brand/`). In the rehearsal the page title and body showed the fork's name, with no CRC name and no floor art.
4. Sign-in by email link: on the sign-in page, enter the rabbi's address. An email arrives from your `RESEND_FROM`. Opening the link shows a confirmation button; pressing it signs in. The email wording names your congregation and product.
5. Sign-in with Google (if configured): the Google button appears; the popup completes and returns signed in. If the button is missing or the popup says "origin not allowed", recheck section 5, step 3.
6. Run the first-owner step (section 3.5). Reload as the rabbi and open Settings. Confirm an anonymous visitor in a private window cannot open the workspace.
7. In Neon, confirm the app connects as the restricted login: `SELECT usename FROM pg_stat_activity WHERE datname = 'neondb';` shows `portal_app` for the app's connections (unverified; on a local Postgres the owner login could not see other logins' sessions, so on Neon expect `portal_app` and check).
8. Run the repository's own checks locally on your fork before relying on it: `npx tsc --noEmit --incremental false`, `node --test tests/never-in-repo.test.mjs`. CI (`.github/workflows/ci.yml`) runs the full suite on your fork's GitHub Actions; it needs no repository secrets (unverified; read the workflow if a job fails for a missing secret).

Then add students and tutors from inside the portal. Importing a roster from CRC's Maven system is CRC-only and not available to you.

## 9. Reference audio kit (optional)

The portal can play the PocketTorah reference recordings word by word. The recordings come from an openly published kit, not from the repository: release `reference-kit-v1` at https://github.com/RavBogard/bneimitzvah/releases/tag/reference-kit-v1 (about 900 MB; licence CC BY-SA 3.0; credit "PocketTorah (not-a-box media lab), CC BY-SA 3.0"). The installer verifies every file against a hash pinned in its own script before uploading anything, and uploads into **your own** private Vercel Blob store.

Cost note: this stores about 7,030 objects (7,028 clips plus the catalog and manifest), roughly 900 MB, in your Blob store. Check Vercel's current Blob pricing and get the rabbi's agreement first.

1. In Vercel, Storage, create a **Blob** store. Choose **private** access. Connect it to your project. Connecting adds `BLOB_READ_WRITE_TOKEN` to the project and shows the store id (`store_...`).
2. The dry run needs no token and no Blob store at all (verified: it downloaded the kit, checked the catalog, manifest and all 7,028 clips, uploaded nothing and printed the variables; about 15 seconds; the files land in `.reference-kit/`, which Git ignores). Run it first. For the real upload, put the token in your shell only for that command (for example run `vercel env pull .env.blob` and then load it, or paste it into the shell for the session; do not write it into the repository or a tracked file). Then:

   ```
   npm run reference-kit:install -- --dry-run     # downloads and verifies, uploads nothing, needs no token
   npm run reference-kit:install                  # verifies, then uploads (needs BLOB_READ_WRITE_TOKEN)
   ```

   Uploads are create-only, so re-running keeps what is already there. `-- --from <directory>` uses a kit already on disk. Errors print short fixed codes. The token is never printed.
3. The installer prints the environment variable names and values to set. Set them in Vercel Production: `BLOB_STORE_ID`, `REFERENCE_AUDIO_CATALOG_SHA256`, `REFERENCE_AUDIO_SHORT_MANIFEST_SHA256`, `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE`, `REFERENCE_AUDIO_STUDENT_RELEASE`. Then remove `BLOB_READ_WRITE_TOKEN` from the Production environment and redeploy. Production reads the store through the deployment's own identity, not a stored token (unverified for a fork's project; CRC works this way).
4. **The student-release switch is the congregation's choice.** The installer prints `REFERENCE_AUDIO_STUDENT_RELEASE=true` as part of a full install. If the rabbi wants to hear the recordings first, set it to `false` (or leave it unset); administrators can then audition them and students cannot hear them. Setting `true` without the catalog hash makes the app refuse to start. Ask the rabbi, do not decide.
5. Credit PocketTorah where the portal credits its sources, as the kit's `LICENSE-KIT.md` says. The kit and anything made from it stay CC BY-SA 3.0.
6. Verify: open a reading as an administrator and play a word. With the student switch on, check as a student (a test student you create) too.

## 10. Importing Daniel's reviewed guides (optional)

A rabbi at CRC can export reviewed study guides, approved portion summaries and published discussions as one `guide-export/v1` file. Ask Daniel's office for the file; it contains no student information, ids, emails or verse text.

1. Sign in as an administrator and open More, then Share guides (`/workspace/admin/guide-sharing`). The route exists and is in the build (verified: its page shell loads, titled "Share guides"; its signed-in contents and the import itself were not exercised).
2. Choose the file. The portal shows a preview and imports nothing yet.
3. Confirm. Citations are looked up again in your own catalog; any that do not match are dropped and counted in the preview.
4. What to expect: guides arrive **held** (not visible to students) and unreviewed, credited "From <author>", and are never written over a reading that already has a guide. Portion summaries arrive as drafts, and approving one needs the credit set in section 4 (it is stamped with your congregation's credit, not the original author's). Discussions are listed but are not imported. Importing the same file twice changes nothing.
5. Your rabbi reads each guide, edits as needed, and publishes. Publishing is what makes it visible to students. Do not publish for the rabbi.

## 11. Staying in sync with upstream (your choice)

Whether to follow Daniel's releases is the congregation's decision. The trade-off to explain to the rabbi: following upstream brings fixes, security corrections and new features at little effort, but each update needs a database migration and a check before it goes live. Never following leaves the copy unchanged and unsupported. Both are acceptable. A fork that edits only settings, `public/<logo>` and nothing else in the code merges upstream cleanly.

To update, in this order:

1. `git fetch upstream` and read what changed: `git log --oneline main..upstream/main` and `git diff --stat main..upstream/main -- src/server/db/migrations`.
2. On a branch, `git merge upstream/main`. Resolve conflicts, if any, in favour of upstream for everything except your own logo and settings.
3. `npm ci`, then the checks: `npx tsc --noEmit --incremental false` and `node --test tests/never-in-repo.test.mjs`. Let your fork's CI run the full suite on the branch.
4. **Apply new migrations before deploying code that needs them.** Look at the list from step 1. If there are new files in `src/server/db/migrations/`, run `node --env-file=.env.operator scripts/db-migrate.mjs` against your database first. It applies only the migrations not yet applied, in order. Never skip, reorder, edit or renumber a migration, and never apply one by hand. Migrations are additive, so the currently running old code keeps working during the short gap.
5. After a migration that creates tables, re-run the section 3.3 verification (the runtime login still has one membership and owns nothing). Migrations grant the privileges the app needs to `portal_runtime`; you do not grant anything yourself.
6. Merge the branch into `main`; Vercel deploys it. Then repeat section 8, steps 2 to 4.
7. If a deployment misbehaves, use Vercel's Instant Rollback to the previous deployment. Do not write a down migration; additive schema changes can stay.

CRC's own repository also has release scripts named `scripts/release-migrate*.mjs`. They are CRC's guarded production operators with CRC-specific checks. A fork uses `scripts/db-migrate.mjs` and does not need them.

## 12. What a fork must never do

- **Never weaken the never-in-repo guard.** `tests/never-in-repo.test.mjs` must stay green. Never edit it or its policy (`scripts/repo-policy.mjs`) to make something pass.
- **No licensed text in the repository, ever.** That includes the JPS translation, the Beit Mitzvah siddur, any copied translation or commentary, student or family data, recordings, rendered audio, model weights, and any credential or `.env` file. Text comes from Sefaria at runtime. Test data stays synthetic (`@example.test`).
- **Never use the CRC floor artwork.** The Siona Benjamin floor image under `public/brand/` is licensed to Central Reform Congregation only. The portal serves it only on CRC's own addresses. Leave that folder alone (a test checks it) and never copy, rename or reference it from your logo or settings. Use your own logo through `CONGREGATION_LOGO`.
- **Generated chant stays off.** No student hears generated or synthetic chant. There is no setting that turns it on, and you must not add one. The reference recordings of section 9 are recorded human audio, a different thing.
- **Student recordings stay off.** Leave `PORTAL_RECORDINGS_ENABLED` unset.
- **Never put the owner database URL in Vercel**, never add a role other than `portal_runtime` to the runtime login, never run the app as an owner, and never turn row-level security off.
- **Binder/Avery chant tables** may be used by your congregation for non-commercial use only, as the repository's `trope/cells/README.md` records. Do not use the portal commercially.
- Keep the portal's credits (Sefaria, Hebcal, STEPBible and the rest listed in `README.md`) and keep the licence notices. The reference-audio credit (section 9) is required if you install the kit.
- Do not make the fork public and add data to it: a public repository must hold no congregation data. Everything private lives in Vercel and Neon.
