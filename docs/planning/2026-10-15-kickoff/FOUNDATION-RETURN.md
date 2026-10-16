# Phase 0 local foundation return

2026-10-15. Sol implementation; Astra owns integration and phase status.

## Delivered

- Initialized local Git on `main`; set the authorized repository-local identity. Nothing staged, committed, pushed or deployed in this assignment.
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

## Remaining integration gates

Explicitly review/stage the intended file list and make the first commit; create/push the public repository when assigned; observe Windows/Linux CI; create/link/deploy the Vercel project when assigned; verify deployed HTTP 200 and handle domain DNS. Phase 0 is not complete before these gates. `STATE.md` remains owned by Astra.

## Official version evidence

- [Node release schedule and LTS status](https://nodejs.org/en/about/previous-releases)
- [Next support policy](https://nextjs.org/support-policy)
- [October 14 Next security update and patched minimum](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [Official Next 16.4.2 release](https://github.com/vercel/next.js/releases/tag/v16.4.2)
- [Next 16 runtime requirements](https://nextjs.org/docs/app/guides/upgrading/version-16)
