# 04 — Tests, CI, docs and process overhead

Reviewed at `582aa56` (2026-11-03). Read-only; no suite was run. The clone is shallow (50 commits), so nothing here rests on git history. Line counts understate size because this codebase writes very long lines (2,604 lines over 200 characters in `tests/app` alone), so bytes are given too.

## 1. Measurements

| Area | Files | Lines | Bytes | Test cases (grep of `it(`/`test(`) |
|---|---|---|---|---|
| `src` (ts/tsx only) | 786 | 64,272 | (18 MB with data JSON) | |
| `tests/app` (Vitest on PGlite) | 434 (421 tests, 13 fixtures) | 55,272 | 4.9 MB | 3,330 |
| `tests/http-browser` (Vitest driving Playwright, real Postgres) | 68 (55 tests, 13 helpers) | 11,982 | 1.16 MB | 255 |
| `tests/postgres` | 52 (46 tests) | 5,874 | 0.51 MB | 152 |
| `tests/*.test.mjs` (node --test) | 64 | 8,738 | 0.69 MB | 509 |
| `e2e` (Playwright, 3 device projects) | 54 (46 specs, 8 helpers) | 7,740 | 0.58 MB | 285 (about 800 runs across projects) |
| `tests/helpers` | 27 | 880 | 78 KB | |
| `tests/fixtures` | 32 | 126,457 | 4.0 MB (3.68 MB is seven `release-*-reference.json`) | |
| `scripts` | 62 | 8,761 | 0.62 MB | |

Test code is about 90,500 lines / 7.9 MB against 64,300 lines of application TypeScript: 1.4 to 1 by lines, and well above that by bytes of hand-written code. There are five runners (node --test, Vitest/PGlite, Vitest/Postgres, Vitest + Playwright library, Playwright Test) and three Vitest configs.

Largest test files: `tests/reference-short-publish-native.test.mjs` 664, `tests/app/accounts.test.ts` 646, `e2e/service-course.spec.ts` 641, `tests/app/notifications.test.ts` 520, `tests/http-browser/portal-ui.test.ts` 512, `tests/http-browser/reading-exploration-ui.test.ts` 493.

Files named for the process that produced them rather than a behaviour: 49 `*review*` and 16 `*adversarial*` in `tests/app` (65 files, 6,342 lines, 583 KB), 8 `*review*` in `tests/postgres`, 7 at top level, and milestone names such as `learn-p4-defects`, `learn-t3-n19a`, `parent-screens-n13`, `honoree-b2-adversarial`. Most of these are real behavioural regression tests; the cost is fragmentation (for source content alone: `source-content`, `-review`, `-extents-contract`, `-extents-contract-review`, `-extents-review`, `-reader-review`, `-client`), not dead weight.

## 2. Findings, ranked by payoff

### T1. "Read first, every session" costs about 85k tokens, most of it history (docs; highest payoff)

- `CLAUDE.md:3` orders every session to read `docs/planning/2026-10-15-kickoff/MISSION.md` (329 lines, 61 KB) and `STATE.md` (855 lines, 266 KB), then "the plan beside them". That is roughly 327 KB, about 80k tokens, before any work, and `AGENTS.md` repeats it.
- `STATE.md` is an append-mostly log. Its own headings mark lines 428 to 700 "historical", "superseded", "Previous", "Earlier"; lines 732 to 805 are a Phase 0 to 7 checklist from October 15; the two newest entries (2026-11-03) are at the bottom (844, 850) while the "return point" at the top is 2026-11-01. A reader cannot tell what is current without reading all of it.
- `MISSION.md` carries about 25 "Amended …" blocks in non-chronological order (10-23 at line 7, 10-22 at 62 to 84, 10-18 at 88 to 92, 10-17 at 94, 10-24 at 297, 10-26 at 323), several of which reverse earlier ones (Finkel recordings in, then cut; recordings parked, then "dropped"; "Codex owns continued implementation" at 203, "Astra directs, Sol 6.1 implements" at 240). Further rulings live only in STATE (for example "RULING (Daniel 2026-10-28): base study guides are overviews only") and in the plans' "Decided here" lists.
- Do: section 5 below. Risk low (docs only). Confidence high.

### T2. Retired one-shot release operators and their tests (about 48 files, 3,600 lines, 4.0 MB)

