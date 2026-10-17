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
- **Logic unchanged:** `reading-preview.tsx` is untouched. `reading-editor.tsx` has one addition (correction to an earlier draft of this note, which called it untouched): an optional `onBusy(busy)` prop, fed by `useEffect(() => onBusy?.(pending !== null), [pending, onBusy])`. It only reports whether a prepare or confirm is in flight, so the sheet can stay open. No request, binding, expiry, conflict, revocation or departure-guard code changed. Browser evidence, in the sheet: the tutor test in `reading-ui.test.ts` passes. It covers confirm, the draft held through a visible access recheck, edited and stale reviews invalidated, and an uncertain (503) confirmation not retried. It also checks that the draft survives closing and reopening the sheet. The browser suite has no editor-specific expiry or revocation case; those remain the existing server and app tests, which this change does not touch.
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

## Carried integration repair (2026-10-16)

Codex's reviewed tutor pagination repair `b9f12e9` is cherry-picked onto `design/song-session-staff` (as `46480fd`, no conflicts). Its `tutor-route-ui` browser file passes on this branch (4/4). The departure-review modal repair stays with Codex, as reserved in COORDINATION.md; it is not duplicated here.

## Phase 2, slice 3: service parts as a tab for tutors (2026-10-16)

- **Tabs:** on a tutor's student page, "Reading" and "Service parts" are an ARIA tablist under the hero. It uses automatic activation, a roving tabindex, and Arrow, Home and End keys. Underline tabs keep them distinct from the Torah/Haftarah pill control below. The service panel becomes a surface card, and its "Service parts" heading is screen-reader only because the tab names it. The hero's and text toolbar's "Service parts" links are dropped for tutors. Learner, parent and admin views are unchanged: every branch is gated on tutor mode.
- **Nothing remounts:** both panels stay mounted; the inactive one is `hidden`. Reload registration, access checks, unsent work and departure guards behave as on the long page. The tabs appear only once the student has loaded. Before that, or after a failed load, both panels show, so service errors stay visible.
- **Modals in a hidden tab:** a modal inside a `display:none` panel would lock the page.
  - **CSS safety net:** `.page-tab-panel[hidden]:has(dialog[open])` keeps such a panel displayed.
  - **Observer:** a MutationObserver brings the dialog's tab forward.
  - **Start:** switches to Reading in the same React update that opens practice.
  - **Reading actions:** a guarded action (paging, Torah/Haftarah) that the tutor continues past the service-draft prompt returns them to Reading.
  - **Browser support:** without `:has()` (Firefox before 121), the observer still switches the tab immediately after the dialog opens.
- **Notes tab not built:** tutor lesson notes need Codex's lesson-log contract. Per-verse notes stay in the reading.
- **For Codex:** `service-learning/editor.tsx` has its own "Keep this service draft?" modal. It is inside the workspace wrapper, so it has the same access-check lock as `work/departure-review.tsx`. It may want `useWorkspaceModal` in the same reserved repair.
- **Tests:** in `service-learning-ui.test.ts`, the tutor helper opens the Service parts tab. A new test covers:
  - the default tab, the panels and their `aria-controls`/`aria-labelledby` links, and that tutors get no "Service parts" link;
  - Arrow, Home and End keys;
  - Start returning to the reading and opening practice, with focus back on Start;
  - open material and an unsent draft surviving tab switches;
  - the draft prompt from the Reading tab bringing Service parts forward, keeping the draft on "Keep editing", and returning to Reading with Haftarah loaded on "Discard".
  - New local-only captures: `tutor-service-tab-{desktop,mobile}`.
  - Not covered by a browser case: the failed-load layout, where both panels show with no tabs.
- **Adversarial review (second agent):** no lock path in Chromium. Fixed from its findings:
  - the draft prompt's tab is brought forward, and the tutor returns to Reading after continuing;
  - service messages stay visible on a failed load;
  - Start's fallback scroll waits a frame;
  - the tab reset is a layout effect, so the previous student's tab never shows;
  - the test title now says only what the test checks.
- **Checks:**
  - Typecheck passes on the final tree.
  - Browser files pass one at a time on a disposable WSL PostgreSQL 16, after the review fixes: service-learning-ui 13/13, tutor-route-ui 4/4, reading-ui 3/3, reading-preview-ui 7/7, study-ui 6/6, workspace-ui 3/3, student-work-ui 10/10, portal-ui 7/7.
  - Before the review fixes, all 17 browser files passed; so did `next build`, app tests (779 passed, 1 existing skip) and the repository guard (16/16).
  - The app-test and build rerun after the fixes was stopped by Claude Code for low system memory. It was not repeated; rerun it at integration.
  - The test role and database have been dropped.
