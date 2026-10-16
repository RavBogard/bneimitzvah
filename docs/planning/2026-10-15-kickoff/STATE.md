# State — CRC B'nei Mitzvah portal

Authority: `MISSION.md` (Daniel's rulings). Plan: `PLAN-CODE-2026-10-15.md`. This file says where the work stands. Update it at the end of every session and every phase.

Current phase: 2. Published checkpoint `17669af` adds private reading/session projections, recipient-bound invitation review and HTTP boundary/pending-cookie primitives to the earlier practice/runtime services. Independent review accepted the scope. All four hosted jobs passed in [run 38845190293](https://github.com/RavBogard/bneimitzvah/actions/runs/38845190293), including Windows/Linux app checks, production browser smoke and PostgreSQL SQL/service gates. Matching Vercel deployment `7110045961` succeeded; the public application still contains only the title placeholder. Phase 2 is not complete: HTTP routes are now being built, followed by the isolated browser harness, authority-management workflows, role pages and live-provider checks. DNS remains pending. Engine source: haftarah `trope-engine-research` at `380b1b2`, verified against GitHub on 2026-10-15; main reference `5b2530f`.

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
GATE: prerequisite publication `2795dcc` passed hosted Windows/Linux/browser/PostgreSQL jobs in run `38836579205`; its production deployment reports success and the stable Vercel placeholder returns HTTP 200. Phase 2 application workflows are still under construction.
GATE: access/host service independent review passed 23 focused tests after tightening unexpected-role membership checks. Primary readings review found and closed cached date/calendar binding and explicit-custom-on-empty-calendar issues; 12 reading tests pass. Full local integration passes 120 Node + 45 app tests, typecheck/build and 3 placeholder browser checks. Real concurrent service/revocation checks subsequently passed in checkpoint `346ab44`; live-provider flows remain later gates.

GATE: real PostgreSQL access/revocation checkpoint `346ab44` passed all hosted jobs in run `38839377952`, including 6 SQL tests and 3 service tests covering six lock-observed races; the matching Vercel deployment reports success. See `POSTGRES-ACCESS-RETURN.md` for local and hosted transport limits.

GATE: invitation/bootstrap and roster/reading/CSV services passed independent review after closing stale-invitation, immutable-owner and durable-delivery findings. Final local integration passes 120 Node + 73 app tests, typecheck/build and 3 placeholder browser checks. Real PostgreSQL 16.15 passes 6 SQL + 5 service tests, including observed same-token redemption and first-assignment unique-index contention. See `PHASE2-SECURITY-REVIEW.md`, `STUDENTS-RETURN.md` and `POSTGRES-ACCESS-RETURN.md`; no route/live-provider or complete-Phase-2 claim is made.

GATE: invitation/roster/reading checkpoint `18918c0` passed hosted Windows/Linux unit, browser and PostgreSQL jobs in run `38841820697`. The PostgreSQL job includes 6 SQL + 5 service tests and actual invitation/first-assignment contention. The matching deployment reports success and the stable placeholder returns HTTP 200. Provider setup, child contexts and portal screens remain outside this verified checkpoint.

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
- [ ] Hebcal + `leyning.mjs` copy; verse proposal (pure layer, bounded fetch/cache adapter, trusted numeric catalog and authorized persistence built; runtime cache wiring and UI remain)
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
- Published portal checkpoint `17669af`: combined Windows baseline 120 Node + 123 app tests and build; independent focused rerun 42/42, including three new adversarial tests, plus typecheck. Current-code PostgreSQL service regression 7/7; hosted checks passed after adding reviewer tests. See `PORTAL-RETURN.md`, `HTTP-RETURN.md` and `PHASE2-SECURITY-REVIEW.md`. No routes or browser harness are claimed by this checkpoint.
- HTTP checkpoint ready for publication: explicit auth/portal route allowlists, real SDK cookies, encrypted student review bindings and `/invitations/open` token landing passed independent review. The reviewer found a forwarding-header throttle bypass; Sol fixed every SDK entry path with closed header reconstruction and a server-selected origin bucket. This temporarily shares five magic-link attempts/minute across an origin; provider-readiness must address availability before family access. Local integration passed 120 Node + 148 app tests, production build, seven real PostgreSQL service regressions, three production placeholder browser checks and focused independent auth verification (20/20). See `HTTP-RETURN.md`, `PORTAL-RETURN.md` and `PHASE2-SECURITY-REVIEW.md`. No role UI or live-provider claim.
- Active work: isolated browser harness has a four-test passing baseline, but independent review requires correcting Next dev output/config isolation, production bundle coverage/local-flag probes, and redirect-safe egress blocking before acceptance; see `BROWSER-RETURN.md`. Separate authority-management service work follows this HTTP checkpoint. Browser UI must still serialize sibling selection and discard late old-child responses. Provider steps are in `PROVIDER-SETUP.md`; Impeccable direction remains pending in `UI-DIRECTION.md`. No student release, provider email or live database migration occurred.
- Earlier 2026-10-15: original Cowork planning files written before build work began.
