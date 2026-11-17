# Proposed replacement for CLAUDE.md (for Daniel to adopt or not)

Written 2026-11-17 from the 2026-11-16 project review (`REPORT.md` C8, `04-tests-ci-docs.md` T1 and section 5). CLAUDE.md itself is unchanged until Daniel says to adopt this. Nothing below relaxes a rule; the changes remove history and fix lines that are no longer true.

What changed and why:

1. **Read-first list.** It pointed every session at MISSION (61 KB) and a 266 KB STATE log. It now points at `docs/planning/RULINGS.md` (the rulings in force, with sources) and the short STATE, which is replaced rather than appended. MISSION stays the authority and is read when a ruling needs its full text.
2. **"Done means tests green on Windows".** The line dates from when all work ran on a Windows laptop; work now runs in cloud Linux sessions and production is Linux. Proposed: green in CI. Whether CI keeps its Windows jobs is a separate question for Daniel (REPORT section 5, "tests on Windows", answered "Na"); until he answers, the Windows jobs stay in CI.
3. **"The rest of 1.9 is three bundles …".** All of 1.9 and 2.0 are merged and released; the sentence is removed. The rule it illustrated (bundle by area) stays.
4. **"The migration check scripts" on the never-relaxed list.** No such scripts are in the repo: production migrations were applied with a scratch check-apply-verify operator kept outside it. The item now names what is actually never relaxed: a migration is applied to production by check, apply and verify before the PR that needs it merges, using `scripts/db-migrate.mjs`. If Daniel wants the check script itself committed, that is a follow-up.
5. **Windows paths and Windows-only practice.** CLAUDE.md has none left; the builder brief's Windows worktree setup was replaced with platform-neutral steps in the same change (`docs/planning/AGENT-BRIEF.md`).
6. **Four dated sections of the same correction** ("Fewer round trips", "Small wording", "Rulings follow", "Proportion", all 2026-10-26) are merged into one "How the lead decides" section with the same content and Daniel's quotes kept.
7. **Multi-builder wave rules** ("never two open PRs in the same hot-file group", "migration numbers are reserved when a milestone starts") are kept but marked as applying when two or more builders run at once.
8. **"Planning, wording and research go to Cowork".** Kept as a may: whether Cowork is still the planning lane is not recorded after 2026-10-28.

9. **Stop-and-ask** now lists, in one place, the items of the old Rules list and of the old 2026-10-26 "Rulings follow" list (the beta label, irreversible production data changes, messages to real people). Nothing was dropped from either.

