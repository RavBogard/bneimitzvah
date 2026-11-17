# CLAUDE.md — CRC B'nei Mitzvah

Read first, every session: `docs/planning/RULINGS.md` (Daniel's rulings in force, each with its source), then `docs/planning/2026-10-15-kickoff/STATE.md` (where the work stands; short, replaced rather than appended), then the plan for the task at hand. `docs/planning/2026-10-15-kickoff/MISSION.md` is the authority behind RULINGS; read the section a ruling cites when you need its full text. Where a ruling exists, do not re-decide. History is in `docs/archive/`.

## Rules

- **Never in the repo:** JPS or any licensed text, student or family data, recordings, rendered audio, model weights, credentials. `tests/never-in-repo.test.mjs` must stay green; never weaken it to pass.
- **G3 gate:** no student hears generated chant until Daniel passes the listening review (at least 95% melody passes, zero "would teach wrong"), after G1 and G2. No code path may serve an unreleased render to a student.
- **Show rather than hide (Daniel 2026-10-22):** texts, human recordings and study tools are open, including to signed-out visitors; people data stays private. Human recordings need no listening review.
- **Engine:** `trope/` stays dependency-free Node plus its vendored, licensed copies with `PROVENANCE.md`. Nothing is installed into it. Its tests run with `node --test`. The app never imports a Python side.
- **Stop and ask Daniel for:** money that would take total portal spend past $10 a month (below that, decide and log it in STATE.md); any licence question; a second tenant; the beta label; irreversible production data changes; messages to real people; a ruling that proves wrong. Everything else: decide, log it in the plan's "Decided here" or STATE.md, move on.
- **Student-visible changes ship, then Daniel is told (Daniel 2026-11-17):** decide wording and layout in the house voice, ship when CI is green, and give him a short list of what changed. He can ask for anything to be reverted.
- **Secrets:** never print, log or return a token, cookie, connection string or full email address. Spawning tests use `tests/helpers/isolatedEnv.mjs`.
- **High-stakes work** (auth: sign-in, sessions, invitation tokens; tenant and cross-family isolation; never-in-repo; the chant gate) gets an adversarial pass by a second agent before it is reported done.
- **Done** means tests green in CI (Linux) and a deploy Daniel can open.

## How the work runs

- **Agents:**
  - Each builder or reviewer prompt points to `docs/planning/AGENT-BRIEF.md`, plus the task's spec pasted in and its exact approved strings.
  - Builders commit in their own worktree and stop. The lead brings the commits onto the working branch, runs CI on it by hand (`workflow_dispatch`), fast-forwards `main` when it is green (Daniel 2026-11-17: "you can just deploy to main if that's easier"), and wakes a builder only with a failing test that is theirs. A pull request is opened only when Daniel asks for one.
  - Mechanical fixes (a test locator, a string, an allow-list entry) the lead makes directly.
- **Models and concurrency:** Sonnet builds; Opus for adversarial reviews and for builds that touch auth, RLS or licensed text. When two or more builders run at once: never two open PRs in the same hot-file group, and migration numbers are reserved when the work starts.
- **Size work by area** (Daniel 2026-10-26: "each of these milestones is a tiny little thing"). Each PR has fixed costs (a fresh agent's context, CI time, a review, a fix round), so bundle a whole area into one PR. Work that shares screens or files goes to one builder as one PR with one review.
- **One fix round per PR:** review findings and late wording go to the builder together, in one push. A delta re-review only when the fix touches security; never for wording.
- **Reviews:** an adversarial pass is limited to the diff and a named list of attacks. A re-review covers only the delta.
- **Tests:** CI is the full check. Locally, run only tsc, the changed tests and never-in-repo. Fix flakes as soon as they appear. New tests assert roles and test ids, not wording.
- **The lead:** watch in the background, never by polling in the foreground; read only the failing lines of a log; make one STATE commit per batch of merges, replacing STATE's sections rather than appending; keep updates to Daniel short.
- **Planning and wording** may go to Cowork. Builders never wait on wording; gaps are batched into one popup round per wave.

## How the lead decides (Daniel 2026-10-26)

- **Small wording is the lead's call** ("You really don't need my calls on these small wording things. Your judgement is generally fine"): labels, empty states, status lines, chips, errors and email details, in the house voice: the child's name and never pronouns, no exclamation points or pep talk, plain verbs, American spelling ("practice" for verb and noun; Daniel 2026-11-17). Log each decision in the plan's "Decided here". Ask Daniel only for wording that is a real product decision: a new promise to families, anything about privacy or what others can see, or a MISSION-level rule.
- **Rulings follow from his decisions** ("just be logical and consistent with these decisions. You don't need my individual rulings on the vast majority of these"): product, privacy and wording questions that a consistent reading of RULINGS.md answers are the lead's to decide, with the reasoning logged.
- **Proportion** ("you're stressing about disclosures and privacy way more than is needed for a learn to chant Torah site"): adversarial review only for the four high-stakes areas above. What a child's own tutor or parent sees, disclosure wording and caching on one's own device are ordinary product work: no gates, no ordering tests, no re-review rounds.
- **Never relaxed:** adversarial reviews on high-stakes work, never-in-repo, the RLS tests, applying each production migration by check, apply and verify before the PR that needs it merges (`scripts/db-migrate.mjs`, `DEPLOYING.md` section 3.2), and CI's three Playwright device projects.

## Git

- Commit as `Claude` with the noreply address the cloud environment configures, the identity it signs and GitHub shows as verified (Daniel 2026-11-17: "Commits as Claude are fine").
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
