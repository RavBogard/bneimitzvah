# Usability release

Daniel approved this work on November 20 after the public beta and current main were reviewed at fe15eb65. A shared passage keeps the exact verses and optional preparation date that were sent. Share again after an edit to send the new passage. The owner’s saved reading, title and private work stay in their account.

The [usability review](../2026-11-20-usability-review/REVIEW.md) records the original observations and their scope.

## Acceptance walkthrough

| Context | Verify |
| --- | --- |
| Recording library | At 320 × 568, 390 × 844, and in landscape, start a recording, adjust its speed, collapse the controls, choose another track and close the player. The active control stays visible and the player stops on Close. |
| Reader | On Torah and haftarah, hear a verse, repeat it, switch to Study and return to the passage. Check enlarged Hebrew, keyboard focus, light/dark themes and forced colors. Daniel’s walkthrough informs any subsequent dock redesign. |
| Share passage | Use the owner’s saved reading to copy a public address. In a fresh signed-out browser check disjoint ranges and a weekday preparation date, including Print, Save and the return link. Check again after the owner edits or removes the reading. |
| Learning | Sign in from each course with email and Google through the existing tested flows. Return to the course and its progress. Follow the service links to morning, evening and Havdalah. |
| Staff | Cancel an invitation replacement and confirm that nothing was sent. Deliberately replace it and handle clipboard failure. Leave and return to changed settings, find a guide in a catalog of 168 and hold or release the intended version. |
| Family and recovery | Retry a failed parent summary read, including switching children while it is pending. Inspect a family honors save with an uncertain outcome. Open an empty offline shelf both online and offline, and use the missing-link Unsubscribe page with heading navigation. |

The release uses public reference playback. Synthetic records cover private workflows. The real-family pilot remains Daniel’s decision.

## Verification

- The recording and invitation changes received independent source reviews on `b4a8d2b4`. Recording playback still uses the verified public catalog. Invitation replacement still requires a fresh authorized admin session and a same-origin request, returns a fragment link once and sends no email.
- On Windows, the recording test passed on all three browser profiles. A separate keyboard and hit-test check on a 320 × 568 viewport at 200% text measured a 118 px bar. Play, expanded controls, collapse and close all kept focus visible. The complete invitation suite passed against disposable PostgreSQL, including cancel, confirmation and manual copy.

- The updated settings, parent-summary retry and honors browser suites passed 18 cases against PostgreSQL on Windows. Settings entry and exit use normal document navigation so browser Back, Forward and reload use the native unsaved-changes prompt. Workspace links present Keep editing and Discard. A server version conflict leaves the draft available for review.
- The 168-entry synthetic Guides catalog passed its phone, tablet and desktop runs. The tests cover name and status filters, page counts, previewing a version, opening the reader and Back to the previous result.
- An independent review of the snapshot change confirmed that the share link contains only public verses, the passage kind and the chosen date. A Windows browser check exercised the owner action, a fresh signed-out reader, Print and the Save offer. Text-only Lein places focus on the first Hebrew word. Study places it on the first verse selector.
- The first production release passed all 15 CI jobs. A signed-out production check selected two recordings, opened and collapsed the controls and closed the second track at 320 px and 200% text. [CI run](https://github.com/RavBogard/bneimitzvah/actions/runs/44852147763)
- Course sign-in returns to its originating course for an email code entered on the requesting device or for Google. The emailed link retains its existing My Readings or pending-invitation landing. Independent review checked that only the two exact course homes were added to the allowlist. Focused server and browser tests exercised both paths with synthetic accounts.
- Independent review traced the parent retry and guide version boundaries. A held settings save followed by leaving and restoring the page exposed a stale-response race. A generation check now ignores the late receipt, and all six settings tests passed against disposable PostgreSQL after the fix.
- Online/offline recovery and the Unsubscribe heading passed 18 cross-device checks. Shared brand and footer targets measure at least 44 × 44 CSS pixels. Equivalent Learn style tokens preserve the previous sizes. The teaching face, phrase corners and dark overlay are documented in the design guide.