- **Next:** tutor lesson notes, and progress wiring, once Codex offers frozen lesson-log and progress refs. Then Phase 3, admin.

## Moved onto Codex's editor/modal integration (2026-10-16)

- New branch `design/song-session-progress`, from `origin/codex/editor-modal-integration` at `243d133`. That ref already contains my frozen tutor and editor work (as `37a4994` and `4b08fa8`), the pagination repair `b9f12e9`, Codex's departure-prompt and repeated-Escape fixes, and the accepted progress backend `2689d94`.
- Slice 3 (tutor tabs, `3655031`) is carried as `dd28b2b`. It merged cleanly, but the merged file did not typecheck: my tabs code imported React's `KeyboardEvent` type, which shadowed the DOM type used by Codex's Escape guard. The import is renamed to `ReactKeyboardEvent` inside `dd28b2b`, so that commit typechecks on its own.
- `design/song-session-staff` stays as it was, for reference.

## Phase 2, slice 4: verse progress marks (2026-10-16)

The UI side of Codex's accepted progress contract (`2689d94`, spec `2026-10-16-verse-progress-design.md`). No server, schema or migration file is touched.

- **Students** (own mode and explicit child practice) mark each verse in the practice view: **Still working** or **Got it**. Tapping the chosen one again clears it back to unmarked.
- **Tutors and admins** assess each verse in the practice view: **Not started**, **Working** or **Solid**. Under the buttons they see the student's own mark ("Student: got it").
- **Parents** only read: the practice view and the verse cards show both marks, each named. Parents get no buttons.
- **Verse cards** carry a small chip:
  - for students, their own mark;
  - for staff and parents, "Student: …" and "Tutor: …" as two separate chips.
- **Header counts:** the line under the reading reference adds "N got it", and for staff also "N solid". These are the server's counts by stream, with nothing added when zero.
- **The two streams stay separate**, as MISSION and the spec require. A student's "Got it" never changes the tutor's assessment, and the tutor's "Solid" never changes the student's mark. The browser test proves this against the stored rows.
- **Writes:**
  - One write at a time per verse, with the stored version as `expectedVersion`.
  - A conflict or an unknown outcome is never resent. The store re-reads the page and shows the latest mark with a message on that verse.
  - After every save the store re-reads the page, so the counts are always the server's.
  - Page loads keep the higher version for each stream, so a read that raced a save never brings back an older mark.
  - A stale-assignment answer reloads the reading once per assignment.
  - 401, 403 and 404 clear the marks and go down the existing access-failure path. In child practice, `readProgress` in `provider.tsx` mirrors `readWork`: the same context checks and the same redirect to the parent page.
- **Files:**
  - New: `workspace/progress/{api.ts, store.ts, marks.tsx}`.
  - Edited: `provider.tsx` (`readProgress`), `reading.tsx` (the store and the header count), `study/view.tsx` (`onShown`, `renderMark`, `renderLiftControls`), `study/annotations.tsx` (an optional `mark` slot in the card head), `study/lift.tsx` (an optional `controls` slot above Back/Next), `globals.css`.
- **Adversarial review (second agent):** no Critical or High findings. Confirmed sound: the stream follows from the mode; there is no automatic replay; child-practice handling matches `readWork`; parsing matches the server's response shapes; and a change of student, context or revision clears the store. Fixed from its findings:
  - counts could double-count when a refresh raced a save (the store now never adjusts counts itself);
  - an older read could put back a newer saved mark;
  - an unknown outcome said "wasn't saved" (it now re-reads and says "may not have saved");
  - access loss from a progress request now clears the store;
  - messages are per verse, not shared;
  - the staff chip is named "Tutor: …";
  - the descriptive line is no longer a live region, so only real messages are announced;
  - parents' cards show both marks;
  - the stale-assignment reload is limited to once.
