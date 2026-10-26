# CLAUDE.md — CRC B'nei Mitzvah

Read first, every session: `docs/planning/2026-10-15-kickoff/MISSION.md` (Daniel's binding rulings), then `docs/planning/2026-10-15-kickoff/STATE.md` (where the work stands), then the plan beside them. Where MISSION rules, do not re-decide.

## Rules

- **Never in the repo:** JPS or any licensed text, student or family data, recordings, rendered audio, model weights, credentials. `tests/never-in-repo.test.mjs` must stay green; never weaken it to pass.
- **G3 gate:** no student hears generated chant until Daniel passes the listening review (at least 95% melody passes, zero "would teach wrong"), after G1 and G2. No code path may serve an unreleased render to a student.
- **Show rather than hide (Daniel 2026-10-22):** texts, human recordings and study tools are open, including to signed-out visitors; people data stays private. Human recordings need no listening review. See MISSION's 2026-10-22 amendment.
- **Engine:** `trope/` stays dependency-free Node plus its vendored, licensed copies with `PROVENANCE.md`. Nothing is installed into it. Its tests run with `node --test`. The app never imports the Python side.
- **Stop and ask Daniel for:** money that would take total portal spend past $10 a month (below that, decide and log it in STATE.md; Daniel 2026-10-22); anything student-visible before it ships; any licence question; a second tenant; a MISSION ruling that proves wrong. Everything else: decide, log it in the plan's "Decided here" or STATE.md, move on.
- **Secrets:** never print, log or return a token, cookie, connection string or full email address. Spawning tests use `tests/helpers/isolatedEnv.mjs`.
- **High-stakes work** (auth, tenant isolation, never-in-repo, the chant gate) gets an adversarial pass by a second agent before it is reported done.
- **Done** means tests green on Windows and in CI and a deploy Daniel can open.

## Operating procedure (token efficiency, Daniel 2026-10-25)

- **Agents:**
  - Each builder or reviewer prompt points to `docs/planning/AGENT-BRIEF.md`, plus the milestone's spec pasted in and its exact approved strings.
  - Builders push, open the PR and stop.
  - The lead checks CI with a background `merge-if-green` script, and wakes a builder only with a failing test that is theirs.
- **Models and concurrency:**
  - Sonnet builds. Opus is for adversarial reviews, and for builds that touch auth, RLS or licensed text.
  - Two or three builders at once. Never two open PRs in the same hot-file group.
  - Migration numbers are reserved when a milestone starts.
- **Reviews:** an adversarial pass is limited to the diff and a named list of attacks. A re-review covers only the delta.
- **Tests:**
  - CI is the full check. Locally, run only tsc, the changed tests and never-in-repo.
  - Fix flakes as soon as they appear.
  - New tests assert roles and test ids, not wording.
- **The lead:**
  - Watch in the background, never by polling in the foreground.
  - Read only the failing lines of a log.
  - Make one STATE/PLAN commit per batch of merges.
  - Keep updates to Daniel short.
- **Planning and wording:**
  - Planning, wording and research go to Cowork.
  - Builders never wait on wording; gaps are batched into one popup round.
- **Fewer round trips (Daniel 2026-10-26: "really small changes … rather than grouping them together"):**
  - Before a wave starts, the lead gathers every foreseeable wording gap for it into one popup round, so builders start with the strings. Gaps found while building wait for one end-of-wave popup, never one per PR.
  - One fix round per PR: review findings and late wording go to the builder together, in one push. A delta re-review only when the fix touches security; never for wording.
  - Milestones that share screens or files go to one builder as one PR, with one review.
  - Size work by area, not by the plan's milestone numbers. Each PR has fixed costs (a fresh agent's context, about 25 minutes of CI, a review, a fix round), so bundle a whole area into one PR and keep small milestones out of their own pipelines (Daniel 2026-10-26: "each of these milestones is a tiny little thing"). The rest of 1.9 is three bundles: staff screens (N14, N15 and leftovers), practice visibility (N23), and N16.
  - Mechanical fixes (a test locator, a string, an allow-list entry) the lead makes directly instead of reviving an agent.
- **Small wording is the lead's call (Daniel 2026-10-26: "You really don't need my calls on these small wording things. Your judgement is generally fine"):**
  - Labels, empty states, status lines, chips, errors and email details: decide in the house voice. That means the child's name and never pronouns, no exclamation points or pep talk, plain verbs, "practise". Log each decision in the plan's "Decided here".
  - Ask Daniel only for wording that is a real product decision: a new promise to families, anything about privacy or what others can see, or a MISSION-level rule.
- **Rulings follow from his decisions (Daniel 2026-10-26: "just be logical and consistent with these decisions. You don't need my individual rulings on the vast majority of these"):**
  - Product, privacy and wording questions that a logical, consistent reading of MISSION, the decisions and earlier rulings can answer are the lead's to decide, with the reasoning logged in "Decided here".
  - Stop and ask only for money, licences, a second tenant, the beta label, irreversible production data changes, and messages to real people.
- **Proportion (Daniel 2026-10-26: "you're stressing about disclosures and privacy way more than is needed for a learn to chant Torah site"):**
  - Adversarial review only for the CLAUDE.md four: auth (sign-in, sessions, invitation tokens), tenant and cross-family isolation, never-in-repo (licensed text, family data), and the chant gate.
  - What a child's own tutor or parent sees, disclosure wording, and caching on one's own device are ordinary product work. They get no gates, no ordering tests and no re-review rounds.
- **Never relaxed:** adversarial reviews on high-stakes work, never-in-repo, the RLS tests, the migration check scripts, and CI's three device projects.

## Git

- Commit with the same identity the haftarah repo's `main` uses (`RavBogard <RavBogard@users.noreply.github.com>`), set repo-locally.
- Subjects are long, descriptive single sentences, as in the haftarah repo: what changed and why, in plain words.
- Never force-push `main`. Never rewrite pushed history.
- The haftarah repo is read-only from here.

## Where docs go

- Planning and handoffs: `docs/planning/<date>-<topic>/`.
- Specs: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, opening with "Settled decisions (Daniel, binding)" and ending with "Open items that wait on Daniel".
- Plans: `docs/superpowers/plans/`. Research: `docs/superpowers/research/`.

## Tests

- `npm test`: engine (`node --test "tests/**/*.test.mjs"`) and app (Vitest on PGlite). No network.
- `npm run test:e2e`: Playwright.
- Engine only: `node --test "tests/trope-*.test.mjs"`.
