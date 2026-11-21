# CRC Torah build plan after the feature gap review

Daniel selected the following behavior in nine popup answers on November 20, 2026 and subsequently approved the complete plan, implementation and deployment. The [gap analysis](REPORT.md) describes the product at `1c9e2eff`. This plan starts from main at `1a0af252`, which includes the collapsed tutor sidebar, aligned Close controls and return from shared Practice. Release status belongs in the kickoff state note.

## Decisions

| Area | Daniel’s selection |
|---|---|
| Child using a parent’s sign-in | After the parent selects a child, that child gets their assigned Learn, Run-through and review, with progress saved to the child. |
| What counts as a practice day | Assigned Practice and completed Learn, verse review, Run-through or service activities each qualify. Credit one day per student regardless of the number of activities. |
| Offline dates | A Tuesday activity synced on Thursday credits Tuesday. |
| Tutor visibility | Coursework contributes a day only. The tutor’s existing lesson and verse progress views keep their current level of detail. |
| Tutor choosing verses | Show a recording-coverage summary next to the assignment, with optional verse details for voice changes, whole-verse-only playback and missing audio. |
| Independent adult rehearsal | A signed-in owner can rehearse a dated saved reading and privately resume work on verses marked for another try. |
| Service preparation | Start from one list of the student’s assigned parts in service order. Put the matching lesson, available recording, tutor directions and feedback on the part. |
| Staff setup | Put a resumable checklist on the student page. Staff can complete the applicable tasks in any order. |

## 1. Give the selected child a complete learning path

**Outcome.** A child without an individual mailbox can use their own Torah or haftarah assignment in Learn, Run-through and verse review. Choosing the child establishes whose assignment to read and whose progress to write.

**Ownership.** One builder owns the child-practice entry, Learn’s assignment lookup and the relevant course, service and verse-review access paths. Start with `src/server/practice/`, `src/components/learn/own-reading.ts`, `src/server/course-progress/`, `src/server/service-course/` and `src/server/verse-review/`. Trace where each activity currently stores progress before choosing a schema change. Carry the existing tab-specific selection through navigation. Partition browser progress and pending writes by owner. On expiry, return the parent to child selection and resume only after authority is confirmed.

**Acceptance.** With one synthetic parent and two children assigned different passages, start a lesson and Run-through for child A, save a difficult verse, switch to B and repeat. Return to A after reload and verify each child’s assignment and marks. Repeat with two tabs, a late save, an expired session and a revoked guardian link. The parent’s own course history, siblings’ histories, and existing directly signed-in student and public flows must each behave correctly. Commission the existing independent auth and cross-family review before release.

## 2. Credit practice on the day it happened and enforce retention

**Outcome.** A completed activity can fill the calendar even when the student never opens the assigned reader. Offline completion counts on the practice date. The tutor sees the resulting day, including when several activities contributed to it.

**Ownership.** One builder owns practice-day aggregation, offline replay and scheduled cleanup. Coordinate the activity-completion handoff with milestone 1. Reuse `src/server/practice-calendar/`, the current course completion handlers, `src/server/data/practice-calendar.ts` and the owner-scoped offline stack. Existing online visit writes expect the current server day. Give delayed completions an explicit date-only path with bounded validation. Use the existing America/Chicago calendar convention across online and offline work. Keep the minimum local information needed to reconcile the owner and date; repeated syncs must converge on one day. A pending child credit must never be reassigned to the currently selected sibling.

The existing maintenance service accepts a tenant and bounded student batch. Add scheduled discovery, fair traversal across batches and retry, so every eligible student is reached. Preserve the existing 90-day detailed-history rule and the one-year-after-ceremony boundary for dates. Exercise cleanup against disposable records before any irreversible production deletion, under the project’s existing release rules.

**Acceptance.** Complete a service lesson without opening the reader. Complete a lesson, Run-through and assigned Practice on the same day. Complete Tuesday offline, reconnect Thursday, retry twice and check all relevant calendars. Exercise midnight in Chicago, a daylight-saving transition, new sign-in after expiry, logout and sibling switching. Verify that no new activity-type detail reaches the tutor. With synthetic records on both sides of each retention boundary, interrupt and resume cleanup and confirm an old queued sync cannot recreate expired history.

