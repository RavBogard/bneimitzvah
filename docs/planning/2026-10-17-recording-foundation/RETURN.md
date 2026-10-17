# Student recording ledger return

Contract: [student-recording ledger design](../../superpowers/specs/2026-10-17-student-recording-ledger-design.md). Product/normal-test freeze: `578b5fc8f252ef2b27b09b811e7bcf465a171f18`, based on released `0ce58b6` plus root's accepted contract documents `7175c49`.

## Implemented boundary

- New local `0020_student_recording_ledger.sql`, generated snapshot and `recording-schema.ts`: immutable asset/hash/media/student identity, private-only insertion, consecutive irreversible lifecycle, FORCE RLS, qualified student FK, narrow runtime SELECT/INSERT/column UPDATE and no DELETE.
- `data/recordings.ts` and `recordings/{authority,service,validation,retention}.ts`: exact selected-mode authorization, current authority/expiry/calendar checks after waits, scoped visible id-only cursors, database CAS and minimal metadata receipts. Parent dashboard is denied; staff lists submitted only and cannot mutate.
- Separate server-only `recordings/registration.ts`: trusted independently verified-media registration seam, immutable exact replay and generic collision failures. The actual runtime object exposes only `page`, `submit`, `remove`; there is no creation route or registration field.
- Client-safe DTOs in `src/lib/recordings/types.ts`; closed no-store list/submit/delete HTTP adapter, dispatcher and minimal runtime composition. Existing route/browser fixture objects gain only the corresponding service.
- All-recordings retention now uses the existing reviewed Chicago/calendar arithmetic deliberately, including year-10000 anniversaries. The ceremony-edit trigger permanently transitions overdue private/submitted rows under either old/new date, uses post-lock actual time and adds no fabricated recording audit actor. Deletion requests remain allowed after due time. Physical deletion is not implemented. See the dated amendment below; the original submitted-only source/review results remain historical evidence.

Old recording policy/types, historical SQL, old release operators, frontend/reference/generated audio and provider settings are unchanged. No audio/media/provider/production operations occurred. This is a metadata ledger, not a completed capture/upload/playback feature.

## Author verification at freeze

- `node .local-logs/run-isolated.mjs recording-focused-corrected npm run test:app -- tests/app/recording-ledger.test.ts tests/app/recording-ledger-migration.test.ts`: **11/11**, two files, 12.00s; ignored log `.local-logs/recording-focused-corrected.log`.
- `node .local-logs/run-isolated.mjs recording-typecheck-corrected npm run typecheck`: **PASS**, including actual runtime shapes; ignored log `.local-logs/recording-typecheck-corrected.log`.
- Staged diff whitespace check passed before the source commit. No broad suite/native PostgreSQL execution by author at this checkpoint.
- Initial focused attempt had four fixture failures because pinned drizzle-kit truncated the generated MIME CHECK at a codec-string semicolon; five pure date cases passed. Restored the full new SQL CHECK to the exact expression retained in the generated snapshot, then all focused cases passed. Initial typecheck also identified the expected browser-fixture runtime composition addition, now resolved. These were pre-freeze integration corrections; no guard/constraint was relaxed.

Historical release-fixture inspection found **no affected current-tree migration fixture**, so no test edits were made. `tests/postgres/release-migrate.integration.mjs` already constructs its migrations/journal from exact `RELEASE_BASE` (`4ad7e0c`); `tests/helpers/release-roster-fixture.mjs` already does the same from `ROSTER_BASE` (`add56e7`). The pure release fixtures are synthetic or use those pinned Git trees. `tests/release-roster.test.mjs` retains the explicit extra-0020 rejection and the old-0018-operator extended-tree rejection. Current immutable reference/operator files are unchanged. Root separately reported Node 216/216; no duplicate run was started for this source-only follow-up.

## Remaining gates and next action

### Root integration checkpoint

