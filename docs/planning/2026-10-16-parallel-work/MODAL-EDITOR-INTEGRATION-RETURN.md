# Frozen editor/modal integration return — 2026-10-16

## Checkpoint and scope

Integration branch: `codex/editor-modal-integration`, based on independently reviewed progress checkpoint `2689d94d474e1c62304a6b91d530eac6b43c826c`. Root reports that exact progress checkpoint's four hosted jobs succeeded. This modal candidate still requires its own exact-tree hosted CI; it has not been pushed by the author.

Only frozen UI `3b3d73a` was cherry-picked, as `4b08fa8`; tutor `94dae65` was already integrated and was not duplicated. Existing `b9f12e9` roster pagination/departure repairs and progress backend remain preserved. No moving UI/voice source was used. New voice after the accepted frozen stream remains excluded.

The frozen change opens the tutor assignment editor as a retained sheet, updates picker styling, and introduces conceal-aware native modal lifecycle for sheet/lift. Its `ReadingEditor` diff also added a busy callback/passive effect; the inherited claim that the editor was untouched does not describe that actual diff. Preparation, server bindings, generations, expiry and uncertain-confirmation behavior remain unchanged by this integration.

## Bounded corrections

- `40e1e84`: departure review now uses the conceal-aware helper. While its decision is pending, the physical editor is suspended but its logical open state/draft remain mounted. This intentionally uses one modal, rather than promising simultaneous visible editor/departure backdrops. Capture the rightful opener before suspension; restore only a connected, visible, non-inert control in an open dialog after cancellation. Concealment closes the physical layer without resolving/discarding the pending decision; authority failure clears it.
- `1fbaf96`: the lift recheck test is independent of earlier browser cases and proves fresh keyboard Enter activation plus Escape/opener restoration.
- `21a403d` / `db60fce`: reviewer-authored independent privacy tests, then the reviewer's correction to reselect the default-reset note stream before checking the exact retained unsent text. No draft-loss product claim was established.
- `0d4b00b`: fresh reading test contexts reuse each role's first real SDK session. The enlarged file otherwise made a sixth magic-link request within the plugin's unchanged five-request window. No production throttle or authority setting changed; these tests never intentionally revoke/expire the reused sessions.
- `ffd04b1`, `2748e0c`, `b7c1c9d`: layout publication synchronizes pending state; native `closedby="none"` while busy and `closerequest` while idle prevent platform close requests. A document-capture Escape fallback acts only while busy and the actual sheet is open, modal and outside hidden/inert ancestors, with exact listener cleanup. No forced reopen, generic modal stack or idle keyboard trap.
- `2496d04`: test-only recovery setup establishes a real authorized preparation followed by a fixed stale/409 response before clicking the blocked-only explicit reload control. Removes repeated captures; preserves all immediate/repeated Escape, disabled-close, fallback, outcome, draft and idle-focus assertions.

The diagnostic disproved the initial layout-only explanation: the first native cancel was cancelable/prevented with busy/open/modal true; the second was non-cancelable and closed the still-busy dialog. It was not a missing accessible name or concealed workspace. This matches the [HTML close-watcher algorithm](https://html.spec.whatwg.org/multipage/interaction.html#close-watcher-request-close). Final testing verifies installed Chromium's native `closedBy` support and also removes the attribute temporarily to exercise the scoped keyboard fallback; it does not claim Safari/Firefox execution.

## Verification and honest failures

Author executed all browser work below through ignored `.local-logs/frozen-browser-isolated.mjs`: fixed loopback port 3191 checked free, exact existing disposable PostgreSQL cluster identity checked, fresh owned anchor/DB/restricted runtime roles, isolated child environment. Every run reported exact temporary server-source restoration and owned role removal; final Git diff for `server.ts`/`tsconfig.json` is empty. No shared credentials, cluster reset, other process termination or production operation occurred.

| Gate | Result |
| --- | --- |
| Focused app reading/UI/proposal/draft/reload/binding checks | 34/34, five files, 17.36s |
| Final product typecheck and build at `b7c1c9d` | Passed; final test-only `2496d04` typecheck also passed |
| Initial browser batch at `f169410` | 11/14 passed, five unselected skipped, 99.73s. Failed busy repeated-Escape case, note-stream selector after remount, and sixth SDK sign-in. All failures retained in log. |
| Exact three-case confirmation at `ffd04b1` | 2/3 passed, 36.73s. Corrected note retention and existing empty-calendar case passed; busy prepare still failed, disproving layout-only fix. |
| One native diagnostic | Reproduced the repeated non-cancelable close with safe boolean/phase trace, 15.98s; no acceptance claimed. |
| Native/fallback acceptance attempt at `b7c1c9d` | Held prepare, confirm and post-confirm reload passed and captures generated; later failed author test setup by targeting blocked-only recovery after success, 38.82s. No new product failure. |
| Final single busy case at `2496d04` | 1/1 passed, three unselected skipped, 11.90s. Actual prepare/confirm/post-confirm reload/explicit recovery waits, immediate/repeated Escape with native and simulated missing attribute, disabled Close, visible server outcomes, idle Escape, fallback opener and retained draft all passed. |
| Scoped mechanical detector | 47 advisory findings, zero primary; no inherited visual polishing. Later corrections change behavior only. |

The fourteen selected cases are covered cumulatively by the initial eleven passes, two corrected confirmation passes, and final busy pass. This is **not** a claim of one final 14/14 run or an independent reviewer browser execution. Existing unchanged backend full-app 790 pass/one skip evidence is reused; full Node/app/PG/browser matrix belongs to exact hosted CI.

Logs: `.local-logs/modal-focused-app.log`, `modal-fallback-typecheck.log`, `modal-fallback-build.log`, `modal-final-test-typecheck.log`, `modal-integration-browser.log`, `modal-confirmation-browser.log`, `modal-native-diagnostic-browser.log`, `modal-native-acceptance-browser.log`, `modal-final-busy-browser.log`, `modal-detector.json`. Final single-case command: `node .local-logs/frozen-browser-isolated.mjs modal-final-busy tests/http-browser/reading-ui.test.ts -t "keeps the tutor sheet"`.

## Visual and independent acceptance

Root inspected and accepted the three synthetic captures from product `b7c1c9d` in one batch, without requesting polish: `.impeccable/review/reading-tutor-prepared-busy-checked-mobile.png`, `reading-tutor-confirmed-busy-checked-mobile.png`, and `reading-tutor-prepared-busy-checked-desktop.png`. Phone viewport is 390×844. The final setup correction changes tests only and intentionally does not repeat those captures. Daniel's approved student design and unchanged 820px first-Hebrew gate were not reopened.

The paired independent review records source/fixture/test inspection separately from author browser measurements and root visual acceptance. Its owned original report is copied into this integration context, leaving the original intact. Final staged candidate/index repository guard and `git diff --check` are required before the documentation checkpoint; handoff reports their executed outcome.

## Next authorized work and holds

Root-approved lesson-log spec is frozen at `f169410`, [2026-10-16-lesson-log-design.md](../../superpowers/specs/2026-10-16-lesson-log-design.md). After preserving this clean modal checkpoint for root's publish/hosted CI, continue on separate `codex/lesson-log-foundation` from it with additive local 0017/schema/data/service/HTTP/client-safe types/tests and independent review. No lesson source is included here. Publishing this review branch is allowed when root accepts; production/deploy/provider/migration application/import/model/audio work remains held. Original STATE/COORDINATION and the moving UI/voice checkouts are unchanged by this implementer.