Not changed: the never-in-repo rule and its test, G3, show rather than hide, the engine rule, the stop-and-ask list, secrets, the four adversarial-review areas, the never-relaxed list (apart from item 4's wording), git identity and history rules, where docs go, and the test commands.

---

# CLAUDE.md — CRC B'nei Mitzvah

Read first, every session: `docs/planning/RULINGS.md` (Daniel's rulings in force, each with its source), then `docs/planning/2026-10-15-kickoff/STATE.md` (where the work stands; short, replaced rather than appended), then the plan for the task at hand. `docs/planning/2026-10-15-kickoff/MISSION.md` is the authority behind RULINGS; read the section a ruling cites when you need its full text. Where a ruling exists, do not re-decide. History is in `docs/archive/`.

## Rules

- **Never in the repo:** JPS or any licensed text, student or family data, recordings, rendered audio, model weights, credentials. `tests/never-in-repo.test.mjs` must stay green; never weaken it to pass.
- **G3 gate:** no student hears generated chant until Daniel passes the listening review (at least 95% melody passes, zero "would teach wrong"), after G1 and G2. No code path may serve an unreleased render to a student.
- **Show rather than hide (Daniel 2026-10-22):** texts, human recordings and study tools are open, including to signed-out visitors; people data stays private. Human recordings need no listening review.
- **Engine:** `trope/` stays dependency-free Node plus its vendored, licensed copies with `PROVENANCE.md`. Nothing is installed into it. Its tests run with `node --test`. The app never imports a Python side.
- **Stop and ask Daniel for:** money that would take total portal spend past $10 a month (below that, decide and log it in STATE.md); anything student-visible before it ships; any licence question; a second tenant; the beta label; irreversible production data changes; messages to real people; a ruling that proves wrong. Everything else: decide, log it in the plan's "Decided here" or STATE.md, move on. (Today's CLAUDE.md lists "student-visible" in Rules but leaves it out of its 2026-10-26 list; RULINGS.md "Unclear", item 1, asks Daniel which holds.)
- **Secrets:** never print, log or return a token, cookie, connection string or full email address. Spawning tests use `tests/helpers/isolatedEnv.mjs`.
- **High-stakes work** (auth: sign-in, sessions, invitation tokens; tenant and cross-family isolation; never-in-repo; the chant gate) gets an adversarial pass by a second agent before it is reported done.
- **Done** means tests green in CI and a deploy Daniel can open.

## How the work runs

- **Agents:**
  - Each builder or reviewer prompt points to `docs/planning/AGENT-BRIEF.md`, plus the task's spec pasted in and its exact approved strings.
  - Builders push, open the PR and stop. The lead checks CI with a background merge-if-green script and wakes a builder only with a failing test that is theirs.
  - Mechanical fixes (a test locator, a string, an allow-list entry) the lead makes directly.
- **Models and concurrency:** Sonnet builds; Opus for adversarial reviews and for builds that touch auth, RLS or licensed text. When two or more builders run at once: never two open PRs in the same hot-file group, and migration numbers are reserved when the work starts.
- **Size work by area** (Daniel 2026-10-26: "each of these milestones is a tiny little thing"). Each PR has fixed costs (a fresh agent's context, CI time, a review, a fix round), so bundle a whole area into one PR. Work that shares screens or files goes to one builder as one PR with one review.
- **One fix round per PR:** review findings and late wording go to the builder together, in one push. A delta re-review only when the fix touches security; never for wording.
- **Reviews:** an adversarial pass is limited to the diff and a named list of attacks. A re-review covers only the delta.
- **Tests:** CI is the full check. Locally, run only tsc, the changed tests and never-in-repo. Fix flakes as soon as they appear. New tests assert roles and test ids, not wording.
- **The lead:** watch in the background, never by polling in the foreground; read only the failing lines of a log; make one STATE commit per batch of merges, replacing STATE's sections rather than appending; keep updates to Daniel short.
- **Planning and wording** may go to Cowork. Builders never wait on wording; gaps are batched into one popup round per wave.

## How the lead decides (Daniel 2026-10-26)

- **Small wording is the lead's call** ("You really don't need my calls on these small wording things. Your judgement is generally fine"): labels, empty states, status lines, chips, errors and email details, in the house voice: the child's name and never pronouns, no exclamation points or pep talk, plain verbs. Log each decision in the plan's "Decided here". Ask Daniel only for wording that is a real product decision: a new promise to families, anything about privacy or what others can see, or a MISSION-level rule.
- **Rulings follow from his decisions** ("just be logical and consistent with these decisions. You don't need my individual rulings on the vast majority of these"): product, privacy and wording questions that a consistent reading of RULINGS.md answers are the lead's to decide, with the reasoning logged.
- **Proportion** ("you're stressing about disclosures and privacy way more than is needed for a learn to chant Torah site"): adversarial review only for the four high-stakes areas above. What a child's own tutor or parent sees, disclosure wording and caching on one's own device are ordinary product work: no gates, no ordering tests, no re-review rounds.
- **Never relaxed:** adversarial reviews on high-stakes work, never-in-repo, the RLS tests, applying each production migration by check, apply and verify before the PR that needs it merges (`scripts/db-migrate.mjs`, `DEPLOYING.md` section 3.2), and CI's three Playwright device projects.

## Git

- Commit with the same identity the haftarah repo's `main` uses (`RavBogard <RavBogard@users.noreply.github.com>`), set repo-locally.
- Subjects are long, descriptive single sentences, as in the haftarah repo: what changed and why, in plain words.
- Never force-push `main`. Never rewrite pushed history.
- The haftarah repo is read-only from here.

## Where docs go

- Rulings: `docs/planning/RULINGS.md` (one line per ruling in force; replace a line when Daniel reverses it). State: `docs/planning/2026-10-15-kickoff/STATE.md`.
- Planning and handoffs: `docs/planning/<date>-<topic>/`; move a folder to `docs/archive/planning/` when its work is shipped.
- Specs: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, opening with "Settled decisions (Daniel, binding)" and ending with "Open items that wait on Daniel".
- Plans: `docs/superpowers/plans/`. Research: `docs/superpowers/research/`.

## Tests

- `npm test`: engine (`node --test "tests/**/*.test.mjs"`) and app (Vitest on PGlite). No network.
- `npm run test:e2e`: Playwright.
- Engine only: `node --test "tests/trope-*.test.mjs"`.
