# CLAUDE.md — CRC B'nei Mitzvah

Read first, every session: `docs/planning/2026-10-15-kickoff/MISSION.md` (Daniel's binding rulings), then `docs/planning/2026-10-15-kickoff/STATE.md` (where the work stands), then the plan beside them. Where MISSION rules, do not re-decide.

## Rules

- **Never in the repo:** JPS or any licensed text, student or family data, recordings, rendered audio, model weights, credentials. `tests/never-in-repo.test.mjs` must stay green; never weaken it to pass.
- **G3 gate:** no student hears generated chant until Daniel passes the listening review (at least 95% melody passes, zero "would teach wrong"), after G1 and G2. No code path may serve an unreleased render to a student.
- **Engine:** `trope/` stays dependency-free Node plus its vendored, licensed copies with `PROVENANCE.md`. Nothing is installed into it. Its tests run with `node --test`. The app never imports the Python side.
- **Stop and ask Daniel for:** money (new paid service, upgrade, spend notice); anything student-visible before it ships; any licence question; a second tenant; a MISSION ruling that proves wrong. Everything else: decide, log it in the plan's "Decided here" or STATE.md, move on.
- **Secrets:** never print, log or return a token, cookie, connection string or full email address. Spawning tests use `tests/helpers/isolatedEnv.mjs`.
- **High-stakes work** (auth, tenant isolation, never-in-repo, the chant gate) gets an adversarial pass by a second agent before it is reported done.
- **Done** means tests green on Windows and in CI and a deploy Daniel can open.

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
