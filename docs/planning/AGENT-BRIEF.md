# Standing brief for builder and reviewer agents

Every agent prompt points here. A prompt adds only the milestone's own spec, pasted in, and its exact approved strings. Agents do not read the whole PLAN, DESIGN or strings files.

## Setup

- From `C:/Users/dsbog/bneimitzvah-study`, run `git fetch origin`, then `git worktree add C:/Users/dsbog/bneimitzvah-<slug> -b <branch> origin/main`, then `npm ci`. Work only in that worktree.
- Never touch `C:/Users/dsbog/bneimitzvah`, `bneimitzvah-voice`, the Codex worktrees or other worktrees. The haftarah, shirei-shabbat and shirei-tfilah repos are read only. Never `git stash` in `bneimitzvah-study`.
- Set the git identity repo-locally to `RavBogard <RavBogard@users.noreply.github.com>`.

## Build, push, stop

1. Implement the slice in the prompt and nothing more.
2. Run locally: `npx tsc --noEmit --incremental false`, then the test files you changed or added, then `tests/never-in-repo.test.mjs`. Never the full Vitest, Playwright or http-browser suites; CI runs those.
3. Commit, push, open the PR, and **stop**. Don't wait on CI and don't rerun jobs. The lead checks CI and comes back to you only with a failing test that is yours.
4. Report in under 15 lines: the PR number, head SHA, what changed, the tests you ran, and the wording gaps.

## Rules that always hold

- **Never in the repo:** licensed text (JPS, the Beit Mitzvah siddur), student or family data, recordings, rendered audio, credentials. Fixtures are synthetic (`@example.test`). Never weaken `never-in-repo`.
- **Secrets:** never print a token, cookie, connection string or full email address. Tests that spawn processes use `tests/helpers/isolatedEnv.mjs`.
- **G3:** no generated chant reaches a student.
- **Wording:** use approved strings only, word for word. A string with no precedent is a gap: ship the behaviour without it and list it.
- **Tone:** no emoji, exclamation points, pep talk, streaks, scores or tallies ("Part n of m" positions are fine). Use straight apostrophes and "practise" as the verb. Use the child's name, never pronouns.
- **New tests:** assert roles, labels and test IDs, not exact wording or layout, except in one deliberate wording test per screen. When you touch a brittle test anyway, convert it.
- **Tools:** don't use the Playwright MCP or Chrome DevTools MCP. Never trigger `window.print()`.
- **Bash:** heredocs with apostrophes fail here. Write commit messages with the Write tool and commit with `git commit -F`.
- **Commits:** subjects are long, single, descriptive sentences. End each message with the `Co-Authored-By` and `Claude-Session` lines the prompt gives.
- **PR bodies:** end with the "Generated with Claude Code" line and the session link the prompt gives.

## Reviewers

- Read only. Write no product code and push nothing.
- Review the diff named in the prompt against its list of attacks. On a re-review, look only at the change since the last pass.
- Report PASS or BLOCK in under 20 lines, with file:line references, a concrete scenario and the fix for each finding.