- Independent source review accepted product578b5fc; adversarial tests/report are committed as `b26b0bd`. Three additional app cases and composed typecheck pass. The first native review run passed13/14; its remaining test supplied an invalid revision99 and never reached the intended lock. The reviewer corrected only that fixture to a valid stale revision3 and the affected case passed. Root subsequently ran all14 together as part of the full native regression below.
- Root Node regression: **216/216**; `.local-logs/recording-ledger-node.log`.
- Root full Windows app regression at the source freeze: **857 passed, one existing platform skip,98 files**; `.local-logs/recording-ledger-app.log`. The three separate reviewer cases are additional coverage; exact hosted checks must collect the final combined tree.
- Root fresh isolated native SQL regression: **24/24**,29.87s; `.local-logs/recording-ledger-fresh-serial-sql.log`. The owned PostgreSQL cluster was stopped and its verified owned path removed.
- Root full restricted PostgreSQL service/race regression, including all14 new adversarial cases together: **131/131**,11 files,101.52s; `.local-logs/recording-ledger-pg-regression.log`. The owned anchor was removed; no shared database reset occurred.
- Root production build: **PASS**; `.local-logs/recording-ledger-build.log`. Author and reviewer composed typechecks pass. No runtime source changed after independent acceptance.
- Reviewed private-storage research is recorded separately in [the candidate note](../../superpowers/research/2026-10-17-private-recording-storage.md); no provider or spending approval is implied.

This is a **source checkpoint only**. Exact hosted cross-platform/browser gates are the next integration step. Main and production remain0ce58b6; no0020 production apply, real data import, invitation or mail occurred. A separate known-shape Hebrew markup repair is reviewed in its own checkout/branch so it can ship without this unready recording migration.

Root coordinates independent recording-access/source review, separate adversarial/native PostgreSQL race tests, broader integration and exact hosted gates. Those results are not claimed by author focused tests. Preserve old release operators' explicit refusal of future migrations; any affected proof fixtures must use their pinned historical trees.

Daniel resolved private-unsent retention on 2026-10-17: all student recordings use the same one-calendar-year-after-ceremony deadline. Storage/provider selection, verified byte processing, playback, cleanup completion, offline leases, frontend review and production migration/release remain outside this implementation. Root owns subsequent decisions and integration; no production apply is authorized for this worker.

## All-recordings retention amendment, 2026-10-17

This supersedes the original submitted-only eligibility in source freeze578b5fc and its earlier review evidence. The existing historical `studentSubmissionRetention` pure helper remains submission-specific and unchanged; the new ledger now applies Daniel's deadline to both private and submitted records.

- `data/recordings.ts` uses the same due-time empty visible filter for all selected modes and cursor lookups: no private/submitted metadata, counts or pagination hints remain after expiry. Existing post-wait freshness checks and bounded requery now apply to both states.
- New, still-local migration0020 ceremony trigger stages either private1→deleting2 with NULL submission time or submitted2→deleting3 with its original submission time, under either OLD or NEW due date. A postponement cannot revive either state. Historical migrations/operators and the generated schema snapshot remain unchanged (only the new trigger body changed).
- Registration and submission already refused the deadline. Own-student/child deletion after due time remains allowed with the exact revision; current deleting retries remain audit-free no-ops. No physical deletion claim is added.
- Updated ordinary regressions cover own/child/admin due lists and both cursor states, private registration/submit replay denial, own/child deletion after expiry, private/submitted OLD-date postponement, NEW-date expiry, timestamp preservation and transaction rollback.
- Author focused command: `node .local-logs/run-isolated.mjs recording-all-retention-focused npm run test:app -- tests/app/recording-ledger.test.ts tests/app/recording-ledger-migration.test.ts`: **11/11**, two files, 10.41s. Log `.local-logs/recording-all-retention-focused.log`.
- Author composed typecheck: **PASS** via `node .local-logs/run-isolated.mjs recording-all-retention-typecheck npm run typecheck`; log `.local-logs/recording-all-retention-typecheck.log`. No broad app/native PostgreSQL/browser/provider check rerun by author.

Root owns the updated binding policy/spec documents separately. This amendment requires independent re-review and updated adversarial/native retention coverage before new source acceptance; earlier submitted-only results are historical evidence, not proof of the amended behavior.