- **Test:** the new `tests/http-browser/progress-ui.test.ts` covers:
  - a student marking in the practice view;
  - the stored self-check and assessment rows;
  - the chips and the header count;
  - the tutor assessing while the student's mark is shown, with no student buttons;
  - the student seeing "Your tutor: solid", then clearing their own mark while the assessment stays;
  - a conflict made elsewhere being shown, not overwritten.
  - Local-only captures: `progress-{student-lift-mobile, student-list-mobile, tutor-lift-desktop}`.
- **Waiting on Daniel (student-visible wording):** this needs his sign-off before it reaches students.
  - Buttons and labels: "Still working", "Got it" and "Your tutor: solid / working".
  - Header: "N got it".
  - Messages: "This verse was marked somewhere else. The latest mark is shown.", "That mark may not have saved. The latest mark is shown." and "Too many changes at once. Wait a moment, then try again."
  - The tutor-side labels follow MISSION's own words (not started / working / solid).
- **For Codex:** `study-ui.test.ts` fails one case locally with a 429 at sign-in ("discards held old-child text after a switch…"). It fails identically with my changes stashed, at `dd28b2b` on top of `243d133`, so it comes from the base. It is the five-per-window magic-link throttle, the same issue as `0d4b00b` fixed for the reading tests. I have not changed that file.
- **Checks on the final tree:**
  - Typecheck passes.
  - `next build` compiles.
  - App tests pass: 790, plus the 1 existing skip.
  - `never-in-repo` passes, with the new files staged.
  - Browser files pass one at a time on a disposable WSL PostgreSQL 16:
    - progress-ui 2/2 and student-work-ui 10/10;
    - tutor-route-ui 4/4 and service-learning-ui 13/13;
    - reading-ui 4/4 and reading-preview-ui 7/7;
    - workspace-ui 3/3, portal-ui 7/7 and modal-privacy-ui 2/2;
    - browser 2/2 and canonical-navigation 4/4.
  - study-ui is 5/6; the base-branch throttle case is described above.
  - The test role and database have been dropped.
- **Not covered by a browser case:**
  - parent and admin views of the marks;
  - child-practice marking;
  - the stale-assignment reload;
  - the unknown-outcome message.
- **Next:** tutor lesson notes, once Codex publishes the frozen lesson-log ref (`f2aabe24` is reviewed source, not yet published as final). Then Phase 3, admin.


## Phase 2, slice 5: lesson notes (2026-10-16)

Built on Codex's published lesson-log backend: `origin/codex/lesson-log-foundation` at `9b914625`, merged (not rebased) into the new branch `design/song-session-lessons`. The merge keeps the frozen `dd28b2b` (tabs) and `6398b3f` (progress) unchanged. No server, schema or migration file is touched.

- **Tutors** get a third tab, **Lessons**, after Reading and Service parts. It shows the student's lesson notes newest first. **Add a lesson** opens a side sheet with the date (today by default) and "What you worked on". The sheet says "The student and their family can read this."
- **Edit** appears on a note only when the server says `canEdit`. **Delete lesson** is inside the edit sheet and asks first: "Delete this lesson note? It can't be brought back."
- **Admins** get the same panel below service parts on the admin student page (not tabbed).
- **Parents, students and child practice** see a read-only **Lesson notes** list below service parts. Its parser rejects any read-only answer that offers `canEdit` or `canDelete`.
- **Writes are never resent.**
  - On a conflict or an unclear outcome, the sheet re-reads the list and shows what is really saved.
  - If the note saved, the sheet closes as saved.
  - If someone else changed it, the latest version appears in the sheet with the tutor's text kept. Saving again is the tutor's explicit choice to replace it.
  - If it was deleted elsewhere, the text is kept and saving adds it as a new lesson.
  - A new lesson keeps its `entryId` across retries, so the backend's exact-replay rule means a retry can never add it twice.
- **Unsaved notes:**
  - Closing a sheet with unsaved text, or leaving the student or role, asks "Keep this lesson note?" (Keep writing / Discard note).
  - The panel registers with `registerWork` and `registerDeparture` and the beforeunload guard, like the service editor.
  - A routine reload (focus, access check) clears only the list, never the open note.
  - A session, student or role change discards both.
- **Access:** `readLessons` in `provider.tsx` goes through the existing `serviceRead` path. That gives session checks before and after each request, the child-practice redirect, and clear-and-refresh on 401/403/404.
- **Files:**
  - New: `workspace/lessons/{api.ts, panel.tsx}`, `tests/http-browser/lessons-ui.test.ts`.
  - Edited: `provider.tsx`, `reading.tsx`, `globals.css`.
