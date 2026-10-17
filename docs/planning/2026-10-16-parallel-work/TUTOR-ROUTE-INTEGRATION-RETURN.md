# Tutor route integration return — 2026-10-16

## Scope and frozen refs

Owned checkout: `C:/Users/dsbog/.codex/worktrees/recording-core/bneimitzvah`, branch `codex/tutor-route-integration`, starting at hosted-green `1c3081227531995ab8f32e7554983f3c27aedc41`.

Only frozen tutor `94dae6572e003e05488d68106cb84dbbec586a51` was integrated, as clean cherry-pick `37a4994260e6c2a26fe3c231dde881e104200796`. It adds tutor student cards, focused `/workspace/tutor/[studentId]` pages, Song session teaching controls, staff status chips and corresponding browser-selector changes. Moving editor/source work in the Claude checkout was not an input. Voice beyond accepted `24778d3` remains excluded.

Daniel's approval of the existing frozen student surface and wording remains closed. This milestone adds no mandatory repeat human approval gate for staff-only work. Tutor and changed parent-card previews were reviewed by root; production remains held under the existing release constraints. No new editor, progress feature, provider operation, production migration/import, model processing, package change or dependency installation occurred. The original shared STATE/COORDINATION and live Claude checkouts were not edited.

## Confirmed defect and bounded correction

Independent review confirmed a P2 route defect: an authorized student beyond the first 100 rows was reported missing. Even loading that student's card on page two did not help, because navigating to its focused URL reloaded only page one.

Correction `b9f12e9` uses the existing authorized student-list API and continues cursor pagination until the focused target is found or the list is exhausted. It preserves cancellation, sequence checks and fresh server authorization on every page; duplicate/backward page progress fails closed. A keyed target change clears the prior reading and work while resolving. Loading stays distinct from an exhausted not-found result. No new API or style change was needed.

The new four-case actual SDK/restricted-PostgreSQL browser regression covers:

- Authorized card, copied and direct routes, nested Tutor `aria-current`, and a target beyond 100 authorized rows.
- A held later page keeps the absent target in loading state until authorized pagination is exhausted.
- Foreign, unknown and malformed targets never select another reading or initiate target reading/study/work requests.
- An old held reading cannot replace the newly selected student; live tutor-link revocation clears focused text and editors.
- Card navigation with an unsent tutor note supports Keep working and explicit discard, with no accidental note submission or browser-storage leakage.
- Parent access remains separate from tutor authority; admin-only, student-only and anonymous sessions cannot obtain tutor reading authority through the new URL.

The accepted student accessible phrase descriptions, Start keyboard activation/focus restoration, synthetic long-verse coverage and strict 390×844 / 820px student geometry assertions remain. Tutor phone staff assignment metadata may precede Hebrew; that is separate from the student geometry gate.

## Verification and evidence

- Focused UI/API tests: **86/86**, eight files (`.local-logs/tutor-focused-ui.log`), at the initial frozen tutor cherry-pick. These cover unchanged API/work/reading trust contracts; the subsequent pagination correction is covered by the independent runtime probes and actual browser cases below.
- Final corrected source typecheck and production build pass (`tutor-typecheck.log`, `tutor-build.log`).
- First and only browser batch: **7/7**, two files, **48.45s**, at corrected source `b9f12e9`: new tutor-route **4/4** and existing workspace **3/3** (`tutor-browser.log`). No failed browser round or confirmation run occurred.
- Independent reviewer accepts the corrected source, meaningful browser assertions and bounded runtime selection/control probes. Details and limits are in [TUTOR-ROUTE-INTEGRATION-REVIEW.md](TUTOR-ROUTE-INTEGRATION-REVIEW.md). Independent source/probe evidence is distinct from the author's browser execution and root's visual inspection.
- One scoped Impeccable context/detector pass on the changed tutor route/provider/students/reading/view/globals surface: **41 advisories, zero primary findings** (37 documented type-ramp mismatches, four radius mismatches). Raw results are ignored `tutor-impeccable-{context,detector}.json` and stderr files. No inherited-advisory polishing or PRODUCT/DESIGN regeneration was performed.
- Final staged candidate/index repository guard and `git diff --check` are required before this documentation checkpoint is committed; final handoff confirms their result.

The hosted-green baseline's **185 Node / 779 Windows app plus one existing skip** evidence is reused for unchanged Node, guard, recording and student-only boundaries. No full Node/app or student-only visual suite was repeated locally; exact final hosted CI remains required. Dependencies are the existing independent installation and `package-lock.json` is unchanged.

## Browser isolation and captures

The existing ignored runner was reused with explicit tutor/workspace test targets. It verified loopback port **3191** free immediately before use, asserted the known local disposable PostgreSQL cluster identity, and created an owned random anchor login. The fixture created its own database and restricted runtime roles; actual application requests used the restricted pool and real SDK authentication. Children used `isolatedEnv.mjs`, with production/provider credentials absent. No shared password was rotated, cluster reset or other process terminated.

Runner completion reports **exact server source bytes restored: true; owned temporary anchor login removed: true**. Fixture cleanup returned successfully. The temporary port change is absent from the committed source.

Root inspected and accepted all five synthetic captures in one batch under `.local-logs/tutor-route-review/`: `desktop-home.png`, `phone-home.png`, `phone-parent-home.png`, `phone-reading.png` and `desktop-reading.png`. Cards, selected-student/role controls and reading tools fit their phone/desktop viewports without clipping. This is synthetic browser/visual evidence, not physical-device touch proof or production approval.

## Next action and hold

Come to rest at this bounded reviewed checkpoint. Root may publish the accepted review branch and watch fresh Windows/Linux/PostgreSQL/public and full authenticated browser CI for its exact final commit. No worker push or production deployment is authorized here. Do not start the moving editor, progress backend or another interface milestone from this return.
