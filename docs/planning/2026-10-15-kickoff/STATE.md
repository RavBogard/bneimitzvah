# State — CRC B'nei Mitzvah portal

Authority: `MISSION.md` (Daniel's rulings). Plan: `PLAN-CODE-2026-10-15.md`. This file says where the work stands. Update it at the end of every session and every phase.

Current phase: 2, with the Phase 3 text pipeline in progress. Verified public checkpoint `2b37394` adds reviewed admin invitation management and authorized cached study-text delivery. All four jobs passed in [run 38891100680](https://github.com/RavBogard/bneimitzvah/actions/runs/38891100680), and matching deployment `7117315075` succeeded. Stable Vercel entry and the invitation route return HTTP 200; unconfigured session access returns fixed 503 with private/no-store/no-referrer headers. Phase 2 remains incomplete: relationship/CSV interfaces, private owner admin operations and live-provider checks remain. The text endpoint has no published frontend consumer; the rest of Phase 3 is not delivered. Engine source: haftarah `trope-engine-research` at `380b1b2`, verified against GitHub on 2026-10-15; main reference `5b2530f`.

Current execution authority: Daniel requested Astra as project manager and Sol agents as implementers on 2026-10-15. See `PM-REVIEW-2026-10-15.md` for confirmed amendments, review findings, and proposals. Root `PRODUCT.md` captures the completed Impeccable product interview; the chosen workflow is code-first.

Active continuation, 2026-10-16: Daniel asked whether the product was finished; Astra clarified that the deployed checkpoint is incomplete and resumed the authorized campaign. Published checkpoint `2b37394` passed independent authority review after explicit disconnect and final-read natural-expiry checks. Fresh visual review closed long-value overflow in phone invitation confirmation and returned `ship` for that scored fix. Local integration passed 127 Node + 329 app tests, 24 real PostgreSQL service tests (including eleven study authority/expiry cases), 22 actual-SDK/private-PostgreSQL browser tests, typecheck/build and six production-page browser checks, followed by all four hosted jobs. See `INVITATION-UI-RETURN.md`, `INVITATION-UI-FINISH-REVIEW.md`, `STUDY-AUTHORITY-RETURN.md` and `PHASE2-SECURITY-REVIEW.md`. The next local candidate now has reviewed assigned-text display and private owner admin commands, ready for publication. Integration passes 127 Node + 347 app tests (one POSIX-only Windows skip), final 25 authenticated-browser checks, typecheck/build and six production-page checks. Four new owner PostgreSQL tests pass separately from the previous 24-test checkpoint. The fresh visual reviewer accepted the reading-first phone correction; the scoped workspace brief is updated. See STUDY-UI-RETURN.md, STUDY-UI-FINISH-REVIEW.md and OWNER-ADMIN-RETURN.md. Candidate 362986e is pushed and its matching Vercel deployment 7117819796 succeeded, but hosted run 38894007060 found one Linux phone-first-viewport assertion failure (24/25 browser checks; all 28 database service checks passed). Sol is diagnosing that cross-platform failure before acceptance. The previous 2b37394 remains the last fully green checkpoint. Astra approved explicitly confirmed absent-membership creation and new-row regrant after revoked-history confirmation, with permanent owner-grant protection and no authority revival; see `OWNER-ADMIN-PLAN.md`. Sol has an approved bounded plan for relationship/CSV interfaces, queued behind that correction. A separate Sol worker is implementing student-translation and tutor-note persistence under STUDENT-WORK-PLAN.md; retained history must not reference ephemeral sessions/contexts by FK or block logout. These next changes are unreviewed. Full product remains incomplete.

Delivery sequence (Daniel, 2026-10-15): finish all planned features before any human testing beyond Daniel. No early student/parent/tutor pilot. Automated tests and agent reviews continue; Phase 7 follows feature completeness, including MCP and generated chant, and Daniel's approval.

Latest product/setup decisions (Daniel, 2026-10-15): student entry opens directly on the assigned reading with practice tools alongside it. Daniel selected **Annotated score** in chat because the desktop chooser was inaccessible from his phone. He supplied a Google Web client export; only configuration shape and nonsecret redirect metadata were inspected. He reports correcting the previously supplied custom-domain/local callbacks; the additional active Vercel callback is `https://bneimitzvah.vercel.app/api/auth/callback/google`. Credentials remain private and unconfigured. Neon and Resend remain unconfigured; continue locally and prepare setup steps. No provider provisioning is requested by this decision.

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
- Published HTTP checkpoint `e0766f4`: explicit auth/portal route allowlists, real SDK cookies, encrypted student review bindings and `/invitations/open` token landing passed independent review and all four hosted jobs. The reviewer found a forwarding-header throttle bypass; Sol fixed every SDK entry path with closed header reconstruction and a server-selected origin bucket. This temporarily shares five magic-link attempts/minute across an origin; provider-readiness must address availability before family access. Local integration passed 120 Node + 148 app tests, production build, seven real PostgreSQL service regressions, three production placeholder browser checks and focused independent auth verification (20/20). See `HTTP-RETURN.md`, `PORTAL-RETURN.md` and `PHASE2-SECURITY-REVIEW.md`. No role UI or live-provider claim.
- Published browser harness `a1a9c00`: all four jobs passed in [run 38848281288](https://github.com/RavBogard/bneimitzvah/actions/runs/38848281288), including the new browser HTTP/production-denial step. Private local PostgreSQL/browser suite passed 6/6 after corrections; independent focused checks passed 6/6, including two new startup/raw-header probes, plus typecheck and process-isolation checks. Reviewed temporary Next projects keep root config/build unchanged; production wrappers deny fake identities/local test flags; fetch redirects cannot escape the egress guard. See `BROWSER-RETURN.md`. This tooling checkpoint has no application behavior change; the latest observed successful Vercel deployment remains `e0766f4`. One ignored `.local-logs/http-browser-project-XkpsGh` directory remains after automatic approval review rejected cleanup; later corrected runs clean up successfully. No provider or role-UI proof is claimed.
- Published relationship checkpoint `86757bc`: migration 0007 adds positive guardian/grant revisions and two audit actions. Admin services and nine HTTP routes support tutor assignment, exact-link revocation, guardian practice controls, non-admin grant revocation and cantor flags; tenant-authorized names identify selections. Reads do not require a fresh sign-in; authority writes do. Core and adapter independent reviews passed (52/52 and 24/24 focused), including five new adversarial tests across those reviews. Combined Windows baseline passed 120 Node + 170 app tests before the final two reviewer tests, plus build/typecheck; real PostgreSQL 9/9 includes both observed guardian-revocation/write orderings, and browser suite 8/8 passes with runtime wiring. Hosted checks and deployment subsequently passed. See `RELATIONSHIPS-RETURN.md` and `PHASE2-SECURITY-REVIEW.md`.
- Published listing/guard checkpoint `876a32b`: independent listing checks pass 33/33 with typecheck; focused guard checks pass 14/14, including a tab-containing index-path regression corrected before publication. Combined Windows baseline passed 122 Node + 181 app tests before the final guard regression; real PostgreSQL browser checks pass 8/8 with the new listing route exercised, and production build passes. The staged repository guard passed before push. See `PHASE2-RETURN.md` and `PHASE2-SECURITY-REVIEW.md` for scope and limits.
- Published temporary-origin checkpoint `800a917`: one configured origin accepts requests even though both exact CRC production hosts have directory rows. Independent auth/runtime checks passed 42/42; fresh real PostgreSQL migration/RLS checks passed 6/6. The first SQL check correctly refused an already populated disposable database, then passed in a new cluster that was stopped. Design metadata gets one exact reviewed path allowance; private attachments and review-only screenshots stay out of Git. All hosted jobs and deployment passed. See `PHASE2-SECURITY-REVIEW.md` and `PROVIDER-SETUP.md`.
- Initial entry UI: real sign-in/session/invitation states at `/`, `/sign-in`, `/invitations/accept`; explicit one-time acceptance, recoverable fixed errors, no fake passage or role destinations. Baseline 124 Node + 190 app checks passed before three new production-isolation tests; those and isolation checks pass 6/6 independently. Existing browser checks passed 8/8; five new real-SDK browser checks passed after a locator-only correction. Built production UI passed 6/6 with the isolated server helper. Fresh Impeccable review returned `ship` across seven captures; DESIGN.md and schema-v2 design metadata are extracted and validated. See `UI-DIRECTION.md`, `UI-FINISH-REVIEW.md`, `BROWSER-RETURN.md` and the security review for boundaries. No native BFCache or live-provider claim.
- Initial entry publication `291b742`: final local Node suite passed 127/127; all four hosted jobs and Vercel succeeded as recorded above. Production remains deliberately unavailable for sign-in until providers are configured.
- Role-workspace checkpoint, 2026-10-16: direct student reading references, explicit parent/tutor selection and per-tab child practice, admin roster create/edit/disable. Independent review corrected draft loss across Zoom/tab switches, stale role notices and phone-table wrapping. The fresh finish reviewer scored both material visual fixes resolved; the documenter validated the incumbent system without rewriting DESIGN.md. See `WORKSPACE-RETURN.md` and `WORKSPACE-FINISH-REVIEW.md`. Production build and six isolated production browser checks pass. Final actual-SDK/restricted-PostgreSQL workspace checks pass 3/3; five updated entry checks also passed. Full local integration passed 127 Node checks and 255/256 app checks; the sole failure was a synthetic clock mismatch, corrected without weakening production validation, with focused checks passing 15/15. Publication/hosted checks are next.
- Study adapter, 2026-10-16: reviewed bounded Sefaria client, exact edition registry and structured Hebrew normalization; 51 synthetic checks and two private live contract checks pass. No route/cache/authorization composition is exposed. Unknown MAM structures and broader edition coverage remain explicit limitations. See `STUDY-ADAPTER-RETURN.md` and `STUDY-PIPELINE-PLAN.md`.
- Published `beac58f`: all four hosted jobs pass, including the complete Windows/Linux suites after the fixture-clock correction. Vercel deployment succeeds and stable entry/workspace/API behavior is verified. The disposable PostgreSQL cluster on port 55439 was stopped. Only this state note and the return status were updated locally after publication, ready for the next milestone commit; application/source changes are committed and pushed.
- Next after this checkpoint: remaining Phase 2 invitation/relationship, reading-confirmation and CSV interfaces; private owner admin operations; live-provider setup/checks. Then compose the text adapter with runtime cache and authorization before/final revalidation after fetch, including real concurrency tests. Hebrew text/audio stay unavailable until their pipelines/gates are satisfied. Provider corrections are in `PROVIDER-SETUP.md`. No real-family testing, provider email or live database migration occurred.
- Earlier 2026-10-15: original Cowork planning files written before build work began.
