# B3. D'var Torah strings

2026-10-24. State: drafted for Daniel's sign-off (Batch 4). Design: `B3-DESIGN.md`.

House voice (H20 §2): sentence case, plain verbs, the same words for a 12-year-old and a 60-year-old. No exclamation points, emoji, streaks, badges, scores or pep talk. The product is `{productName}`, never "CRC Torah" written out. Placeholders go in braces. Dates use the existing `ceremonyCountdown` label (`reading.tsx` L43–48). Staff see first names only. Learners never see a staff member's name. Where existing wording is reused, the roster's is in `roster.tsx`.

"chars" counts the characters with placeholders left unfilled. Every string was checked by script for `!` and for any character outside Latin, punctuation and the ellipsis. Straight apostrophes are used here for ease of reading. The code uses typographic ones (’), as in the existing "couldn’t" strings in `students.tsx` L83 and `roster.tsx`.


## Student and child practice (section on the stacked page)

| id | string | chars | note |
|---|---|---|---|
| D-S-TITLE | D'var Torah | 11 | Section heading |
| D-S-INTRO | You write your d'var Torah in a Google Doc that you share with your tutor and rabbi. {productName} keeps your stages and dates. It never opens or stores your document. | 167 | Section intro; {productName} from tenant settings |
| D-S-DOC-H | Your document | 13 | Subheading |
| D-S-DOC-OPEN | Open your document | 18 | Link; opens a new tab, no referrer; an icon marks it as external |
| D-S-DOC-OPEN-SR | Open your document in Google Docs (opens a new tab) | 51 | Accessible name for the link |
| D-S-DOC-CHANGE | Change link | 11 | Text button; shows the field again |
| D-S-DOC-REMOVE | Remove link | 11 | Text button inside the change state |
| D-S-DOC-REMOVE-CONFIRM | Remove the link? Your document stays in Google Docs. Only the link here is removed. | 83 | Confirm line |
| D-S-DOC-REMOVE-YES | Remove link | 11 | Confirm button |
| D-S-DOC-REMOVE-NO | Keep link | 9 | Cancel button |
| D-S-DOC-EMPTY | No document yet. Start a Google Doc, share it by email with your tutor and rabbi, then paste its link here. | 107 | Empty state |
| D-S-DOC-LABEL | Link to your Google Doc | 23 | Field label |
| D-S-DOC-PLACEHOLDER | https://docs.google.com/document/… | 34 | Placeholder; shows the shape, not an example id |
| D-S-DOC-SAVE | Save link | 9 | Primary button |
| D-S-DOC-SAVING | Saving… | 7 | Button while saving |
| D-S-DOC-SAVED | Link saved. Check that your tutor and rabbi can open it. | 56 | Status after save; the app can't check sharing |
| D-S-DOC-SHARE-HELP | Share with people by email, not with "Anyone with the link". | 60 | Help line under the field |
| D-S-STAGES-H | Stages | 6 | Subheading |
| D-S-NEEDS-DOC | Add your document first | 23 | Shown on stages 3 to 5 until a link exists |
| D-S-MARK | Mark done | 9 | Button on stages the student owns |
| D-S-READY | Ready for feedback | 18 | Button on First draft |
| D-S-UNMARK | Not done yet | 12 | Text button; undoes the student's own mark |
| D-S-DUE | Due {date} | 10 | {date} = ceremonyCountdown label, e.g. Sat, Jan 31 |
| D-S-DUE-IN | in {n} days | 11 | After the due date; n > 1 |
| D-S-DUE-TOMORROW | tomorrow | 8 | n = 1 |
| D-S-DUE-TODAY | today | 5 | n = 0 |
| D-S-WAS-DUE | Was due {date} | 14 | Past due; no other marking |
| D-S-DONE | Done {date} | 11 | Marked stage |
| D-S-READY-ON | Ready {date} | 12 | First draft marked ready |
| D-S-BY-YOU | Marked by you | 13 | Mark attribution |
| D-S-BY-PARENT | Marked by your parent | 21 | Mark made in child practice |
| D-S-BY-TUTOR | Marked by your tutor | 20 | Mark attribution |
| D-S-BY-RABBI | Marked by your rabbi | 20 | Mark attribution |
| D-S-RABBI-MARKS | Your rabbi marks this | 21 | Rabbi-owned stage, not done |
| D-S-TUTOR-MARKS | Your tutor marks this | 21 | Tutor-owned stage, not done |
| D-S-REHEARSAL | {date} (first rehearsal) | 24 | Due label when the stage uses a rehearsal date |
| D-S-CEREMONY | Ceremony {date} | 15 | Footer line |
| D-S-EARLIER | Earlier stages | 14 | Heading for marks on stages the congregation later removed |