## 3. Show actual recording coverage while choosing verses

**Outcome.** Before saving, a tutor can tell whether the selected passage supports word practice in the preferred voice, whether the learner will hear a different credited source, and where only full-verse audio or text is available.

**Ownership.** The reading-editor builder owns the summary and its verse detail. Reuse the same coverage and timing decisions as the reader in `src/components/portal/workspace/study/preferred-reading-playback.ts` and the verified catalogs. Resolve full-verse and word availability separately. Show the source used for each when they differ. Resolve availability without playing or copying recordings. Distinguish an unavailable catalog check from a confirmed recording gap; valid readings remain assignable.

**Acceptance.** Choose a mixed passage containing a timed preferred recording, a whole-verse preferred recording with a word-level fallback, and a text-only case. Compare the summary and detail to the player for every verse. Change the range quickly and verify the summary follows the final selection. Include a special haftarah, a long assignment and a narrow phone.

## 4. Let an independent adult resume rehearsal on a saved reading

**Outcome.** From a dated saved reading, its owner can begin Run-through, privately mark verses to retry and resume from the shelf. A ceremony record or tutor assignment is unnecessary.

**Ownership.** The saved-reading builder owns the shelf entry, rehearsal persistence and return path. Reuse the existing verse-run and fading-cue UI. Inspect `src/server/saved/service.ts`, `src/components/learn/run-through.tsx` and `src/components/learn/passage-preparation.tsx`. Key rehearsal work to the owner and saved reading. On an edit, retain applicable marks for surviving verse references and remove obsolete ones. Keep public snapshots limited to public passage data.

**Acceptance.** Save an independent reading, rehearse two verses, mark one for another try and resume after a fresh sign-in. Edit the reading and verify surviving marks. Open its shared link anonymously and under another account and confirm neither exposes the owner’s practice state. Verify the roster-based Run-through still opens the student’s assigned verses.

## 5. Bring the student’s service work together

**Outcome.** On “My assigned parts,” the student sees what they lead, how to practice each part and what their tutor asked them to do.

**Ownership.** The service-learning builder owns the student list, lesson handoff and return. Reconcile the existing Music order, tutor plan and course mappings in `src/components/portal/workspace/service-learning/` and `src/components/learn/service/`. Join by stable identifiers and the service version. Keep the full order available as context. Label a pending replacement or missing recording at the affected part.

**Acceptance.** Follow a morning part, an evening or Havdalah variant and a part without a recording from assignment to lesson and back. Check service order, directions and authorized feedback, including after a tutor changes the assignment. Confirm that a course completion updates the intended part and that retained work on a removed part cannot appear as current.

## 6. Give staff a resumable student setup checklist

**Outcome.** Staff opening the student’s page can tell whether contact and access, service date and slot, reading, tutor relationship and invitation are ready, pending or inapplicable. They can go directly to unfinished work.

**Ownership.** The staff-workspace builder owns the checklist and return links. Derive readiness from the authoritative student, reading, relationship and invitation records so changes made via Maven, Claude or another staff session appear on return. Reuse the existing editors and explicit invitation action. Respect the adult/child distinction and each staff role’s existing permissions.

**Acceptance.** Start with a child imported with an unknown slot and an adult added manually. Complete steps out of order, leave, make a change through another authorized path and return. The checklist must show the new state, distinguish a prepared invitation from an accepted one, and produce no mail from import, viewing or resuming setup.

## Integration and review

Start with milestones 1 and 2 because child identity determines where both online and offline work belongs. The recording summary can then improve the same tutor-to-learner walkthrough. The remaining three milestones can land separately. Reuse the project’s focused tests, independent reviews for high-stakes changes, CI and release checks at each boundary.

For the integrated walkthrough, have Daniel use a synthetic family to assign a mixed-coverage reading, enter through the parent’s account, select a child, complete a lesson offline, reconnect and resume in the next tutor session. Check the child’s saved work and the tutor’s day-only calendar side by side. Then use a separate adult account to rehearse a dated saved passage. The real-family pilot remains Daniel’s decision.
