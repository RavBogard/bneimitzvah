# Admin sheets — bounded independent regression

Product freeze: `3bc99ea3d7ceb9496c4f98f210131d02474e3f55`, integrated unchanged into managed `codex/roster-admin-release`. Source review is in `../2026-10-16-parallel-work/ADMIN-ROSTER-INTEGRATION-REVIEW.md`. No frontend product edits were made by this reviewer.

Own only `tests/http-browser/admin-sheet-release-review.test.ts`, SHA-256 `6d082e98e656c2adf1a2683867af3e36b20c91dcb567d8fa21fec07d992e9bae` at handoff. Three synthetic cases exercise each new roster/access/invitation dialog:

- Hold the real successful session check, require zero physical modals while concealed, then one rightful sheet with preserved draft/review; idle Escape dismisses and returns focus, with zero mutation requests.
- Hold the real committed mutation response; repeated Escape, removal of closedby to exercise capture fallback, and native close must preserve one modal, disabled close and exactly one POST. Verify the actual saved student/cantor/invitation result after release.
- Open a new private draft/review, expire that case's exact SDK session, and hold the actual 401 check. Require no modal or retained private DOM after denial and an actual protected API 401, with no automatic additional POST.

Each case obtains a fresh SDK session because it deliberately expires that session; no expired cookie reuse. Existing synthetic browser fixture supplies restricted PostgreSQL runtime and captured transport; browser egress is loopback only. Setup/teardown preserve the existing fixture/role/server ownership rules. Persistent request counts continue after the held route is removed.

Independent `node .local-logs/run-isolated.mjs admin-sheet-review-typecheck npm run typecheck` passed before the final persistent request-counter strengthening. That final change adds only a numeric counter/request listener and assertions. Whitespace checks pass. No browser/PG execution has occurred for these new cases at this handoff; root owns the coordinated isolated runtime and visual batch before releasing the fixture lane to migration-reference generation. Runtime acceptance remains pending.

Root's first actual run passed roster and invitation cases fully; access failed at the idle-focus assertion before its remaining mutation/expiry checks. Log `.local-logs/roster-admin-release-sheets-browser.log`:2/3 passed,28.00s. Source diagnosis showed a reviewer expectation error: the access reload intentionally unmounts the row button, and the documented focus fallback is the page heading when the stored opener disconnects. The owned test was corrected to require the exact `Tutors` h1 focused, preserving an actual focus assertion and every other behavior check. No product change. Corrected file SHA-256 `d8afdbfc29bb7b6598c143168ba458844c15a14f479325f6e8cf9693a92999c1`.

Root reports the affected access-only confirmation passed1/1 at that corrected test hash. Together with the initial roster/invitation passes, all three bounded cases are now covered successfully. This is cumulative3/3, not a claim of one single green three-case run, and runtime execution is root's evidence rather than an independent browser run by this reviewer. The tests exercise actual restricted-runtime writes and exact-session expiry, not fabricated authority responses. Product remains unchanged at3bc99ea.

Root separately reports existing admin UI plus synthetic quiet-import desktop/mobile passed4/4. Root inspected the screenshot batch and accepted roster sheet, People and reading layouts without obstruction or overflow. This is root visual acceptance; the reviewer did not perform another visual round. The initial isolated browser batch reported exact server restoration and owned temporary role removal; no additional source repair was needed.

Bounded source and runtime review accepted. Root retains final committed hashes, repository protection, full integration/hosted CI and release sequencing. No further reviewer source edits, browser runs or polish are queued.