## Stage labels and help (defaults; congregation can edit)

| id | string | chars | note |
|---|---|---|---|
| D-ST-FOCUS | Choose your focus | 17 | Stage 1 label |
| D-ST-FOCUS-HELP | Read the whole portion and choose the part or idea you want to teach. | 69 | Stage 1 help |
| D-ST-OUTLINE | Outline | 7 | Stage 2 label |
| D-ST-OUTLINE-HELP | Plan the main points in order, in your document or on paper. | 60 | Stage 2 help |
| D-ST-DRAFT | First draft | 11 | Stage 3 label |
| D-ST-DRAFT-HELP | Write it all the way through. Mark it ready when someone can read it. | 69 | Stage 3 help |
| D-ST-FEEDBACK | Feedback on the draft | 21 | Stage 4 label |
| D-ST-FEEDBACK-HELP | Your rabbi or tutor leaves comments in your document. | 53 | Stage 4 help |
| D-ST-FINAL | Final text | 10 | Stage 5 label |
| D-ST-FINAL-HELP | Your rabbi reads the finished text and approves it. | 51 | Stage 5 help |
| D-ST-ALOUD | Read it aloud | 13 | Stage 6 label |
| D-ST-ALOUD-HELP | Read it aloud to your tutor, at the pace you'll use on the day. | 63 | Stage 6 help |

## Tutor and rabbi on one student (D'var Torah tab)

| id | string | chars | note |
|---|---|---|---|
| D-T-TAB | D'var Torah | 11 | Fourth tab, after Lessons |
| D-T-DOC | Document | 8 | Row label |
| D-T-DOC-OPEN | Open document | 13 | Link, new tab, no referrer |
| D-T-DOC-OPEN-SR | Open {firstName}'s document in Google Docs (opens a new tab) | 60 | Accessible name |
| D-T-DOC-HELP | Shared by the family. If it won't open, ask them to share it with your email. | 77 | Help line |
| D-T-DOC-EMPTY | No document yet. The student adds the link. | 43 | Empty state |
| D-T-DOC-REMOVE | Remove link | 11 | Rabbi only, for a link that doesn't work |
| D-T-DOC-REMOVE-CONFIRM | Remove this link? The document itself isn't changed. The family can add a new link. | 83 | Rabbi confirm |
| D-T-MARK | Mark done | 9 | Button |
| D-T-FEEDBACK | Feedback given | 14 | Button on Feedback on the draft |
| D-T-APPROVE | Approved | 8 | Button on Final text; rabbi only |
| D-T-UNMARK | Undo | 4 | Text button on a mark the viewer may undo |
| D-T-BY-STUDENT | Marked by the student | 21 | Attribution |
| D-T-BY-PARENT | Marked by a parent in practice | 30 | Attribution |
| D-T-BY-NAME | Marked by {firstName} | 21 | Staff mark; first name only |
| D-T-READY-BY-STUDENT | Marked ready by the student | 27 | First draft attribution |
| D-T-RABBI-MARKS | The rabbi marks this | 20 | Shown to tutors on Final text |
| D-T-DATES | Change dates for this student | 29 | Opens the dates sheet |
| D-T-DATES-H | Dates for {firstName} | 21 | Sheet heading |
| D-T-DATES-HELP | Clear a date to use the congregation's default. | 47 | Sheet help |
| D-T-DATES-SAVE | Save dates | 10 | Primary button |
| D-T-DATES-DEFAULT | Default: {date} | 15 | Under each field |
| D-T-DATES-SAVED | Dates saved. | 12 | Status |
| D-T-DATES-MOVED | The ceremony date changed. Check these dates. | 45 | After a roster date change, if overrides exist |
| D-T-DATES-CLOSE | Some dates are close together. Adjust them if you need to. | 58 | When a stage would fall after the ceremony |
| D-T-DISCARD-Q | Discard your changes? They haven't been saved. | 46 | Roster wording, reused |
| D-T-DISCARD-KEEP | Keep editing | 12 | Roster wording, reused |
| D-T-DISCARD-YES | Discard changes | 15 | Roster wording, reused |

