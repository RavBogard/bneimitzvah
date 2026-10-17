# Song session student surface — return note

Stream: Claude student redesign. Checkout `C:/Users/dsbog/bneimitzvah-song`, branch `design/song-session-student`, based on `25accb7`.

## Acknowledgement (2026-10-16)

Read `docs/planning/2026-10-16-parallel-work/COORDINATION.md`. I keep to the files listed below and do not edit other streams' state or source. Codex owns integration and the shared coordination file. Daniel asked all coders to stay in touch; the voice Claude stream (`bneimitzvah-voice`) was messaged directly.

## Owned files in this pass

- Visual world: `src/app/globals.css` (Song session tokens, light and night-lake dark mode, shell, hero, verse cards, toolbar, lifted line).
- Student reading: `src/components/portal/workspace/reading.tsx`, `reading-prefs.ts` (new), `reading-toolbar.tsx` (new), `students.tsx` (student page title becomes screen-reader only), `provider.tsx` (lake app bar, product name "CRC Beit Mitzvah", role nav hidden for single-role accounts, plain footer).
- Study text: `study/view.tsx`, `study/annotations.tsx`, `study/annotations.module.css`, `study/credits.tsx`, `study/lift.tsx` (new).
- Font: `public/fonts/bricolage-grotesque/*`, `public/fonts/PROVENANCE.md`, `.gitattributes`, `scripts/font-assets.mjs`, and `scripts/repo-policy.mjs` (`missingFontPair` only).
- Tests: `tests/font-assets-policy.test.mjs`, `tests/http-browser/study-ui.test.ts`, `tests/http-browser/server.ts` (copies both font families).

## Shared hotspot: `scripts/repo-policy.mjs`

My only change is `missingFontPair`, which now pairs each font with its own notice per `family`. The registry gained a `family` field and the Bricolage pair. Voice's `PRIVATE_BENCHMARK_SCHEMA` rule is not on this branch and must be kept at integration. An independent adversarial review of the font change reported it safe: pins match upstream commit `6ce172f7`, no cross-family borrowing, binary exception still exact-pin only, and the font plus never-in-repo tests pass. Its one test gap (line-ending checkout for the new pair) is closed.

## Decisions recorded here

- **Preference scope (Codex observation):** phrase colors, translation and Hebrew text size are remembered **per student**, matching the UX ruling. Each student's choice is stored in browser storage under a key derived from a one-way hash of their id. No raw id, text or progress is stored. Staff preview outside a student scope uses one shared default. The browser test turns colors off for one child, switches siblings and asserts the sibling still has the default.
- **No fake progress:** the contract's Working / Got it self-check and the "4 of 9 solid" end line need a progress backend that does not exist. They are not built. Any API or schema for them is Codex's to coordinate.
- **Signature motion:** the ink-pull wipe plays when each phrase is lifted in the practice view, not on "Got it".
- **Students see no status or provenance:** confirmation and revision lines, calendar-source and edition status, missing-aliyah notes and the long unsent-work warning are hidden for students, child practice and parents. Sources stay one tap away under "About this text". Staff views are unchanged apart from the new inks.
- Server bindings, revocation, unsent-work recovery, departure review and the exact Hebrew/qere/read-word indexes are untouched. Ketiv/qere still renders inline.

## Checks on the frozen commit

- Typecheck and production build pass.
- App tests: 685 passed, 1 existing skip. Engine and node tests: 153 passed. Font policy and never-in-repo: 16 passed.
- Browser suite: all 16 files pass, run one file at a time against a disposable loopback PostgreSQL 16 in WSL. Claude Code stopped a single combined run for low system memory; it was not restarted as one run.
- Font-registry change: an independent adversarial review confirmed it safe. Its one test gap is closed.
- Impeccable finish review: disposition "fix" with eight material fixes. Six are applied: lift scrolling and phrase-follow, apparatus out of the lifted line, desktop toolbar as a rail beside the verses, flat inks with no soft shadows, legible "coming soon", child-practice header compacted, and reduced-motion scrolling.
  - Cringe check passed.
  - Kept as adaptations: the student name stays as the hero heading rather than moving into the app bar, because the active child must be explicit; the refresh control stays, because reload flows use it.
- DESIGN.md and `.impeccable/design.json` were rewritten from the shipped build by the documenter.

## Waiting on Daniel (student-visible wording)

- Toolbar "English" instead of "Translation". Per-verse "Your translation & notes" for students.
- Ketiv/qere note for students: "Read aloud the word in brackets (qere), not the written form (ketiv) before it." Staff keep the original sentence.
- The whole surface is student-visible and does not ship before Daniel looks at it.

## Known gaps

- Working / Got it self-check and the end-of-session line need a progress backend (Codex to coordinate).
- No position rail on the reading list; the rail exists in the lifted line.
- The finish reviewer asked for a long-verse capture at Standard and Huge. The synthetic fixture only has one-word verses, so this is not yet captured.
- DESIGN.md lists small stylesheet drift on staff screens: old 6px textarea corners, a hard-coded dark navy, and the `--color-teal` name now holding forest green.

## Next checkpoint

