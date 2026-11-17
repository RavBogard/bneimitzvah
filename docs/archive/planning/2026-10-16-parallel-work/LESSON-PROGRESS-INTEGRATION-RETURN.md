# Lesson/progress frontend integration — author return

Status: bounded frontend source and cumulative independent browser matrix accepted; broad local integration and exact hosted CI remain pending. Independent tests are committed at `213a71c`; see [review](LESSON-PROGRESS-INTEGRATION-REVIEW.md) for the initial 1/4 and corrected affected 3/3, source identities and restored fixtures. Guarded migration helper `dbc470e` and restricted WS smoke `b292c05` are separately reviewed; root's actual default read-only preflight passes on PG18. Private catalog activation still has its own acceptance gate. Root owns release preparation and cutover. This return does not claim a production deployment or migration apply.

## Sources and ownership

- Accepted base: `4ad7e0c110cb30819b948429a7b65a1fcc5e35f9`, previously green in all four hosted jobs.
- Frozen progress UI `6398b3f30270177bf074dd937e28e039f2a1818f` → `32002c9`; frozen lesson UI `26057b1` → `785b233`.
- Progress correction: `6eb3e44`; lesson cleanup correction: `5a14d73c456d6398992900f665cde0ccc878e842` (current frontend product freeze).
- Original shared coordination reserved these sources before edits. Moving admin/roster/navigation/fixture and voice sources are excluded. No backend/schema/provider configuration changes are included.
- The ReadingPanel conflict retains the accepted service `onDepartureActive` signal and adds the lesson panel. Existing shared conceal hook, service/work sheet suspension, tab auto-reveal, roster pagination and busy editor Escape behavior remain.
- The separate release-migration helper is independently owned by the other Sol. Its source and evidence will have a separate review; it is not represented as frontend verification here.

## Narrow corrections

Uncertain or conflicted progress writes now mark their verse unverified until an authoritative GET succeeds. Held or failed recovery reads cannot enable another mutation or present the cached mark as current. The explicit “Check saved mark” action reads the affected verse's page and never replays a POST. Failed verification hides stale summary counts. A successful recovery preserves the conflict/unknown explanation and then states that the latest mark is shown.

Successful writes reconcile counts against the current scope generation, rather than requiring the exact same baseline object. Same-scope refresh therefore cannot skip reconciliation permanently. Changed assignment/context generations still reject late results.

Lesson authority-clear, scope replacement and unmount cancel a pending departure decision (`false`). They cannot supply the user permission that an original navigation was waiting for. Explicit user discard remains the existing separate action.

No additional modal framework or provider flag was added. Source inspection found that the lesson sheet blocks ordinary background actions; work/service guards publish departure before awaiting network operations. This is source evidence, not proof of every runtime interleaving. A new signal requires a rightful reachable failing case, as root directed.

## Author verification so far

- Progress store reproduction: three failures, one positive changed-assignment fence pass. Both unknown/conflict recovery became writable too soon; same-scope refreshed counts stayed stale. After the correction, all four pass.
- Lesson lifecycle probe: asserts that the real component's registered departure promise is pending before invoking authority-clear or unmount. Both returned `true` before the fix; both return `false` after it. This DOM-free hook host does not claim native dialog/focus coverage.
- Combined focused app checks: **6/6**, two files. Log `.local-logs/lesson-cleanup-confirmation.log`.
- Actual SDK/restricted PostgreSQL ordinary browser checks: **4/4**, two files, **66.35s**. Includes separate progress streams/counts/default clearing/conflict, lesson add/edit/delete/conflict/unsent prompt/focus recheck/lost acknowledgement and family read-only list. Run before the one-line lesson cleanup correction. Log `.local-logs/lesson-progress-normal-browser.log`.
- Runner: `node .local-logs/frozen-browser-isolated.mjs lesson-progress-normal tests/http-browser/progress-ui.test.ts tests/http-browser/lessons-ui.test.ts`. Fresh owned fixture, fixed loopback 3191; exact port source restored and owned role removed. Configuration diff is quiet. PostgreSQL/browser lane was explicitly released to the release-helper owner afterward.
- Typecheck passes after all product corrections and the additional normal recovery browser test. Log `.local-logs/lesson-progress-freeze-typecheck.log`.
- Targeted follow-up on the corrected frontend: **3/3 selected cases**, two files, **70.36s** (six unselected cases skipped). The real authorized mark commits before its acknowledgement is lost; held/failed recovery removes writable controls, explicit retry verifies the mark/counts without a second POST. Existing study setup plus Standard/Huge phone wrapping, first-word ≤820px, Huge final-word stage/dialog containment, keyboard Enter opening and Escape/focus restoration pass. Command: `node .local-logs/frozen-browser-isolated.mjs lesson-progress-recovery-longverse tests/http-browser/progress-ui.test.ts tests/http-browser/study-ui.test.ts -t "keeps an uncertain mark|shows escaped structured Hebrew|wraps a synthetic long verse"`. Log `.local-logs/lesson-progress-recovery-longverse-browser.log`. Source/config restored (diff exit 0), owned role removed; lane explicitly released.
- Required scoped detector: **55 advisory, zero primary**, exit 0, on changed globals/provider/reading/progress/lesson/study targets. No advisory polishing. `.local-logs/lesson-progress-detector.json`.

## Captures

Actual integrated synthetic captures are retained under ignored `.local-logs/lesson-progress-captures/`:

- `progress-student-lift-mobile.png`, `progress-student-list-mobile.png`, `progress-tutor-lift-desktop.png`.
- `lessons-student-mobile.png`, `lessons-tutor-sheet-desktop.png`, `lessons-tutor-list-desktop.png`, `lessons-tutor-conflict-desktop.png`.
- `progress-unverified-retry-mobile.png` from the real committed-write/lost-answer/failed-read flow; no synthetic composition.
- `longverse/standard-reading.png`, `standard-lift.png`, `huge-reading.png`, `huge-lift.png`, `huge-lift-end.png` retain the corrected integrated phone reading and scroll evidence.

Root inspected and accepted the student progress lift, student lesson list and tutor lesson sheet. Their render is unchanged by the cleanup-only correction. This bounded visual acceptance does not replace the unchanged 390×844/820px and Huge final-word reachability gates or authorize family pilot use. Daniel-facing preview remains root's release responsibility.

## Remaining gates

- Independent real-flow privacy/ordering matrix and release-helper reviews are complete at the linked frozen scopes; preserve their exact evidence and the author's Standard/Huge checks.
- Final broad app/type/build checks after independent source acceptance, copied final review, staged repository guard/candidate/index and `git diff --check`, clean checkpoint, then root's exact hosted CI and release preparation.
