# State — CRC B'nei Mitzvah portal

Authority: `MISSION.md` (Daniel's rulings). Plan: `PLAN-CODE-2026-10-15.md`. This file says where the work stands. Update it at the end of every session and every phase.

Current phase: 2. Auth SDK compatibility, schema/migrations, restricted-role transaction helper and real-Postgres CI gate are implemented and independently reviewed; local integration is green, hosted verification pending. This is a prerequisite checkpoint, not Phase 2 completion. Invitations, capability services, routes, role pages and live providers remain ahead. Phases 0 and 1 are published and verified. Custom-domain DNS remains pending. Engine source: haftarah `trope-engine-research` at `380b1b2`, verified against GitHub on 2026-10-15. Haftarah `main` reference: `5b2530f`.

Current execution authority: Daniel requested Astra as project manager and Sol agents as implementers on 2026-10-15. See `PM-REVIEW-2026-10-15.md` for confirmed amendments, review findings, and proposals. Root `PRODUCT.md` captures the completed Impeccable product interview; the chosen workflow is code-first.

Delivery sequence (Daniel, 2026-10-15): finish all planned features before any human testing beyond Daniel. No early student/parent/tutor pilot. Automated tests and agent reviews continue; Phase 7 follows feature completeness, including MCP and generated chant, and Daniel's approval.

Latest product/setup decisions (Daniel, 2026-10-15): student entry opens directly on the assigned reading with practice tools alongside it. Google OAuth, Neon and Resend are not configured; continue building locally and prepare provider setup steps. No provider provisioning is requested by this decision.

## Gates

Format, one line each, newest last:

- `GATE: <what was checked or decided> — proceeded because <reason>`
- `BLOCKED (Daniel): <what is needed from him, in one line>`
- `SUBSTITUTION: <seat> ran on Opus after Fable failed — <date>`

GATE: engine test count is 108, not the 314 MISSION names — proceeded because the other 206 of the branch's 314 are haftarah sheet tests that do not move (measured 2026-10-15; 1 trope test fails on Linux, fixed in Phase 1 step 7).
GATE: MAM Hebrew (CC BY-SA) and Hebcal (CC BY) calibration fixtures come over with the engine — proceeded because the same files are already public on haftarah's branch; Daniel confirms (plan, open item a).
GATE: independent Phase 0 repository-guard review by Astra — subprocess-error disclosure finding fixed by Sol and covered by a regression; approved at this scope, with documented limits of content heuristics.
GATE: Node 24 LTS replaces the planned Node 22 baseline — local runtime is 24.11.1, CI tracks supported 24.x; no system runtime replacement was performed.
GATE: Daniel confirmed noncommercial use permission and expressly authorized public-repository inclusion of the Binder/Avery tables on 2026-10-15 — publication can proceed with distinct table notices and fixture attribution; the MIT code license does not replace those terms.
GATE: local engine move preserved 25 source commits and passed 109 engine tests on Windows and Ubuntu WSL — migration is verified locally; no generated audio was released.
GATE: full local integration passed 119 Node tests plus 1 Vitest/PGlite test — repository guard false-positive fix also reviewed by Astra.
GATE: published foundation `452c1c5` passed all hosted Windows/Linux/browser jobs and Vercel HTTP 200 — Phase 0 acceptance met at the Vercel hostname.
GATE: engine publication `da12401` passed hosted Windows/Linux/browser CI run `38833091139` and its Vercel deployment is Ready/HTTP 200 — Phase 1 complete; noncommercial table terms and fixture attribution are recorded, with no remaining engine-publication blocker.
BLOCKED (Daniel): custom domain needs CNAME host `bneimitzvah` pointing to `a008a8e486abbe24.vercel-dns-016.com.` at the existing DNS provider.
GATE: Phase 2 prerequisite independent security review found a privileged login masked by SET ROLE; Sol fixed checks for both session and active identities and transitive elevated/owner membership. Reviewer verified the fix and found no remaining blocker at this scope; see `PHASE2-SECURITY-REVIEW.md`.
GATE: prerequisite local integration passed 120 Node tests, 21 app tests, typecheck, build and 3 placeholder browser checks. Separate real PostgreSQL 16.15 tests passed 6/6; CI targets 17.11. Live Neon WebSocket transport and provider round trips are not established by these checks.

## Checklist

### Phase 0 — Repo, scaffolding, CI, never-in-repo test
- [x] git init, first commit, `gh repo create` (public), foundation push, status clean
- [x] repo-local git identity RavBogard (GitHub noreply)
- [x] Next.js scaffold created, deps pinned
- [x] package.json test, browser, typecheck and build scripts (`db:*` intentionally deferred to Phase 2 with real schema/migrations)
- [x] isolatedEnv + isolation test copied, CLEARED extended
- [x] never-in-repo test and independent review
- [x] LICENSE (MIT), `.env.example`
- [x] CI: ubuntu + windows `npm test`; ubuntu e2e (hosted foundation jobs green)
- [x] Vercel project `bneimitzvah`, placeholder deployed, domain added (external DNS pending)
- [x] Gate: foundation `npm test` green Windows + CI; build; deploy 200

### Phase 1 — Engine move
- [x] branch tip recorded
- [x] filter-repo extract (25 retained source commits)
- [x] merged with history; `git log --follow trope/melody.mjs` checked
- [x] `trope/lib-trope.cjs`
- [x] path rewrites in `text.mjs` and `trope-text.test.mjs`; missing source fixtures reduced to Hebrew-only fields
- [x] parity golden + `trope-lib.test.mjs` (182 verses, 400 variants)
- [x] `findModal` Linux fix (Windows joins and PATH delimiters)
- [x] Gate: 108 engine tests + parity green Windows + CI

### Phase 2 — Data model, tenancy, auth, roles, admin
- [x] auth/tenancy design spec (Sol drafted; Astra approved direction; pinned SDK compatibility checked locally)
- [x] schema + migrations + nonpersonal CRC seed (no owner identity in public seed)
- [ ] Better Auth: Google, magic link, sessions, invites
- [ ] Hebcal + `leyning.mjs` copy; verse proposal
- [ ] admin, tutor, parent, student pages
- [ ] redacting logger
- [ ] adversarial pass (auth, isolation)
- [ ] Gate: role matrix, two-tenant suite, Playwright, CI migration, deploy

### Phase 3 — Study page
- [ ] Sefaria texts + cache + credits
- [ ] verse view: trope colours, picker, transliteration toggle
- [ ] word data load + word panel
- [ ] commentary: defaults, assigned, all; approved summaries
- [ ] own-translation drafts; tutor notes
- [ ] source defaults page; assign from verse
- [ ] printable trope chart
- [ ] fonts + OFL texts
- [ ] Gate: golden, Playwright, deploy; Daniel approves the page

### Phase 4 — Audio
- [ ] recordings store; spend notice checked
- [ ] player (slot empty)
- [ ] tutor per-verse uploads
- [ ] record-yourself, send to tutor, inbox, parent view
- [ ] adversarial pass (recording access)
- [ ] Gate: Vitest, Playwright, deploy; Daniel approves

### Phase 5 — MCP
- [ ] `/api/mcp` + OAuth, role limits
- [ ] tools
- [ ] Gate: tool tests, no-leak test, adversarial pass, deploy; Daniel connects

### Phase 6 — Generated chant behind G3
- [ ] laptop commits ported; render work continues here
- [ ] engine Wave 1 remainder
- [ ] `trope/chant.mjs`
- [ ] `chant-queue`, `chant-encode`, G1/G2 offline
- [ ] `bneimitzvah-chant` store; spend notice confirmed
- [ ] `chant-publish`, `chant_render` rows
- [ ] G3 review page; Daniel's pass
- [ ] gated player, label, nusach row
- [ ] drills + chart audio
- [ ] Gate: release-gate test, manifest allow-list, deploy

### Phase 7 — Pilot
- [ ] student, family, tutor chosen (Daniel)
- [ ] start-to-finish run; workarounds logged and fixed
- [ ] 1.0: a run with no workaround

## Resume notes

(Newest first. What was done, what is half done, the exact next step, test counts, last deploy URL and status.)

- 2026-10-15, Astra/Sol milestone: reviewed Cowork's plan and completed Impeccable init. Confirmed all-device practice, Zoom tutoring, linked child practice views, and code-first. See `PM-REVIEW-2026-10-15.md` and root `PRODUCT.md`.
- Publication: [public repo](https://github.com/RavBogard/bneimitzvah), [green engine CI](https://github.com/RavBogard/bneimitzvah/actions/runs/38833091139), [Ready/HTTP-200 title-only placeholder](https://bneimitzvah.vercel.app). Engine publication `da12401` is the verified public code/deployment, including all 25 historical commits. See `FOUNDATION-RETURN.md` for the earlier foundation checks and pending DNS details.
- Engine: local history merge `afd56ae`, parity/portability `ee77d23`, reviewed guard correction `b02eb1e`, provenance/license update `8de656c`. 109/109 engine tests on Windows and Ubuntu WSL; 119 Node + 1 PGlite test in final combined Windows suite. See `ENGINE-MIGRATION-RETURN.md` and `trope/PROVENANCE.md`. Source haftarah checkout and refs unchanged. No render/GPU job, audio upload, or student release occurred.
- Next action: finish hosted verification of the Phase 2 prerequisite checkpoint, then delegate exact-host resolution, verified-session capability services, explicit invitations and per-tab child contexts under `docs/superpowers/specs/2026-10-15-auth-tenancy-design.md`. Read `PHASE2-RETURN.md` and `PHASE2-SECURITY-REVIEW.md` for implementation/evidence limits. Provider setup steps are in `PROVIDER-SETUP.md`; Daniel confirmed these services are not configured and asked to continue locally. The open Impeccable direction round is recorded in `UI-DIRECTION.md`; student reading-first entry and code-first are settled. Canonical auth origin is the custom domain; the Vercel hostname remains a placeholder. No student release, provider email or live database migration occurred.
- Earlier 2026-10-15: original Cowork planning files written before build work began.
