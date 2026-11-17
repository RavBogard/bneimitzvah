# Phase 0 local foundation return

2026-10-15. Sol implementation; Astra owns integration and phase status.

## Delivered

- Initialized local Git on `main`; set the authorized repository-local identity. The initial local-only assignment ended before staging, committing, pushing or deploying; the subsequently authorized publication assignment is recorded below.
- Minimal Next.js App Router/TypeScript shell with only the approved product heading. No portal feature work or visual direction was introduced.
- Exact npm dependency pins and lockfile; `.env.example` contains names only; MIT code licence; local logs ignored.
- Offline Node tests plus a real PGlite transaction/constraint probe. Playwright exercises the production server on desktop, tablet and phone. CI config runs tests, typecheck and build on Windows/Linux, and Chromium browser checks on Linux.
- `isolatedEnv.mjs` and its original tests came from haftarah `5b2530f`; extended the credential names, recursive lint coverage and real-child/home-cleanup test. Source repo was read only.
- Repository policy checks worktree publish candidates including untracked files, and staged blobs independently. Force-staged ignored files are included. Regressions cover secret formats, prohibited paths, safe configuration/synthetic paths, stale staged content, and sanitized Git failure paths. Known forbidden media/key blobs are rejected without reading their contents.
- README corrected to describe the actual local foundation and future engine import.

## Decisions and intentional deferrals

- Node 24 LTS major baseline in `.nvmrc`, engines and CI, approved by Astra to match the installed major. Local verification used Node 24.11.1/npm 11.6.2. The official Node page currently lists 24.22.0 as latest LTS; the system installation was not changed, and hosted CI will resolve the current 24 patch.
- Next 16.4.2 and React/React DOM 19.3.1; official Next security guidance requires at least 16.4.1. Exact versions confirmed against npm registry metadata. TypeScript 7.0.2, Vitest 5.0.5, PGlite 0.5.10, Playwright 1.64.1.
- Vitest config uses `.mts` so the root package can remain without `type: module`, preserving the planned engine's mixed module compatibility.
- Drizzle, schema, migration jobs and `db:*` commands wait for Phase 2. No command pretends to run a migration before one exists. Auth, email, Blob and MCP dependencies wait for their implementing phases.
- Publisher/version patterns are a licensing tripwire, not proof of a text's licence. Email/filename patterns cannot identify every piece of student data. Fixture provenance and human review remain necessary. No engine or calibration fixtures were imported here.

## Local verification

- `npm test`: 9 Node tests and 1 Vitest/PGlite test passed, no network services.
- `npm run typecheck`: passed.
- `npm run build`: passed, production `/` and Next not-found routes generated.
- `npm run test:e2e`: 3 passed (desktop, tablet, phone), HTTP 200, correct title/heading/language and no horizontal overflow.
- `npm install`: 0 reported vulnerabilities. Verbose verification output is in ignored `.local-logs/`.
- Astra independently reviewed the guard and requested sanitizing subprocess errors; implementation and a real failing-Git regression now discard command output, causes and sensitive arguments. Final review disposition belongs to Astra.
- Follow-up publication assignment: Astra accepted the guard review. Impeccable mechanical detection ran once over the minimal page/layout and returned zero findings; this is not a portal visual-design review. Explicitly staged the reviewed foundation/PM file list and reran the guard successfully against the staged index before the initial snapshot commit.

## Publication and hosted gates

- Explicitly staged 32 reviewed foundation and PM files, verified the staged index guard, then committed foundation snapshot `452c1c51a9f6c872502c588cbbc1d65d47bccaa8` and pushed that exact SHA to public [RavBogard/bneimitzvah](https://github.com/RavBogard/bneimitzvah).
- [Hosted CI run 38832145643](https://github.com/RavBogard/bneimitzvah/actions/runs/38832145643) completed successfully: Windows and Ubuntu unit tests/typecheck/build, and Ubuntu Chromium browser checks.
- Created `bneimitzvah` in existing Vercel team `ravbogards-projects`, connected the GitHub repository and `main` production branch, and set Next.js/Node 24/`npm ci`/`npm run build`. No paid plan change or database, email or Blob resources were created.
- Deployed from a separate immutable foundation checkout, not the later locally integrated engine tree. Deployment `dpl_6az884sdBn8ys6Rezn8yGQ2LNwDN` is Ready. [Stable placeholder](https://bneimitzvah.vercel.app) returned HTTP 200; browser verified exact product heading/title. Phone screenshot visually checked in ignored local logs. [Immutable deployment](https://bneimitzvah-kq4bc11zk-ravbogards-projects.vercel.app).
- Added `bneimitzvah.centralreform.org` to the project only after the basic deploy passed. DNS remains misconfigured at the external SiteGround nameservers. Vercel's domain configuration API recommends a **CNAME** named `bneimitzvah` in the `centralreform.org` zone, pointing to **`a008a8e486abbe24.vercel-dns-016.com.`** (rank 1); its fallback is `cname.vercel-dns.com.`. No DNS changes were made. Do not change the parent domain's nameservers for this subdomain.
- During local engine integration, Markdown `` `@spaces.GPU` `` in imported research exposed a false email match. Local-only guard fix `b02eb1e06f7fbe64fca11153a4493060380df1ca` excludes Markdown code delimiters from unquoted email matches, with regressions preserving real-email rejection. Six focused policy/integration tests passed against the imported tree. This fix and the engine commits have not been pushed; remote main remains the reviewed foundation SHA.
- Haftarah source repository was only read with `git show`; it was not modified. `STATE.md` and overall phase status remain owned by Astra. Custom-domain DNS is the remaining external setup item for this foundation deployment; this placeholder is not a student application release.

## Official version evidence

- [Node release schedule and LTS status](https://nodejs.org/en/about/previous-releases)
- [Next support policy](https://nextjs.org/support-policy)
- [October 14 Next security update and patched minimum](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [Official Next 16.4.2 release](https://github.com/vercel/next.js/releases/tag/v16.4.2)
- [Next 16 runtime requirements](https://nextjs.org/docs/app/guides/upgrading/version-16)