## Rabbi's list (/workspace/admin/dvar-torah)

| id | string | chars | note |
|---|---|---|---|
| D-R-NAV | D'var Torah | 11 | Admin navigation item |
| D-R-TITLE | D'var Torah | 11 | Page heading |
| D-R-SEG-WAITING | Waiting on you | 14 | Segment |
| D-R-SEG-ALL | All upcoming | 12 | Segment |
| D-R-READY | First draft ready · {date} | 26 | Card line |
| D-R-FINAL-DUE | Final text due {date} | 21 | Card line |
| D-R-NEXT | Next: {stage} · due {date} | 26 | All upcoming row |
| D-R-ALL-DONE | All stages done | 15 | All upcoming row |
| D-R-NO-DOC | No document yet | 15 | Card line when doc_id is null |
| D-R-OPEN-STUDENT | Open student | 12 | Link to the student's D'var Torah tab |
| D-R-EMPTY-WAITING | Nothing is waiting on you. | 26 | Empty state |
| D-R-EMPTY-ALL | No upcoming students. | 21 | Empty state |
| D-R-ORDER | In ceremony order | 17 | Subheading for All upcoming |

## Parent view (read only; decided 2026-10-24: stages and dates, never the link)

| id | string | chars | note |
|---|---|---|---|
| D-P-TITLE | D'var Torah | 11 | Summary heading |
| D-P-LAST | {stage} done {date}. | 20 | Last done stage |
| D-P-NEXT | Next: {stage}, due {date}. | 26 | Next stage |
| D-P-NONE | No stage is done yet. The first is {stage}, due {date}. | 55 | Nothing done |
| D-P-ALL | All stages are done. | 20 | Everything done |
| D-P-ABOUT | Your child writes it in a Google Doc they share with their tutor and rabbi. | 75 | Context line |

## Admin settings (stage list)

