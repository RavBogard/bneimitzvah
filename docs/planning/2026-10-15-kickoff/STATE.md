# State — CRC B'nei Mitzvah portal

Authority: `MISSION.md` (Daniel's rulings). Plan: `PLAN-CODE-2026-10-15.md`. This file says where the work stands. Update it at the end of every session and every phase.

Current phase: 0 (local foundation in progress; CI and deployment unverified). Engine source: haftarah `trope-engine-research` at `380b1b2` (re-check the tip in Phase 1). Haftarah `main` reference: `5b2530f`.

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
BLOCKED (Daniel): resolve engine melody-table and fixture publication permissions before pushing the extracted history; local migration preparation continues.

## Checklist

### Phase 0 — Repo, scaffolding, CI, never-in-repo test
- [ ] git init, first commit, `gh repo create` (public), push, status clean
- [x] repo-local git identity RavBogard (GitHub noreply)
- [x] Next.js scaffold created, deps pinned
- [x] package.json test, browser, typecheck and build scripts (`db:*` intentionally deferred to Phase 2 with real schema/migrations)
- [x] isolatedEnv + isolation test copied, CLEARED extended
- [x] never-in-repo test and independent review
- [x] LICENSE (MIT), `.env.example`
- [x] CI configuration: ubuntu + windows `npm test`; ubuntu e2e (hosted execution pending)
- [ ] Vercel project `bneimitzvah`, placeholder deployed, domain added
- [ ] Gate: `npm test` green Windows + CI; build; deploy 200

### Phase 1 — Engine move
- [ ] branch tip recorded
- [ ] filter-repo extract (commit count recorded)
- [ ] merged with history; `git log --follow trope/melody.mjs` checked
- [ ] `trope/lib-trope.cjs`
- [ ] path rewrites in `text.mjs` and `trope-text.test.mjs`
- [ ] parity golden + `trope-lib.test.mjs`
- [ ] `findModal` Linux fix
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

- 2026-10-15: planning files written in Cowork; nothing built.

### Active milestone — 2026-10-15 PM handoff

- Confirmed all-device home practice and Zoom tutoring; parent sign-in with explicit linked child practice contexts; code-first design workflow.
- Sol owns local Phase 0 scaffold, pinned dependencies, CI configuration, isolation helper, and repository guard. Astra owns planning records and integration decisions. Independent guard review follows implementation.
- No student release approved. Engine publication remains gated on provenance/permissions and a scan of the history to be published.
- Next: complete local build/tests, resolve independent review findings, then verify repository publication, CI, and placeholder deployment access. Do not call Phase 0 complete from local checks alone.

### Local foundation verification — 2026-10-15

- Sol reports passing on Windows/Node 24.11.1: 9 Node tests, 1 PGlite test, typecheck, Next production build, and 3 Playwright device projects (desktop, tablet, phone).
- Dependency pins include Next 16.4.2 and React 19.3.1; install audit reports zero vulnerabilities. Version selection checked against official Next release/security guidance. No production/student features are present.
- Root Git initialized. No remote publication or deployment verified yet. A separate Sol worker is preparing the engine extraction; GitHub research tip matches local `380b1b2` and the filtered history contains 25 commits. Engine test results pending.