- **Test** (2 cases), covering:
  - add, with today's date and the family note;
  - keep and then discard an unsaved note;
  - edit;
  - a change made in another tab shown rather than overwritten, then replaced on purpose;
  - deleting after confirmation;
  - the stored rows and versions checked through the API;
  - the parent and student read-only views with no buttons;
  - a lost request and a lost answer, each settling to exactly one saved lesson.
  - Local-only captures: `lessons-{tutor-sheet-desktop, tutor-conflict-desktop, tutor-list-desktop, student-mobile}`.
- **Accessibility fix found by the test:** a label wrapping the textarea made the field's accessible name include the typed text. Each field now has its own `label for`.
- **Adversarial review (second agent), all findings fixed:**
  - A second Escape could close the sheet natively and leave hidden state. The dialogs now re-sync on `close`, and Escape is blocked while a save is in flight.
  - A lesson not found on the first page while older pages exist now keeps its `entryId`, so a retry can't duplicate it.
  - Focus goes to the note once the sheet can be typed in, to "Keep it" when the delete confirm opens, and back to "Delete lesson" when it closes. Both live regions stay mounted.
  - `pending` no longer sticks after a 401/403/404, and a failed refresh shows the list's error state.
  - Hidden control characters are normalized (VT/FF to newline) or named in a message.
  - "Your earlier save went through" replaces "changed somewhere else" when the tutor's own uncertain save is what landed.
  - Edit buttons name the lesson's date and the first 40 characters of the note.
- **Regressions caught by the sweep, fixed:** the sheet now uses its own `lesson-sheet` class, sharing the verse editor's sheet CSS, so `dialog.editor-sheet` stays unique for reading-ui. In my own tab test (service-learning-ui), ArrowLeft from Reading now wraps to Lessons.
- **Not covered by a browser case:** the admin view, child-practice reads, paging ("Show earlier lessons"), the 401/403/404 clearing path, and a wrong-student answer. The parser rejects those answers, but no test drives them.
- **Waiting on Daniel (student- and family-visible wording):** "Lesson notes", "No lessons yet" and its empty-state lines, the lesson date and byline format, and "Lessons" as the tutor tab. The tutor-side lines also need his look: "The student and their family can read this.", the save, conflict and delete messages, and "Keep this lesson note?".
- **Checks on the final tree:**
  - Typecheck passes; `next build` compiles.
  - App tests: 800 passed, plus the 1 existing skip. They were run with two workers because the machine was short on memory.
  - `never-in-repo` passes with the new files staged.
  - Every browser file passes, run one at a time on a disposable WSL PostgreSQL 16:
    - lessons-ui 2/2, progress-ui 2/2, study-ui 6/6, student-work-ui 10/10;
    - tutor-route-ui 4/4, service-learning-ui 13/13, reading-ui 4/4, reading-preview-ui 7/7;
    - workspace-ui 3/3, portal-ui 7/7, modal-privacy-ui 2/2;
    - browser 2/2, canonical-navigation 4/4.
  - The test role and database have been dropped.
- **For Codex:** the service-draft dialog adaptation and the final integration are yours, as agreed. Nothing is pushed and no migration is applied.
- **Next:** Phase 3, admin.


## Phase 3, slice 1: admin nav, student list and student page (2026-10-16)

Branch `design/song-session-admin`, on top of the lessons commit `26057b1`. Screens only: no server, API, schema or migration file is touched.

- **One admin nav.** Students · Invitations · Tutors sits under the app bar on every admin page (`admin-nav.tsx`). A student's own pages count as Students (`aria-current="location"`). The ad hoc link rows ("Manage invitations · Manage tutors · Import students", "Back to student roster") are gone.
- **Students list** (`roster.tsx`), replacing the table and the form under it:
  - Each row shows the name, ceremony date, a marigold days-to-go chip, Child/Adult and the service slot. Disabled students are muted, carry a "Disabled" chip and have no page link.
  - Tapping a name opens the student's page. "Edit" and "People" sit at the end of each row.
  - "Find a student" filters by name, ignoring accents and case. A miss says so. The count line reads "2 students · 1 disabled".
  - Import and Add student are the two header actions.