- `scripts/release-migrate*.mjs`: 15 files, 1,544 lines, 153 KB. They are guarded production operators for the migrations up to about 0020, pinned to `RELEASE_BASE = 4ad7e0c…` (`scripts/release-migrate-support.mjs:7`) and a fixed table list. `DEPLOYING.md:298` says a fork does not need them. STATE records every later production migration (0044, 0049, 0051, 0052, 0053, 0055, 0056) as applied with a "scratch operator (check, apply, verify)" kept in the session scratchpad, not with these scripts (`STATE.md:149`, `:157`, `:197`). No file in `src`, `e2e` or `.github` references them (grep).
- Their tests: `tests/release-*.test.mjs` (8 files, 1,081 lines, 132 KB), `tests/postgres/release-*` (8 files, 656 lines, 60 KB), `tests/helpers/release-*-fixture.mjs` plus `adult-honors-upgrade.*` (8 files, 306 lines), `tests/fixtures/portal/release-*-reference.json` (7 files, 3.68 MB, about 92% of all fixture bytes), and `tests/font-assets-policy.test.mjs` names them.
- They are also the stated reason every CI job checks out with `fetch-depth: 0` ("Release tests verify the pinned historical migration ancestor", `ci.yml:29`, `:49`, `:108`, `:148`).
- Do: delete the scripts, tests, helpers and reference fixtures; drop `fetch-depth: 0`. If the scratch operator is what CLAUDE.md means by "the migration check scripts", commit that one small script instead, since today the thing on the never-relaxed list is not in the repo at all.
- Risk low (they cannot run against today's ledger). Confidence high that they are unused; I did not read all 15 to confirm none exports something a live script imports beyond the tests listed (grep of `src`, `e2e`, `.github` was clean; `scripts/` cross-imports are among themselves).

### T3. One frozen test per already-applied migration (38 files, 3,817 lines, 386 KB)

- `tests/app/*-migration.test.ts`, one per migration from about 0019 on. Each rebuilds a "prior" journal, migrates, then asserts the journal index, the snapshot diff against the previous snapshot, and the literal SQL text (`expect(text).toContain("GRANT SELECT, INSERT, DELETE ON saved_reading TO portal_runtime;")`, `tests/app/saved-migration.test.ts:20-70`).
- Once a migration is in the production ledger its file never changes (the ledger stores its hash), so these tests can only fail if someone edits history. They were useful while the PR was open and are permanent cost afterwards: about 9% of the app suite's bytes, each with a private PGlite migrate-from-zero rather than the shared snapshot.
- Do instead: one generic test (about 150 lines) that migrates from zero, migrates again, and asserts from the catalogue that every tenant table has RLS enabled and forced, that `portal_runtime` holds no `ALL`/`TRUNCATE` and no table-wide `UPDATE`, and that journal indices are monotonic. That covers all 57 migrations (19 have no test today) and future ones. Keep a per-migration test only until that migration is applied. The behavioural RLS tests on real Postgres (`tests/postgres/*rls*`, 10 files, 1,484 lines) stay untouched, so "the RLS tests" are not relaxed.
- Saves about 3,600 lines / 370 KB. Risk low to medium (loses the exact grant-list pin for old tables; the catalogue assertion replaces it). Confidence high.

### T4. Tests that grep the source instead of exercising behaviour (9 files to delete, assertions in about 24 more)

- `tests/*-structure.test.mjs`: 9 files, 745 lines, 66 KB (`saved`, `accounts`, `practice-visibility`, `verse-review`, `course-progress`, `service-course-progress`, `service-part-finished`, `ceremony-done`, `tutor-invite-hold`). They read every file under `src` and `scripts` and regex it, for example `tests/saved-structure.test.mjs:24-50`: the list of files that may contain the string `app.saved_owner`, that `set_config('app.saved_owner'` appears exactly once, that a function body matches a 200-character regex, that `bindViewer` is not exported. The file's own header says "RLS is the enforcement; these keep the code shaped". Any refactor that keeps behaviour breaks them; a behavioural hole written in a different shape passes them.
- 24 non-migration files in `tests/app` (3,886 lines) also `readFileSync` component or CSS source: `beta-mark.test.ts:22-25` (which file contains `className="portal-brand"`), `visual-system.test.ts` (parses `globals.css` for six type sizes and three weights; `e2e/visual-system.spec.ts` measures the same in a browser), `tab-bar`, `site-bar`, `signed-in-shell`, `learn-tone`, `sefaria-user-agent`, `offline-platform`, `owner-admin-files`, `reading-player-transport`.
- Two tests assert that shipped copy equals a planning draft byte for byte: `tests/app/service-course.test.ts:96` and `tests/app/service-course-evening.test.ts:80` read `docs/planning/2026-10-24-release-2-0/cowork/A3-DRAFTS/*.md`. The text is already approved and in the product; this pins a doc path forever (see section 5).
- Do: delete the nine structure files (the RLS and race tests in `tests/postgres` cover the same threats behaviourally: `saved-rls`, `saved-races`, `course-progress-rls`, `verse-review-rls`, `service-part-finished-rls`, and so on). In the 24, remove the source-reading assertions, keep the render assertions. Drop the two draft-equality tests or copy the nine drafts to `tests/fixtures`.
- Saves about 750 lines outright plus roughly 500 to 800 lines of assertions. Risk low. Confidence high. This is the largest single cause of the "search the tests for what you changed" step in `AGENT-BRIEF.md`.

### T5. Wording pinned in three layers

- Literal string locators and expectations (`getByText("…")`, `toHaveText("…")`, `name: "…"`): about 1,073 in `e2e`, 1,238 in `tests/http-browser`; about 197 literal-sentence `toContain` in `tests/app`. Test ids are used 338 times in the two browser suites, so the convention exists but is the minority.
- A label change therefore touches up to three suites, which is why `AGENT-BRIEF.md` step 2 tells every builder to grep `tests/`, `e2e/` and `tests/http-browser/` before pushing, and why CLAUDE.md has the rule "new tests assert roles and test ids, not wording". The rule is right; the existing 2,500 assertions predate it.
- Do: no mass rewrite. Convert on touch (already the stated rule), and delete rather than convert when the same screen is covered in the other browser suite (T6). Risk low. Confidence medium on the counts (grep heuristics).

### T6. Two parallel browser suites, one of which rebuilds the app's routing by hand (68 files, 11,982 lines, 6 CI shards)

- `e2e/`: Playwright Test against the built production server with every API answered by route mocks (162 `route(` calls; `e2e/student-fixture.ts`), three device projects.
- `tests/http-browser/`: Vitest driving the Playwright library against a custom Node server (`tests/http-browser/server.ts`, 146 lines) that copies `src` into a temp project, runs `next({ dev: true })`, and re-implements dispatch with a hand-kept list of 30 `*RouteMethods` imports, plus `fixture.ts` (191 lines, 21 KB) that re-composes about 30 services. 50 of the 55 test files call `startBrowserServer`, so each compiles Next in dev mode again; the config runs one file at a time (`fileParallelism: false`, 120 s timeouts), which is why it needs six shards.
- The harness drifts from the app: `server.ts:8` and `:35` record that learners, practice visibility, the roster sheet and part-finished "fell through to Next's production composition and answered 503" until someone added them (STATE gate #147). Tests of a hand-built copy of the composition can pass while production composition is wrong, and fail while it is right.
- Same screens are in both suites and in `tests/app`: saved (`tests/app/saved*.test.ts` x7, `saved-structure`, `postgres/saved-rls` + `saved-races` + `mcp-saved`, `http-browser/saved-ui`, `e2e/saved.spec` + `saved-bfcache.spec`), accounts (4 + structure + races + `http-browser/accounts-ui` + `e2e/accounts.spec`), honoree (17 app files + postgres + http-browser + e2e), public reading, study, practice calendar.
- Helpers are duplicated across the suites: `e2e/more-sheet.ts` and `tests/http-browser/more-sheet.ts` (same Change-sheet opener, two APIs); `e2e/learn-synthetic.ts` and `tests/app/learn-synthetic.ts`; `e2e/student-fixture.ts`, `e2e/aliyot-fixture.ts` versus `tests/app/access-fixture.ts`, `tests/postgres/access-fixture.ts` and `tests/http-browser/fixture.ts` (four separate "seed a tenant, a student and a session" fixtures).
- Do, in order of cost: (a) start the server once per shard in a Vitest `globalSetup` instead of once per file; expect six shards to become two. (b) Stop adding to `http-browser`; new signed-in browser checks go in `e2e`. (c) Keep in `http-browser` only what needs a real database behind a real browser and is high-stakes: sign-in and session navigation, cross-family denial, `production-denial`, `egress` (roughly 10 to 15 files); delete the `*-ui` files whose screen has an `e2e` spec and whose authority has a `tests/postgres` test.
- Saves 6,000 to 8,000 lines and four CI jobs at step (c); step (a) alone saves CI time with no loss. Risk medium for (c) (it is the only suite that exercises UI against real authority), low for (a). Confidence medium: I read the harness and file lists, not every test.

### T7. Firefox, PulseAudio and ffmpeg installed in six CI jobs for two files

- `ci.yml:169-185` installs Chromium and Firefox plus `ffmpeg pulseaudio pulseaudio-utils` in every http-browser shard. Firefox is launched in two files only: `tests/http-browser/reading-exploration-ui.test.ts:96` and `practice-calendar-session-review.test.ts:95`. `tests/http-browser/firefox-audio-output.ts` (163 lines) starts a private PulseAudio server with hash-pinned binaries so that Firefox has a real audio sink; `synthetic-short-reference.ts` shells out to ffmpeg to synthesise audio.
- Do: run those two files in Chromium (or in `e2e`), delete `firefox-audio-output.ts`, drop the three apt packages and the Firefox download. Risk low: no rule in MISSION or CLAUDE.md asks for Firefox, and a cross-browser claim resting on two files is not one. Confidence high on the facts; I did not confirm whether a Chromium-specific autoplay difference motivated Firefox.

### T8. Prebuild probes for a feature that was dropped (2 scripts, 6 tests, 1,256 lines)

- `package.json:9` runs `scripts/private-media-oidc-probe.mjs` (176 lines) and `private-media-object-probe.mjs` (192 lines) before every build, locally, in CI and on Vercel. They do nothing unless three `PRIVATE_MEDIA_OIDC_PROBE_*` flags are set; then they verify that a Vercel OIDC token can reach the private Blob store (25 identity checks, a put/range/stale-etag/unsigned/delete round trip). Both carry CRC's Vercel project, team and store ids as constants, which `DEPLOYING.md:36` has to explain to forks.
- They ran once: `docs/planning/2026-10-17-recording-foundation/OBJECT-PROBE-RETURN.md` records all five checks passing on 2026-10-17. They were groundwork for student recordings, which Daniel dropped on 2026-10-22 ("I don't think this is really a useful thing for us", `STATE.md:261`). No file in `src` references the probes (grep).
- Tests: `tests/private-media-*.test.mjs`, 6 files, 888 lines, 72 KB (`-probe`, `-review`, `-diagnostic-review`, `-hosted-review`, `-object-probe`, `-object-review`).
- Do: remove the `prebuild` script, both probes and the six tests. If private Blob is ever needed again the 2026-10-17 result still stands. Risk low. Confidence high. They do not earn their place.
- Related, for whoever reviews features: the recording server (`src/server/recordings`, `src/server/http/recordings.ts`, about 880 lines) is still wired into `dispatch.ts:32`, but `src/components/portal/workspace/recordings/capture.ts` has no importer. Its tests are 10 files in `tests/app` (1,060 lines), 5 in `tests/postgres`, 2 in `tests/http-browser`. If the feature is formally retired, about 19 test files go with it.

### T9. Windows doubles the unit suite (5 of 20 CI jobs)

- A PR starts 20 jobs: `unit` 4 shards x 2 OS, `unit-static` x 2 OS, `build`, `postgres`, `http-browser` x 6, `browser` x 2. Windows accounts for four Vitest shards and one static job that also builds.
- "Done means tests green on Windows" (`CLAUDE.md:14`) dates from when all work happened in worktrees under `C:/Users/dsbog/…` (`AGENT-BRIEF.md` setup; 21 such paths in STATE). Production is Linux on Vercel. `vitest.config.mts` caps workers at 2 specifically because of "cold hosted Windows starts", which slows Linux too.
- Do: keep one Windows job (`unit-static`: node tests, typecheck, build), drop the four Windows Vitest shards, or run them nightly on `main`. If Daniel's sessions are now cloud Linux, drop Windows from "Done". Windows is not on the "never relaxed" list. Risk low to medium (path and CRLF bugs in test helpers would surface a day later). Confidence high on the structure; ask Daniel whether anyone still runs the suite on Windows.

### T10. Three device projects: kept, but applied more widely than they need to be

- The rule stays. But `playwright.config.ts` runs every spec except `service-course` on desktop, tablet and phone. 14 specs (58 tests) contain no viewport, project or mobile branch at all: `rate-limit`, `saved-bfcache`, `account-roles`, `foundation`, `find-reading`, `any-reading`, `compare`, `shelf`, and six `learn-*` specs. `rate-limit.spec.ts` and `saved-bfcache.spec.ts` test server and browser-cache behaviour that cannot differ by viewport.
- Do: tag specs that are not about layout to run on phone only, as `service-course` already does (`testIgnore`). Saves about 100 of about 800 runs with the three projects intact for everything visual. Risk low. Confidence medium (absence of a viewport branch does not prove a layout cannot break; pick the obviously non-visual ones first).

### T11. Engine-pipeline and policy tests (not counted as savings; flag for the engine review)

- `tests/reference-*.test.mjs` 12 files / 2,213 lines, `tests/trope-{soulx,speech2sing,human-retime,benchmark-pack,prompt,render-cli}` and `private-benchmark-policy{,-adversarial}` cover research and corpus-building scripts (`scripts/reference-short-*`, `trope-speech2sing.mjs`, `trope-human-retime.mjs`). Whether those scripts are still live is the engine reviewer's call; if a script goes, its test goes.
- Never-in-repo is light where it matters (`tests/never-in-repo.test.mjs` is 66 lines over `scripts/repo-policy.mjs`, 259 lines) and heavier around it: `repo-policy.test.mjs` 265, `repo-policy-review` 30, `font-assets-policy` 401, `brand-assets-policy` 165, `reference-catalog-policy` 78, `reference-index-guard-review` 57. `font-assets-policy.test.mjs` at 401 lines for four font families is the outlier. Keep the guard; the font and brand policies could be one table-driven test. Low priority.
- `tests/isolation*.test.mjs`, `e2e-server-isolation.test.mjs`, `http-browser/server-isolation.test.ts`, `server-review.test.ts` (about 250 lines) test the test harness's own environment isolation. They protect the secrets rule, so keep, but they are tests of tests.

### T12. Guard tests named in the brief that I could not find

- `AGENT-BRIEF.md` tells builders to check "Tab-stop budgets, storage allowlists, landmark counts, the policy registry". By grep I found landmark counts in four places (`tests/app/signed-in-shell.test.ts:71`, `tests/app/visual-system.test.ts:162`, `e2e/workspace-shell.spec.ts:23`, `e2e/visual-system.spec.ts:79`, plus `e2e/web-vitals.ts:45`) and nothing matching a Tab-stop budget, a storage allowlist or a policy registry. Either they were removed or they go by other names; the brief should name files, not concepts. The four landmark checks say the same thing ("one main, one footer") in two static and two browser tests; one browser check is enough.

## 3. CI

What runs on every pull request (`.github/workflows/ci.yml`, 268 lines; no `paths` filter; `main` is not retested):

| Job | Count | What |
|---|---|---|
| `unit` | 8 (4 shards x Ubuntu, Windows) | `vitest run --shard` over `tests/app` (421 files) |
| `unit-static` | 2 | `node --test tests/**/*.test.mjs`, `next typegen && tsc`, and on Windows `next build` |
| `build` | 1 | `next build` on Ubuntu, uploaded as an artifact |
| `postgres` | 1 | Postgres 18.6 service; 20 `.integration.mjs` serially, then 30 Vitest integration files, one worker |
| `http-browser` | 6 shards | Postgres service, Chromium + Firefox, ffmpeg + PulseAudio, 55 files one at a time |
| `browser` | 2 shards | Playwright, 46 specs x 3 device projects, 1 retry |

I could not measure durations (no network, no timing notes in STATE beyond "postgres job 45 min" before sharding, `STATE.md:283`). CLAUDE.md's "about 25 minutes" is wall clock; with 20 parallel jobs the runner time per PR is several times that. STATE shows the cost in practice: PRs merged "after its one red browser shard went green on rerun" (#163), "#157 merged with browser shards red", repeated flake-fix PRs (#90, #92, #123), and the apt mirror stalling installs, which is what the 86-line `.github/scripts/ci-system-packages.sh` and four cache steps per job exist to work around.

Redundant or reducible, in order:

1. Docs-only changes. STATE and PLAN commits use `[skip ci]` by hand. Add `paths-ignore: ['docs/**', '*.md', '.impeccable/**']` so it is automatic. Note two tests read `docs/…/A3-DRAFTS` (T4); fix that first.
2. Windows Vitest shards (T9): 4 jobs.
3. `fetch-depth: 0` in four jobs, needed only by the retired release tests (T2).
4. Firefox, PulseAudio, ffmpeg (T7): removes a browser download, an apt step and one cache per http-browser shard.
5. http-browser one server per shard (T6a): 6 shards to about 2.
6. Viewport-agnostic specs on one project (T10): about 12% of Playwright runs.
7. The Windows `next build` in `unit-static` duplicates the Ubuntu build to prove the build works on Windows; drop it with the decision in T9.
8. `postgres` and `http-browser` on every PR: keep `postgres` always (it is the RLS check, one job). `http-browser` could run only when `src/server/**`, `src/app/api/**`, migrations or its own files change; a CSS-only PR does not need real Postgres behind a browser. Medium risk, do after 5.

`vercel.json` is three daily crons and nothing else; nothing to trim (`tests/service-cron-policy.test.mjs`, 12 lines, pins them).

`scripts/` (62 files, 8,761 lines): 15 are the retired release operators (T2), 2 are the probes (T8), `provider-bootstrap/` (5 files, 258 lines) is a Neon WebSocket probe with its own Vitest config that only `tests/app/provider-neon-probe.test.ts` references (another one-shot diagnostic; I did not verify it is retired). About 11 `reference-*` and 7 `trope-*` scripts belong to the engine review. The operator scripts a fork needs are `db-migrate`, `db-generate`, `bootstrap-owner`, `manage-admin`, `add-congregation*`, `reference-kit-*`, `import-course-text`, `test-local-db`.

## 4. Docs: what is live and what is record

`docs/` is 393 files (389 Markdown), 41,529 lines, 5.53 MB.

| Set | Files | Bytes | Status |
|---|---|---|---|
| `planning/2026-10-15-kickoff` minus MISSION and STATE | 62 | 805 KB | Record. 91 `*RETURN*`, 67 `*REVIEW*`, 15 `*HANDOFF*` files repo-wide; these are per-slice hand-backs from October 15 to 22 (`PHASE2-SECURITY-REVIEW.md` alone is 953 lines). |
| `planning/2026-10-16…` to `2026-10-23…` | 180 | 1.73 MB | Record: Codex-era parallel work, recording foundation (17 files for a dropped feature), reviews, Cowork offload. |
| `planning/2026-10-24…` onward | 53 | 840 KB | Mixed. 1.9 and 2.0 PLANs (114 KB, 64 KB) are shipped (v1.9.0 and v2.0.0 tagged, `STATE.md:73`); `2026-10-30-second-congregation-copy`, `2026-10-31-music-card-details`, `2026-11-03-people-tutor` are current. |
| `superpowers/specs` | 46 | 563 KB | Record of built designs. |
| `superpowers/plans` | 13 | 386 KB | Record, except `2026-10-28-replacing-the-study-guide-booklet.md` (in flight). |
| `superpowers/research` | 36 | 880 KB | `2026-10-15-trope-engine` (12 files, 391 KB) is live reference for the engine; the rest is record. |
| Root: `CLAUDE.md` 73 lines, `AGENTS.md` 9, `README.md` 48, `PRODUCT.md` 78, `DESIGN.md` 380, `DEPLOYING.md` 310 | 6 | 97 KB | Live, with the staleness below. |
| `.impeccable/` | 10 | 164 KB | Design-tool state: one critique from 2026-10-16 and seven surface notes. `repo-policy.mjs:44` allow-lists its two JSON files. Record, apart from `config.json`. |

Contradictions and duplication:

- `AGENTS.md` says "Astra owns product direction … Sol agents implement" and points to a "2026-10-15 project-manager review". `CLAUDE.md` says Sonnet builds and Opus reviews. `MISSION.md:203` says Codex owns implementation; `:240` says Astra and Sol 6.1; `STATE.md:358` says "Claude Code owns the whole product". Only the last is true. `AGENTS.md` is read automatically by other agent tools, so it actively misdirects.
- The never-in-repo, secrets, G3 and tone rules are written out three times: `CLAUDE.md` Rules, `AGENT-BRIEF.md` "Rules that always hold", and `README.md` "Never in this repo". They agree today; three copies will not stay agreed.
- `AGENT-BRIEF.md` setup is entirely Windows worktree instructions (`C:/Users/dsbog/bneimitzvah-study`, "never `git stash` in bneimitzvah-study", "heredocs with apostrophes fail here"). None applies in a cloud session; it names guard tests that do not exist by those names (T12).
- `README.md` is stale: "Revised 1.0 is still in progress", "Reference playback remains administrator-only until Daniel accepts…" (released 2026-10-22), "Generated voices are outside 1.0, and student recordings are parked", fonts credited as "Ezra SIL, Noto Serif Hebrew, Literata" while `public/fonts` holds Noto Serif Hebrew, Bricolage Grotesque, Stam Ashkenaz CLM and Taamey Frank CLM, and "Production schema changes use reviewed release operators" (T2).
- `CLAUDE.md` stale lines: line 14 "green on Windows"; line 43 "The rest of 1.9 is three bundles: staff screens (N14, N15 and leftovers), practice visibility (N23), and N16" (all merged, 1.9 and 2.0 released); line 37 "Planning, wording and research go to Cowork" (true of the 1.9/2.0 period; check whether it still is); the opening pointer to a 266 KB STATE; "Migration numbers are reserved when a milestone starts" and "Never two open PRs in the same hot-file group" assume the multi-builder waves of late October; "the migration check scripts" names something that lives in a scratchpad. The "Fewer round trips", "Small wording", "Rulings follow" and "Proportion" sections are four dated corrections of the same over-caution; they can be one paragraph now.

Does anything read the docs? I grepped `tests/`, `scripts/`, `e2e/`, `src/`, `.github/` for `docs/`:

- Two tests read files: `tests/app/service-course.test.ts:96` and `tests/app/service-course-evening.test.ts:80`, both from `docs/planning/2026-10-24-release-2-0/cowork/A3-DRAFTS/` (9 files, 74 KB). Moving that folder breaks them.
- `tests/repo-policy.test.mjs` uses `docs/…` only as synthetic path strings. `scripts/repo-policy.mjs` scans all tracked files wherever they are, so an archive move is neutral for never-in-repo.
- Comments only (nothing breaks): 14 references to `docs/superpowers/research`, 8 to `docs/planning/2026-11-03-people-tutor`, 3 to `docs/superpowers/plans`, 2 to release-2-0; `tests/fixtures/trope/README.md` cites the trope-engine research three times.
- Root docs link into `docs/` 13 times (`CLAUDE.md` 7, `PRODUCT.md` 4, `README.md` 1, `DEPLOYING.md` 1); STATE has 49 relative links and MISSION 9. An archive move must rewrite the root ones; links inside archived files can break without harm if the whole tree moves together and keeps its relative layout.

## 5. Proposal

### Move under `docs/archive/` (keeping each folder's name and relative layout)

- `docs/planning/2026-10-15-kickoff/` whole, including the present MISSION.md and STATE.md as the historical originals.
- Every `docs/planning/2026-10-16-*` to `2026-10-27-*` folder, including the 1.9 and 2.0 plans and `chanting-program-review`.
- `docs/superpowers/specs/` whole; `docs/superpowers/plans/` except the 2026-10-28 booklet plan; `docs/superpowers/research/` except `2026-10-15-trope-engine/` and `2026-10-28-replacing-…`.
- `.impeccable/critique/` and `.impeccable/surfaces/` (or delete; they are tool output).
- First, either copy `A3-DRAFTS` to `tests/fixtures/portal/service-course-drafts/` and repoint the two tests, or delete those two assertions (T4).

Stays live: `docs/RULINGS.md` (new), `docs/STATE.md` (new), `docs/planning/AGENT-BRIEF.md` (rewritten), `docs/planning/2026-10-30-second-congregation-copy`, `2026-10-31-music-card-details`, `2026-11-03-people-tutor`, the booklet plan and its research, the trope-engine research.

| | Before | After |
|---|---|---|
| Live docs under `docs/` | 393 files, 5.53 MB | about 22 files, about 0.55 MB (0.39 MB of it trope-engine research) |
| Archived | 0 | about 370 files, about 5.0 MB |
| Mandatory reading per session (CLAUDE + MISSION + STATE) | 1,257 lines, 334 KB, about 85k tokens | CLAUDE about 45 lines + RULINGS about 200 + STATE about 60: about 30 KB, about 8k tokens |
| Builder brief | 37 lines, half Windows setup | about 25 lines |

### A short `docs/STATE.md` (about 60 lines, replaced not appended)

1. Live: production URL, commit, last tag (v2.0.0, beta label on), ledger number (56) and how migrations are applied.
2. In flight: open PRs and branches, each one line (booklet guides awaiting Daniel's read of the sensitive overviews; the T7 `torah.centralreform.org` cutover; the Kipnes fork prompt).
3. Waiting on Daniel: the open questions, one line each.
4. Dated reminders (Neon cost check, course-text import before 2026-12-21).
5. Last ten gates, newest first, one line each; older entries roll into `docs/archive/GATE-LOG.md` in the same commit. "Decided here" entries that state a rule move to RULINGS; the rest go to the gate log.

### A consolidated `docs/RULINGS.md` ("rulings in force", about 200 lines)

One line per ruling as it stands today, grouped by topic, each ending with its date and a pointer to the archived source; superseded rulings are simply absent. Sections:

- Who it is for: roles, adults, parents, "the way anyone leins at CRC" (2026-10-22), second congregations as separate copies (2026-10-30).
- Open versus private: show rather than hide; what signed-out visitors see; what a tutor or parent sees of a child; people data private.
- Text and licences: JPS and siddur text never in the repo; Sefaria at runtime; Binder/Avery noncommercial permission; Finkel recordings as voice material; the 2026-10-25 siddur-text ruling; credits.
- Audio: human recordings live without listening review; G3 for generated chant with its 95% / zero thresholds; student recordings dropped.
- Study guides and Claude: overviews only for students (2026-10-28); origin and reviewed labels; held drafts; no invented citations.
- Voice and wording: the child's name, no pronouns, no exclamation points, "practise", no streaks or scores.
- Money and authority: the $10 a month line; what to stop and ask for; what the lead decides.
- Engineering constants: dependency-free engine; two database logins; RLS forced; migrations applied before merge by check, apply, verify.
- Release state: alpha, beta label, public indexing.

Writing it is a one-time job of reading MISSION (61 KB), the STATE "RULING"/"Decided here"/"Daniel, verbatim" lines and the two PLANs' "Decided here" lists. It should be reviewed by Daniel once, since it becomes the binding text; that is a "MISSION-level" ask and worth one popup.

### CLAUDE.md after the cut (about 45 lines)

- Opening: read `docs/RULINGS.md` and `docs/STATE.md`.
- Rules: keep as is, minus "on Windows" if T9 is accepted, with `AGENT-BRIEF.md` pointing here instead of restating them.
- Operating procedure: keep agents (builders push and stop; lead watches in background), models, one fix round, bundle by area, lead makes mechanical fixes, small wording and consistent rulings are the lead's call, adversarial review only for the four. Delete the 1.9 bundle list, the per-quote history, hot-file groups and migration-number reservation unless multi-builder waves resume.
- Never relaxed: unchanged; name the migration check script's path once it is committed.
- Delete `AGENTS.md` or reduce it to one line: "See CLAUDE.md."
- Fix `README.md` status, fonts and the release-operator sentence.

## 6. What could go, in one table

| Category | Files | Lines | Bytes | Loss | Risk |
|---|---|---|---|---|---|
| Retired release operators, tests, helpers, reference fixtures (T2) | about 48 | about 3,600 code + 7 JSON | 4.0 MB | none | low |
| Per-migration frozen tests, replaced by one generic test (T3) | 38 → 1 | 3,800 → 150 | 386 KB | exact grant text of old migrations | low to medium |
| Source-grepping structure tests (T4) | 9 + parts of 24 | about 1,300 | about 110 KB | shape pins that RLS tests already back | low |
| Prebuild probes and their tests (T8) | 8 | 1,256 | 97 KB | none | low |
| http-browser collapsed to its high-stakes core (T6c) | about 40 | 6,000 to 8,000 | about 0.7 MB | UI-on-real-DB coverage of ordinary screens | medium |
| Firefox audio harness (T7) | 1 + CI steps | 163 | 10 KB | Firefox run of two files | low |
| Student-recording tests, if the feature is retired (T8 note) | about 19 | about 2,000 | about 0.2 MB | follows the feature | follows the feature |
| CI jobs per PR | 20 → about 11 | | | Windows Vitest, 4 http-browser shards | low to medium |
| Docs live set | 393 → about 22 | 41,500 → about 4,000 | 5.5 MB → 0.55 MB | nothing deleted, only archived | low |

Low-risk items alone (T2, T3, T4, T8, T7) remove about 105 test and script files, about 10,000 lines and about 4.6 MB, and touch none of the never-relaxed list: never-in-repo, the Postgres RLS tests and the three device projects are unchanged, and the migration check becomes a committed script rather than a scratchpad file.

## 7. Not verified

- CI durations and flake rates (no network access was used).
- That no live script imports from `scripts/release-migrate*-support.mjs` beyond the tests listed; grep of `src`, `e2e` and `.github` was clean.
- Whether `scripts/provider-bootstrap/` is retired.
- Whether anyone still runs the suite on a Windows machine.
- The wording-assertion counts are grep heuristics, good to perhaps plus or minus 20%.
- I sampled about 15 test files in full; category judgements for the rest rest on file names, imports and grep.
