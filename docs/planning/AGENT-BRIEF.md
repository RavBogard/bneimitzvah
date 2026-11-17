# Standing brief for builder and reviewer agents

Every agent prompt points here. A prompt adds only the milestone's own spec, pasted in, and its exact approved strings. Agents do not read the whole PLAN, DESIGN or strings files. The rules themselves are in `CLAUDE.md` and Daniel's rulings in `docs/planning/RULINGS.md`; this page is the procedure.

## Setup

- Work in your own git worktree or clone on a branch made from `origin/main` (or the base branch the prompt names): `git fetch origin`, create the branch, then `npm ci`. Use Node 24 (`.nvmrc`).
- Touch nothing outside that worktree: not the main checkout, not other agents' worktrees. The haftarah, shirei-shabbat and shirei-tfilah repos are read only.
- The git stash is shared between worktrees; set work aside with a temporary commit instead.
- Commit with the identity the prompt gives.

## Build, push, stop

1. Implement the slice in the prompt and nothing more.
2. **Before pushing, search the tests for what you changed.** For every label, heading, link name, aria-label, test ID, class, route or stored key your change removes, renames or moves, grep `tests/`, `e2e/` and `tests/http-browser/` and update each match in the same commit. Also check the guard tests your change may trip on purpose, and update them with the reason in a comment:
   - Tab-stop checks: `tests/app/visual-system.test.ts`, `e2e/aliyot.spec.ts`, `e2e/sheet-dock.spec.ts`, `e2e/word-card.spec.ts`.
   - Browser storage keys a page may write: `tests/http-browser/student-work-ui.test.ts` (search for `crc-torah:`).
   - Landmark counts (one main, one footer): `tests/app/signed-in-shell.test.ts`, `tests/app/visual-system.test.ts`, `e2e/workspace-shell.spec.ts`, `e2e/visual-system.spec.ts`.
   - Repository and asset policy: `tests/never-in-repo.test.mjs` with `scripts/repo-policy.mjs`; fonts in `scripts/font-assets.mjs` and `tests/font-assets-policy.test.mjs`; brand images in `tests/brand-assets-policy.test.mjs`.
   Say in your report what the search found.
3. Run locally: `npx tsc --noEmit --incremental false`, then the test files you changed or added, then `node --test tests/never-in-repo.test.mjs`. For any `tests/postgres/` or `tests/http-browser/` file you changed or that your search matched, run it with `npm run test:local-db -- <file>` (it starts a throwaway UTF-8 Postgres; `--http` builds first). Never the full Vitest, Playwright or http-browser suites; CI runs those.
4. Before pushing, merge your PR's base branch into yours, so CI tests what will merge.
5. Commit, push, open the PR, and **stop**. Don't wait on CI and don't rerun jobs. The lead checks CI and comes back to you only with a failing test that is yours.
6. Report in under 15 lines: the PR number, head SHA, what changed, the tests you ran, and the wording gaps.

## Rules that always hold

The full list is `CLAUDE.md` "Rules". The ones a builder trips most:

- **Never in the repo:** licensed text (JPS, the Beit Mitzvah siddur), student or family data, recordings, rendered audio, credentials. Fixtures are synthetic (`@example.test`). Never weaken `never-in-repo`.
- **Secrets:** never print a token, cookie, connection string or full email address. Tests that spawn processes use `tests/helpers/isolatedEnv.mjs`.
- **G3:** no generated chant reaches a student.
- **Wording:** use approved strings word for word. A string with no precedent is a gap: ship the behaviour without it and list it.
- **Tone:** no emoji, exclamation points, pep talk, streaks, scores or tallies ("Part n of m" positions are fine). Use straight apostrophes and American spelling, "practice" for both verb and noun (see `RULINGS.md`, "Unclear", item 2). Use the child's name, never pronouns.
- **New tests:** assert roles, labels and test IDs, not exact wording or layout, except in one deliberate wording test per screen. When you touch a brittle test anyway, convert it.
- **Tools:** don't use the Playwright MCP or Chrome DevTools MCP. Never trigger `window.print()`.
- **Commits:** write the message to a file and commit with `git commit -F` (shell quoting of apostrophes is fragile). Subjects are long, single, descriptive sentences. End each message with the `Co-Authored-By` and `Claude-Session` lines the prompt gives.
- **PR bodies:** end with the "Generated with Claude Code" line and the session link the prompt gives.

## Reviewers

- Read only. Write no product code and push nothing.
- Review the diff named in the prompt against its list of attacks. On a re-review, look only at the change since the last pass.
- Report PASS or BLOCK in under 20 lines, with file:line references, a concrete scenario and the fix for each finding.