| id | string | chars | note |
|---|---|---|---|
| D-A-TITLE | D'var Torah stages | 18 | Settings section heading |
| D-A-HELP | Students see these stages and dates. Dates count back from each ceremony. | 73 | Section help |
| D-A-WEEKS | {n} weeks before | 16 | Due summary |
| D-A-WEEK | 1 week before | 13 | n = 1 |
| D-A-ONDAY | On the ceremony day | 19 | n = 0 |
| D-A-REHEARSAL1 | First rehearsal | 15 | Due summary |
| D-A-REHEARSAL2 | Second rehearsal | 16 | Due summary |
| D-A-FALLBACK | If no rehearsal is set: {n} weeks before | 40 | Under a rehearsal stage |
| D-A-OWNER | Owner: {role} | 13 | role = Student / Tutor / Rabbi |
| D-A-OWNER-STUDENT | Student | 7 | Owner option |
| D-A-OWNER-TUTOR | Tutor | 5 | Owner option |
| D-A-OWNER-RABBI | Rabbi | 5 | Owner option |
| D-A-LABEL | Stage name | 10 | Field label; 60 characters max |
| D-A-HELPFIELD | Help line (optional) | 20 | Field label; 200 characters max |
| D-A-DUE | When it's due | 13 | Field group legend |
| D-A-EDIT | Edit | 4 | Row button |
| D-A-ADD | Add a stage | 11 | Button |
| D-A-REMOVE | Remove stage | 12 | Row button |
| D-A-REMOVE-NOTE | Marks already made on this stage are kept. | 42 | Shown on remove |
| D-A-MOVE-UP | Move up | 7 | Row button |
| D-A-MOVE-DOWN | Move down | 9 | Row button |
| D-A-DEFAULTS | Use the defaults | 16 | Resets the draft to the built-in list |
| D-A-SAVE | Save stages | 11 | Primary button |
| D-A-SAVED | Stages saved. | 13 | Status |
| D-A-ERR-COUNT | Keep between 2 and 10 stages. | 29 | Validation |
| D-A-ERR-FINAL | Keep a Final text stage owned by the rabbi. | 43 | Validation |
| D-A-ERR-LABEL | Give each stage a name of 60 characters or fewer. | 49 | Validation |
| D-A-ERR-HELP | Keep each help line to 200 characters or fewer. | 47 | Validation |
| D-A-ERR-WEEKS | Choose 0 to 52 weeks before the ceremony. | 41 | Validation |

## Link errors (inline, under the field)

| id | string | chars | note |
|---|---|---|---|
| D-ERR-NOT-DOC | This isn't a Google Doc link. Copy the link from the Share button in your document. | 83 | Wrong host or shape |
| D-ERR-PUBLISHED | This is a published-to-web link, which anyone can read. Use the document's own link instead. | 92 | /document/d/e/…/pub |
| D-ERR-OTHER-GOOGLE | This link is to another kind of Google file. Use a Google Doc. | 62 | Sheets, Slides, Forms, Drive file |
| D-ERR-TOO-LONG | This link is too long. Copy it again from the Share button. | 59 | Over 512 bytes |
| D-ERR-EMPTY | Paste a link first. | 19 | Empty submit |

## Shared states and errors

| id | string | chars | note |
|---|---|---|---|
| D-LOAD-S | Loading your d'var Torah… | 25 | Student loading, role=status |
| D-LOAD-T | Loading the d'var Torah… | 24 | Tutor tab loading |
| D-LOAD-R | Loading d'var Torah stages… | 27 | Rabbi list loading |
| D-ERR-LOAD-S | Your d'var Torah couldn't be loaded. | 36 | Student load error |
| D-ERR-LOAD-T | The d'var Torah couldn't be loaded. | 35 | Tutor load error |
| D-ERR-LOAD-R | The list couldn't be loaded, so none of it is shown. | 52 | Rabbi list error, roster pattern |
| D-RELOAD | Reload | 6 | Button |
| D-CONFLICT | This changed since you opened it. Nothing was overwritten. | 58 | 409 |
| D-UNCLEAR | We couldn't confirm whether this saved. Reload to check before trying again. | 76 | Unclear outcome, roster wording |
| D-DENIED | This change isn't allowed any more. Reload to check your access. | 64 | 401/403/404, roster wording |
| D-OFFLINE | This needs a connection. Your stages show again when you're back online. | 72 | Offline in the installed app |
| D-DISABLED | This student is disabled. Their stages are kept for reference. | 62 | Staff view of a disabled student |

## Open, tied to B3 questions

- The D-S-FOCUS-* strings are removed: Q2 is decided, no free-text focus line (Batch 3b Q19).
- D-P-* ship: parents see stages and dates, never the link (Daniel 2026-10-24, Batch 3 Q14). No string gives a parent the document link.
- The stage labels and help lines are placeholders until CRC's guide arrives (B2 header).