- **Add and edit in a sheet**, the same right-hand sheet as the verse editor and lesson notes:
  - Student kind is a two-pill choice (Child / Adult) instead of a select. The email fields follow the kind's order.
  - The disable step lives at the bottom of the sheet.
  - Load, save, disable, conflict and access-check behaviour is unchanged: no retry, and Save stays disabled after a 409, a 401/403/404 or an unclear outcome until a reload.
  - The sheet leaves the top layer during an access check and returns with the draft (`useWorkspaceModal`).
- **Admin student page** (`admin-reading.tsx`, `reading.tsx`): admins get the tutor's page, with the hero, the Reading · Service parts · Lessons tabs and the verse editor in a sheet. `staff = tutor || admin` replaces the tutor-only gates. An "All students" breadcrumb and a "People and access" link sit above the hero.
- **People, Invitations, Tutors and Import** get the nav and new headings ("People and access", "Invitations", "Tutors"). Their bodies are unchanged; their redesign is the next slice.
- **Staff empty state:** "Choose the verses this student will read." replaces the learner line for tutors and admins. Staff also get a "Trope chart" link in the hero, which the review found admins had lost.

### Decided here (GATE log)

- GATE: staff-only wording on admin screens (headings, "Edit", "People", "People and access", "All students", the result messages "Added … No invitation has been sent.", "Saved …", "… is disabled. Their record stays in the list.", the conflict and unclear-outcome lines, and the staff empty-state line). Proceeded because it is staff-visible, not student-visible, and follows the UX analysis ruling: outcomes phrased as results, caveats in the detail view. It is listed below for Daniel's look anyway.
- GATE: Cancel or Escape in the student sheet discards the draft without a "keep this?" prompt, as the old "Cancel edit" did. Proceeded because it keeps the existing behaviour; a prompt like lesson notes' can follow if Daniel wants one.
- Roster chips for tutor, parent invited and reading confirmed (from the UX analysis) are **not** built. The roster API does not return them, and a per-student read would be N requests. **For Codex:** a roster summary field (tutor count, parent invited, readings confirmed or needing review) would let the list show them.

### Adversarial review (second agent)

No privacy or authority break was found. The sheet closes during access checks, and Save stays blocked after conflicts and unclear outcomes. Fixed from its findings:

- **Medium:** closing the sheet after an unclear or conflicting save had cleared the warning, inviting a duplicate add. The warning now stays on the list with a "Reload roster" button, and Add and Edit stay disabled until a reload. A new browser case covers this: a 503 on add, close, the warning still shown, Add disabled, then a reload shows the student once.
- Focus returns to the opener (or Add) after the reload that follows a save, instead of being lost.
- After an access check, focus returns to the field the admin was in, not the heading.
- A close that races a starting save reopens the sheet instead of leaving it stuck.
- An empty roster has a reload button.
- Not changed: the old non-Song staff branch in `reading.tsx` (the "Practice tools" aside and the inline editor) is now unreachable, since every mode is learner or staff. It is left in place for Codex's integration and can be removed in a later cleanup.

### Tests

- **New** `admin-ui.test.ts` (2 cases): the nav across areas; search and its miss; Add in the sheet, with Escape returning focus to Add; edit focus and kind pills; the unclear-save case above; and the student page tabs, verse sheet, Lessons tab and People link on desktop and phone.
- **Adapted, with no lost coverage:**
  - workspace-ui: the roster cases use the sheet. The 409 alert is now asserted inside the dialog, and Reload closes it. After the delayed 503, either honest message is accepted (the old test asserted none). The table `nowrap` check went with the table.
  - roster-controls-ui: kind pills and the new result lines.
  - Admin cases in reading-ui, reading-preview-ui and study-ui open the verse sheet as the tutor cases do, closing it to work in the verse notes. "Reading" is selected as a combobox because the Reading tab panel shares the label.
  - study-ui turns English on for admins, as for tutors.
  - service-learning-ui opens the Service parts tab for admins.
  - invitation-management-ui and student-work-ui use the new nav and breadcrumb names.

### Checks

- Typecheck passes; `next build` compiles.
- App tests: 800 passed, plus the 1 existing skip, run with two workers.
- `never-in-repo` passes with the files staged.
- Every browser file passes, one at a time, on a disposable WSL PostgreSQL 16. Claude Code stopped one background sweep for low memory; the rest were run in the foreground.
  - admin-ui 2/2, workspace-ui 3/3, roster-controls-ui 7/7, invitation-management-ui 3/3;
  - reading-ui 4/4, reading-preview-ui 7/7, study-ui 6/6, service-learning-ui 13/13, student-work-ui 10/10;
  - tutor-route-ui 4/4, lessons-ui 2/2, progress-ui 2/2, modal-privacy-ui 2/2, portal-ui 7/7;
  - browser 2/2, canonical-navigation 4/4, egress 1/1, production-denial 2/2, server-isolation 1/1, server-review 2/2, service-learning-http 1/1.
