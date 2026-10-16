# State — CRC B'nei Mitzvah portal

Authority: `MISSION.md` (Daniel's rulings). Plan: `PLAN-CODE-2026-10-15.md`. This file says where the work stands. Update it at the end of every session and every phase.

Current phase: 1 (local engine migration verified; publication and hosted engine CI await permission/provenance decisions). Phase 0 foundation is published, hosted CI passes, and the Vercel placeholder serves HTTP 200; custom-domain DNS remains pending. Engine source: haftarah `trope-engine-research` at `380b1b2`, verified against GitHub on 2026-10-15. Haftarah `main` reference: `5b2530f`.

Current execution authority: Daniel requested Astra as project manager and Sol agents as implementers on 2026-10-15. See `PM-REVIEW-2026-10-15.md` for confirmed amendments, review findings, and proposals. Root `PRODUCT.md` captures the completed Impeccable product interview; the chosen workflow is code-first.

## Gates

Format, one line each, newest last:

- `GATE: <what was checked or decided> — proceeded because <reason>`
- `BLOCKED (Daniel): <what is needed from him, in one line>`
- `SUBSTITUTION: <seat> ran on Opus after Fable failed — <date>`

GATE: engine test count is 108, not the 314 MISSION names — proceeded because the other 206 of the branch's 314 are haftarah sheet tests that do not move (measured 2026-10-15; 1 trope test fails on Linux, fixed in Phase 1 step 7).
GATE: MAM Hebrew (CC BY-SA) and Hebcal (CC BY) calibration fixtures come over with the engine — proceeded because the same files are already public on haftarah's branch; Daniel confirms (plan, open item a).
GATE: independent Phase 0 repository-guard review by Astra — subprocess-error disclosure finding fixed by Sol and covered by a regression; approved at this scope, with documented limits of content heuristics.
GATE: Node 24 LTS replaces the planned Node 22 baseline — local runtime is 24.11.1, CI tracks supported 24.x; no system runtime replacement was performed.
BLOCKED (Daniel): resolve engine melody-table and fixture publication permissions before pushing the extracted history; local migration is complete.
GATE: local engine move preserved 25 source commits and passed 109 engine tests on Windows and Ubuntu WSL — migration is verified locally; no generated audio was released.
GATE: full local integration passed 119 Node tests plus 1 Vitest/PGlite test — repository guard false-positive fix also reviewed by Astra.
GATE: published foundation `452c1c5` passed all hosted Windows/Linux/browser jobs and Vercel HTTP 200 — Phase 0 acceptance met at the Vercel hostname.
BLOCKED (Daniel): custom domain needs CNAME host `bneimitzvah` pointing to `a008a8e486abbe24.vercel-dns-016.com.` at the existing DNS provider.

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
- [ ] Gate: 108 engine tests + parity green Windows + CI

### Phase 2 — Data model, tenancy, auth, roles, admin
- [ ] auth/tenancy design spec (Fable)
- [ ] schema + first migration + seed
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
- Foundation: [public repo](https://github.com/RavBogard/bneimitzvah), [green hosted CI](https://github.com/RavBogard/bneimitzvah/actions/runs/38832145643), [Ready/HTTP-200 title-only placeholder](https://bneimitzvah.vercel.app). Remote main and deployment remain foundation `452c1c5`; **do not push local main while engine publication gates remain open**. See `FOUNDATION-RETURN.md` for pins, browser checks, deployment and DNS details.
- Engine: local history merge `afd56ae`, parity/portability `ee77d23`, reviewed guard correction `b02eb1e`, provenance/license update `8de656c`. 109/109 engine tests on Windows and Ubuntu WSL; 119 Node + 1 PGlite test in final combined Windows suite. See `ENGINE-MIGRATION-RETURN.md` and `trope/PROVENANCE.md`. Source haftarah checkout and refs unchanged. No render/GPU job, audio upload, or student release occurred.
- Next action: resolve the recorded engine publication decisions, push only once cleared, then verify hosted engine CI to complete Phase 1. Phase 2 starts with the auth/tenancy architecture spec, including guardian identity versus child practice context. Custom-domain DNS can be completed independently. Earlier supervised pilot after Phase 4 remains a recommendation awaiting Daniel's decision.
- Earlier 2026-10-15: original Cowork planning files written before build work began.