Daniel's look at the screens, then the wording decisions above. After that: staff surfaces (tutor, then admin) in the same world, as phase 2.

## Requested integration action (for Codex)

When the frozen commit is ready, reconcile `scripts/repo-policy.mjs` with voice's rule. Run the combined font, never-in-repo and private-path tests. Then run the browser suite on the integrated commit.

## Frozen commit

`f345972` on `design/song-session-student`: the Song session student surface, font, tests, DESIGN.md and this note. Not pushed, merged or deployed.

## Phase 2, slice 1: tutor daily path (2026-10-16)

Daniel said "Continue" after the Phase 1 freeze. The two student-wording calls stay as built and flagged.

- **Tutor home:** "Who are you teaching today?" student cards replace the dropdown. Each card shows the name, ceremony date and countdown. Parent child selection uses the same cards as buttons.
- **Stable page per student:** `/workspace/tutor/<studentId>`. A route id is honoured only if it is in the tutor's authorized list. Otherwise the page shows "Student not found" and loads nothing; the server still authorizes every read. The other students sit in a compact chip strip for back-to-back lessons.
- **Tutor reading:** the Song session hero, toolbar and lifted line, plus a "Change verses" jump to the editor. Staff assignment details stay, and "Needs review" is a marigold chip instead of red text.
- **Role nav:** stays current on per-student pages.
- **Tests:** card selection is scoped to the "Student" or "Child" list so a role switch can't race. A new browser check covers the per-student route and a foreign id.
- **Checks:** typecheck passes; app tests 685 passed, 1 existing skip; repository guard passes. Browser files reading, study, student-work, workspace, roster-controls, reading-preview, service-learning and portal all pass, run one at a time.
- **Next slices:** the reading editor as a sheet where the preview is the picker, with one confirm per task and the server-side review binding unchanged. Then service parts and notes as tabs.

## Rebased onto the integration ref (2026-10-16)

Read Codex's note that Daniel approved the frozen student UI and wording ("Looks good"). The two wording calls above are closed by that approval. Branch `design/song-session-staff` starts from `origin/codex/frozen-stream-integration` (`1c30812`), so it carries Codex's phrase descriptions (`b037c61`) and the long-verse and keyboard coverage. The tutor slice `e412e0f` was cherry-picked onto it without conflicts. The older branch `design/song-session-student` is superseded for staff work.

## Phase 2, slice 2: verse editor as a sheet for tutors (2026-10-16)

- **Sheet:** "Change verses" (or "Assign verses" when nothing is assigned) opens the existing reading editor in a modal sheet. It is full screen on phones and a right-hand panel on wider screens, with the reading still visible behind it. Admin keeps the inline editor until Phase 3.
- **Picker:** inside the sheet, the preview is restyled as the picker. Start and End are pill buttons beside each verse. The "Stage a verse selection" box stays pinned while verses scroll on wider screens; on phones it is not pinned, because it is too tall.
- **Review:** the review reads as a card with one full-width Confirm.
- **Logic unchanged:** `reading-editor.tsx` and `reading-preview.tsx` are untouched. Prepare, review and confirm, the server binding, expiry, conflict handling and the departure guard work exactly as before. The draft survives closing and reopening the sheet.
- **Finding, fixed generally:** a modal `<dialog>` inside the workspace's hidden/inert wrapper renders nothing but still makes the whole page inert. That would lock the "Checking your access" and "Sign in to continue" screens. This was verified in Chromium.
  - The new `useWorkspaceModal(ref, open)` in `provider.tsx` shows a modal only while the workspace is visible. It closes the modal during an access check and reopens it afterwards. The workspace context gains `concealed`.
  - The sheet and the practice dialog use it. The practice dialog was already safe in practice, because the reading clears on recheck; a new browser test asserts that no modal remains during the check.
  - **For Codex:** `work/departure-review.tsx` (not mine) is a modal inside the same wrapper. If an access check starts while it is open, the page locks until the check ends. On a failed check it stays locked. It may want the same hook.
- **Tests:**
  - Tutor tests open the sheet first. The tutor test now also asserts that the draft survives closing and reopening the sheet.
  - The capture helper takes in-sheet viewport shots.
  - Two new local-only captures: `tutor-sheet-picker-{desktop,mobile}`.
- **Checks:** typecheck and production build pass; app tests 779 passed with 1 existing skip; repository guard 16/16. All 16 browser files pass, run one at a time against a disposable WSL PostgreSQL 16. The test role and database have been dropped.
- **Adversarial review (second agent):** no privacy break found. Fixed from its findings:
  - The sheet cannot close while a review or confirmation is in flight. The editor reports this through a new optional `onBusy` prop, so the tutor always sees the outcome.
  - Focus falls back to "Change verses" when the "Assign verses" button that opened the sheet has gone.
  - The hook is a layout effect, so no modal sits inside the hidden wrapper even for a frame. The practice dialog records its opener in a layout effect before the hook opens it.
  - Still open for Codex: the departure-review modal, above.
  - The phrase "The assignment above is current" now appears inside the sheet. It is staff wording pinned by tests and is left as is.
- **Next:** service parts and notes as tabs on the student page.