- Local captures (not committed): `.impeccable/review/admin-{roster-desktop,roster-sheet-desktop,student-desktop,student-mobile,people-mobile}.png` and `workspace-admin-roster-mobile.png`.

### Waiting on Daniel

- A look at the admin screens, and the staff wording above.
- Whether the student sheet should ask before discarding a typed draft.

**Next:** Phase 3, slice 2. People and access gets grouped cards, plain status, the confirm step in a sheet, no raw role identifier, and "Invite a parent" from the student. Then Invitations and Tutors, then Import.


## Phase 3, slice 2: People and access, and Tutors (2026-10-16)

Screens only; access logic unchanged.

- **People and access** (`relationships/workspace.tsx`): one card each for Tutors, Parents and Student sign-in.
  - Each person is a row with an initial avatar, their name, a plain status ("Can teach this student", "Can read · Can practise as the child", "Access paused") and short actions: Unassign, Stop/Allow child practice, Unlink, and Revoke … role in red.
  - Each action's accessible name includes the person ("Unassign Synthetic Tutor").
  - Assigning a tutor is a select with an "Assign" button inside the Tutors card.
  - "Invite a parent" and "Invite the student" link from the student's cards to Invitations. They are hidden for disabled students.
  - The student's name and ceremony date sit under the heading. A disabled student gets a note that existing links can still be removed.
- **Tutors page:** the same rows, with a Cantor chip and the actions Mark as cantor / Remove cantor flag / Revoke tutor role. It has an empty state, and paging appears only when there is more than one page.
- **Confirm step in a sheet** (`relationships/review.tsx`). It shows the person, the student and the consequence (unchanged text from `api.ts`), then "Access is checked again before anything is saved." The full role identifier and ceremony date are folded under "Technical details"; names are already disambiguated by `identityLabels`.
  - Load, the fingerprint re-check before POST, the latch, the blocked state after unknown outcomes and 401/403/404 clearing are unchanged.
  - While access reloads, the page still hides everything rather than showing old people.
- **Invitation prefill** (`invitations/workspace.tsx`): `?student=…&role=parent|student` fills the role, the student and that record's contact email once. It only applies to an active student in the loaded roster, and never over anything the admin has already typed. Only the id and role go in the URL; nothing is sent until the admin reviews.
- **Wording (staff):** "Saved. Access is up to date." and "Access reloaded." are the calm lines. "Something changed for this person since you opened the review…", "We couldn’t confirm whether this change saved…" and "This change isn’t allowed any more…" stay error-styled and blocking, as before.

### Decided here (GATE log)

- GATE: staff-only wording and action names on People and access and Tutors. Proceeded because it is staff-visible and follows the UX analysis ruling (plain outcomes, caveats in detail views). It is listed for Daniel's look.
- GATE: the role identifier is no longer shown in the review by default, only under "Technical details". Proceeded because labels already disambiguate same-named people and the UX analysis flagged the raw identifier.

### Adversarial review (second agent)

No authority or privacy hole was found. Unchanged: access logic, the double-submit latch, unknown outcomes kept blocked and error-styled, the sheet closing on failed loads, conflicts and access checks, and Escape blocked while saving. Fixed from its findings:

- Focus now reaches the review heading. It is set after the sheet is shown, because `showModal` focuses the close button first.
- Focus returns to the opener once the change and its reload settle, or to the page heading if the opener is gone or disabled. A test asserts the heading after Assign.
- The prefill never overwrites a draft the admin has started.
- The 409 / not-posted line no longer claims "nothing was saved".
- The failure panel no longer has two "Reload access" buttons.
- The Technical details fold is now tested: hidden by default, and the identifier is shown when opened.

### Tests

- roster-controls-ui (7/7) finds row actions by verb within a named card. The old properties are all kept: one POST under a double click, no POST after a changed identity, controls disabled after an unknown outcome, and the "ALL linked children / ALL assigned students" consequences.
- admin-ui (2/2) adds captures of the People page and an "Invite a parent" prefill check. invitation-management-ui passes 3/3.

### Checks

- Typecheck and `next build` pass.
- App tests: 800 passed, plus the 1 existing skip (two workers).
- `never-in-repo` passes with the files staged.
- The touched browser files pass one at a time: roster-controls-ui 7/7, admin-ui 2/2, invitation-management-ui 3/3. Every other browser file passed on slice 1's tree; this slice changes only the People, Tutors and Invitations screens and their CSS.
- Captures (local): `.impeccable/review/admin-people-{desktop,mobile}.png` and `roster-long-review-mobile.png`.

**Next:** Invitations (the compose form and the list as cards, the review in a sheet) and Import.


## Admin handoff: frozen ref on the release frontend (2026-10-16)

**Acknowledged (Codex, COORDINATION.md):**
- Codex owns release coordination through deployment.
- Sol owns integrating my progress (`6398b3f`) and lessons (`26057b1`), including the progress recovery fixes. I do not touch progress/store/marks or the lesson lifecycle.
- The admin work stays separate from this release and is offered as its own frozen ref.
- The service-dialog `onDepartureActive` / one-active-modal behaviour is preserved.

**Frozen admin ref:** branch `design/song-session-admin-release` at the commit that adds this note. It contains two commits, cherry-picked onto the release frontend `5a14d73` (local branch `codex/lesson-progress-integration`), not onto my older base:

- `8aee6b1` (was `376d554`): the admin nav, the student list with its sheet, and the admin student page with the staff tabs and verse sheet.
- `226a2b4` (was `65e661c`): People and access, Tutors, the access confirm sheet, and the invitation prefill.

**Reconcile note:** one conflict, in `reading.tsx`, where the sheet state is declared. It keeps the release's `serviceDepartureActive` state, `useWorkspaceModal(sheet, sheetOpen && !work.departure && !serviceDepartureActive)` and `onDepartureActive={setServiceDepartureActive}` unchanged. Only the comment and the `staff` gate are mine. The service panel's departure wiring does not depend on mode, so admins get the same one-active-modal behaviour as tutors. No progress, lesson, service-learning, server, schema or migration file differs from `5a14d73`.

**Checks on this exact tree:**
- Typecheck and `next build` pass.
- App tests: 826 passed, plus the 1 existing skip (two workers).
- Node: 185 passed. `never-in-repo` passes.
- All 21 browser files pass, one at a time, on a disposable WSL PostgreSQL 16:
  - admin-ui 2/2, workspace-ui 3/3, roster-controls-ui 7/7, invitation-management-ui 3/3;
  - reading-ui 4/4, service-learning-ui 14/14, reading-preview-ui 7/7, study-ui 6/6, student-work-ui 10/10;
  - lessons-ui 2/2, progress-ui 3/3, tutor-route-ui 4/4, modal-privacy-ui 2/2, portal-ui 7/7;
  - browser 2/2, canonical-navigation 4/4, egress 1/1, production-denial 2/2, server-isolation 1/1, server-review 2/2, service-learning-http 1/1.

**Review status:** a second agent adversarially reviewed each admin slice, finding no authority or privacy break; its fixes are in. Daniel's look at the admin screens and the staff wording is still open. The older branch `design/song-session-admin` (on `26057b1`) is superseded by this one.


## Phase 3, slice 3: Invitations and Import (2026-10-17)

Branch `design/song-session-admin-invites`, on the frozen admin ref `df10e59`. Screens only; the invitation and import logic is unchanged apart from wording.

- **Invitations** (`invitations/*.tsx`):
  - The "Invite someone" card stays on the page. The role is a Parent / Student / Tutor pill choice, with the email and student side by side and one short help line per role.
  - "Review invitation" opens the check in a sheet: "Check before sending", "Send this invitation again?" or "Revoke this invitation?". It shows the recipient, role and student, and one plain consequence.
  - Sent invitations are rows. Each has a status chip (Pending / Accepted / Expired / Revoked), the mail state ("Email sent", "Email failed" in red, "Email unconfirmed"), and short "Sent" and "Expires/Accepted/Revoked" dates with the exact time in the tooltip. Pending and expired rows offer "Send again" and "Revoke"; their accessible names include the recipient.
  - Outcomes read as results:
    - "Invitation created…", "A new invitation replaced the old one…" and "Invitation revoked. The link no longer works."
    - Mail: "The email went to the mail service. We can’t see whether it reached their inbox." Or it failed, or couldn't be confirmed.
    - Unknown outcomes stay blocked, with a full "Reload invitations" button.
  - The prefill from People and the same-session draft rules are unchanged.
- **Import** (`csv-import/workspace.tsx`): the two steps are numbered cards, "1 Add your list" and "2 Review student import", with a monospace draft and a calmer lede. The logic and wording are otherwise unchanged.

### Decided here (GATE log)

- GATE: staff-only wording on Invitations and Import, including the outcome lines and the per-role help. Proceeded because it is staff-visible and follows the UX analysis (results, not server states). Each line was checked against the server: revoke and reissue set `revokedAt` in the same transaction, and "nothing was sent" appears only before the POST. Listed for Daniel's look.

### Adversarial review (second agent)

No authority, privacy or double-send defect was found. Unchanged: fresh load plus `matches` before POST, the gate, blocked after unknown outcomes, no retry, prefill rules and no token exposure. The status/date mapping was checked against the server for all states. Fixed from its findings:

- A refused "Review invitation" no longer leaves a stale focus target that a later reload would jump to.
- The tutor help says "Once they accept, they become a tutor".
- A revoke in progress says "Checking and revoking…".
- Dates show the year when it isn't this year, and the exact times are kept as tooltips. The email-attempt time is kept for screen readers, and the pager shows "Page N".
- Not built: tests for Escape while sending and the second-Escape reopen. These paths are shared with the People and student sheets and are reviewed in code.

### Checks

- Typecheck and `next build` pass.
- App tests: 826 passed, plus the 1 existing skip (two workers). `never-in-repo` passes.
- invitation-management-ui 3/3, admin-ui 2/2, roster-controls-ui 7/7 (import cases included). The other browser files passed on `df10e59`; this slice changes only the invitation and import screens and their CSS.
- Captures (local): `.impeccable/review/invitation-{review-desktop,list-desktop,review-mobile,failed-mobile,unknown-mobile}.png` and `csv-review-{desktop,mobile}.png`.

**Frozen ref for Codex:** this commit on `design/song-session-admin-invites` (parent `df10e59`). It is separate from the release; nothing is pushed.


## Admin handoff on deployed main (2026-10-17)

**Acknowledged:** main `1d5e932` is deployed (Codex, COORDINATION.md "DEPLOYED 2026-10-17 — use main now"). The admin work stays a separate bounded review and preserves the deployed modal and progress fixes.

**Frozen ref:** branch `design/song-session-admin-main` at the commit that adds this note, based on `origin/main` `1d5e932`. It holds the four admin commits, cherry-picked without conflicts:

| On main | Was | Content |
|---|---|---|
| `a5759e1` | `8aee6b1` | nav, students list and sheet, admin student page |
| `1e2cec5` | `226a2b4` | People and access, Tutors, confirm sheet, invitation prefill |
| `06a2588` | `df10e59` | earlier handoff note |
| `ab573e8` | `bd1dd65` | Invitations and Import |

`src/` is byte-identical to the reviewed `bd1dd65` tree; main changed no source after `5a14d73`.

**One test adapted:** main's new `lesson-progress-privacy-ui.test.ts`, in its admin case, now clicks the staff "Lessons" tab before paging and editing. Admins read lessons in that tab, as tutors do. No assertion was removed or loosened.

**Checks on this exact tree:**
- Typecheck and `next build` pass.
- Node: 206 passed. App tests: 828 passed, plus the 1 existing skip (two workers). `never-in-repo` passes.
- All 22 browser files pass, one at a time, on a disposable WSL PostgreSQL 16:
  - admin-ui 2, workspace-ui 3, roster-controls-ui 7, invitation-management-ui 3;
  - reading-ui 4, service-learning-ui 14, reading-preview-ui 7, study-ui 6, student-work-ui 10;
  - lessons-ui 2, progress-ui 3, lesson-progress-privacy-ui 4, tutor-route-ui 4, modal-privacy-ui 2, portal-ui 7;
  - browser 2, canonical-navigation 4, egress 1, production-denial 2, server-isolation 1, server-review 2, service-learning-http 1.

**Still open:**
- Daniel's look at the admin screens and the staff wording listed in slices 1–3.
- Roster chips (tutor, parent invited, reading confirmed) need a roster summary field from the backend.
- Nothing is pushed.
